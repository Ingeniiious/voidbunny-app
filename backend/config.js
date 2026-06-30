import os from 'node:os';
import path from 'node:path';

export const PANEL_HOME = path.resolve(process.env.PANEL_HOME || process.env.HOME || os.homedir());
export const PANEL_UPLOADS_ROOT = path.resolve(
  process.env.PANEL_UPLOADS_ROOT || path.join(PANEL_HOME, 'voidbunny-uploads'),
);
