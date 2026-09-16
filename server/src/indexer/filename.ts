import { basename, extname } from 'node:path';
import { collapseWhitespace } from '../lib/text.ts';

export interface FilenameMetadata {
  title: string;
  author: string;
  series: string;
  seriesIndex: number | null;
  language: string;
}

const AUTHOR_SEPARATORS = [' - ', '—', '–'];
const TRAILING_SEPARATOR = /(?:^|\s)[-—–]+\s*$/;
// Common bracket styles used by Chinese ebook collections: 【】（）()[]《》
const SERIES_PATTERN = /(?:【([^】]+)】|\[([^\]]+)\])/;
const CN_AUTHOR_HINT = /著|编著|主编|译/;
const CN_TITLE_HINT = /《|》/;

/**
 * Best-effort parse of a book filename.
 *
 * Supported shapes:
 *   《书名》作者.epub
 *   书名 - 作者.epub
 *   作者 - 书名 (Series 01).epub
 *   [系列 01] 书名 - 作者.epub
 */
export function parseFilename(relPath: string): FilenameMetadata {
  const rawName = basename(relPath, extname(relPath));
  let name = collapseWhitespace(rawName);
  // Drop download noise that pollutes otherwise clean names.
  name = name.replace(/\s*[（(\[][^)\]）]*(?:libgen|z-?lib|zlibrary|douban|扫描版|影印版)[^)\]）]*[)\]）]\s*/gi, ' ');
  name = collapseWhitespace(name);

  let series = '';
  let seriesIndex: number | null = null;
  const seriesMatch = SERIES_PATTERN.exec(name);
  if (seriesMatch) {
    // The bracket may wrap just a volume marker, e.g. "[01]", in which case
    // there is no name to record and only the index is kept.
    const inner = collapseWhitespace(seriesMatch[1] ?? seriesMatch[2] ?? '');
    const nameAndIndex = /^(.*?)\s*(\d{1,3})$/.exec(inner);
    if (nameAndIndex && nameAndIndex[1]) {
      series = collapseWhitespace(nameAndIndex[1]);
      seriesIndex = Number.parseInt(nameAndIndex[2]!, 10);
    } else if (/^\d{1,3}$/.test(inner)) {
      seriesIndex = Number.parseInt(inner, 10);
    } else {
      series = inner;
    }
    name = collapseWhitespace(name.replace(seriesMatch[0], ' '));
  }

  // "（第1卷）" style. The marker is stripped before the title/author split only
  // after the split has run, so a name such as "金庸 - 射雕英雄传（第1卷）" still
  // distinguishes author from title.
  const parenSeries = /[（(]\s*([^)）]{0,40}?)\s*第\s*(\d{1,3})\s*[卷册部集][)）]/.exec(name);
  let volumeLabel = '';
  if (!series && parenSeries) {
    volumeLabel = collapseWhitespace(parenSeries[1] ?? '');
    seriesIndex = Number.parseInt(parenSeries[2]!, 10);
    // Remove the entire bracketed group up front so the title/author split
    // below sees "金庸 - 射雕英雄传" rather than a string with a dangling
    // half-open bracket.
    name = collapseWhitespace(name.replace(/[（(]\s*[^)）]*?\s*第\s*\d{1,3}\s*[卷册部集][)）]/g, ' '));
  }

  let title = name;
  let author = '';

  const bookTitleMatch = /[《《]([^》》]+)[》》]/.exec(name);
  if (bookTitleMatch) {
    title = collapseWhitespace(bookTitleMatch[1]!);
    const rest = collapseWhitespace(name.replace(bookTitleMatch[0], ' '));
    author = cleanAuthor(rest);
  } else {
    for (const sep of AUTHOR_SEPARATORS) {
      const index = name.indexOf(sep);
      if (index <= 0) continue;
      const left = collapseWhitespace(name.slice(0, index));
      const right = collapseWhitespace(name.slice(index + sep.length));
      if (!left || !right) continue;
      // Both "书名 - 作者" and "作者 - 书名" are common in the wild, and the two
      // are indistinguishable without a marker. Rather than guess (and misfile
      // a real book), only apply a split when something proves the direction:
      //
      //   《书名》            -> that side is the title
      //   著 / 编 / 译        -> that side is the author
      //
      // Otherwise the whole string is kept as the title and the author is left
      // empty, which the client surfaces as an incomplete field for the reader
      // to fill in. A missing author is a far cheaper failure than a wrong one.
      if (CN_AUTHOR_HINT.test(right) && !CN_AUTHOR_HINT.test(left)) {
        title = left;
        author = cleanAuthor(right);
      } else if (CN_AUTHOR_HINT.test(left) && !CN_AUTHOR_HINT.test(right)) {
        title = right;
        author = cleanAuthor(left);
      } else if (CN_TITLE_HINT.test(right) && !CN_TITLE_HINT.test(left)) {
        title = extractTitleMarker(right) ?? right;
        author = cleanAuthor(left);
      } else if (CN_TITLE_HINT.test(left) && !CN_TITLE_HINT.test(right)) {
        title = extractTitleMarker(left) ?? left;
        author = cleanAuthor(right);
      } else {
        // Latin titles are unambiguous: "Title - Author" is the near-universal
        // convention for English-language files.
        const leftLatin = isLatinName(left);
        const rightLatin = isLatinName(right);
        if (leftLatin && !rightLatin) {
          title = right;
          author = cleanAuthor(left);
        } else if (rightLatin && !leftLatin) {
          title = left;
          author = cleanAuthor(right);
        } else if (leftLatin && rightLatin) {
          title = left;
          author = cleanAuthor(right);
        } else if (looksLikeCjkName(left) && !looksLikeCjkName(right)) {
          title = right;
          author = cleanAuthor(left);
        } else if (looksLikeCjkName(right) && !looksLikeCjkName(left)) {
          title = left;
          author = cleanAuthor(right);
        } else {
          // Still ambiguous. Keeping the whole string as the title is the safe
          // failure: a missing author is far cheaper than a wrong one, and the
          // client flags it as incomplete for the reader to fill in.
          title = collapseWhitespace(`${left} - ${right}`);
          author = '';
        }
      }
      break;
    }
    if (!author) {
      const parenAuthor = /[（(]([^)）]{1,30})[)）]\s*$/.exec(name);
      if (parenAuthor && !CN_AUTHOR_HINT.test(parenAuthor[1]!)) {
        author = cleanAuthor(parenAuthor[1]!);
        title = collapseWhitespace(name.replace(parenAuthor[0], ' '));
      }
    }
  }

  const language = detectLanguage(title);

  // A bare volume marker means the work is itself the series, so the title
  // (now free of the marker) supplies the series name.
  if (!series && parenSeries) series = volumeLabel || title;

  return {
    title: title || collapseWhitespace(rawName),
    author,
    series,
    seriesIndex,
    language,
  };
}

/**
 * CJK surnames, used only as a tie-breaker between two otherwise ambiguous
 * sides of a separator. Kept short on purpose: a wrong entry here misfiles a
 * book, so the list holds the unambiguous single-character surnames.
 */
const CJK_SURNAME_CHARS =
  '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹姚邵湛汪祁毛禹狄米贝明臧计伏成戴谈宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯昝管卢莫';

/**
 * True when the value plausibly names a person: 2-4 CJK characters beginning
 * with a common surname, or a Latin name-shaped string.
 */
function looksLikeCjkName(value: string): boolean {
  const trimmed = collapseWhitespace(value);
  if (!/^[\u4e00-\u9fff]{2,4}$/.test(trimmed)) return false;
  // A string of exactly 2 chars starting with a surname is a name; anything
  // longer must also start with one. This keeps "基地" (not a surname) and
  // "红楼梦" (3 chars, 红 is not a surname) out.
  return CJK_SURNAME_CHARS.includes(trimmed[0]!);
}

/** Latin "Surname, Given" or "Given Surname" shapes. */
function isLatinName(value: string): boolean {
  const trimmed = collapseWhitespace(value);
  if (/[\u4e00-\u9fff\u3040-\u30ff]/.test(trimmed)) return false;
  return /^[A-Z][A-Za-z.'-]*(?:,?\s+[A-Z][A-Za-z.'-]*){0,3}$/.test(trimmed);
}

function extractTitleMarker(value: string): string | null {
  const match = /[《《]([^》》]+)[》》]/.exec(value);
  return match ? collapseWhitespace(match[1]!) : null;
}

function cleanAuthor(value: string): string {
  let cleaned = collapseWhitespace(value);
  // Trim a trailing separator of any flavour. "刘慈欣 -《三体》" leaves a bare
  // "-" behind because the title marker was stripped before the split.
  while (TRAILING_SEPARATOR.test(cleaned)) {
    cleaned = collapseWhitespace(cleaned.replace(TRAILING_SEPARATOR, ''));
  }
  return collapseWhitespace(
    cleaned
      .replace(/[著编著译校注疏主编]$/u, '')
      .replace(/[,，;；]\s*$/u, '')
      .replace(/^[\[【(（]+|[\]】)）]+$/gu, ''),
  );
}

/**
 * Rough CJK detection. This feeds the `language` field only when the EPUB has
 * no dc:language, so a heuristic is acceptable.
 */
export function detectLanguage(input: string): string {
  const cjk = (input.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) ?? []).length;
  const kana = (input.match(/[\u3040-\u30ff]/g) ?? []).length;
  const latin = (input.match(/[A-Za-z]/g) ?? []).length;
  const total = cjk + kana + latin;
  if (total === 0) return '';
  if (kana / total > 0.15) return 'ja';
  if (cjk / total > 0.3) return 'zh';
  if (latin / total > 0.5) return 'en';
  return '';
}
