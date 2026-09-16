import { defineConfig } from 'vitest/config';

// The build output is consumed twice:
//   - served directly by the server for the browser/H5 build
//   - copied into the Android app's assets and loaded from file:// in a WebView
//
// Because of the second consumer the build is a single self-contained bundle
// with relative asset URLs (base: './') and no code-splitting: a WebView loading
// from file:// cannot fetch sibling chunks over the network, and every extra
// request through the file protocol is a chance to meet a platform quirk.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: 'assets/client.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
    modulePreload: { polyfill: false },
  },
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: process.env.READER_SERVER ?? 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
