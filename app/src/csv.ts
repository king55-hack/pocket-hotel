/**
 * One cell of a CSV file that Excel will open. A cell that starts with = + - @ (or a tab/return) can be run as a formula
 * by Excel, so a guest named "=HYPERLINK(...)" could do harm to whoever opens the file. A quote mark in front makes it plain text.
 * Numbers are left alone (a negative number is not a formula).
 */
export function csvSafe(v: string | number): string {
  const raw = typeof v === "number" ? String(v) : v;
  const text = typeof v === "string" && /^[=+\-@\t\r]/.test(raw) && !/^-?\d+(\.\d+)?$/.test(raw) ? "'" + raw : raw;
  return `"${text.replace(/"/g, '""')}"`;
}

export const csvFile = (rows: (string | number)[][]) => "﻿" + rows.map((r) => r.map(csvSafe).join(",")).join("\r\n");

/** Read a CSV text (commas, quoted cells, "" for a quote). Returns rows of text. */
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim() !== "")) out.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) out.push(row);
  return out;
}
