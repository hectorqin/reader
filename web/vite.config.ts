import { defineConfig } from 'vite';

/**
 * The renderer is a plain TypeScript library with one entry point, built to a
 * static bundle. There is no framework here on purpose:
 *
 *  - The hot path is imperative DOM work (splicing chapter documents into a
 *    container, sizing pages, keeping scroll position across a chapter swap).
 *    React's model would force the book's own DOM through a reconciler that must
 *    not touch it.
 *  - The same bundle is served by the server to browsers and packaged into the
 *    Android app's assets. A framework runtime would be dead weight in both.
 *
 * `base: './'` is what makes the second use case work: the Android shell loads
 * the files from `file:///android_asset/`, where an absolute `/assets/...` path
 * resolves to the filesystem root.
 */
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      input: 'index.html',
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
  },
});
