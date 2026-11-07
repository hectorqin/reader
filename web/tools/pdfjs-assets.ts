import { createReadStream } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import type { Plugin } from 'vite';

const root = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
const folders = ['cmaps', 'standard_fonts', 'wasm'];

export function pdfjsAssets(): Plugin {
  return {
    name: 'reader-pdfjs-assets',
    configureServer(server) {
      server.middlewares.use('/pdfjs', (request, response, next) => {
        const match = /^\/(cmaps|standard_fonts|wasm)\/([\w.-]+)$/.exec(request.url?.split('?')[0] ?? '');
        if (!match) return next();
        response.setHeader('content-type', match[2]?.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream');
        const stream = createReadStream(join(root, match[1]!, match[2]!));
        stream.on('error', () => { response.statusCode = 404; response.end(); });
        stream.pipe(response);
      });
    },
    async generateBundle() {
      for (const folder of folders) {
        for (const file of await readdir(join(root, folder))) {
          this.emitFile({ type: 'asset', fileName: `pdfjs/${folder}/${file}`, source: await readFile(join(root, folder, file)) });
        }
      }
    },
  };
}
