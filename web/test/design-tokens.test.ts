import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ui.md §2: the interface layer reads its scales from tokens. This keeps the radius
 * scale from drifting back to "one more pixel" literals one rule at a time.
 */
const root = join(import.meta.dirname, '..', 'src');
const stylesheets = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? stylesheets(path) : entry.name.endsWith('.css') ? [path] : [];
  });

describe('design tokens', () => {
  it('keeps literal colors in the semantic palette and glass material definitions', () => {
    const allowlist = new Set<string>();
    const seen = new Set<string>();
    const offenders = stylesheets(root).flatMap((file) => {
      if (['theme-tokens.css', 'glass.css'].includes(file.split(/[\\/]/).at(-1)!)) return [];
      const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      return [...source.matchAll(/^\s*([a-z-]+):\s*([^;{}]+);/gm)]
        .filter(([, , value]) =>
          /#[\da-f]{3,8}\b|\brgba?\(|(?:^|[\s,(])(?:black|silver|gray|white|maroon|red|purple|fuchsia|green|lime|olive|yellow|navy|blue|teal|aqua|rebeccapurple)(?=[\s,)]|$)/i.test(
            value!,
          ),
        )
        .map((match) => `${relative(root, file)}: ${match[0].trim()}`)
        .filter((entry) => {
          if (!allowlist.has(entry)) return true;
          seen.add(entry);
          return false;
        });
    });
    expect(offenders).toEqual([]);
    expect([...allowlist].filter((entry) => !seen.has(entry))).toEqual([]);
  });

  it('reads shadows from tokens rather than introducing another elevation recipe', () => {
    const offenders = stylesheets(root).flatMap((file) => {
      if (file.endsWith('theme-tokens.css') || file.endsWith('glass.css')) return [];
      return [...readFileSync(file, 'utf8').matchAll(/\bbox-shadow:\s*([^;]+);/g)]
        .filter(
          ([, value]) => !/^(?:none|var\(--[\w-]+\)(?:\s+var\(--[\w-]+\))*)(?:\s*!important)?$/.test(value!.trim()),
        )
        .map((match) => `${relative(root, file)}: ${match[0]}`);
    });
    expect(offenders).toEqual([]);
  });

  it('keeps compact visible captions at the metadata size rather than below 12px', () => {
    const css = readFileSync(join(root, 'styles/reader.css'), 'utf8');
    expect(css).toMatch(/--text-meta:\s*0\.75rem;/);
    expect(css).toMatch(/--text-micro:\s*var\(--text-meta\);/);
    expect(css).toMatch(/--touch-target:\s*2\.75rem;/);
    const shell = readFileSync(join(root, 'app/shell.css'), 'utf8');
    expect(shell).toMatch(/\.app-nav-search > input:focus-visible\s*\{\s*outline: var\(--focus-ring\);/);
  });

  it('uses --radius-* instead of literal corner radii (ui.md §2.6)', () => {
    const offenders = stylesheets(root).flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return [...source.matchAll(/border-radius:\s*[^;}]*?\b\d*\.?\d+(?:px|rem)[^;}]*/g)]
        .map((match) => match[0].trim())
        .map((declaration) => `${relative(root, file)}: ${declaration}`);
    });
    expect(offenders).toEqual([]);
  });

  it('uses --text-* instead of literal font sizes up to 24px (ui.md §2.2)', () => {
    // Above 24px is decorative (a player's initial, a hero numeral) and stays literal.
    const offenders = stylesheets(root).flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return [...source.matchAll(/font-size:\s*(\d*\.?\d+)(px|rem)/g)]
        .filter(([, size, unit]) => (unit === 'rem' ? Number(size) * 16 : Number(size)) <= 24)
        .map((match) => `${relative(root, file)}: ${match[0]}`);
    });
    expect(offenders).toEqual([]);
  });

  it('keeps every typed field at 16px+ on touch screens so iOS does not zoom (ui.md §3.3)', () => {
    const shell = readFileSync(join(root, 'app', 'shell.css'), 'utf8');
    expect(shell).toMatch(
      /@media \(pointer: coarse\) \{\s*:is\(\s*input:not\([^)]*\),\s*textarea,\s*select\s*\) \{\s*font-size: max\(var\(--text-title\), 1em\) !important;/,
    );
  });

  it('times transitions with the motion tokens (ui.md §2.3)', () => {
    // One duration and one curve, so prefers-reduced-motion (which shortens the token)
    // reaches every state change. Looping animations (spinners, skeletons) keep their
    // own pace; `0s` (an instant switch) and the reduced-motion overrides are allowed.
    const offenders = stylesheets(root).flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return [...source.matchAll(/transition(?:-duration)?:[^;}]*/g)]
        .map((match) => match[0])
        .filter(
          (declaration) =>
            /\b(?!0m?s\b)\d*\.?\d+m?s\b/.test(declaration.replace(/var\([^)]*\)/g, '')) &&
            !/\b(?:0\.001s|1ms)\b/.test(declaration),
        )
        .map((declaration) => `${relative(root, file)}: ${declaration}`);
    });
    expect(offenders).toEqual([]);
  });

  it('reads safe areas through the --safe-* variables (ui.md §3.1)', () => {
    // The Android shell zeroes the four variables (its WebView is already inset), and a
    // layer that owns an edge overrides them; a rule reading env() directly escapes both.
    // The variables' own definitions and the sidebar column's right inset (which zeroes
    // --safe-right for everything inside it, so must read the device value) are the exceptions.
    const offenders = stylesheets(root).flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return source
        .split('\n')
        .filter((line) => /env\(safe-area-inset/.test(line) && !/^\s*--safe-(top|right|bottom|left):/.test(line))
        .filter(
          (line) =>
            !(
              relative(root, file).endsWith(join('app', 'shell.css')) &&
              line.trim() === 'padding-right: env(safe-area-inset-right, 0px);'
            ),
        )
        .map((line) => `${relative(root, file)}: ${line.trim()}`);
    });
    expect(offenders).toEqual([]);
  });

  it('only styles :hover where a pointer can hover (ui.md §2.5)', () => {
    // On a touch screen a tap leaves the control in its hover look until the next tap
    // elsewhere, so every :hover rule sits inside a `@media (hover: hover)` block.
    const offenders = stylesheets(root).flatMap((file) => {
      const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      const open: string[] = [];
      const found: string[] = [];
      let start = 0;
      for (let i = 0; i < source.length; i += 1) {
        const char = source[i];
        if (char !== '{' && char !== '}') continue;
        if (char === '}') {
          open.pop();
          start = i + 1;
          continue;
        }
        const prelude = source
          .slice(start, i)
          .replace(/^[\s\S]*;/, '')
          .trim();
        if (
          prelude.includes(':hover') &&
          !open.some((block) => block.startsWith('@media') && block.includes('hover'))
        ) {
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
