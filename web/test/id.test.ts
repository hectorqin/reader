import { expect, it, vi } from 'vitest';
import { newId } from '../src/core/id.ts';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

it('uses the LAN-compatible ID helper everywhere instead of secure-context UUID APIs', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
    );
  const src = join(process.cwd(), 'src');
  const offenders = walk(src)
    .filter((file) => relative(src, file) !== join('core', 'id.ts'))
    .filter((file) =>
      /\bcrypto\s*(?:(?:\?\.|\.)\s*randomUUID\b|(?:\?\.)?\s*\[\s*['"]randomUUID['"]\s*\])/.test(
        readFileSync(file, 'utf8'),
      ),
    )
    .map((file) => relative(src, file));
  expect(offenders).toEqual([]);
});

it('generates distinct RFC 4122 v4 record IDs without randomUUID on LAN HTTP', () => {
  const random = globalThis.crypto;
  vi.stubGlobal('crypto', { getRandomValues: random.getRandomValues.bind(random) });
  try {
    const values = Array.from({ length: 1000 }, () => newId());
    expect(new Set(values).size).toBe(values.length);
    for (const value of values)
      expect(value).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  } finally {
    vi.unstubAllGlobals();
  }
});
