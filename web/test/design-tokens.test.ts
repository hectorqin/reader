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

  it('uses --text-* instead of literal font sizes up to 24px (ui.md §2.2)', () => {
    // Above 24px is decorative (a player's initial, a hero numeral) and stays literal.
    const offenders = stylesheets(root).flatMap(file => {
      const source = readFileSync(file, 'utf8');
      return [...source.matchAll(/font-size:\s*(\d*\.?\d+)(px|rem)/g)]
        .filter(([, size, unit]) => (unit === 'rem' ? Number(size) * 16 : Number(size)) <= 24)
        .map(match => `${relative(root, file)}: ${match[0]}`);
    });
    expect(offenders).toEqual([]);
  });

  it('keeps every typed field at 16px+ on touch screens so iOS does not zoom (ui.md §3.3)', () => {
    const shell = readFileSync(join(root, 'app', 'shell.css'), 'utf8');
    expect(shell).toMatch(/@media \(pointer: coarse\) \{\s*:is\(input:not\([^)]*\), textarea, select\) \{\s*font-size: max\(var\(--text-title\), 1em\) !important;/);
  });

  it('times transitions with the motion tokens (ui.md §2.3)', () => {
    // One duration and one curve, so prefers-reduced-motion (which shortens the token)
    // reaches every state change. Looping animations (spinners, skeletons) keep their
    // own pace; `0s` (an instant switch) and the reduced-motion overrides are allowed.
    const offenders = stylesheets(root).flatMap(file => {
      const source = readFileSync(file, 'utf8');
      return [...source.matchAll(/transition(?:-duration)?:[^;}]*/g)]
        .map(match => match[0])
        .filter(declaration => /\b(?!0m?s\b)\d*\.?\d+m?s\b/.test(declaration.replace(/var\([^)]*\)/g, '')) && !/\b(?:0\.001s|1ms)\b/.test(declaration))
        .map(declaration => `${relative(root, file)}: ${declaration}`);
    });
    expect(offenders).toEqual([]);
  });

  it('only styles :hover where a pointer can hover (ui.md §2.5)', () => {
    // On a touch screen a tap leaves the control in its hover look until the next tap
    // elsewhere, so every :hover rule sits inside a `@media (hover: hover)` block.
    const offenders = stylesheets(root).flatMap(file => {
      const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      const open: string[] = [];
      const found: string[] = [];
      let start = 0;
      for (let i = 0; i < source.length; i += 1) {
        const char = source[i];
        if (char !== '{' && char !== '}') continue;
        if (char === '}') { open.pop(); start = i + 1; continue; }
        const prelude = source.slice(start, i).replace(/^[\s\S]*;/, '').trim();
        if (prelude.includes(':hover') && !open.some(block => block.startsWith('@media') && block.includes('hover'))) {
          found.push(`${relative(root, file)}: ${prelude}`);
        }
        open.push(prelude);
        start = i + 1;
      }
      return found;
    });
    expect(offenders).toEqual([]);
  });
});
