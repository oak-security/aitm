import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';

export const COLORS = {
  ink: '#202126',
  muted: '#61636C',
  line: '#DEDDE2',
  paper: '#F5F4F6',
  gold: '#FFC965',
  magenta: '#9C0069',
  pale: '#F9EDF5',
};
const clean = (value) =>
  String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\t/g, '    ');
export const plain = (value) =>
  clean(value)
    .replace(/\*\*/g, '')
    .replace(/`([^`]+)`/g, '$1');

// Owns page geometry and flowing text. Large fields flow onto new pages; diagrams
// and short records reserve space before drawing. No content uses clipping boxes.
export class ReportLayout {
  constructor(project) {
    this.doc = new PDFDocument({
      size: 'A4',
      margins: { top: 76, bottom: 62, left: 48, right: 48 },
      autoFirstPage: false,
      bufferPages: true,
      info: { Title: `${project.name} — TRACE threat model`, Author: 'AiTM — AI-generated report' },
    });
    this.doc.registerFont(
      'Oak',
      fileURLToPath(new URL('../assets/BDOGrotesk-Regular.ttf', import.meta.url)),
    );
    this.doc.registerFont(
      'Oak-Bold',
      fileURLToPath(new URL('../assets/BDOGrotesk-Bold.ttf', import.meta.url)),
    );
    const chunks = [];
    this.completed = new Promise((resolve, reject) => {
      this.doc.on('data', (chunk) => chunks.push(chunk));
      this.doc.on('end', () => resolve(Buffer.concat(chunks)));
      this.doc.on('error', reject);
    });
    this.width = 499.28;
    this.left = 48;
    this.top = 76;
    this.bottom = 779.89;
    this.pages = [];
    this.contents = [];
    this.label = '';
    this.doc.on('pageAdded', () => {
      this.pages.push(this.label);
      this.doc.x = this.left;
      this.doc.y = this.top;
    });
  }
  page(label = this.label) {
    this.label = label;
    this.doc.addPage();
  }
  ensure(height) {
    if (this.doc.y + height > this.bottom) this.page();
  }
  gap(height = 12) {
    this.doc.y += height;
  }
  style(size = 11, bold = false, color = COLORS.ink) {
    return this.doc
      .font(bold ? 'Oak-Bold' : 'Oak')
      .fontSize(size)
      .fillColor(color);
  }
  height(text, width = this.width, size = 11, bold = false) {
    return this.style(size, bold).heightOfString(plain(text), { width, lineGap: 4 });
  }
  text(
    value,
    {
      size = 11,
      bold = false,
      color = COLORS.ink,
      indent = 0,
      gap = 9,
      literal = false,
      ...options
    } = {},
  ) {
    const text = literal ? clean(value) : plain(value);
    if (!text) return;
    this.ensure(size + 9);
    this.style(size, bold, color).text(text, this.left + indent, this.doc.y, {
      width: this.width - indent,
      lineGap: 4,
      ...options,
    });
    this.doc.y += gap;
  }
  anchor(id) {
    this.doc.addNamedDestination(id, 'XYZ', this.left, this.doc.page.height - this.doc.y, null);
  }
  section(title) {
    this.page(title);
    const number = String(this.contents.length + 1).padStart(2, '0');
    const id = `section-${number}`;
    this.anchor(id);
    this.contents.push({ title, number, id, page: this.pages.length });
    this.doc.outline.addItem(title);
    this.text(`SECTION ${number}`, { size: 9, bold: true, color: COLORS.magenta, gap: 12 });
    this.text(title, { size: 28, bold: true, gap: 18 });
    this.rule();
    this.gap(18);
  }
  heading(title, { size = 17, id, keep = 52 } = {}) {
    const height = this.height(title, this.width, size, true);
    this.ensure(height + keep + 15);
    if (id) this.anchor(id);
    this.text(title, { size, bold: true, gap: 12 });
  }
  field(label, value, options = {}) {
    if (!plain(value)) return;
    this.ensure(55);
    this.text(label, { size: 9, bold: true, color: COLORS.muted, gap: 3 });
    this.text(value, options);
  }
  bullets(items) {
    if (!items.length) return this.text('None recorded.', { color: COLORS.muted });
    for (const item of items) {
      this.ensure(30);
      const y = this.doc.y;
      this.doc.circle(this.left + 3, y + 7, 2).fill(COLORS.magenta);
      this.text(item, { indent: 15, gap: 9 });
    }
  }
  rule() {
    const y = this.doc.y;
    this.doc
      .moveTo(this.left, y)
      .lineTo(this.left + this.width, y)
      .lineWidth(0.7)
      .stroke(COLORS.line);
  }
  // A row for compact directories: wrapped labels and values, with a repeated
  // section header supplied by the page furniture on automatic continuation pages.
  row(label, value, { labelWidth = 112, size = 10, destination } = {}) {
    const width = this.width - labelWidth - 16;
    const height =
      Math.max(this.height(label, labelWidth, size, true), this.height(value, width, size)) + 20;
    if (height > this.bottom - this.top) {
      this.heading(label, { size: 12 });
      this.text(value, { size });
      return;
    }
    this.ensure(height);
    const y = this.doc.y;
    this.style(size, true, destination ? COLORS.magenta : COLORS.ink).text(
      plain(label),
      this.left,
      y + 7,
      {
        width: labelWidth,
        lineGap: 4,
        ...(destination ? { goTo: destination } : {}),
      },
    );
    this.style(size).text(plain(value), this.left + labelWidth + 16, y + 7, { width, lineGap: 4 });
    this.doc.y = y + height;
    this.rule();
    if (destination) this.doc.goTo(this.left, y, this.width, height, destination);
  }
  finish() {
    const doc = this.doc;
    const total = this.pages.length;
    // Draw page furniture last so automatic text pagination cannot inherit its style.
    for (let i = 0; i < total; i++) {
      doc.switchToPage(i);
      const bottomMargin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      if (i > 0) {
        this.style(9, true, COLORS.magenta).text('AiTM / TRACE', 48, 31, { lineBreak: false });
        this.style(9, false, COLORS.muted).text(this.pages[i], 180, 31, {
          width: 367,
          align: 'right',
          lineBreak: false,
        });
        doc.moveTo(48, 54).lineTo(547.28, 54).lineWidth(0.6).stroke(COLORS.line);
      }
      doc.moveTo(48, 799).lineTo(547.28, 799).lineWidth(1).stroke(COLORS.gold);
      this.style(8, false, COLORS.muted).text('AI-generated / TRACE threat model', 48, 811, {
        lineBreak: false,
      });
      this.style(8, true, COLORS.muted).text(`${i + 1} / ${total}`, 487, 811, {
        width: 60,
        align: 'right',
        lineBreak: false,
      });
      doc.page.margins.bottom = bottomMargin;
    }
    doc.end();
    return this.completed;
  }
}
