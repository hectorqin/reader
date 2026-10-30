import { render } from '../src/shared/ui/render-root.ts';
// @vitest-environment jsdom
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Icon, ICONS } from '../src/ui/icon.tsx';
import { IconButton } from '../src/ui/toolkit.tsx';

/**
 * The names are the product's (ui.md §1). The set once borrowed Font Awesome 6's
 * names verbatim (#40), which put a *known* name on different artwork; they were
 * reverted to the plain English the rest of the codebase speaks, and this list keeps
 * them from drifting back.
 */
const BORROWED = [
  'bars', 'magnifying-glass', 'xmark', 'file-lines', 'file-arrow-up', 'file-arrow-down',
  'trash-can', 'arrows-rotate', 'table-columns', 'circle-info', 'triangle-exclamation',
  'folder-open', 'ellipsis', 'power-off', 'right-from-bracket', 'circle-plus',
  'backward-step', 'forward-step', 'volume-high', 'gear', 'books', 'pen',
  'arrow-down-wide-short', 'up-down', 'font',
  ];

describe('the icon names', () => {
  it('does not borrow another icon set’s names', () => {
    const names = Object.keys(ICONS);
    expect(names.filter(name => BORROWED.includes(name))).toEqual([]);
  });
});

describe('the icon box', () => {
  it('renders the glyph and hides it from assistive technology when decorative', () => {
    const host = document.createElement('div');
    render(Icon({ name: 'close' }), host);
    const span = host.querySelector('.icon')!;
    expect(span.tagName.toLowerCase()).toBe('svg');
    expect(span.children.length).toBeGreaterThan(0);
    expect(span.getAttribute('aria-hidden')).toBe('true');
    expect(span.hasAttribute('aria-label')).toBe(false);
  });

  it('exposes a label as its accessible name when it is not decorative', () => {
    const host = document.createElement('div');
    render(Icon({ name: 'close', label: '关闭' }), host);
    const span = host.querySelector('.icon')!;
    // `role="img"` is what makes a labelled glyph announce as an image.
    expect(span.getAttribute('role')).toBe('img');
    expect(span.getAttribute('aria-label')).toBe('关闭');
    expect(span.hasAttribute('aria-hidden')).toBe(false);
  });
});

/**
 * The stylesheet's half of the contract.
 *
 * Whether the icon ends up where it should is decided in CSS. These read `.icon` out of the real stylesheet, because the rules that matter are
 * the ones that were wrong and a test that re-states them in its own words would have
 * been updated alongside the bug.
 */
describe('the stylesheet', () => {
  const css = readFileSync(join(process.cwd(), 'src/styles/reader.css'), 'utf8');
  const iconRule = /(^|\n)\.icon \{([^}]*)\}/.exec(css)?.[2] ?? '';
  const declaration = (property: string): string | undefined =>
    new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`).exec(iconRule)?.[1]?.trim();

  it('keeps an explicit advance width', () => {
    // A row of icons and labels has to be laid out the same way whatever glyphs are in it.
    expect(declaration('width')).toBe('1em');
  });

  it('aligns on the middle for the rows that are not flex or grid', () => {
    // In a paragraph, `baseline` would put the icon's baseline on the text's, and the icon
    // has no baseline in the text sense — its ink is centred on the em.
    expect(declaration('vertical-align')).toBe('middle');
  });

  it('does not move the glyph with a transform', () => {
    // A transform would also move the ink inside a flex or grid container, where
    // `vertical-align` is inert — but it moves the glyph at paint time, so the space the
    // icon reserves stops agreeing with the space it appears to occupy.
    expect(declaration('transform')).toBeUndefined();
  });

  it('is applied by every icon button, including the hand-built ones', () => {
    // The glyph has to be `.icon` for any of the above to reach it, and a button that
    // builds its own markup is where that gets forgotten.
    const sources = [
      'toolkit.tsx',
      'reader-chrome.tsx',
      'shelf-settings.tsx',
      'sheet.tsx',
      'dialog.tsx',
      'pager.tsx',
    ];
    for (const source of sources) {
      const text = readFileSync(join(process.cwd(), 'src/ui', source), 'utf8');
      // A raw `<button className="icon-button">` is the shape that drifts; the primitive
      // and the icon-name type are what make the glyph's class a consequence rather than
      // a convention.
      expect(text.includes('className="icon-button'), `${source} hand-builds an icon button`).toBe(false);
      expect(text.includes("className={'icon-button"), `${source} hand-builds an icon button`).toBe(false);
    }
  });
});

describe('icon buttons', () => {
  it('carries the label as the accessible name and hides the glyph', () => {
    const host = document.createElement('div');
    render(IconButton({ label: '目录', icon: 'menu' }), host);
    const button = host.querySelector('button')!;
    // The name must be on the *button*: a glyph inside an aria-labelled button is
    // read by some screen readers as well, which is why the glyph is aria-hidden.
    expect(button.getAttribute('aria-label')).toBe('目录');
    const glyph = button.querySelector('.icon')!;
    expect(glyph.getAttribute('aria-hidden')).toBe('true');
    expect(glyph.tagName.toLowerCase()).toBe('svg');
  });

  it('draws every icon button from the icon set rather than from text', () => {
    const host = document.createElement('div');
    render(IconButton({ label: '关闭', icon: 'close' }), host);
    // A regression here is the whole point of the change: the old button took
    // arbitrary children, and Unicode punctuation is what it was given.
    expect(host.querySelector('.icon')).not.toBeNull();
    expect(host.querySelector('svg path')).not.toBeNull();
  });
});

describe('one icon set', () => {
  it('draws every icon through ui/icon.tsx (ui.md §1)', () => {
    // A screen that imports lucide-react itself picks its own glyph, size and stroke;
    // that is how the set drifted to three gears and five stroke weights.
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
      entry.isDirectory() ? walk(join(dir, entry.name)) : /\.tsx?$/.test(entry.name) ? [join(dir, entry.name)] : []);
    const src = join(process.cwd(), 'src');
    const importers = walk(src).filter(file => /from 'lucide-react'/.test(readFileSync(file, 'utf8'))).map(file => relative(src, file));
    expect(importers).toEqual([join('ui', 'icon.tsx')]);
  });
});
