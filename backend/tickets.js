import { Router } from 'express';
import { randomBytes } from 'node:crypto';

// Short-lived single-use tickets for WebSocket upgrades. Keeps the JWT off
// the URL (and out of Caddy's access log + browser history).
const TTL_MS = 15 * 1000;
const tickets = new Map(); // ticket -> expiresAt (ms)

function issueTicket() {
  const ticket = randomBytes(32).toString('base64url');
  tickets.set(ticket, Date.now() + TTL_MS);
  return ticket;
}

export function consumeTicket(ticket) {
  if (typeof ticket !== 'string' || ticket.length === 0) return false;
  const expiresAt = tickets.get(ticket);
  if (expiresAt === undefined) return false;
  tickets.delete(ticket);
  return expiresAt > Date.now();
}

// Sweep expired tickets so the map can't grow without bound if clients
// never consume what they request.
setInterval(() => {
  const now = Date.now();
  for (const [t, exp] of tickets) {
    if (exp <= now) tickets.delete(t);
  }
}, 30 * 1000).unref();

const router = Router();
router.get('/ws-ticket', (_req, res) => {
  res.json({ ticket: issueTicket() });
});

export default router;
