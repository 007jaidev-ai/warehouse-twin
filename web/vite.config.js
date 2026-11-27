import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const r = (p) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  base: './',
  server: { port: 5173, open: false },
  build: {
    rollupOptions: {
      // index = landing (v2), app = the live twin, landing-v1 = archived first cut
      input: {
        main: r('./index.html'),
        app: r('./app.html'),
        v1: r('./landing-v1.html'),
      },
    },
  },
});
