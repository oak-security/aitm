// Scrollable Markdown report viewer with export keys. Plain line-based rendering:
// headings and table rules get color, everything else prints as-is, hard-wrapped.
import React from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { h, GOLD, MAGENTA, KeyHints } from "./components.js";

function wrapLine(line, width) {
  if (line.length <= width) return [line];
  const out = [];
  let rest = line;
  while (rest.length > width) {
    let cut = rest.lastIndexOf(" ", width);
    if (cut < width * 0.5) cut = width;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^ /, "");
  }
  if (rest) out.push(rest);
  return out;
}

function styleFor(line) {
  if (/^#{1,2}\s/.test(line)) return { color: GOLD, bold: true };
  if (/^#{3,6}\s/.test(line)) return { color: MAGENTA, bold: true };
  if (/^\s*\|[\s:-]+\|/.test(line)) return { color: "gray" };
  if (/^\s*([-*]|\d+\.)\s/.test(line)) return {};
  return {};
}

export function ReportViewer({ markdown, statusLine, onKey }) {
  const { stdout } = useStdout();
  const width = Math.max(40, (stdout.columns || 100) - 2);
  const height = Math.max(6, (stdout.rows || 30) - 5);
  const lines = React.useMemo(
    () => markdown.split("\n").flatMap((l) => wrapLine(l, width)),
    [markdown, width]
  );
  const maxOffset = Math.max(0, lines.length - height);
  const [offset, setOffset] = React.useState(0);

  useInput((input, key) => {
    if (key.downArrow || input === "j") setOffset((o) => Math.min(maxOffset, o + 1));
    else if (key.upArrow || input === "k") setOffset((o) => Math.max(0, o - 1));
    else if (key.pageDown || input === "f") setOffset((o) => Math.min(maxOffset, o + height));
    else if (key.pageUp || input === "b") setOffset((o) => Math.max(0, o - height));
    else if (input === "g") setOffset(0);
    else if (input === "G") setOffset(maxOffset);
    else if (onKey) onKey(input, key);
  });

  const visible = lines.slice(offset, offset + height);
  const pct = maxOffset ? Math.round((offset / maxOffset) * 100) : 100;
  return h(
    Box,
    { flexDirection: "column" },
    h(
      Box,
      { flexDirection: "column", height },
      ...visible.map((l, i) => h(Text, { key: String(offset + i), wrap: "truncate", ...styleFor(l) }, l || " "))
    ),
    statusLine ? h(Text, { color: "green" }, statusLine) : null,
    h(KeyHints, {
      hints: [`${pct}%`, "j/k scroll", "f/b page", "g/G top/bottom", "m export md", "p export pdf", "q quit"]
    })
  );
}
