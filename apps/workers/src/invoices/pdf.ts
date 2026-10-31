/**
 * Minimal PDF 1.4 writer: A4 pages, Helvetica / Helvetica-Bold text and rules. Enough for a
 * text invoice without pulling a PDF library into the worker. Text outside Latin-1 is replaced
 * with "?" (standard fonts use WinAnsi encoding).
 */

export const A4 = { width: 595, height: 842 };

const esc = (s: string) =>
  s
    .replace(/[^\x20-\x7e\xa0-\xff]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');

/** Rough Helvetica advance width (points per 1pt font size) for right-aligning numbers. */
const AVG_CHAR = 0.5;

export class PdfDoc {
  private pages: string[][] = [];

  constructor() {
    this.addPage();
  }

  addPage(): void {
    this.pages.push([]);
  }

  private get ops(): string[] {
    return this.pages[this.pages.length - 1]!;
  }

  text(x: number, y: number, s: string, size = 9, bold = false): void {
    this.ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x} ${y} Td (${esc(s)}) Tj ET`);
  }

  /** Right-aligned at `right` (approximate metrics). */
  textRight(right: number, y: number, s: string, size = 9, bold = false): void {
    this.text(right - s.length * size * AVG_CHAR, y, s, size, bold);
  }

  rule(x1: number, y1: number, x2: number, y2: number, width = 0.5): void {
    this.ops.push(`${width} w ${x1} ${y1} m ${x2} ${y2} l S`);
  }

  toBuffer(): Buffer {
    const objects: string[] = [];
    const add = (body: string) => objects.push(body); // returns the 1-based object number
    const catalog = add('');
    const pagesObj = add('');
    const f1 = add(
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    );
    const f2 = add(
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    );
    const kids: number[] = [];
    for (const ops of this.pages) {
      const stream = ops.join('\n');
      const content = add(
        `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
      );
      kids.push(
        add(
          `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${A4.width} ${A4.height}] ` +
            `/Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R >>`,
        ),
      );
    }
    objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
    objects[pagesObj - 1] =
      `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;

    let out = '%PDF-1.4\n';
    const offsets: number[] = [];
    objects.forEach((body, i) => {
      offsets.push(Buffer.byteLength(out, 'latin1'));
      out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = Buffer.byteLength(out, 'latin1');
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
    out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, 'latin1');
  }
}
