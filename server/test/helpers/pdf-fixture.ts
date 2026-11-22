/**
 * Builds small real PDFs for tests: lines of Helvetica text at chosen positions,
 * and an outline (bookmarks) whose entries point at a page and a height on it.
 * pdf.js reads them like any other PDF, so the extraction is exercised end to end.
 */
export interface FixtureLine {
  text: string;
  x?: number;
  y: number;
  size?: number;
}
export interface FixtureBookmark {
  title: string;
  /** 0-based page. */
  page: number;
  /** Height on the page (PDF units from the bottom); absent means the page itself. */
  top?: number;
  children?: FixtureBookmark[];
}

const escape = (text: string) => text.replace(/[\\()]/g, (c) => `\\${c}`);

export function buildPdf(pages: FixtureLine[][], outline: FixtureBookmark[] = []): Buffer {
  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length;
  };
  const catalog = add('');
  const pagesId = add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pageIds: number[] = [];
  for (const lines of pages) {
    const content = lines
      .map((line) => `BT /F1 ${line.size ?? 11} Tf ${line.x ?? 72} ${line.y} Td (${escape(line.text)}) Tj ET`)
      .join('\n');
    const contentId = add(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
    pageIds.push(
      add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${contentId} 0 R >>`,
      ),
    );
  }
  objects[pagesId - 1] =
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  let outlines = '';
  if (outline.length) {
    const root = add('');
    const write = (items: FixtureBookmark[], parent: number): number[] => {
      const ids = items.map(() => add(''));
      items.forEach((item, index) => {
        const children = item.children?.length ? write(item.children, ids[index]!) : [];
        const dest = `[${pageIds[item.page]} 0 R ${item.top === undefined ? '/Fit' : `/XYZ 0 ${item.top} 0`}]`;
        objects[ids[index]! - 1] =
          `<< /Title (${escape(item.title)}) /Parent ${parent} 0 R /Dest ${dest}` +
          (index > 0 ? ` /Prev ${ids[index - 1]} 0 R` : '') +
          (index < ids.length - 1 ? ` /Next ${ids[index + 1]} 0 R` : '') +
          (children.length ? ` /First ${children[0]} 0 R /Last ${children.at(-1)} 0 R /Count ${children.length}` : '') +
          ' >>';
      });
      return ids;
    };
    const top = write(outline, root);
    objects[root - 1] = `<< /Type /Outlines /First ${top[0]} 0 R /Last ${top.at(-1)} 0 R /Count ${top.length} >>`;
    outlines = ` /Outlines ${root} 0 R`;
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R${outlines} >>`;

  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = Buffer.byteLength(pdf);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}
