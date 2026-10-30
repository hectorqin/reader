import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

/**
 * The media stylesheets grew by layering (media → presentation → v2 → manager), and
 * screens that were replaced left their rules behind: ~300 lines styled class names no
 * component renders any more. A rule for a class nothing uses is not harmless — it is
 * where the next change gets made, to no effect. Every class the media styles name must
 * appear somewhere in the source; DPlayer's own classes are its markup, not ours.
 */
const src = join(import.meta.dirname, '..', 'src');
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]);

it('styles only classes that the source renders (media stylesheets)', () => {
  const code = files(src).filter(file => /\.tsx?$/.test(file)).map(file => readFileSync(file, 'utf8')).join('\n');
  const styles = join(src, 'features', 'media', 'styles');
  const unused = readdirSync(styles).filter(name => name.endsWith('.css')).flatMap(name => {
    // A class inside :not() is matched by its absence, so it need not exist.
    const css = readFileSync(join(styles, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/:not\([^)]*\)/g, '');
    const names = new Set([...css.matchAll(/\.(-?[a-zA-Z_][\w-]*)/g)].map(match => match[1]!));
    return [...names].filter(cls => !cls.startsWith('dplayer') && !code.includes(cls)).map(cls => `${name}: .${cls}`);
  });
  expect(unused).toEqual([]);
});
