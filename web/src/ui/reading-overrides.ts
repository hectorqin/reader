import { anchorRange } from './text-anchor.ts';
import type { ReadingOverrides } from '../api/types.ts';
export type { ReadingOverrides } from '../api/types.ts';
export const emptyOverrides = (): ReadingOverrides => ({ version: 0, corrections: [], headingPrefix: '' });
/** Apply only exact anchored text; inserting text nodes never executes replacement markup. */
export function applyCorrections(root: HTMLElement, sectionId: string, overrides: ReadingOverrides): number {
  let applied = 0;
  const normal = (id: string) => id.replace(/^xhtml:/, '');
  for (const c of overrides.corrections.filter(c => normal(c.anchor.sectionId) === normal(sectionId))) {
    const range = anchorRange(root,c.anchor);
    if (!range || range.toString() !== c.anchor.quote) continue;
    range.deleteContents(); range.insertNode(document.createTextNode(c.replacement)); applied++;
  }
  return applied;
}
