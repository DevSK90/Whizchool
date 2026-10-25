/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF), for any one-character delimiter. */
export function parseCsv(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

/**
 * Excel writes commas, or semicolons where the decimal separator is a comma; "Unicode Text"
 * exports use tabs. Decided from the header line, ignoring anything inside quotes.
 */
export function detectDelimiter(text: string): "," | ";" | "\t" {
  const firstLine = text.split(/\r?\n/, 1)[0]!.replace(/"[^"]*"/g, "");
  const count = (d: string) => firstLine.split(d).length - 1;
  const candidates = (["\t", ";", ","] as const).map((d) => [d, count(d)] as const);
  const [best] = [...candidates].sort((a, b) => b[1] - a[1]);
  return best![1] > 0 ? best![0] : ",";
}

/**
 * Turns a CSV file's bytes into text. Handles UTF-8 (with or without the byte-order mark Excel's
 * "CSV UTF-8" adds), UTF-16 ("Unicode Text") and, for old Excel "CSV" files, Windows-1252.
 */
export function decodeCsv(bytes: Uint8Array): { text: string; encoding: "utf-8" | "utf-16le" | "utf-16be" | "windows-1252" } {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder("utf-16le").decode(bytes.subarray(2)), encoding: "utf-16le" };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder("utf-16be").decode(bytes.subarray(2)), encoding: "utf-16be" };
  const body = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(body), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(body), encoding: "windows-1252" };
  }
}

/** A text cell that a spreadsheet would run as a formula (=, +, -, @) is defused with a leading quote. */
const defuse = (s: string) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);

export function toCsv(rows: (string | number | undefined)[][]) {
  return rows
    .map((r) =>
      r
        .map((v) => {
          const s = v === undefined ? "" : typeof v === "number" ? String(v) : defuse(v);
          return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    )
    .join("\r\n");
}

export function downloadText(filename: string, text: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob(["﻿", text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
