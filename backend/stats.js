import { Router } from 'express';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_VERSION = (() => {
  try {
    return JSON.parse(readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

const router = Router();

router.get('/version', (_req, res) => {
  res.json({ version: PKG_VERSION });
});

// Parse /proc/meminfo into a map of bytes. We rely on MemAvailable rather than
// MemFree because Linux aggressively uses RAM for page cache; "free" memory
// looks alarmingly low even on idle systems.
async function readMeminfo() {
  const data = await fs.readFile('/proc/meminfo', 'utf8');
  const out = {};
  for (const line of data.split('\n')) {
    const m = line.match(/^([A-Za-z()]+):\s+(\d+)\s*kB?/);
    if (m) out[m[1]] = Number(m[2]) * 1024;
  }
  return out;
}

router.get('/stats', async (_req, res) => {
  try {
    const mem = await readMeminfo().catch(() => ({}));
    const memTotal = mem.MemTotal ?? os.totalmem();
    const memAvailable = mem.MemAvailable ?? os.freemem();
    const memUsed = Math.max(0, memTotal - memAvailable);

    const cpuCount = os.cpus().length || 1;
    const [load1, load5, load15] = os.loadavg();

    let disk = null;
    try {
      // fs.statfs landed in Node 18.15. Wrap in try in case of unusual envs.
      const st = await fs.statfs('/');
      const total = Number(st.blocks) * Number(st.bsize);
      const free = Number(st.bavail) * Number(st.bsize);
      disk = { total, used: Math.max(0, total - free) };
    } catch { /* ignore */ }

    res.json({
      mem: { total: memTotal, used: memUsed, available: memAvailable },
      cpu: { count: cpuCount, load1, load5, load15 },
      disk,
      uptime: os.uptime(),
      ts: Date.now(),
      version: PKG_VERSION,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
