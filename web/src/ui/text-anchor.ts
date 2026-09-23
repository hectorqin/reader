/** Text offsets plus an exact quote keep search and annotations independent of pagination. */
export interface TextAnchor { sectionId: string; start: number; end: number; quote: string; prefix: string; suffix: string }

export function textNodes(root: Node): Text[] {
  const walker = root.ownerDocument!.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    if (parent?.closest('script,style,noscript,[data-reader-mark]')) continue;
    nodes.push(node as Text);
  }
  return nodes;
}

export function anchorFor(sectionId: string, text: string, start: number, end: number): TextAnchor {
  return { sectionId, start, end, quote: text.slice(start, end), prefix: text.slice(Math.max(0, start - 32), start), suffix: text.slice(end, end + 32) };
}
export function encodeAnchor(anchor: TextAnchor): string { return 'rt1:' + JSON.stringify(anchor); }
export function decodeAnchor(locator: string): TextAnchor | null {
  if (!locator.startsWith('rt1:')) return null;
  try {
    const a = JSON.parse(locator.slice(4)) as TextAnchor;
    return typeof a.sectionId === 'string' && typeof a.quote === 'string' && a.quote.length > 0 &&
      typeof a.prefix === 'string' && typeof a.suffix === 'string' && Number.isSafeInteger(a.start) &&
      Number.isSafeInteger(a.end) && a.start >= 0 && a.end > a.start ? a : null;
  } catch { return null; }
}

export function anchorRange(root: Node, anchor: TextAnchor): Range | null {
  const nodes = textNodes(root), text = nodes.map(n => n.data).join('');
  let start = anchor.start;
  if (text.slice(start, start + anchor.quote.length) !== anchor.quote) {
    const context = anchor.prefix + anchor.quote + anchor.suffix;
    const exact = text.indexOf(context);
    if (exact >= 0 && text.indexOf(context, exact + 1) < 0) start = exact + anchor.prefix.length;
    else {
      start = text.indexOf(anchor.quote);
      // Ambiguous matches must not silently move a note onto another paragraph.
      if (start < 0 || text.indexOf(anchor.quote, start + 1) >= 0) return null;
    }
  }
  const range = root.ownerDocument!.createRange();
  const end = start + anchor.quote.length;
  let offset = 0, started = false;
  for (const node of nodes) {
    const next = offset + node.length;
    if (!started && start < next) { range.setStart(node, start - offset); started = true; }
    if (started && end <= next) { range.setEnd(node, end - offset); return range; }
    offset = next;
  }
  return null;
}

export function selectedAnchor(root: Node, sectionId: string, selection: Selection | null): TextAnchor | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const prefix = range.cloneRange(); prefix.selectNodeContents(root); prefix.setEnd(range.startContainer, range.startOffset);
  const text = textNodes(root).map(n => n.data).join('');
  // cloneContents excludes styles via the same traversal used by search.
  const start = textNodes(prefix.cloneContents()).map(n => n.data).join('').length;
  const quote = textNodes(range.cloneContents()).map(n => n.data).join('');
  return quote ? anchorFor(sectionId, text, start, start + quote.length) : null;
}

export function searchableText(html: string, markup = true): string {
  if (!markup) return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return textNodes(doc.body).map(n => n.data).join('');
}

export interface SearchHit { title: string; excerpt: string; anchor: TextAnchor }
export function findText(sectionId: string, title: string, text: string, query: string, limit = 200): SearchHit[] {
  const result: SearchHit[] = [];
  if (!query.trim()) return result;
  let start = text.indexOf(query);
  while (start >= 0 && result.length < limit) {
    result.push({ title, excerpt: text.slice(Math.max(0, start - 35), start + query.length + 65), anchor: anchorFor(sectionId, text, start, start + query.length) });
    start = text.indexOf(query, start + Math.max(1, query.length));
  }
  return result;
}
