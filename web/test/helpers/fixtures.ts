import JSZip from 'jszip';

/**
 * Fixture builders.
 *
 * Books are constructed in code rather than committed as binaries: a committed
 * EPUB is an opaque blob nobody reviews, while these make the exact structure
 * under test readable — which matters when the failing assertion is about spine
 * order or a percent-encoded href.
 */

export async function makeEpub(options: {
  chapters: Array<{ id: string; href: string; title: string; extra?: string }>;
  opfPath?: string;
  styles?: Array<{ path: string; css: string }>;
  toc?: Array<{ href: string; label: string }>;
  ncx?: Array<{ src: string; label: string }>;
  direction?: 'ltr' | 'rtl';
  includeIdentifier?: boolean;
  cover?: { href: string; bytes: Uint8Array; mediaType: string };
  /**
   * Explicit spine idref order. Omitted means "same order as `chapters`".
   *
   * Exists so a test can assert that reading order comes from the spine rather
   * than from the manifest or the archive, which is the mistake a naive loader
   * makes on roughly every second real-world EPUB.
   */
  spineOrder?: string[];
}): Promise<Uint8Array> {
  const zip = new JSZip();
  const opfPath = options.opfPath ?? 'OEBPS/content.opf';
  const baseDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';

  zip.file('mimetype', 'application/epub+zip');
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="${opfPath}" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
  );

  const manifestItems: string[] = options.chapters.map(
    (chapter) => `<item id="${chapter.id}" href="${chapter.href}" media-type="application/xhtml+xml"/>`,
  );
  const spineItems = (options.spineOrder ?? options.chapters.map((chapter) => chapter.id)).map(
    (id) => `<itemref idref="${id}"/>`,
  );

  const properties: string[] = [];
  if (options.toc) {
    manifestItems.push('<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>');
    properties.push('nav');
  }
  if (options.ncx) {
    manifestItems.push('<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>');
  }
  if (options.styles) {
    for (const [index, style] of options.styles.entries()) {
      manifestItems.push(`<item id="css${index}" href="${style.path}" media-type="text/css"/>`);
    }
  }
  if (options.cover) {
    manifestItems.push(
      `<item id="cover-img" href="${options.cover.href}" media-type="${options.cover.mediaType}" properties="cover-image"/>`,
    );
    manifestItems.push('<item id="cover-meta" href="cover.xhtml" media-type="application/xhtml+xml"/>');
  }

  zip.file(
    opfPath,
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid"${options.direction ? ` page-progression-direction="${options.direction}"` : ''}>
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>测试书</dc:title>
    <dc:creator>某人</dc:creator>
    ${options.includeIdentifier === false ? '' : '<dc:identifier id="bookid">urn:uuid:test-1234</dc:identifier>'}
    ${options.cover ? '<meta name="cover" content="cover-img"/>' : ''}
  </metadata>
  <manifest>
    ${manifestItems.join('\n    ')}
  </manifest>
  <spine${options.ncx ? ' toc="ncx"' : ''}>
    ${spineItems.join('\n    ')}
  </spine>
</package>`,
  );

  for (const chapter of options.chapters) {
    zip.file(
      `${baseDir}${chapter.href}`,
      `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${chapter.title}</title></head>
<body><h1>${chapter.title}</h1><p>正文内容</p>${chapter.extra ?? ''}</body></html>`,
    );
  }

  if (options.styles) {
    for (const style of options.styles) zip.file(`${baseDir}${style.path}`, style.css);
  }

  if (options.toc) {
    zip.file(
      `${baseDir}nav.xhtml`,
      `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>
<nav epub:type="toc"><ol>
${options.toc.map((entry) => `<li><a href="${entry.href}">${entry.label}</a></li>`).join('\n')}
</ol></nav></body></html>`,
    );
  }

  if (options.ncx) {
    zip.file(
      `${baseDir}toc.ncx`,
      `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap>
${options.ncx
  .map(
    (entry) => `<navPoint id="np-${entry.src}"><navLabel><text>${entry.label}</text></navLabel><content src="${entry.src}"/></navPoint>`,
  )
  .join('\n')}
</navMap></ncx>`,
    );
  }

  if (options.cover) {
    zip.file(`${baseDir}${options.cover.href}`, options.cover.bytes);
    zip.file(
      `${baseDir}cover.xhtml`,
      `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body>
<div><img src="${options.cover.href}" alt="cover"/></div>
</body></html>`,
    );
  }

  return zip.generateAsync({ type: 'uint8array' });
}

export async function makeCbz(pages: Array<{ name: string; bytes?: Uint8Array }>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const page of pages) {
    zip.file(page.name, page.bytes ?? PNG_1X1);
  }
  return zip.generateAsync({ type: 'uint8array' });
}

/** A minimal valid 1x1 PNG, so image bytes are real rather than filler. */
export const PNG_1X1 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);


/**
 * GB18030 byte sequences for the detection tests.
 *
 * Hard-coded rather than produced with `Buffer.from(text, 'gb18030')` because
 * Node's small-ICU build can *decode* GB18030 but not encode it. The bytes below
 * are the canonical GBK/GB18030 encodings, which is what makes them a real test
 * of the fallback path rather than of the test helper.
 */
export const GB18030_SAMPLES: Record<string, number[]> = {
  // 第一章 起始
  '第一章 起始': [0xb5, 0xda, 0xd2, 0xbb, 0xd5, 0xc2, 0x20, 0xc6, 0xf0, 0xca, 0xbc],
  // 测试
  测试: [0xb2, 0xe2, 0xca, 0xd4],
  // 中文内容
  中文内容: [0xd6, 0xd0, 0xce, 0xc4, 0xc4, 0xda, 0xc8, 0xdd],
};

export function gb18030Bytes(text: string): Uint8Array {
  const bytes = GB18030_SAMPLES[text];
  if (!bytes) throw new Error(`no GB18030 fixture for ${text}`);
  return new Uint8Array(bytes);
}

/**
 * Big5 byte sequences for the same reason, and for one more.
 *
 * Big5 is not a curiosity here: it is the encoding of a real share of
 * Traditional-Chinese libraries, and — unlike GB18030 — its byte sequences
 * usually *also* decode as valid GB18030. That overlap is exactly what the
 * detection heuristic has to resolve, so these bytes are the test.
 */
export const BIG5_SAMPLES: Record<string, number[]> = {
  // 第一章 起始
  '第一章 起始': [0xb2, 0xc4, 0xa4, 0x40, 0xb3, 0xb9, 0x20, 0xb0, 0x5f, 0xa9, 0x6c],
  // 測試
  測試: [0xb4, 0xfa, 0xb8, 0xd5],
  // 中文內容
  中文內容: [0xa4, 0xa4, 0xa4, 0xe5, 0xa4, 0xba, 0xae, 0x65],
  // 第一章 測試內容這是一段中文文本用來判斷亂碼
  '第一章 測試內容這是一段中文文本用來判斷亂碼': [
    0xb2, 0xc4, 0xa4, 0x40, 0xb3, 0xb9, 0x20, 0xb4, 0xfa, 0xb8, 0xd5, 0xa4, 0xba, 0xae, 0x65, 0xb3, 0x6f,
    0xac, 0x4f, 0xa4, 0x40, 0xac, 0x71, 0xa4, 0xa4, 0xa4, 0xe5, 0xa4, 0xe5, 0xa5, 0xbb, 0xa5, 0xce, 0xa8,
    0xd3, 0xa7, 0x50, 0xc2, 0x5f, 0xb6, 0xc3, 0xbd, 0x58,
  ],
};

export function big5Bytes(text: string): Uint8Array {
  const bytes = BIG5_SAMPLES[text];
  if (!bytes) throw new Error(`no Big5 fixture for ${text}`);
  return new Uint8Array(bytes);
}

export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
