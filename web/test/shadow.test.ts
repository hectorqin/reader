// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { extractBody, extractInlineStyles, sanitiseInjectedContent } from '../src/ui/shadow.ts';

/**
 * Sanitisation and style extraction.
 *
 * These run against a real DOM (jsdom) rather than a string, because the whole
 * point is to catch what the HTML parser produces — a string-level rewrite cannot
 * see the difference between a `<script>` in markup and one the parser moved.
 *
 * The security property being asserted: a book is data. It may describe how it
 * should look; it may not run code or reach the network.
 */

function parse(html: string): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = html;
  return container;
}

describe('sanitiseInjectedContent', () => {
  it('removes script elements', () => {
    const node = parse('<p>text</p><script>window.pwned = true</script>');
    sanitiseInjectedContent(node);
    expect(node.querySelector('script')).toBeNull();
    expect(node.textContent).toContain('text');
  });

  it('strips inline event handlers', () => {
    // These survive an innerHTML round trip, so they must be removed explicitly
    // rather than trusted to the parser.
    const node = parse('<img src="reader-res:a.png" onerror="window.pwned=1"/>');
    sanitiseInjectedContent(node);
    expect(node.querySelector('img')?.getAttribute('onerror')).toBeNull();
  });

  it('strips a javascript: href but keeps the link text', () => {
    const node = parse('<a href="javascript:alert(1)">click</a>');
    sanitiseInjectedContent(node);
    const anchor = node.querySelector('a');
    expect(anchor?.hasAttribute('href')).toBe(false);
    expect(anchor?.textContent).toBe('click');
  });

  it('drops a remote src so a book cannot report a reading session', () => {
    const node = parse('<img src="https://tracker.example/pixel.gif"/>');
    sanitiseInjectedContent(node);
    expect(node.querySelector('img')?.hasAttribute('src')).toBe(false);
  });

  it('keeps the internal resource scheme and blob/data URLs', () => {
    const node = parse(
      '<img src="reader-res:OEBPS/a.png"/><img src="data:image/png;base64,AA"/><img src="blob:xyz"/>',
    );
    sanitiseInjectedContent(node);
    const sources = [...node.querySelectorAll('img')].map((img) => img.getAttribute('src'));
    expect(sources).toEqual(['reader-res:OEBPS/a.png', 'data:image/png;base64,AA', 'blob:xyz']);
  });

  it('removes a base element and a meta refresh, which would navigate away', () => {
    const node = parse('<base href="https://evil.example/"/><meta http-equiv="refresh" content="0;url=https://evil.example"/>');
    sanitiseInjectedContent(node);
    expect(node.querySelector('base')).toBeNull();
    expect(node.querySelector('meta')).toBeNull();
  });

  it('removes target so a footnote link cannot replace the reader', () => {
    const node = parse('<a href="reader-res:notes.xhtml" target="_blank">note</a>');
    sanitiseInjectedContent(node);
    expect(node.querySelector('a')?.hasAttribute('target')).toBe(false);
    expect(node.querySelector('a')?.getAttribute('href')).toBe('reader-res:notes.xhtml');
  });

  it('leaves ordinary content untouched', () => {
    const node = parse('<p>正文</p><em>强调</em><ruby>漢<rt>かん</rt></ruby>');
    sanitiseInjectedContent(node);
    expect(node.textContent).toBe('正文强调漢かん');
    expect(node.querySelector('ruby')).not.toBeNull();
  });
});

describe('extractBody', () => {
  it('returns only the body of a full XHTML document', () => {
    const html = '<html><head><title>t</title></head><body><p>内容</p></body></html>';
    expect(extractBody(html)).toBe('<p>内容</p>');
  });

  it('returns the input unchanged when there is no body element', () => {
    expect(extractBody('<p>fragment</p>')).toBe('<p>fragment</p>');
  });
});

describe('extractInlineStyles', () => {
  it('collects style blocks in document order', () => {
    const html = '<style>a{color:red}</style><p>x</p><style>b{color:blue}</style>';
    expect(extractInlineStyles(html)).toEqual(['a{color:red}', 'b{color:blue}']);
  });

  it('returns an empty list when there are none', () => {
    expect(extractInlineStyles('<p>x</p>')).toEqual([]);
  });
});
