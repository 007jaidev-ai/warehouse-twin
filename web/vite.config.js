import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const r = (p) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  base: './',
  server: { port: 5173, open: false },
  build: {
    rollupOptions: {
      // index = landing page, app = the live twin
      input: {
        main: r('./index.html'),
        app: r('./app.html'),
      },
    },
  },
});
