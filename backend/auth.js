import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { createHash } from 'node:crypto';

const router = Router();

const WINDOW_MS = 60 * 1000;
const MAX_ATTEMPTS = 10;

function fingerprint(req) {
  const h = createHash('sha256');
  h.update(req.headers['user-agent'] ?? '');
  h.update('|');
  h.update(req.headers['accept-language'] ?? '');
  h.update('|');
  h.update(req.headers['accept-encoding'] ?? '');
  h.update('|');
  h.update(req.headers['sec-ch-ua'] ?? '');
  h.update('|');
  h.update(req.headers['sec-ch-ua-platform'] ?? '');
  return h.digest('hex').slice(0, 32);
}

const handler = (_req, res) => res.status(429).json({ error: 'too many login attempts, slow down' });

const ipLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: MAX_ATTEMPTS,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Use the lib's helper so IPv6 addresses are normalized (a /64 prefix
  // counts as one client, so attackers can't bypass by rotating /128s).
  keyGenerator: (req, res) => `ip:${ipKeyGenerator(req, res)}`,
  handler,
});

const fpLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: MAX_ATTEMPTS,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: (req) => `fp:${fingerprint(req)}`,
  handler,
});

const JWT_SECRET = process.env.JWT_SECRET;
const PANEL_USERNAME = process.env.PANEL_USERNAME;
const PANEL_PASSWORD = process.env.PANEL_PASSWORD;

if (!JWT_SECRET || !PANEL_USERNAME || !PANEL_PASSWORD) {
  throw new Error('Missing required env vars: JWT_SECRET, PANEL_USERNAME, PANEL_PASSWORD');
}

const isBcryptHash = PANEL_PASSWORD.startsWith('$2a$') || PANEL_PASSWORD.startsWith('$2b$') || PANEL_PASSWORD.startsWith('$2y$');

router.post('/', ipLimiter, fpLimiter, async (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'username and password required' });
  }

  const userOk = username === PANEL_USERNAME;
  const passOk = isBcryptHash
    ? await bcrypt.compare(password, PANEL_PASSWORD)
    : password === PANEL_PASSWORD;

  if (!userOk || !passOk) {
    console.warn(`[auth] login fail ip=${req.ip} user=${JSON.stringify(username).slice(0, 64)}`);
    return res.status(401).json({ error: 'invalid credentials' });
  }

  console.log(`[auth] login ok ip=${req.ip} user=${username}`);
  const token = jwt.sign({ sub: username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token });
});

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'missing bearer token' });
  }
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: 'invalid token' });
  }
}

export default router;
