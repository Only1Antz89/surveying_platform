import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";

// Practice-branded documents (quotes, letters, signed terms, practice reports).
// These are the practice's own documents, separate from licensed RICS output.

export type Brand = { name: string; accent: string | null; address: string | null; email: string | null; phone: string | null };
const A4 = { width: 595.28, height: 841.89 };
const margin = 56;
const hex = (value: string | null): RGB => {
  const match = value?.match(/^#?([0-9a-f]{6})$/i);
  if (!match) return rgb(0.13, 0.29, 0.77);
  const n = parseInt(match[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};
const ink = rgb(0.06, 0.11, 0.18), muted = rgb(0.38, 0.44, 0.53), rule = rgb(0.85, 0.88, 0.92);

/** Standard PDF fonts cover Windows-1252 only; other characters are replaced rather than failing. */
function safe(font: PDFFont, text: string) {
  const supported = new Set(font.getCharacterSet());
  return Array.from(text.replace(/\t/g, "  ").replace(/[‐-‒]/g, "-").replace(/ /g, " ")).map((char) => supported.has(char.codePointAt(0)!) ? char : "?").join("");
}

export class BrandedDocument {
  private doc!: PDFDocument;
  private page!: PDFPage;
  private regular!: PDFFont;
  private bold!: PDFFont;
  private y = 0;
  private accent: RGB;
  private constructor(private brand: Brand, private title: string, private watermark: string | null) { this.accent = hex(brand.accent); }

  static async create(brand: Brand, title: string, options: { watermark?: string | null; subject?: string } = {}) {
    const writer = new BrandedDocument(brand, title, options.watermark ?? null);
    writer.doc = await PDFDocument.create();
    writer.doc.setTitle(title); writer.doc.setAuthor(brand.name); writer.doc.setCreator("Surveynt"); writer.doc.setProducer("Surveynt");
    if (options.subject) writer.doc.setSubject(options.subject);
    writer.regular = await writer.doc.embedFont(StandardFonts.Helvetica);
    writer.bold = await writer.doc.embedFont(StandardFonts.HelveticaBold);
    writer.newPage();
    return writer;
  }

  private newPage() {
    this.page = this.doc.addPage([A4.width, A4.height]);
    this.page.drawRectangle({ x: 0, y: A4.height - 6, width: A4.width, height: 6, color: this.accent });
    this.page.drawText(safe(this.bold, this.brand.name), { x: margin, y: A4.height - 44, size: 13, font: this.bold, color: this.accent });
    const contact = [this.brand.address, this.brand.phone, this.brand.email].filter(Boolean).join("  ·  ");
    if (contact) this.page.drawText(safe(this.regular, this.fit(contact, this.regular, 8, A4.width - margin * 2)), { x: margin, y: A4.height - 58, size: 8, font: this.regular, color: muted });
    this.page.drawLine({ start: { x: margin, y: A4.height - 68 }, end: { x: A4.width - margin, y: A4.height - 68 }, thickness: 0.6, color: rule });
    if (this.watermark) this.page.drawText(safe(this.bold, this.watermark), { x: 120, y: 300, size: 46, font: this.bold, color: rgb(0.9, 0.92, 0.95), rotate: degrees(35), opacity: 0.6 });
    this.y = A4.height - 96;
  }

  private fit(text: string, font: PDFFont, size: number, width: number) {
    let value = text;
    while (value.length > 1 && font.widthOfTextAtSize(safe(font, value), size) > width) value = `${value.slice(0, -2)}…`;
    return value;
  }

  private ensure(height: number) { if (this.y - height < margin + 24) this.newPage(); }

  private wrap(text: string, font: PDFFont, size: number, width: number) {
    const lines: string[] = [];
    for (const paragraph of safe(font, text).split("\n")) {
      let line = "";
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        const candidate = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, size) <= width) { line = candidate; continue; }
        if (line) lines.push(line);
        line = word;
        while (font.widthOfTextAtSize(line, size) > width) { let cut = line.length - 1; while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > width) cut--; lines.push(line.slice(0, cut)); line = line.slice(cut); }
      }
      lines.push(line);
    }
    return lines;
  }

  heading(text: string, level: 1 | 2 = 2) {
    const size = level === 1 ? 20 : 13;
    this.ensure(size + 18);
    this.y -= level === 1 ? 4 : 10;
    for (const line of this.wrap(text, this.bold, size, A4.width - margin * 2)) { this.page.drawText(line, { x: margin, y: this.y, size, font: this.bold, color: level === 1 ? ink : this.accent }); this.y -= size + 4; }
    this.y -= 4;
    return this;
  }

  paragraph(text: string, options: { size?: number; muted?: boolean; bold?: boolean } = {}) {
    const size = options.size ?? 10, font = options.bold ? this.bold : this.regular;
    for (const line of this.wrap(text, font, size, A4.width - margin * 2)) {
      this.ensure(size + 4);
      this.page.drawText(line, { x: margin, y: this.y, size, font, color: options.muted ? muted : ink });
      this.y -= size + 4.5;
    }
    this.y -= 6;
    return this;
  }

  details(rows: [string, string][]) {
    for (const [label, value] of rows) {
      const lines = this.wrap(value, this.regular, 10, A4.width - margin * 2 - 150);
      this.ensure(lines.length * 14 + 2);
      this.page.drawText(safe(this.bold, label), { x: margin, y: this.y, size: 9, font: this.bold, color: muted });
      lines.forEach((line, index) => this.page.drawText(line, { x: margin + 150, y: this.y - index * 14, size: 10, font: this.regular, color: ink }));
      this.y -= lines.length * 14 + 4;
    }
    this.y -= 6;
    return this;
  }

  /** A simple table; numeric columns align right. */
  table(columns: { label: string; width: number; align?: "left" | "right" }[], rows: { cells: string[]; bold?: boolean }[]) {
    const total = columns.reduce((sum, column) => sum + column.width, 0);
    const widths = columns.map((column) => column.width / total * (A4.width - margin * 2));
    const draw = (cells: string[], font: PDFFont, color: RGB) => {
      let x = margin;
      cells.forEach((cell, index) => {
        const text = this.fit(cell, font, 9.5, widths[index] - 6);
        const width = font.widthOfTextAtSize(safe(font, text), 9.5);
        this.page.drawText(safe(font, text), { x: columns[index].align === "right" ? x + widths[index] - width - 3 : x + 3, y: this.y, size: 9.5, font, color });
        x += widths[index];
      });
    };
    const header = () => { this.ensure(22); draw(columns.map((column) => column.label), this.bold, muted); this.y -= 6; this.page.drawLine({ start: { x: margin, y: this.y + 2 }, end: { x: A4.width - margin, y: this.y + 2 }, thickness: 0.6, color: rule }); this.y -= 12; };
    header();
    for (const row of rows) {
      if (this.y - 16 < margin + 24) { this.newPage(); header(); }
      draw(row.cells, row.bold ? this.bold : this.regular, ink);
      this.y -= 15;
    }
    this.y -= 8;
    return this;
  }

  spacer(height = 10) { this.y -= height; return this; }

  async finish(footer: string) {
    const pages = this.doc.getPages();
    pages.forEach((page, index) => {
      page.drawLine({ start: { x: margin, y: 44 }, end: { x: A4.width - margin, y: 44 }, thickness: 0.6, color: rule });
      page.drawText(safe(this.regular, this.fit(`${footer}`, this.regular, 8, A4.width - margin * 2 - 70)), { x: margin, y: 30, size: 8, font: this.regular, color: muted });
      const label = `Page ${index + 1} of ${pages.length}`;
      page.drawText(label, { x: A4.width - margin - this.regular.widthOfTextAtSize(label, 8), y: 30, size: 8, font: this.regular, color: muted });
    });
    return this.doc.save();
  }
}

export const pdfResponse = (bytes: Uint8Array, filename: string) => new Response(Buffer.from(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${filename.replace(/[^\w.-]/g, "-")}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
export const money = (minor: number, currency = "GBP") => new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(minor / 100);
export const longDate = (value: Date | string) => new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" });
