import { defineConfig } from 'vite';

// Relative base so the build works from any GitHub Pages sub-path.
export default defineConfig({
  base: './',
  // Keep the Vite 7 browser baseline when upgrading the bundler.
  build: { target: ['chrome107', 'edge107', 'firefox104', 'safari16'] },
  // Only the public build, never the source-serving dev server, accepts opaque frames.
  preview: { cors: { origin: ['http://127.0.0.1:4173', 'http://127.0.0.1:4174', 'null'] } },
});
