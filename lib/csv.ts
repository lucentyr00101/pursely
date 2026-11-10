// Reading a CSV of transactions, shared by the import action and its tests. No database here.
import { isIsoDate } from "./dates";
import { parseAmount } from "./money";

/** Most rows one file may hold; a Server Action's body is capped at 1MB anyway. */
export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_BYTES = 900_000;

/**
 * Splits CSV text into rows of cells. Handles quoted cells (with doubled quotes, commas and line
 * breaks inside), CRLF or LF, and a leading byte order mark. The delimiter is whichever of comma or
 * semicolon the header line uses more, since Excel saves with semicolons in some regions. Blank lines
 * are dropped.
 */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^﻿/, "");
  const header = source.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = header.split(";").length > header.split(",").length ? ";" : ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const endRow = () => {
    row.push(cell);
    if (row.some((c) => c.trim() !== "")) rows.push(row);
    row = [];
    cell = "";
  };
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (source[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = false;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") endRow();
    else if (ch !== "\r") cell += ch;
  }
  if (cell !== "" || row.length) endRow();
  return rows;
}

export type ImportRow = {
  line: number; // 1-based, counting the header, as a spreadsheet shows it
  date: string;
  type: "expense" | "income";
  amount: number; // cents
  category: string;
  subcategory: string;
  note: string;
  paidWith: string;
  statement: string | null;
};
export type ImportError = { line: number; message: string };

const COLUMNS = ["date", "type", "category", "subcategory", "amount", "paid_with", "statement", "note"] as const;
type Column = (typeof COLUMNS)[number];

/** The export guards a cell that starts like a formula with an apostrophe; reading it back drops that. */
const unguard = (value: string) => value.replace(/^'(?=[=+\-@\t\r])/, "");

/**
 * Turns parsed rows into transactions to import. The first row names the columns, in any order and
 * letter case: `date` and `amount` are required, the rest are the export's and optional. A row that
 * can't be read is reported by line and left out; the others still import.
 */
export function readImport(rows: string[][]): { rows: ImportRow[]; errors: ImportError[] } | string {
  if (!rows.length) return "The file is empty.";
  const names = rows[0].map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, "_"));
  const at = Object.fromEntries(COLUMNS.map((c) => [c, names.indexOf(c)])) as Record<Column, number>;
  if (at.date < 0 || at.amount < 0) return "The first row must name the columns, with at least date and amount.";
  if (rows.length - 1 > MAX_IMPORT_ROWS) return `A file can hold at most ${MAX_IMPORT_ROWS.toLocaleString("en-US")} transactions. Split it and import each part.`;

  const out: ImportRow[] = [];
  const errors: ImportError[] = [];
  rows.slice(1).forEach((cells, i) => {
    const line = i + 2;
    const get = (c: Column) => (at[c] < 0 ? "" : (cells[at[c]] ?? "").trim());
    const date: unknown = get("date");
    if (!isIsoDate(date)) return errors.push({ line, message: `"${get("date").slice(0, 20)}" isn't a date like 2026-01-31.` });
    const amount = parseAmount(get("amount"));
    if (amount === null) return errors.push({ line, message: `"${get("amount").slice(0, 20)}" isn't an amount greater than 0.` });
    const type = get("type").toLowerCase() || "expense";
    if (type !== "expense" && type !== "income") return errors.push({ line, message: `The type must be expense or income.` });
    const statement = get("statement");
    out.push({
      line,
      date,
      type,
      amount,
      category: get("category"),
      subcategory: get("subcategory"),
      note: unguard(get("note")).slice(0, 200),
      paidWith: type === "expense" ? get("paid_with") : "",
      statement: type === "expense" && isIsoDate(statement) ? statement : null,
    });
  });
  return { rows: out, errors };
}
