"use client";

import { useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChartColumn, ReceiptText } from "lucide-react";
import type { CategoryTotal } from "@/lib/data";
import type { TxType } from "@/lib/category-defs";
import { formatMoney } from "@/lib/money";
import { CategoryIcon } from "./category-icon";
import { paidWithOptions } from "./paid-with";
import { Select } from "./select";
import { TransactionsDialog, type DetailContext } from "./transactions-dialog";
import { EmptyState } from "./ui";

// Rows shown before "Show all"; a long tail of small categories would otherwise dwarf the chart beside it.
const TOP = 6;
const GENERAL = "general";
// The dialog key for every transaction in the open category; any other key is a subcategory row.
const ALL = "all";

/**
 * Ranked horizontal bars, filterable by how expenses were paid. Click a category to see its
 * subcategories; click a subcategory, or "View all", to list its transactions in a dialog so the
 * card keeps the height of the chart beside it.
 */
export function CategoryBreakdown({ expense, income, byPaid, from, to, ...context }: DetailContext & {
  expense: CategoryTotal[];
  income: CategoryTotal[];
  /** `expense` split by a card id, a fixed method, or "none". */
  byPaid: Record<string, CategoryTotal[]>;
  from: string;
  to: string;
}) {
  const { cards, methodColors, currency } = context;
  const [type, setType] = useState<TxType>("expense");
  const [paid, setPaid] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const filtered = type === "expense" && paid !== "";
  const list = type === "income" ? income : filtered ? (byPaid[paid] ?? []) : expense;
  const open = list.find((c) => c.id === openId) ?? null;
  const total = list.reduce((s, c) => s + c.amount, 0);
  const bar = type === "expense" ? "var(--series-expense)" : "var(--series-income)";

  type Row = { key: string; name: string; amount: number; cat?: CategoryTotal };
  const rows: Row[] = open
    ? open.children.map((c) => ({ key: c.id ?? GENERAL, name: c.name, amount: c.amount }))
    : list.map((c) => ({ key: c.id, name: c.name, amount: c.amount, cat: c }));
  const max = Math.max(1, ...rows.map((r) => r.amount));
  const base = open ? open.amount : total;
  // Collapsing a single extra row saves nothing, so only cut when at least two would be hidden.
  const collapsible = rows.length > TOP + 1;
  const shown = collapsible && !showAll ? rows.slice(0, TOP) : rows;
  const sub = open && sheet && sheet !== ALL ? (rows.find((r) => r.key === sheet) ?? null) : null;

  // Archived cards only show up while they have spending in the range.
  const usedCards = cards.filter((c) => !c.archived || byPaid[c.id]?.length || c.id === paid);
  const paidOptions = [{ value: "", label: "All methods" }, ...paidWithOptions(usedCards, methodColors), { value: "none", label: "Not set" }];
  const paidName = paidOptions.find((o) => o.value === paid)?.label;

  const choose = (id: string | null) => {
    setOpenId(id);
    setSheet(null);
    setShowAll(false);
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {open ? (
          <button type="button" className="btn btn-ghost h-11 px-3 sm:h-9" onClick={() => choose(null)}>
            <ChevronLeft className="size-4" aria-hidden />
            All categories
          </button>
        ) : (
          <div role="group" aria-label="Type" className="flex gap-1 rounded-lg bg-sunken p-1">
            {(["expense", "income"] as const).map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={type === t}
                onClick={() => setType(t)}
                className={`h-9 cursor-pointer rounded-md px-3 text-sm font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-ring ${
                  type === t ? "bg-surface-strong text-fg shadow-sm" : "text-muted hover:text-fg active:text-fg"
                }`}
              >
                {t === "expense" ? "Expenses" : "Income"}
              </button>
            ))}
          </div>
        )}
        <p className="tabular text-sm text-muted">{formatMoney(base, currency)}</p>
      </div>

      {type === "expense" && (
        <Select
          aria-label="Paid with"
          size="sm"
          className="mb-3 w-full"
          options={paidOptions}
          value={paid}
          onChange={(v) => {
            setPaid(v);
            setSheet(null);
            setShowAll(false);
          }}
        />
      )}

      {open && <h3 className="mb-2 font-medium">{open.name}</h3>}

      {rows.length === 0 ? (
        <EmptyState
          icon={<ChartColumn className="size-8" aria-hidden />}
          title={filtered ? `No expenses paid with ${paidName} in this range` : `No ${type} in this range`}
        />
      ) : (
        <>
          <ul className="flex flex-col gap-1">
            {shown.map((r) => {
              const pct = base ? Math.round((r.amount / base) * 100) : 0;
              const content = (
                <>
                  {r.cat && <CategoryIcon icon={r.cat.icon} color={r.cat.color} size="sm" />}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="truncate font-medium">{r.name}</span>
                      <span className="tabular shrink-0">{formatMoney(r.amount, currency)}</span>
                    </span>
                    <span className="mt-1.5 flex items-center gap-2">
                      <span aria-hidden className="block h-2 flex-1 overflow-hidden rounded-full bg-sunken">
                        <span className="block h-full rounded-full" style={{ width: `${(r.amount / max) * 100}%`, backgroundColor: bar }} />
                      </span>
                      <span className="tabular w-9 shrink-0 text-right text-xs text-subtle">{pct}%</span>
                    </span>
                  </span>
                </>
              );
              const rowClass =
                "flex w-full cursor-pointer items-center gap-2.5 rounded-lg p-2 text-left min-[360px]:gap-3 transition-colors duration-150 hover:bg-sunken active:bg-sunken focus-visible:outline-2 focus-visible:outline-ring";
              return (
                <li key={r.key}>
                  {r.cat ? (
                    <button
                      type="button"
                      onClick={() => choose(r.key)}
                      aria-label={`${r.name}: ${formatMoney(r.amount, currency)}, ${pct}%. Show subcategories and transactions`}
                      className={rowClass}
                    >
                      {content}
                      <ChevronRight className="size-4 shrink-0 text-subtle max-[359px]:hidden" aria-hidden />
                    </button>
                  ) : (
                    <button
                      type="button"
                      aria-haspopup="dialog"
                      onClick={() => setSheet(r.key)}
                      aria-label={`${r.name}: ${formatMoney(r.amount, currency)}, ${pct}%. Show transactions`}
                      className={rowClass}
                    >
                      {content}
                      <ReceiptText className="size-4 shrink-0 text-subtle max-[359px]:hidden" aria-hidden />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {collapsible && (
            <button
              type="button"
              aria-expanded={showAll}
              onClick={() => setShowAll(!showAll)}
              className="mt-2 flex h-11 w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg text-sm font-medium text-muted transition-colors duration-150 hover:bg-sunken hover:text-fg active:bg-sunken active:text-fg focus-visible:outline-2 focus-visible:outline-ring"
            >
              {showAll ? `Show top ${TOP}` : `Show all ${rows.length}`}
              <ChevronDown className={`size-4 transition-transform duration-200 ${showAll ? "rotate-180" : ""}`} aria-hidden />
            </button>
          )}
        </>
      )}

      {open && rows.length > 0 && (
        <button type="button" aria-haspopup="dialog" className="btn btn-ghost mt-2 h-11 w-full" onClick={() => setSheet(ALL)}>
          <ReceiptText className="size-4" aria-hidden />
          View all {open.count} transaction{open.count === 1 ? "" : "s"}
        </button>
      )}

      <TransactionsDialog
        {...context}
        query={
          open && sheet
            ? {
                from,
                to,
                type,
                categoryId: open.id,
                ...(sheet !== ALL && { subcategoryId: sheet }),
                // Recurring payments are left out of the expense breakdown; recurring income stays.
                ...(type === "expense" && { recurring: "exclude" as const, ...(paid && { paidWith: paid }) }),
              }
            : null
        }
        title={open ? (sub ? `${open.name} › ${sub.name}` : open.name) : ""}
        note={filtered ? `Paid with ${paidName}. Without recurring payments.` : type === "expense" ? "Without recurring payments." : undefined}
        onClose={() => setSheet(null)}
      />
    </div>
  );
}

