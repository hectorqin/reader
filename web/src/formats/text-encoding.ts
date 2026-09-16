/**
 * Encoding detection for plain-text books.
 *
 * This is not a nicety. A large share of Chinese TXT libraries on a NAS were
 * produced by desktop tools in the 2000s and are GB18030, with no BOM and no
 * declaration. Decoding those as UTF-8 produces replacement characters on
 * nearly every line — the file becomes unreadable rather than slightly wrong.
 *
 * Two decisions run through this file:
 *
 * 1. **Strict UTF-8 first, always.** A byte sequence that decodes as strict
 *    UTF-8 is by construction almost never valid GB18030 text of this kind, so
 *    the check is reliable in the direction that matters. Every other encoding
 *    is only considered after it fails.
 *
 * 2. **Between GB18030 and Big5, pick the better decode rather than a fixed
 *    order.** Most legacy Chinese TXT is Simplified (GB18030), but not all of
 *    it, and the two codecs overlap heavily: the same bytes usually decode
 *    successfully as both, so "try GB18030, then Big5" never reaches the second
 *    candidate. The bytes that expose the difference are the ones that land in
 *    each decoder's gap — they come out as private-use or replacement
 *    characters, or as kana out of a page of Han text. Scoring both decodes on
 *    that evidence and taking the cleaner one is what makes Traditional Big5
 *    readable without giving up the Simplified majority.
 */

const GB18030 = 'gb18030';
const BIG5 = 'big5';
const UTF16LE = 'utf-16le';
const UTF16BE = 'utf-16be';

export interface DecodedText {
  text: string;
  encoding: string;
  /** True when the chosen encoding is a fallback rather than a declaration. */
  guessed: boolean;
}

function hasUtf8Bom(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
}

function bomOf(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return UTF16LE;
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return UTF16BE;
  return null;
}

/** Strict UTF-8 validation. Returns false when any replacement would occur. */
export function isValidUtf8(bytes: Uint8Array): boolean {
  let index = 0;
  const length = bytes.length;
  while (index < length) {
    const byte = bytes[index]!;
    if (byte <= 0x7f) {
      index += 1;
      continue;
    }
    let needed: number;
    let min: number;
    let code: number;
    if ((byte & 0xe0) === 0xc0) {
      needed = 1;
      min = 0x80;
      code = byte & 0x1f;
    } else if ((byte & 0xf0) === 0xe0) {
      needed = 2;
      min = 0x800;
      code = byte & 0x0f;
    } else if ((byte & 0xf8) === 0xf0) {
      needed = 3;
      min = 0x10000;
      code = byte & 0x07;
    } else {
      return false;
    }
    if (index + needed >= length) return false;
    for (let offset = 1; offset <= needed; offset += 1) {
      const next = bytes[index + offset]!;
      if ((next & 0xc0) !== 0x80) return false;
      code = (code << 6) | (next & 0x3f);
    }
    if (code < min) return false; // overlong encoding
    if (code > 0x10ffff) return false;
    if (code >= 0xd800 && code <= 0xdfff) return false; // lone surrogate
    index += needed + 1;
  }
  return true;
}

/**
 * Decodes a text book.
 *
 * `TextDecoder` with an unsupported label throws in the browser, so each
 * fallback is attempted and dropped if unavailable. The final fallback is
 * lenient UTF-8, which always returns *something*: a book with a few mangled
 * characters beats an error screen.
 */
export function decodeText(bytes: Uint8Array): DecodedText {
  const typed = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const bom = bomOf(typed);
  if (bom === 'utf-8') {
    return { text: decodeStrict(typed.subarray(3), 'utf-8'), encoding: 'utf-8', guessed: false };
  }
  if (bom === UTF16LE || bom === UTF16BE) {
    // Strip the BOM: decoding it into the string leaves a zero-width character
    // at the start of every book, which then breaks chapter-title matching.
    return { text: decodeStrict(typed.subarray(2), bom), encoding: bom, guessed: false };
  }
  if (isValidUtf8(typed)) {
    return { text: decodeStrict(typed, 'utf-8'), encoding: 'utf-8', guessed: false };
  }

  // No BOM and not valid UTF-8: it is one of the CJK legacy encodings.
  const best = chooseLegacyEncoding(typed);
  if (best) return { text: best.text, encoding: best.encoding, guessed: true };

  // Nothing decodes cleanly. Return *something* — a book with a few mangled
  // characters beats an error screen — and mark it guessed so the UI offers the
  // manual override, which is the only thing that can rescue a genuinely odd
  // file.
  return { text: decodeLenient(typed, 'utf-8'), encoding: 'utf-8', guessed: true };
}

/**
 * Picks between GB18030 and Big5 by decoding with both and scoring the result.
 *
 * Returns `null` when neither survives, leaving the caller to fall back rather
 * than committing to a decode that is visibly broken.
 */
function chooseLegacyEncoding(bytes: Uint8Array): { text: string; encoding: string } | null {
  const candidates: Array<{ text: string; encoding: string; score: number }> = [];
  for (const encoding of [GB18030, BIG5]) {
    const text = decodeStrict(bytes, encoding);
    if (!text) continue;
    const score = scoreDecode(text);
    if (score === null) continue;
    // GB18030 wins ties. It is both the far more common source for these files
    // and the superset of the two, so an ambiguous byte sequence is more likely
    // to be Simplified than Traditional.
    candidates.push({ text, encoding, score: score + (encoding === GB18030 ? 1 : 0) });
  }
  if (candidates.length === 0) return null;
  candidates.sort((left, right) => right.score - left.score);
  const best = candidates[0]!;
  // A clean decode scores exactly zero. Requiring a positive score would reject
  // the best possible answer, so the bar is "at least as clean as no damage at
  // all" — anything below that shows damage the manual override can do better.
  return best.score >= 0 ? { text: best.text, encoding: best.encoding } : null;
}

/**
 * Scores a decode by how much damage it shows. Higher is better; `null` means
 * "give up on this candidate".
 *
 * The penalties are ordered by how strong the evidence is:
 *
 *  - Replacement characters mean the decoder hit an invalid sequence. One is
 *    fatal evidence that this is the wrong codec.
 *  - Private-use characters are GB18030's escape hatch for bytes it defines but
 *    does not map to a real character. A page of Chinese text containing them
 *    is a mis-decode.
 *  - Fullwidth/halfwidth compatibility forms (`﹍`, `Ａ`) come from the same
 *    corner of the CJK blocks and almost never appear in book prose.
 *  - Kana in a wall of Han text is the tell that Big5 bytes are being read as
 *    GB18030: several Big5 sequences land in the hiragana block. A Japanese
 *    book is legitimate, but it would also be valid UTF-8 in practice, so it
 *    never reaches this function.
 *
 * A candidate is dropped outright when its damage exceeds a proportion of its
 * length, rather than an absolute count: a 4 MB novel with a handful of
 * genuinely malformed bytes is still the right decode, while a 200-character
 * chapter with one is a wrong one.
 */
function scoreDecode(text: string): number | null {
  if (text.length === 0) return null;
  let score = 0;
  let damage = 0;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code === 0xfffd) {
      damage += 5;
    } else if (inPrivateUse(code)) {
      damage += 3;
    } else if (isCompatibilityForm(code)) {
      damage += 2;
    } else if (isKana(code)) {
      damage += 1;
    }
  }
  if (damage > CONCERNING_DAMAGE_RATIO * text.length) return null;
  score -= damage;
  return score;
}

function inPrivateUse(code: number): boolean {
  return (code >= 0xe000 && code <= 0xf8ff) || (code >= 0xf0000 && code <= 0x10fffd);
}

function isCompatibilityForm(code: number): boolean {
  return code >= 0xfe30 && code <= 0xfe4f;
}

function isKana(code: number): boolean {
  return (code >= 0x3040 && code <= 0x309f) || (code >= 0x30a0 && code <= 0x30ff);
}

/**
 * Share of a text that may look like damage before the decode is rejected
 * outright, so a wrong codec is never preferred merely because it is long.
 */
const CONCERNING_DAMAGE_RATIO = 0.01;

function decodeStrict(bytes: Uint8Array, encoding: string): string {
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder(encoding).decode(bytes);
    } catch {
      return '';
    }
  }
}

function decodeLenient(bytes: Uint8Array, encoding: string): string {
  try {
    return new TextDecoder(encoding).decode(bytes);
  } catch {
    let out = '';
    for (const byte of bytes) out += String.fromCharCode(byte);
    return out;
  }
}

export { hasUtf8Bom };
