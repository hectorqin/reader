/**
 * Shadow-root host for book content.
 *
 * The book's own markup and stylesheets have to live somewhere. Three options,
 * and only one of them is defensible:
 *
 *  - into the app document: a chapter's `p { color: red }` would restyle the
 *    shelf, and `.topbar` collisions would be a matter of luck;
 *  - in an iframe: correct isolation, but every chapter change tears down a
 *    document, which loses scroll position, breaks in-page animation and costs
 *    several times the memory on Android;
 *  - in a shadow root: full style isolation, no document boundary, and the app
 *    can still reach in for pagination and selection.
 *
 * The third is what this is. Note what is *not* done: no reset stylesheet is
 * injected into the shadow root. A reset would override the author's margins and
 * font stacks, which is the exact failure mode this product exists to avoid.
 */



export class BookShadowHost extends HTMLElement {
  readonly shadow: ShadowRoot;
  private readonly styleEl: HTMLStyleElement;
  private readonly contentEl: HTMLDivElement;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
    this.styleEl = document.createElement('style');
    this.contentEl = document.createElement('div');
    this.contentEl.className = 'book-flow';
    this.shadow.append(this.styleEl, this.contentEl);
  }

  /** Replaces the reading surface and the stylesheets that apply to it. */
  setContent(html: string, styles: string[]): void {
    this.styleEl.textContent = styles.join('\n');
    this.contentEl.innerHTML = html;
  }

  /** The element pagination and scroll measurement should look at. */
  get flow(): HTMLDivElement {
    return this.contentEl;
  }

  clear(): void {
    this.contentEl.innerHTML = '';
    this.styleEl.textContent = '';
  }
}

/**
 * Neutralises the parts of an injected document that would break the reader.
 *
 * Applied after injection, on the live DOM, so it catches constructs a
 * string-level rewrite cannot — notably anything the HTML parser normalises.
 *
 * Removed: `script` (a book must not run code), and navigation-away constructs
 * (`<base>`, meta refresh, `target` on links) which would otherwise turn a tap
 * on a footnote into an exit from the reader.
 */
export function sanitiseInjectedContent(root: ParentNode): void {
  for (const element of root.querySelectorAll('script, base, meta[http-equiv="refresh" i]')) {
    element.remove();
  }

  for (const element of root.querySelectorAll('a[target], a[download]')) {
    element.removeAttribute('target');
    element.removeAttribute('download');
  }

  // Inline event handlers survive an innerHTML round trip, so they must be
  // stripped explicitly rather than trusted to the parser.
  for (const element of root.querySelectorAll('*')) {
    const attributes = element.getAttributeNames();
    for (const name of attributes) {
      if (name.toLowerCase().startsWith('on')) {
        element.removeAttribute(name);
      } else if (name.toLowerCase() === 'href') {
        const value = element.getAttribute(name) ?? '';
        if (/^\s*javascript:/i.test(value)) {
          element.removeAttribute(name);
        }
      } else if (name.toLowerCase() === 'src') {
        const value = element.getAttribute(name) ?? '';
        // Only the internal scheme and blobs are allowed. An absolute URL would
        // leak a reading session to a third party; the book has no reason to
        // need one.
        if (!value.startsWith('reader-res:') && !value.startsWith('blob:') && !value.startsWith('data:')) {
          element.removeAttribute(name);
        }
      }
    }
  }
}

/** Keeps only the body of a full XHTML document, dropping `html`/`head` wrappers. */
export function extractBody(html: string): string {
  const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  return bodyMatch?.[1] ?? html;
}

/** Collects `<style>` blocks and inline `<link>` stylesheets for the shadow root. */
export function extractInlineStyles(html: string): string[] {
  const styles: string[] = [];
  const pattern = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    if (match[1]) styles.push(match[1]);
  }
  return styles;
}

if (typeof customElements !== 'undefined' && !customElements.get('book-content')) {
  customElements.define('book-content', BookShadowHost);
}

export function createBookHost(): BookShadowHost {
  return document.createElement('book-content') as BookShadowHost;
}
