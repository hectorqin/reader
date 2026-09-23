import { XMLParser } from 'fast-xml-parser';

export interface NavigationItem { href: string; title: string; depth: number }
type Node = Record<string, any>;
const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, removeNSPrefix: true, processEntities: false, trimValues: false, parseTagValue: false });
const decode = (text: string) => text.replace(/&#(x[0-9a-f]+|\d+);|&(amp|lt|gt|quot|apos);/gi, (all, number: string, name: string) => {
  if (!number) return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[name.toLowerCase()] ?? all;
  const code = parseInt(number[0]?.toLowerCase() === 'x' ? number.slice(1) : number, number[0]?.toLowerCase() === 'x' ? 16 : 10);
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
});
const textOf = (nodes: Node[]): string => nodes.map(node => Object.entries(node).filter(([key]) => key !== ':@').map(([key, value]) => key === '#text' ? String(value) : Array.isArray(value) ? textOf(value) : '').join('')).join('');
function find(nodes: Node[], tag: string): Node[] {
  const result: Node[] = [];
  for (const node of nodes) for (const [key, children] of Object.entries(node)) {
    if (key === tag) result.push(node);
    if (Array.isArray(children)) result.push(...find(children, tag));
  }
  return result;
}

/** Ordered XML tree traversal preserves nested navPoint/li entries and fragment hrefs. */
export function parseNavigation(xml: string, kind: 'nav' | 'ncx'): NavigationItem[] {
  const tree = parser.parse(xml) as Node[];
  const result: NavigationItem[] = [];
  if (kind === 'nav') {
    const navs = find(tree, 'nav');
    const nav = navs.find(n => String(n[':@']?.['@_type'] ?? '').split(/\s+/).includes('toc')) ?? navs[0];
    if (!nav) return [];
    const walk = (nodes: Node[], depth: number): void => {
      for (const node of nodes) for (const [tag, children] of Object.entries(node)) {
        if (!Array.isArray(children)) continue;
        if (tag === 'a') {
          const href = node[':@']?.['@_href'];
          const title = decode(textOf(children)).trim();
          if (typeof href === 'string' && title) result.push({ href: decode(href), title, depth: Math.max(0, depth - 1) });
        } else walk(children, depth + (tag === 'li' ? 1 : 0));
      }
    };
    walk(nav.nav, 0);
  } else {
    const map = find(tree, 'navMap')[0];
    const walk = (nodes: Node[], depth: number): void => {
      for (const node of nodes) if (Array.isArray(node.navPoint)) {
        const label = node.navPoint.find((n: Node) => n.navLabel);
        const content = node.navPoint.find((n: Node) => n.content);
        const href = content?.[':@']?.['@_src'];
        const title = label ? decode(textOf(label.navLabel)).trim() : '';
        if (typeof href === 'string' && title) result.push({ href: decode(href), title, depth });
        walk(node.navPoint, depth + 1);
      }
    };
    if (map) walk(map.navMap, 0);
  }
  return result;
}
