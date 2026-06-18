"use strict";

const PDFDocument = require("pdfkit");

// MHL palette. PDF body uses Helvetica (built into pdfkit); embedding Inter as a TTF is
// a later refinement. The single gold accent appears once per section, per brand rules.
const INK = "#0E1116";
const PAPER = "#FAF6EE";
const GOLD = "#F5C518";
const MUTED = "#5b6066";

function renderReportPdf({ title, markdown, generatedAt }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 54, right: 54, bottom: 64, left: 54 },
      bufferPages: true,
      info: { Title: title, Author: "AiTM", Subject: "AiTM threat model report" }
    });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    drawCover(doc, title, generatedAt);
    doc.addPage();
    renderBody(doc, markdown);
    drawPageNumbers(doc);
    doc.end();
  });
}

function drawCover(doc, title, generatedAt) {
  const { left, right } = doc.page.margins;
  const width = doc.page.width - left - right;
  doc.rect(0, 0, doc.page.width, doc.page.height).fill(PAPER);
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(40).text("AiTM", left, 70, { width });
  // single gold accent rule
  doc.moveTo(left, 126).lineTo(left + 250, 126).lineWidth(7).strokeColor(GOLD).stroke();
  doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(10).text("AI THREAT MODELLER · DESIGN-LEVEL THREAT MODEL", left, 172, { width, characterSpacing: 0.8 });
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(32).text(title, left, 208, { width, lineGap: 4 });
  doc.fillColor(INK).font("Helvetica").fontSize(12).text("Generated with AiTM — AI Threat Modeller", left, 632, { width });
  const date = generatedAt ? new Date(generatedAt) : new Date();
  doc.fillColor(MUTED).fontSize(10).text(date.toISOString().slice(0, 10), left, 652, { width });
  doc.fillColor(MUTED).fontSize(9).text("AI-assisted design-level threat model. Expert review required before external use.", left, 720, { width });
}

function renderBody(doc, markdown) {
  const lines = String(markdown || "").split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i].trim();
    if (!t || /^-{3,}$/.test(t)) continue;
    if (t.startsWith("```")) {
      // body avoids fenced blocks; skip stray fences and their contents
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith("```")) i += 1;
      continue;
    }
    if (t.startsWith("|")) {
      const tableLines = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) { tableLines.push(lines[i].trim()); i += 1; }
      i -= 1;
      drawTable(doc, tableLines);
      continue;
    }
    if (t.startsWith("# ")) continue;
    if (t.startsWith("## ")) {
      if (!isAtTop(doc)) doc.addPage();
      drawSectionTitle(doc, plain(t.slice(3)));
      continue;
    }
    if (t.startsWith("### ")) {
      ensureSpace(doc, 42);
      doc.moveDown(0.45);
      doc.fillColor(INK).font("Helvetica-Bold").fontSize(13).text(plain(t.slice(4)), { lineGap: 2 });
      doc.moveDown(0.25);
      continue;
    }
    if (t.startsWith("- ") || t.startsWith("* ")) {
      drawParagraph(doc, `•  ${plain(t.slice(2))}`, { indent: 12 });
      continue;
    }
    drawParagraph(doc, plain(t));
  }
}

function drawSectionTitle(doc, title) {
  ensureSpace(doc, 72);
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(22).text(title, { lineGap: 3 });
  const x = doc.page.margins.left;
  doc.moveTo(x, doc.y + 8).lineTo(x + 220, doc.y + 8).lineWidth(3).strokeColor(GOLD).stroke();
  doc.moveDown(1.2);
}

function drawParagraph(doc, text, options = {}) {
  const width = contentWidth(doc) - (options.indent || 0);
  const height = doc.heightOfString(text, { width, lineGap: 2 });
  ensureSpace(doc, height + 10);
  doc.fillColor("#202327").font("Helvetica").fontSize(10).text(text, doc.page.margins.left + (options.indent || 0), doc.y, { width, lineGap: 2 });
  doc.moveDown(0.45);
}

function drawTable(doc, lines) {
  const rows = lines
    .map((line) => line.replace(/^\||\|$/g, "").split("|").map((c) => plain(c.trim())))
    .filter((row) => !row.every((c) => /^:?-{3,}:?$/.test(c)));
  if (!rows.length) return;
  const columns = Math.max(...rows.map((r) => r.length));
  const width = contentWidth(doc);
  const colWidth = width / columns;
  const fontSize = columns > 4 ? 7 : 8;
  rows.forEach((row, rowIndex) => {
    const cells = Array.from({ length: columns }, (_, idx) => row[idx] || "");
    doc.font(rowIndex === 0 ? "Helvetica-Bold" : "Helvetica").fontSize(fontSize);
    const heights = cells.map((c) => doc.heightOfString(c || " ", { width: colWidth - 8, lineGap: 1 }));
    const rowHeight = Math.max(24, Math.min(120, Math.max(...heights) + 12));
    ensureSpace(doc, rowHeight + 4);
    const y = doc.y;
    cells.forEach((cell, colIndex) => {
      const x = doc.page.margins.left + colIndex * colWidth;
      doc.rect(x, y, colWidth, rowHeight).fillAndStroke(rowIndex === 0 ? "#efe9dc" : PAPER, "#d9d2c4");
      doc.fillColor(INK).font(rowIndex === 0 ? "Helvetica-Bold" : "Helvetica").fontSize(fontSize)
        .text(cell || " ", x + 4, y + 6, { width: colWidth - 8, height: rowHeight - 10, ellipsis: true, lineGap: 1 });
    });
    doc.y = y + rowHeight;
  });
  doc.moveDown(0.8);
}

function ensureSpace(doc, required) {
  if (doc.y + required > doc.page.height - doc.page.margins.bottom) doc.addPage();
}

function isAtTop(doc) {
  return doc.y <= doc.page.margins.top + 12;
}

function contentWidth(doc) {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

function drawPageNumbers(doc) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    if (i === 0) continue;
    doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(`${i}`, doc.page.margins.left, doc.page.height - doc.page.margins.bottom - 24, {
      width: contentWidth(doc),
      align: "right",
      lineBreak: false
    });
  }
}

function plain(value) {
  return String(value || "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .trim();
}

function safeDownloadName(value) {
  return String(value || "aitm-threat-model").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "aitm-threat-model";
}

module.exports = { renderReportPdf, safeDownloadName };
