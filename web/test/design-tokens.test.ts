import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ui.md §2: the interface layer reads its scales from tokens. This keeps the radius
 * scale from drifting back to "one more pixel" literals one rule at a time.
 */
const root = join(import.meta.dirname, '..', 'src');
const stylesheets = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const path = join(dir, entry.name);
  return entry.isDirectory() ? stylesheets(path) : entry.name.endsWith('.css') ? [path] : [];
});

describe('design tokens', () => {
  it('uses --radius-* instead of literal corner radii (ui.md §2.6)', () => {
    const offenders = stylesheets(root).flatMap(file => {
      const source = readFileSync(file, 'utf8');
      return [...source.matchAll(/border-radius:\s*[^;}]*?\b\d*\.?\d+(?:px|rem)[^;}]*/g)]
        .map(match => match[0].trim())
        .map(declaration => `${relative(root, file)}: ${declaration}`);
    });
    expect(offenders).toEqual([]);
  });
});
