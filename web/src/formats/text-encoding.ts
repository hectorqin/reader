/**
 * Encoding detection for plain-text books.
 *
 * This is not a nicety. A large share of Chinese TXT libraries on a NAS were
 * produced by desktop tools in the 2000s and are GB18030, with no BOM and no
 * declaration. Decoding those as UTF-8 produces replacement characters on
 * nearly every line — the file becomes unreadable rather than slightly wrong.
 *
 * The strategy is validate-then-fallback, not guessing: a byte sequence that
 * decodes as strict UTF-8 is by construction almost never valid GB18030 text of
 * this kind, so the check is reliable in the direction that matters.
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

  // No BOM and not valid UTF-8: it is one of the CJK legacy encodings. Try
  // Simplified Chinese first (by far the most common for these files), then
  // Traditional, then give up on a lenient decode.
  for (const encoding of [GB18030, BIG5]) {
    const text = decodeStrict(typed, encoding);
    if (text && countReplacementChars(text) === 0) {
      return { text, encoding, guessed: true };
    }
  }
  return { text: decodeLenient(typed, 'utf-8'), encoding: 'utf-8', guessed: true };
}

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

function countReplacementChars(text: string): number {
  let count = 0;
  for (const char of text) {
    if (char === '\uFFFD') count += 1;
    if (count > 8) return count;
  }
  return count;
}

export { hasUtf8Bom };
