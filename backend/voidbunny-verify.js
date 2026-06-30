// /api/voidbunny/claim-verify
//
// During the subdomain-claim handshake, the site server makes an outbound
// HTTP request to the user's box to confirm the box is actually running
// Voidbunny. The installer writes a short-lived verify-token to a known
// file path BEFORE calling /api/subdomain/claim on the site. The site
// then GETs this endpoint and matches the returned token against the one
// the dashboard issued.
//
// A phisher with a generic webserver can't satisfy this — the response
// shape is Voidbunny-specific. The token file is removed after a
// successful claim so this endpoint can't be reused as a long-lived
// fingerprint.

import fs from 'node:fs/promises';
import express from 'express';

const TOKEN_FILE = process.env.VOIDBUNNY_CLAIM_FILE || '/etc/voidbunny/claim.json';
const RESPONSE_KIND = 'voidbunny.claim-verify.v1';

const router = express.Router();

router.get('/voidbunny/claim-verify', async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const raw = await fs.readFile(TOKEN_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.verify_token !== 'string') {
      return res.status(404).json({ kind: RESPONSE_KIND, error: 'no-pending-claim' });
    }
    return res.json({
      kind: RESPONSE_KIND,
      verify_token: parsed.verify_token,
    });
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return res.status(404).json({ kind: RESPONSE_KIND, error: 'no-pending-claim' });
    }
    return res.status(500).json({ kind: RESPONSE_KIND, error: 'read-failed' });
  }
});

export default router;
