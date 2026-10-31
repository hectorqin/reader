import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, it } from 'vitest';

/**
 * Every class a stylesheet names must be one the source can render.
 *
 * The media stylesheets grew by layering and replaced screens left their rules
 * behind (~300 lines of them), and a rule for a class nothing uses is where the next
 * change gets made, to no effect. The check has to know the two ways a class name is
 * *built* rather than written, because getting that wrong deletes live styles — which
 * is exactly what happened to the ⋯ menu rows (`${base}-item`, base 'action-menu' or
 * 'sheet-list'):
 *
 *  - `${expr}-suffix`: any class ending in `-suffix` whose prefix the source spells
 *    as a string literal;
 *  - `prefix-${expr}`: any class starting with `prefix-`.
 *
 * Library markup (Notyf, DPlayer) is theirs, not ours. A class inside :not() is matched
 * by its absence, so it need not exist.
 */
const src = join(import.meta.dirname, '..', 'src');
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]);

it('styles only classes that the source renders', () => {
  const code = files(src).filter(file => /\.tsx?$/.test(file)).map(file => readFileSync(file, 'utf8')).join('\n');
  const builtSuffixes = new Set([...code.matchAll(/\$\{[\w.]+\}-([a-z][\w-]*)/g)].map(match => match[1]!));
  const builtPrefixes = new Set([...code.matchAll(/[`'" ]([a-z][\w-]*-)\$\{/g)].map(match => match[1]!));
  const literal = (text: string) => new RegExp(`['"\`]${text}['"\`]`).test(code);
  const used = (cls: string) => code.includes(cls)
    || [...builtPrefixes].some(prefix => cls.startsWith(prefix))
    || [...builtSuffixes].some(suffix => cls.endsWith('-' + suffix) && literal(cls.slice(0, -suffix.length - 1)));
  const unused = files(src).filter(file => file.endsWith('.css')).flatMap(file => {
    const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/:not\([^)]*\)/g, '');
    const names = new Set([...css.matchAll(/\.(-?[a-zA-Z_][\w-]*)/g)].map(match => match[1]!));
    return [...names].filter(cls => !/^(dplayer|notyf)/.test(cls) && !used(cls)).map(cls => `${relative(src, file)}: .${cls}`);
  });
  expect(unused).toEqual([]);
});
