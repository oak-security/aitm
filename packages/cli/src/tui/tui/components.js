// Presentational widgets, plain React.createElement (no JSX build step).
import React from "react";
import { Box, Text, useInput } from "ink";
import InkSpinner from "ink-spinner";

export const h = React.createElement;

export const GOLD = "#FFC965";
export const MAGENTA = "#9C0069";

export const RISK_COLORS = {
  Critical: "#5b0019",
  High: "#8a005d",
  Medium: "yellow",
  Low: "green",
  Informational: "gray",
  "N/A": "gray"
};

const Spinner = InkSpinner.default || InkSpinner;

export function Busy({ label }) {
  return h(
    Box,
    null,
    h(Text, { color: GOLD }, h(Spinner, { type: "dots" })),
    h(Text, null, ` ${label}`)
  );
}

export function Header({ subtitle }) {
  return h(
    Box,
    { flexDirection: "column", marginBottom: 1 },
    h(
      Box,
      null,
      h(Text, { color: GOLD, bold: true }, "AiTM"),
      h(Text, { color: "gray" }, " — AI Threat Modeller "),
      h(Text, { color: MAGENTA }, "· TRACE "),
      h(Text, { color: "gray" }, "· by Oak Security")
    ),
    subtitle ? h(Text, { color: "gray" }, subtitle) : null
  );
}

export function Panel({ title, children }) {
  return h(
    Box,
    { flexDirection: "column", borderStyle: "round", borderColor: "gray", paddingX: 1 },
    title ? h(Text, { bold: true, color: GOLD }, title) : null,
    children
  );
}

export function Select({ items, onSelect, initialIndex = 0 }) {
  const [i, setI] = React.useState(initialIndex);
  useInput((input, key) => {
    if (key.upArrow || input === "k") setI((p) => (p - 1 + items.length) % items.length);
    else if (key.downArrow || input === "j") setI((p) => (p + 1) % items.length);
    else if (key.return) onSelect(items[i].value, i);
  });
  return h(
    Box,
    { flexDirection: "column" },
    ...items.map((it, idx) =>
      h(
        Text,
        { key: String(idx), color: idx === i ? "cyan" : undefined },
        `${idx === i ? "❯ " : "  "}${it.label}`,
        it.hint ? h(Text, { color: "gray" }, `  ${it.hint}`) : null
      )
    )
  );
}

// Space toggles, enter confirms, a/n select all/none. Windows long lists.
export function MultiSelect({ items, initialSelected = [], onSubmit, height = 12 }) {
  const [i, setI] = React.useState(0);
  const [sel, setSel] = React.useState(() => new Set(initialSelected));
  useInput((input, key) => {
    if (key.upArrow || input === "k") setI((p) => (p - 1 + items.length) % items.length);
    else if (key.downArrow || input === "j") setI((p) => (p + 1) % items.length);
    else if (input === " ") {
      setSel((prev) => {
        const next = new Set(prev);
        const v = items[i].value;
        if (next.has(v)) next.delete(v);
        else next.add(v);
        return next;
      });
    } else if (input === "a") setSel(new Set(items.map((it) => it.value)));
    else if (input === "n") setSel(new Set());
    else if (key.return) onSubmit([...sel]);
  });
  const start = Math.max(0, Math.min(i - Math.floor(height / 2), items.length - height));
  const visible = items.slice(start, start + height);
  return h(
    Box,
    { flexDirection: "column" },
    start > 0 ? h(Text, { color: "gray" }, `  … ${start} more above`) : null,
    ...visible.map((it, idx) => {
      const abs = start + idx;
      const active = abs === i;
      const ticked = sel.has(it.value);
      return h(
        Text,
        { key: String(abs), color: active ? "cyan" : undefined },
        `${active ? "❯ " : "  "}${ticked ? "[x] " : "[ ] "}${it.label}`,
        it.hint ? h(Text, { color: "gray" }, `  ${it.hint}`) : null
      );
    }),
    start + height < items.length ? h(Text, { color: "gray" }, `  … ${items.length - start - height} more below`) : null,
    h(Text, { color: "gray" }, "space toggle · a all · n none · enter confirm")
  );
}

// Single-line text input; enter submits (empty allowed unless required).
export function TextPrompt({ label, placeholder = "", initial = "", mask = false, required = false, onSubmit }) {
  const [value, setValue] = React.useState(initial);
  useInput((input, key) => {
    if (key.return) {
      if (required && !value.trim()) return;
      onSubmit(value.trim());
    } else if (key.backspace || key.delete) setValue((v) => v.slice(0, -1));
    else if (key.ctrl && input === "u") setValue("");
    else if (input && !key.ctrl && !key.meta && !key.escape && !key.tab && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow) {
      // Pasted chunks can carry the newline inside the input string with key.return
      // unset — treat an embedded newline as submit.
      const nl = input.search(/[\r\n]/);
      if (nl >= 0) {
        const v = (value + input.slice(0, nl)).trim();
        if (required && !v) return;
        onSubmit(v);
      } else {
        setValue((v) => v + input);
      }
    }
  });
  const shown = mask && value ? "*".repeat(Math.max(0, value.length - 4)) + value.slice(-4) : value;
  return h(
    Box,
    { flexDirection: "column" },
    h(Text, { bold: true }, label),
    h(
      Box,
      null,
      h(Text, { color: "cyan" }, "› "),
      value ? h(Text, null, shown) : h(Text, { color: "gray" }, placeholder),
      h(Text, { color: "cyan" }, "█")
    )
  );
}

export function KeyHints({ hints }) {
  return h(
    Box,
    { marginTop: 1 },
    h(Text, { color: "gray" }, hints.join(" · "))
  );
}
