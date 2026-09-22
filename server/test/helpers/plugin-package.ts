import { gzipSync } from 'node:zlib';

/** Small npm-compatible tar fixture, so installation tests do not contact a registry. */
export function pluginArchive(name = '@reader/example', pluginId = 'test.upload', valid = true): Buffer {
  const files: Record<string, string> = {
    'package.json': JSON.stringify({ name, version: '1.0.0', scripts: {
      postinstall: 'node -e "require(\'fs\').writeFileSync(\'lifecycle-ran\', \'yes\')"',
    } }),
    'plugin.json': valid ? JSON.stringify({ id: pluginId, name: 'Upload example', version: '1.0.0',
      apiVersion: 1, runtime: 'node', entry: 'main.mjs', sourceTypes: [{ id: 'test', label: 'Test', capabilities: ['detail'] }] }) : '{}',
    'main.mjs': `import { createInterface } from 'node:readline';
      createInterface({ input: process.stdin }).on('line', line => {
        const request = JSON.parse(line);
        process.stdout.write(JSON.stringify({jsonrpc:'2.0', id:request.id, result:{ref:'book',title:'Installed book'}})+'\\n');
      });`,
  };
  const chunks: Buffer[] = [];
  for (const [path, text] of Object.entries(files)) {
    const content = Buffer.from(text), header = Buffer.alloc(512);
    header.write('package/' + path);
    for (const [offset, length, value] of [[100, 8, 0o644], [108, 8, 0], [116, 8, 0], [124, 12, content.length], [136, 12, 0]]) {
      header.write(value!.toString(8).padStart(length! - 1, '0') + '\0', offset!, length!);
    }
    header.fill(32, 148, 156); header.write('0', 156); header.write('ustar\0', 257); header.write('00', 263);
    header.write(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148, 8);
    chunks.push(header, content, Buffer.alloc((512 - content.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]));
}
