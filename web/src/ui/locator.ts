import type { BookDoc } from '../formats/types.ts';

/**
 * Locators, and why they look like this.
 *
 * A reading position has to survive three things: a server round trip (as an
 * opaque string), a re-layout at a different font size, and a reload. The
 * server treats it as opaque on purpose (docs/api.md), so the format is the
 * client's to define — and it is the client that has to live with a bad choice.
 *
 * The format is `r1:<offset>:<section id>`, e.g.
 *
 *   `r1:0.4200:OEBPS/text/ch3.xhtml`
 *
 * Three things about that are deliberate and were each arrived at by getting it
 * wrong first:
 *
 *  - **The version prefix.** The server treats a locator as opaque and holds it
 *    for a long time, so a client that later changes the format needs to be able
 *    to recognise a value it is not allowed to interpret. `r1` gives it that.
 *  - **The section id goes last.** A section id is a file path and therefore
 *    contains colons on Windows-authored books and in any href with a scheme.
 *    Splitting on the first two colons and keeping the rest intact is the only
 *    parsing that cannot lose data.
 *  - **The offset is a fraction of the section**, never a pixel value or a CSS
 *    column index. Pixels and columns change with font size, screen width and
 *    theme, so a column-index locator silently lands on a different sentence
 *    when the reader changes the text size — one of the most infuriating bugs a
 *    reading app can have.
 */

export interface Locator {
  sectionId: string;
  /** 0..1 position within the section. */
  offset: number;
  /** 0..1 position within the whole book, for the progress bar. */
  percentage: number;
}

export const LOCATOR_PREFIX = 'r1';

export function parseLocator(value: string, doc: BookDoc): Locator | null {
  if (!value) return null;

  if (value.startsWith(`${LOCATOR_PREFIX}:`)) {
    const rest = value.slice(LOCATOR_PREFIX.length + 1);
    const separator = rest.indexOf(':');
    // `r1:0.5:` with an empty section id is malformed, and so is a versioned
    // locator with no offset at all.
    if (separator === -1) return null;
    const offset = Number.parseFloat(rest.slice(0, separator));
    const sectionId = rest.slice(separator + 1);
    if (!sectionId) return null;
    return resolve(sectionId, offset, doc);
  }

  // Unversioned forms, accepted so that a position written before the version
  // prefix existed is still honoured. A reader losing their place on an upgrade
  // is exactly the kind of thing this product is supposed to be better at.
  if (value.startsWith('epubcfi(')) return null;

  const legacy = /^([^:]+):(-?[\d.]+)$/.exec(value);
  if (legacy) return resolve(legacy[1]!, Number.parseFloat(legacy[2]!), doc);

  // A bare section id, or a bare page number, means "the start of that".
  const byId = doc.sections.findIndex((section) => section.id === value);
  if (byId !== -1) return resolve(value, 0, doc);
  const page = Number.parseInt(value, 10);
  if (Number.isFinite(page) && page >= 0 && page < doc.sections.length) {
    const section = doc.sections[page];
    return section ? resolve(section.id, 0, doc) : null;
  }
  return null;
}

/** Shared tail of every parse path: validate the section, clamp the offset. */
function resolve(sectionId: string, offset: number, doc: BookDoc): Locator | null {
  const index = doc.sections.findIndex((section) => section.id === sectionId);
  if (index === -1) return null;
  const safeOffset = Number.isFinite(offset) ? Math.min(1, Math.max(0, offset)) : 0;
  return {
    sectionId,
    offset: safeOffset,
    percentage: (index + safeOffset) / Math.max(1, doc.sections.length),
  };
}

/**
 * Serialises a position.
 *
 * The offset is fixed to four decimals and always written as a plain decimal:
 * `0.42` is meaningful, `4.2e-1` would not survive anyone's regex, and an
 * exponent in a value the server stores opaquely is a bug waiting to be found
 * by whoever writes the next client.
 */
export function formatLocator(sectionId: string, offset: number): string {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(offset) ? offset : 0));
  return `${LOCATOR_PREFIX}:${clamped.toFixed(4)}:${sectionId}`;
}

/**
 * Total percentage of the book, weighted by section length when the format
 * provides one.
 *
 * Weighing matters: TXT chunks are wildly uneven, and a book whose chapters
 * average 30 pages except for one 400-page final chapter would show "50%" at
 * the halfway chapter while the reader still has most of the book left.
 */
export function bookPercentage(doc: BookDoc, sectionIndex: number, within: number): number {
  const count = doc.sections.length;
  if (count === 0) return 0;
  const weights = sectionWeights(doc);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return Math.min(1, (sectionIndex + within) / count);
  let consumed = 0;
  for (let index = 0; index < sectionIndex; index += 1) consumed += weights[index] ?? 1;
  consumed += (weights[sectionIndex] ?? 1) * Math.min(1, Math.max(0, within));
  return Math.min(1, Math.max(0, consumed / total));
}

function sectionWeights(doc: BookDoc): number[] {
  if (doc.layout === 'fixed') return doc.sections.map(() => 1);
  return doc.sections.map((section) => {
    const length = section.html?.length ?? 0;
    // A floor keeps a nearly empty divider page from counting as zero length,
    // which would make the progress bar stall on it.
    return Math.max(200, length);
  });
}
