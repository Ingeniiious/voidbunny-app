import { WebSocketServer } from 'ws';
import { spawn } from 'node:child_process';
import { consumeTicket } from './tickets.js';

// Phone-mic → ALSA-loopback bridge.
//
// The phone's browser captures audio via getUserMedia, downsamples to 16 kHz
// mono s16le in an AudioWorklet, and streams binary frames over this WS.
// We pipe those frames straight into `aplay` writing to the `snd-aloop`
// playback side. The kernel mirrors that to the capture side, which is the
// ALSA default — so Claude Code's `/voice` (`rec`/`arecord -d`) reads the
// phone mic as if it were a local USB device.
//
// One bridge at a time: snd-aloop's subdevice 0 is single-writer, and there's
// only one user typing `/voice` at the panel. A new connection closes any
// previous one.

const ALOOP_DEVICE = process.env.PANEL_VOICE_DEVICE || 'hw:Loopback,0,0';
// 16 kHz mono s16le matches Claude Code's `rec`/`arecord` recording format
// exactly — no resampling on the receive side and no rate mismatch across
// the loopback.
const SAMPLE_RATE = 16000;
// PCM @ 16k mono = 32 KB/s. 64 KB per message gives us a comfortable headroom
// over 20–40 ms chunks without letting a single message tie up the event loop.
const MAX_MESSAGE_BYTES = 64 * 1024;
// Idle close: if a peer connects but stops sending frames (tab backgrounded,
// network drop), don't keep aplay alive forever. ping/pong keeps real peers
// from getting reaped here.
const IDLE_TIMEOUT_MS = 30_000;
const PING_INTERVAL_MS = 15_000;

let currentBridge = null; // { ws, aplay, lastDataAt }

function killSafe(child, signal) {
  if (!child) return;
  try { child.kill(signal); } catch { /* already dead */ }
}

function teardown(bridge, reason) {
  if (!bridge) return;
  if (currentBridge === bridge) currentBridge = null;
  const { ws, aplay, idleTimer, pingTimer } = bridge;
  if (idleTimer) clearInterval(idleTimer);
  if (pingTimer) clearInterval(pingTimer);
  // Close stdin first so aplay flushes its remaining buffer and exits cleanly.
  try { aplay.stdin.end(); } catch { /* already ended */ }
  killSafe(aplay, 'SIGTERM');
  setTimeout(() => killSafe(aplay, 'SIGKILL'), 500).unref();
  try { ws.close(1000, reason ?? 'closed'); } catch { /* already closed */ }
  console.log(`[audio-bridge] closed (${reason ?? 'unspecified'})`);
}

function rejectUpgrade(socket, code, reason) {
  socket.write(`HTTP/1.1 ${code} ${reason}\r\n\r\n`);
  socket.destroy();
}

export function attachAudioBridge(server) {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_MESSAGE_BYTES,
  });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/audio-bridge') return; // not ours

    const ticket = url.searchParams.get('ticket');
    if (!consumeTicket(ticket)) return rejectUpgrade(socket, 401, 'Unauthorized');

    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws) => {
    // Boot any in-flight bridge before claiming the device — otherwise the
    // new aplay would fail with EBUSY on the loopback subdevice.
    if (currentBridge) teardown(currentBridge, 'superseded');

    const aplay = spawn(
      'aplay',
      [
        '-q',
        '-D', ALOOP_DEVICE,
        '-t', 'raw',
        '-f', 'S16_LE',
        '-r', String(SAMPLE_RATE),
        '-c', '1',
      ],
      { stdio: ['pipe', 'ignore', 'pipe'] },
    );

    const bridge = { ws, aplay, lastDataAt: Date.now(), idleTimer: null, pingTimer: null };
    currentBridge = bridge;

    // aplay logs ALSA errors (EBUSY, missing device, bad rate) to stderr.
    // Capture so the operator can find them in journalctl when something's
    // wrong with snd-aloop or ~/.asoundrc.
    let stderrBuf = '';
    aplay.stderr.on('data', (chunk) => {
      stderrBuf += chunk.toString();
      if (stderrBuf.length > 4096) stderrBuf = stderrBuf.slice(-2048);
    });

    aplay.on('error', (err) => {
      console.error(`[audio-bridge] aplay spawn error:`, err.message);
      teardown(bridge, 'aplay spawn error');
    });

    aplay.on('exit', (code, signal) => {
      // aplay exits with code 0 on EOF (stdin closed) or non-zero if ALSA
      // refused the device. Either way, the bridge is over for this peer.
      if (code !== 0 && code != null) {
        console.warn(`[audio-bridge] aplay exited ${code}${signal ? ` (${signal})` : ''}: ${stderrBuf.trim().slice(-500)}`);
      }
      teardown(bridge, 'aplay exit');
    });

    aplay.stdin.on('error', (err) => {
      // EPIPE if aplay dies mid-write. Already handled by `exit` above.
      if (err.code !== 'EPIPE') {
        console.warn(`[audio-bridge] aplay stdin error:`, err.message);
      }
    });

    ws.on('message', (data, isBinary) => {
      if (!isBinary) return; // ignore text control frames; the protocol is pure binary
      bridge.lastDataAt = Date.now();
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      const ok = aplay.stdin.write(buf);
      if (!ok) {
        // Backpressure: pause the WS so the browser stops sending. This
        // should be extremely rare at 32 KB/s but keeps us correct if the
        // kernel ever blocks the aplay write.
        ws.pause();
        aplay.stdin.once('drain', () => { try { ws.resume(); } catch { /* ignore */ } });
      }
    });

    bridge.pingTimer = setInterval(() => {
      if (ws.readyState !== ws.OPEN) return;
      try { ws.ping(); } catch { /* socket dying */ }
    }, PING_INTERVAL_MS);

    bridge.idleTimer = setInterval(() => {
      if (Date.now() - bridge.lastDataAt > IDLE_TIMEOUT_MS) {
        teardown(bridge, 'idle');
      }
    }, 5_000);

    ws.on('close', () => teardown(bridge, 'ws close'));
    ws.on('error', (err) => {
      console.warn(`[audio-bridge] ws error:`, err.message);
      teardown(bridge, 'ws error');
    });

    // ack so the client UI can flip its status to "connected"
    try { ws.send(JSON.stringify({ type: 'ready' })); } catch { /* ignore */ }
    console.log('[audio-bridge] connected, streaming to', ALOOP_DEVICE);
  });
}

// Clean up on process exit so a SIGTERM-driven restart doesn't leave aplay
// holding the loopback (which would block the next startup).
function shutdown() {
  if (currentBridge) teardown(currentBridge, 'panel shutdown');
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
