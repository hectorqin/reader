import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = join(import.meta.dirname, '../src');
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
  .flatMap(entry => entry.isDirectory() ? files(join(dir, entry.name)) : entry.name.endsWith('.tsx') ? [join(dir, entry.name)] : []);

describe('下拉框', () => {
  // ui.md §10: one drop-down. The two controls below own the (hidden) native element;
  // a screen writing its own `<select>` gets the platform's look instead of the theme's.
  it('only ui/select.tsx and ui/searchable-select.tsx render a native <select>', () => {
    const owners = new Set(['ui/select.tsx', 'ui/searchable-select.tsx']);
    const offenders = files(src)
      .filter(file => /<select[\s>]/.test(readFileSync(file, 'utf8')))
      .map(file => file.slice(src.length + 1).replaceAll('\\', '/'))
      .filter(file => !owners.has(file));
    expect(offenders).toEqual([]);
  });
});
