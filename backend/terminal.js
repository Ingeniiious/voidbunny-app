import { WebSocketServer } from 'ws';
import pty from 'node-pty';
import { consumeTicket } from './tickets.js';
import { isValidSid, sessionExists, sessionKnownLocally, TMUX_BIN, TMUX_SOCK, TMUX_CONF } from './sessions.js';
import { PANEL_HOME } from './config.js';

const CWD = PANEL_HOME;

function rejectUpgrade(socket, code, reason) {
  socket.write(`HTTP/1.1 ${code} ${reason}\r\n\r\n`);
  socket.destroy();
}

export function attachTerminal(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    // Don't destroy non-/terminal upgrades — other modules (browser.js) may
    // own them. They register their own 'upgrade' handlers on the same server.
    if (url.pathname !== '/terminal') return;

    const ticket = url.searchParams.get('ticket');
    if (!consumeTicket(ticket)) return rejectUpgrade(socket, 401, 'Unauthorized');

    const sid = url.searchParams.get('sid');
    if (!isValidSid(sid)) return rejectUpgrade(socket, 400, 'Bad Request');
    // Fast path: the sid was returned by POST /sessions (or seen via GET) and
    // we haven't watched it die, so skip the tmux fork. Fall back to the
    // authoritative check for sids we've never seen — handles direct WS
    // attempts and post-restart cases before GET /sessions repopulates.
    if (!sessionKnownLocally(sid) && !(await sessionExists(sid))) {
      return rejectUpgrade(socket, 404, 'Not Found');
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, { sid });
    });
  });

  wss.on('connection', (ws, _req, { sid }) => {
    // node-pty wraps a `tmux attach`. Closing the WS kills only this client,
    // not the tmux session — that's what gives us persistence.
    const term = pty.spawn(
      TMUX_BIN,
      ['-L', TMUX_SOCK, '-f', TMUX_CONF, 'attach-session', '-t', sid],
      {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: CWD,
        env: { ...process.env, TERM: 'xterm-256color' },
      },
    );

    term.onData((data) => {
      if (ws.readyState === ws.OPEN) ws.send(data);
    });

    term.onExit(() => {
      if (ws.readyState === ws.OPEN) ws.close();
    });

    ws.on('message', (raw) => {
      const text = raw.toString();
      if (text.length > 0 && text.charCodeAt(0) === 0x7b) {
        try {
          const msg = JSON.parse(text);
          if (msg && msg.type === 'resize' && Number.isInteger(msg.cols) && Number.isInteger(msg.rows)) {
            term.resize(msg.cols, msg.rows);
            return;
          }
        } catch {
          // not JSON — treat as raw input
        }
      }
      term.write(text);
    });

    ws.on('close', () => {
      try { term.kill(); } catch { /* already gone */ }
    });
  });
}
