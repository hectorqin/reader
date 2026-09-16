import { describe, expect, it } from 'vitest';
import { decodeText, isValidUtf8 } from '../src/formats/text-encoding.ts';
import { big5Bytes, gb18030Bytes, utf8 } from './helpers/fixtures.ts';

/**
 * Encoding detection is the difference between a readable TXT and a screen of
 * replacement characters, and it is the one place where a wrong guess is
 * silently catastrophic rather than merely inconvenient.
 */

describe('UTF-8 validation', () => {
  it('accepts ASCII and multi-byte UTF-8', () => {
    expect(isValidUtf8(utf8('plain ascii'))).toBe(true);
    expect(isValidUtf8(utf8('中文混排 with English'))).toBe(true);
    expect(isValidUtf8(utf8('日本語のテキスト'))).toBe(true);
    expect(isValidUtf8(utf8('emoji 🎉 and combining é'))).toBe(true);
  });

  it('rejects an overlong encoding, which a naive decoder would accept', () => {
    // 0xC0 0xAF is an overlong encoding of '/'. Accepting it is the classic way
    // a validator becomes a security hole in a path-handling context.
    expect(isValidUtf8(new Uint8Array([0xc0, 0xaf]))).toBe(false);
  });

  it('rejects a lone continuation byte and a truncated sequence', () => {
    expect(isValidUtf8(new Uint8Array([0x80]))).toBe(false);
    expect(isValidUtf8(new Uint8Array([0xe4, 0xb8]))).toBe(false);
  });

  it('rejects a surrogate code point encoded in UTF-8', () => {
    // ED A0 80 encodes U+D800, which is not a valid scalar value.
    expect(isValidUtf8(new Uint8Array([0xed, 0xa0, 0x80]))).toBe(false);
  });
});

describe('decodeText', () => {
  it('strips a UTF-8 BOM so it does not leak into the first chapter title', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('第一章')]);
    const result = decodeText(bytes);
    expect(result.text).toBe('第一章');
    expect(result.text.charCodeAt(0)).not.toBe(0xfeff);
    expect(result.guessed).toBe(false);
  });

  it('detects UTF-16LE from its BOM', () => {
    const le = new Uint8Array([0xff, 0xfe, 0x2d, 0x4e]);
    const result = decodeText(le);
    expect(result.encoding).toBe('utf-16le');
    expect(result.text).toBe('中');
  });

  it('decodes valid UTF-8 without guessing', () => {
    const result = decodeText(utf8('第三章 风起'));
    expect(result.text).toBe('第三章 风起');
    expect(result.guessed).toBe(false);
  });

  it('falls back to GB18030 when the bytes are not valid UTF-8', () => {
    const bytes = gb18030Bytes('第一章 起始');
    // Guard the premise: if these bytes happened to be valid UTF-8 the test
    // would pass without exercising the fallback at all.
    expect(isValidUtf8(bytes)).toBe(false);
    const result = decodeText(bytes);
    expect(result.text).toBe('第一章 起始');
    expect(result.encoding).toBe('gb18030');
    expect(result.guessed).toBe(true);
  });

  it('marks the result as guessed so the UI can offer an override', () => {
    const result = decodeText(gb18030Bytes('测试'));
    expect(result.guessed).toBe(true);
  });

  it('chooses Big5 over GB18030 when GB18030 produces damage and Big5 does not', () => {
    // The whole reason the two candidates are scored instead of tried in order:
    // these bytes also decode "successfully" as GB18030, so a fixed order would
    // never reach Big5.
    const bytes = big5Bytes('第一章 測試內容這是一段中文文本用來判斷亂碼');
    expect(isValidUtf8(bytes)).toBe(false);
    // Guard the premise of the test: GB18030 does decode them without throwing.
    expect(new TextDecoder('gb18030').decode(bytes)).not.toBe('');
    const result = decodeText(bytes);
    expect(result.encoding).toBe('big5');
    expect(result.text).toBe('第一章 測試內容這是一段中文文本用來判斷亂碼');
    expect(result.guessed).toBe(true);
  });

  it('still prefers GB18030 for Simplified bytes, which also decode as Big5', () => {
    // The other half of the same overlap: Simplified GB18030 bytes are accepted
    // by the Big5 decoder too, and are only distinguishable by the damage they
    // produce there. If the scoring were wrong in the other direction the
    // majority of Chinese TXT libraries would break.
    const bytes = gb18030Bytes('第一章 起始');
    const result = decodeText(bytes);
    expect(result.encoding).toBe('gb18030');
    expect(result.text).toBe('第一章 起始');
  });

  it('marks the result as guessed so the UI can offer an override', () => {
    const result = decodeText(gb18030Bytes('测试'));
    expect(result.guessed).toBe(true);
  });

  it('always returns something for undecodable bytes rather than throwing', () => {
    const garbage = new Uint8Array([0x81, 0x82, 0x83, 0xff, 0xfe, 0x00]);
    const result = decodeText(garbage);
    expect(typeof result.text).toBe('string');
  });
});
