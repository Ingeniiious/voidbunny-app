import { Router } from 'express';

const router = Router();

const MAX_AUDIO_BYTES = 5 * 1024 * 1024; // 5 MB — Whisper accepts 25 MB but we cap tighter
const TRANSCRIBE_URL = 'https://api.openai.com/v1/audio/transcriptions';
const DEFAULT_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe';

function readRawBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        const err = new Error('audio payload too large');
        err.status = 413;
        req.destroy();
        reject(err);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function extFor(contentType) {
  if (contentType.includes('webm')) return 'webm';
  if (contentType.includes('mp4') || contentType.includes('m4a')) return 'm4a';
  if (contentType.includes('mpeg')) return 'mp3';
  if (contentType.includes('wav')) return 'wav';
  if (contentType.includes('ogg')) return 'ogg';
  return 'webm';
}

router.post('/transcribe', async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'OPENAI_API_KEY not configured on the server' });
  }

  const ua = req.get('user-agent') || '';
  const rawContentType = (req.get('content-type') || 'audio/webm').toLowerCase();
  // OpenAI's audio API validates the multipart `file` field's content-type
  // strictly. iPad Safari hands MediaRecorder blobs back as
  // `audio/mp4;codecs="mp4a.40.2"` (with the codec param) while iPhone often
  // returns the bare `audio/mp4` — and OpenAI rejects the parameterised
  // variant with "invalid field value". Stripping params before we forward
  // keeps the type tidy on every client. Extension is derived from the bare
  // base type so the filename suffix (.m4a, .webm, etc.) stays correct too.
  const baseContentType = rawContentType.split(';')[0].trim() || 'audio/webm';
  const ext = extFor(baseContentType);

  try {
    const audio = await readRawBody(req, MAX_AUDIO_BYTES);
    if (audio.length === 0) {
      return res.status(400).json({ error: 'empty audio body' });
    }

    const form = new FormData();
    form.append('file', new Blob([audio], { type: baseContentType }), `clip.${ext}`);
    form.append('model', DEFAULT_MODEL);
    form.append('response_format', 'json');

    const response = await fetch(TRANSCRIBE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });

    if (!response.ok) {
      const body = await response.text();
      // Surface enough context in journald to debug per-device failures
      // without a third-party error tracker. Everything's stderr so a
      // `journalctl -u panel -f --grep=transcribe` tails live.
      console.error('[transcribe] OpenAI rejected', JSON.stringify({
        status: response.status,
        rawContentType,
        baseContentType,
        ext,
        bytes: audio.length,
        ua,
        openaiBody: body.slice(0, 600),
      }));
      return res.status(response.status).json({
        error: body.slice(0, 600),
        // Echo the diagnostic context back so the client toast can show
        // what was actually sent — invaluable when only one device fails.
        diagnostics: { rawContentType, baseContentType, ext, bytes: audio.length },
      });
    }

    const data = await response.json();
    res.json({ text: typeof data.text === 'string' ? data.text : '' });
  } catch (err) {
    const status = err.status ?? 500;
    console.error('[transcribe] failed', JSON.stringify({
      status,
      rawContentType,
      baseContentType,
      ext,
      ua,
      message: err.message,
    }));
    res.status(status).json({ error: err.message });
  }
});

export default router;
