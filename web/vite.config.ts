import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { pwa } from './tools/pwa/build.ts';

// The build output is consumed three ways:
//   - served directly by the server for the browser/H5 build
//   - precached by the service worker (tools/pwa/build.ts lists every emitted file)
//   - copied into the Android app's assets and served by WebViewAssetLoader from
//     https://appassets.androidplatform.net/ (see WebHost.kt), not from file://
//
// So relative asset URLs (base: './'), a fixed entry name (client.js) and one
// stylesheet (index.css, so a lazily loaded screen never paints unstyled), but
// rarely used screens (the reader, admin pages; app/router/lazy-pages.tsx) are
// split into content-hashed chunks: every host fetches them like any sibling file,
// and the server caches the hashed names forever.
export default defineConfig({
  plugins: [react(), pwa()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    assetsInlineLimit: 0,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/client.js',
        chunkFileNames: 'assets/[name]-[hash].js',
        // With cssCodeSplit off Vite names the one stylesheet style.css; keep index.css.
        assetFileNames: asset => asset.names?.[0] === 'style.css' ? 'assets/index.css' : 'assets/[name][extname]',
      },
    },
    modulePreload: { polyfill: false },
  },
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: process.env.READER_SERVER ?? 'http://127.0.0.1:5888',
        changeOrigin: true,
      },
    },
    allowedHosts: true
  },
  test: {
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    // The `node:test` files are run by `tsx --test` (see package.json), because
    // they were written for the Node test runner and importing a vitest test
    // file from one process, or vice versa, silently produces "no test suite
    // found". Excluding them here keeps each runner to the files it can actually
    // execute, instead of a green-looking run that quietly skipped half the suite.
    exclude: [
      'test/api.test.ts',
      'test/asset-url.test.ts',
      'test/paginator.test.ts',
      'test/window.test.ts',
      'test/windowed-toc.test.ts',
      'node_modules/**',
    ],
  },
});
