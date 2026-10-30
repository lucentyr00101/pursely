import { getLedgerContext } from "@/lib/session";
import { exportRows } from "@/lib/data";
import { isIsoDate } from "@/lib/dates";

const COLUMNS = ["date", "type", "category", "subcategory", "amount", "paid_with", "statement", "note"] as const;

function csvCell(value: string) {
  // Quote everything; neutralise spreadsheet formula injection.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function GET(request: Request) {
  const ctx = await getLedgerContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });

  const params = new URL(request.url).searchParams;
  const from = params.get("from");
  const to = params.get("to");
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) {
    return new Response("Invalid date range", { status: 400 });
  }

  const rows = await exportRows(ctx.ledgerId, from, to);
  const csv = [COLUMNS.join(","), ...rows.map((r) => COLUMNS.map((c) => csvCell(r[c])).join(","))].join("\r\n");

  return new Response("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="expenses_${from}_to_${to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
