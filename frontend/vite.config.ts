import path from 'node:path';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'));

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  // ES2022 so top-level await (used by @novnc/novnc for WebCodecs detection) builds.
  build: {
    target: 'es2022',
  },
  esbuild: {
    target: 'es2022',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:4000',
      '/terminal': {
        target: 'ws://127.0.0.1:4000',
        ws: true,
      },
      '/browser': {
        target: 'ws://127.0.0.1:4000',
        ws: true,
      },
    },
  },
});
