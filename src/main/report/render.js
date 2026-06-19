"use strict";

// Minimal, dependency-free Markdown -> HTML for the in-app report preview.
// Handles headings, unordered lists, GFM tables, paragraphs, and inline bold/code/links.
// The renderer is fed AI output that avoids fenced code blocks (per the report prompt).

const INK = "#000000";
const PAPER = "#F7F6F5";
const GOLD = "#FFC965";
const MAGENTA = "#9C0069";

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function inline(text) {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
}

function isTableDivider(line) {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/.test(line.trim());
}

function splitRow(line) {
  return line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
}

function bodyToHtml(markdown) {
  const lines = String(markdown || "").split("\n");
  const out = [];
  let i = 0;
  let listOpen = false;
  const closeList = () => {
    if (listOpen) {
      out.push("</ul>");
      listOpen = false;
    }
  };

  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();

    if (!t || /^-{3,}$/.test(t)) {
      closeList();
      i += 1;
      continue;
    }

    // Tables
    if (t.startsWith("|") && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      closeList();
      const header = splitRow(lines[i]);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      out.push("<table><thead><tr>" + header.map((c) => `<th>${inline(c)}</th>`).join("") + "</tr></thead><tbody>");
      for (const r of rows) {
        out.push("<tr>" + header.map((_, idx) => `<td>${inline(r[idx] || "")}</td>`).join("") + "</tr>");
      }
      out.push("</tbody></table>");
      continue;
    }

    if (t.startsWith("### ")) { closeList(); out.push(`<h3>${inline(t.slice(4))}</h3>`); i += 1; continue; }
    if (t.startsWith("## ")) { closeList(); out.push(`<h2>${inline(t.slice(3))}</h2>`); i += 1; continue; }
    if (t.startsWith("# ")) { closeList(); out.push(`<h1>${inline(t.slice(2))}</h1>`); i += 1; continue; }

    if (t.startsWith("- ") || t.startsWith("* ")) {
      if (!listOpen) { out.push("<ul>"); listOpen = true; }
      out.push(`<li>${inline(t.slice(2))}</li>`);
      i += 1;
      continue;
    }

    closeList();
    out.push(`<p>${inline(t)}</p>`);
    i += 1;
  }
  closeList();
  return out.join("\n");
}

function toHtml(markdown, title = "Threat Model Report") {
  const body = bodyToHtml(markdown);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light; }
  body { font-family: "BDO Grotesk", system-ui, sans-serif; max-width: 920px; margin: 40px auto; padding: 0 24px; line-height: 1.6; color: ${INK}; background: ${PAPER}; }
  h1, h2, h3 { line-height: 1.25; }
  h1 { font-size: 2rem; }
  h2 { font-size: 1.4rem; border-bottom: 3px solid; border-image: linear-gradient(90deg, ${GOLD}, ${MAGENTA}) 1; padding-bottom: 6px; margin-top: 2rem; }
  h3 { font-size: 1.1rem; margin-top: 1.4rem; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; font-size: 0.92rem; }
  th, td { border: 1px solid rgba(14,17,22,0.18); padding: 7px 10px; text-align: left; vertical-align: top; }
  th { background: rgba(14,17,22,0.05); }
  code { background: rgba(14,17,22,0.06); padding: 1px 5px; border-radius: 4px; font-size: 0.9em; }
  li { margin: 4px 0; }
  a { color: ${INK}; text-decoration: underline; }
</style></head><body>${body}</body></html>`;
}

module.exports = { toHtml, bodyToHtml, escapeHtml };
