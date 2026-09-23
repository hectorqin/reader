import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Plugin } from 'vite';

/** Include the actual emitted HTML, CSS, fonts and public assets in one version. */
export function pwa() {
  return {
    name: 'reader-pwa',
    apply: 'build',
    async writeBundle(options) {
      const directory = resolve(options.dir ?? 'dist');
      const files = (await readdir(directory, { recursive: true, withFileTypes: true }))
        .filter((entry) => entry.isFile())
        .map((entry) => join(entry.parentPath, entry.name).slice(directory.length + 1).replaceAll('\\', '/'))
        .filter((name) => name !== 'sw.js' && !name.endsWith('.map'))
        .sort();
      const template = await readFile(new URL('./sw.js', import.meta.url), 'utf8');
      const digest = createHash('sha256').update(template);
      for (const file of files) digest.update(file).update(await readFile(join(directory, file)));
      const worker = template.replace('__VERSION__', digest.digest('hex').slice(0, 20))
        .replace('__PRECACHE__', JSON.stringify(files));
      await writeFile(join(directory, 'sw.js'), worker);
    },
  } satisfies Plugin;
}
