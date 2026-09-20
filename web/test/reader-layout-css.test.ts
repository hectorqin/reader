// @vitest-environment node
/**
 * The reader's layout rules, read out of the real stylesheet.
 *
 * These are the rules a *screenshot review* cannot adjudicate, because all four of
 * the defects below look like styling choices and are actually statements about
 * geometry: whether the page reserves space for chrome that may not be there,
 * whether a floating band can cover the line it sits on, and whether a control
 * that must be reachable is painted above or below the page.
 *
 * Read from `reader.css` rather than restated, so a test cannot agree with a rule
 * that no longer exists.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(process.cwd(), 'src/styles/reader.css'), 'utf8');

/**
 * The body of the top-level rule whose selector is exactly `selector`.
 *
 * Top-level only, and exactly, because both restrictions answer a real ambiguity:
 * `.tts-bar` is a prefix of `.tts-bar .tts-main` in the sheet, and a *media query*
 * at the end of it (`prefers-reduced-motion`) lists `.topbar, .footer, .reader-rail`
 * together and would otherwise be the rule a search for `.footer` found first —
 * a test that then agreed with a transition duration instead of a background.
 *
 * Comments are stripped first: several of them contain braces, `.class` names and
 * even whole selectors.
 */
function rule(selector: string): string {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let index = 0;
  let depth = 0;
  while (index < text.length) {
    const character = text[index]!;
    if (character === '}') {
      depth -= 1;
      index += 1;
      continue;
    }
    if (character !== '{') {
      index += 1;
      continue;
    }
    const selectorText = text.slice(lastBoundary(text, index), index).trim();
    const close = matchingBrace(text, index);
    if (depth === 0 && !selectorText.startsWith('@')) {
      const selectors = selectorText.split(',').map((part) => part.trim());
      if (selectors.includes(selector)) return text.slice(index + 1, close);
    }
    // An at-rule's block is walked *into*; a plain rule's is skipped whole, since
    // its declarations are not selectors.
    if (selectorText.startsWith('@')) {
      depth += 1;
      index += 1;
    } else {
      index = close + 1;
    }
  }
  return '';
}

/** Where the selector text of the `{` at `open` begins. */
function lastBoundary(text: string, open: number): number {
  for (let i = open - 1; i >= 0; i -= 1) {
    if (text[i] === '}' || text[i] === '{' || text[i] === ';') return i + 1;
  }
  return 0;
}

/** The index of the `}` that closes the `{` at `open`, depth-counted. */
function matchingBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function declaration(body: string, property: string): string | undefined {
  return new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`).exec(body)?.[1]?.trim();
}

describe('the reading surface fills the screen', () => {
  it('reserves no space for the chrome', () => {
    // "内容要铺满，不要预留 stage": the bars float, so the page must not keep their
    // height clear. Reserving it shortens the reading column in *both* chrome
    // states, so a reader who hid the toolbar still loses the top and bottom bands
    // to empty paper.
    const body = rule('.stage-host');
    expect(body).not.toBe('');
    expect(declaration(body, 'padding')).toBeUndefined();
    expect(declaration(body, 'padding-block')).toBeUndefined();
    expect(declaration(body, 'inset')).toBe('0');
  });

  it('draws the floating bands on a surface the reader can read through', () => {
    // The consequence of the rule above: the bars now overlap text, so they have to
    // be translucent or they hide the paragraph they cover. The surface comes from
    // one token so the three themes cannot drift apart.
    for (const selector of ['.topbar', '.footer']) {
      const body = rule(selector);
      expect(declaration(body, 'background'), selector).toBe('var(--reader-surface-float)');
      expect(declaration(body, 'backdrop-filter'), selector).toContain('blur');
    }
  });

  it('makes each reading readout a full-width row flush to its edge', () => {
    // "reading-indicator 应该是紧贴顶部/底部，并且占用一整行": a readout used to be a
    // paper pill the width of its own text, floated a little inside the edge. A sticker
    // that ends wherever the words end gives the chapter name and the page count two
    // different right edges, and over the chapter's own heading it read as a fragment of
    // body text rather than something the screen drew — the "很奇怪，不整洁" in the report.
    //
    // So each readout is a *row*: the paper spans the stage and the words are inset
    // inside it. Asserted as the pair of properties that make it a row rather than a
    // pill — full width, and no horizontal shrink — because either one alone leaves the
    // old look reachable.
    // The row geometry is one rule for both readouts, so it is read by its own
    // selector list rather than by either name alone.
    // The shared rule is reached by either name: `rule()` matches the selector list
    // the rule declares, so the first of the two names finds the row geometry.
    const row = rule('.indicator-chapter');
    expect(row).not.toBe('');
    expect(declaration(row, 'display')).toBe('block');
    expect(declaration(row, 'width')).toBe('100%');
    expect(declaration(row, 'background')).toBe('var(--reader-paper)');
  });

  it('puts the page insets on the readout text and not on the row', () => {
    // The paper reaches the very edge of the glass — under the notch and the cutout —
    // so the safe insets move the *text* inward instead of leaving a strip of page
    // showing beside the band. The container therefore carries no padding at all: an
    // inset on it would be the strip this avoids.
    const box = rule('.reading-indicator');
    expect(declaration(box, 'padding')).toBeUndefined();
    expect(declaration(box, 'align-items')).toBe('stretch');
    // The two rows carry the safe insets on their own inner edges, in their own
    // rules — read from the sheet's text, because the selector is the *second* rule
    // for each name and a by-name lookup returns the shared row rule above it.
    const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(text).toMatch(/\.indicator-chapter \{[^}]*padding-block-start: calc\(0\.35rem \+ var\(--safe-top\)\)/);
    expect(text).toMatch(/\.indicator-progress \{[^}]*padding-block-end: calc\(0\.35rem \+ var\(--safe-bottom\)\)/);
  });

  it('paints the read-aloud bar above the page it floats over', () => {
    // The bar is a sibling of the absolutely positioned stage host. A static
    // sibling is laid out behind the stage, which paints at --reader-layer-page:
    // the bar was drawn, its buttons were focusable, and none of it could be hit.
    // That is "没法停止" — a stop button that existed and was unreachable.
    const body = rule('.tts-bar');
    expect(declaration(body, 'position')).toBe('absolute');
    expect(declaration(body, 'z-index')).toBe('var(--reader-layer-bar)');
    // Above the footer, which is its own height from the bottom edge — read from
    // the footer's own token so the two bands cannot overlap.
    expect(declaration(body, 'bottom')).toBe('var(--reader-chrome-bottom)');
  });

  it('gives the read-aloud controls their own row so none of them is clipped', () => {
    // One flex row of seven things gave the sentence `flex: 1`, so it was the only
    // thing that shrank and the last control was pushed past the edge on a phone.
    const controls = rule('.tts-bar .tts-controls > *');
    expect(declaration(controls, 'flex')).toBe('1 1 0');
  });
});
