"use client";

import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import { ChartColumn, Table2 } from "lucide-react";
import type { CategoryTotal, SeriesPoint } from "@/lib/data";
import { bucketLabel, bucketTitle, type Granularity } from "@/lib/dates";
import { formatMoney } from "@/lib/money";

/** Scheduled (not yet posted) recurring amounts use this prefix on their category's data key. */
const SCHEDULED = "s:";

/** Categories in `actual` order, then any that only have scheduled amounts. */
function union(actual: CategoryTotal[], scheduled: CategoryTotal[]): CategoryTotal[] {
  const ids = new Set(actual.map((c) => c.id));
  return [...actual, ...scheduled.filter((c) => !ids.has(c.id))];
}

/**
 * Two stacked bars per bucket, expenses then income, each split by category.
 * Only categories with transactions in the range get a series, and a bucket
 * with no income (or no expenses) draws nothing on that side. Upcoming
 * recurring occurrences stack on top as faded, outlined segments.
 */
export function CashFlowChart({ data, expense, income, scheduledExpense, scheduledIncome, group, currency }: {
  data: SeriesPoint[];
  expense: CategoryTotal[];
  income: CategoryTotal[];
  scheduledExpense: CategoryTotal[];
  scheduledIncome: CategoryTotal[];
  group: Granularity;
  currency: string;
}) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const expenseCats = union(expense, scheduledExpense);
  const incomeCats = union(income, scheduledIncome);
  // Render order is stack order: expenses form the left bar, and the largest category sits at the bottom.
  const all = [...expenseCats, ...incomeCats];
  const incomeIds = new Set(incomeCats.map((c) => c.id));
  const visible = all.filter((c) => !hidden.has(c.id));
  const scheduledIds = new Set([...scheduledExpense, ...scheduledIncome].map((c) => c.id));
  const hasScheduled = scheduledIds.size > 0;

  const rows = data.map((d) => {
    const row: Record<string, string | number> = { bucket: d.bucket, label: bucketLabel(d.bucket, group) };
    for (const [id, amount] of Object.entries(d.byCategory)) row[id] = amount;
    for (const [id, amount] of Object.entries(d.scheduled.byCategory)) row[SCHEDULED + id] = amount;
    return row;
  });

  function toggle(id: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < all.length - 1) next.add(id);
      return next;
    });
  }

  return (
    <div>
      {/* The card header lives here so the view toggle sits beside the title, leaving the legend the full width. */}
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Cash flow</h2>
          <p className="mt-0.5 text-sm text-muted">Per {group}</p>
        </div>
        <button
          type="button"
          className="btn btn-ghost h-11 shrink-0 px-3 sm:h-9"
          onClick={() => setView(view === "chart" ? "table" : "chart")}
        >
          {view === "chart" ? <Table2 className="size-4" aria-hidden /> : <ChartColumn className="size-4" aria-hidden />}
          {view === "chart" ? "Table" : "Chart"}
        </button>
      </div>

      <div className="mb-3">
        <div className="flex min-w-0 flex-col gap-1">
          {[
            { label: "Expenses", list: expenseCats },
            { label: "Income", list: incomeCats },
          ]
            .filter((g) => g.list.length)
            .map((g) => (
              <ul key={g.label} className="flex flex-wrap items-center gap-x-1" aria-label={`${g.label} categories`}>
                <li className="w-full shrink-0 text-xs font-medium text-subtle sm:w-18">{g.label}</li>
                {g.list.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      aria-pressed={!hidden.has(c.id)}
                      onClick={() => toggle(c.id)}
                      className={`flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-xs transition-opacity sm:px-2 sm:text-sm duration-150 hover:bg-sunken focus-visible:outline-2 focus-visible:outline-ring ${
                        hidden.has(c.id) ? "opacity-45" : ""
                      }`}
                    >
                      <span aria-hidden className="size-3 rounded-sm" style={{ backgroundColor: c.color }} />
                      {c.name}
                    </button>
                  </li>
                ))}
              </ul>
            ))}
          {hasScheduled && (
            <p className="flex items-center gap-1.5 text-xs text-muted sm:pl-18">
              <span aria-hidden className="size-3 rounded-sm border border-dashed border-muted bg-sunken" />
              Faded segments are scheduled recurring transactions
            </p>
          )}
        </div>
      </div>

      {view === "chart" ? (
        <div
          className="h-72 w-full"
          role="img"
          aria-label={`Expenses and income by category per ${group}${hasScheduled ? ", including scheduled recurring transactions" : ""}. Switch to the table view for exact values.`}
        >
          <ResponsiveContainer>
            <BarChart
              data={rows}
              barGap={2}
              barCategoryGap={rows.length > 40 ? "10%" : "25%"}
              margin={{ top: 8, right: 4, bottom: 0, left: 0 }}
            >
              <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={{ stroke: "var(--chart-grid)" }}
                tick={{ fill: "var(--chart-axis)", fontSize: 12 }}
                minTickGap={16}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={56}
                tick={{ fill: "var(--chart-axis)", fontSize: 12 }}
                tickFormatter={(v: number) => formatMoney(v, currency, { compact: true })}
              />
              <Tooltip
                cursor={{ fill: "var(--chart-cursor)" }}
                content={(props) => <ChartTooltip {...props} incomeIds={incomeIds} group={group} currency={currency} />}
              />
              {visible.map((c) => (
                <Bar
                  key={c.id}
                  dataKey={c.id}
                  name={c.name}
                  stackId={incomeIds.has(c.id) ? "income" : "expense"}
                  fill={c.color}
                  maxBarSize={36}
                />
              ))}
              {/* Declared after every posted series so scheduled amounts stack on top. */}
              {visible
                .filter((c) => scheduledIds.has(c.id))
                .map((c) => (
                  <Bar
                    key={SCHEDULED + c.id}
                    dataKey={SCHEDULED + c.id}
                    name={c.name}
                    stackId={incomeIds.has(c.id) ? "income" : "expense"}
                    fill={c.color}
                    fillOpacity={0.3}
                    stroke={c.color}
                    strokeDasharray="3 2"
                    maxBarSize={36}
                  />
                ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="max-h-72 overflow-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <caption className="sr-only">Expenses and income per {group}</caption>
            <thead className="sticky top-0 bg-surface-strong text-left text-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Period</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Expenses</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Income</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Net</th>
              </tr>
            </thead>
            <tbody className="tabular divide-y divide-line">
              {data.map((d) => (
                <tr key={d.bucket}>
                  <th scope="row" className="px-3 py-2 text-left font-normal">{bucketTitle(d.bucket, group)}</th>
                  <td className="px-3 py-2 text-right">
                    {formatMoney(d.expense, currency)}
                    <ScheduledNote amount={d.scheduled.expense} currency={currency} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    {formatMoney(d.income, currency)}
                    <ScheduledNote amount={d.scheduled.income} currency={currency} />
                  </td>
                  <td className={`px-3 py-2 text-right ${d.income - d.expense < 0 ? "text-danger" : ""}`}>
                    {formatMoney(d.income - d.expense, currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ScheduledNote({ amount, currency }: { amount: number; currency: string }) {
  if (!amount) return null;
  return <span className="block text-xs text-subtle">+{formatMoney(amount, currency)} scheduled</span>;
}

/** Lists only the categories present in the hovered bucket, grouped into expenses and income. */
function ChartTooltip({ active, payload, incomeIds, group, currency }: TooltipContentProps & {
  incomeIds: Set<string>;
  group: Granularity;
  currency: string;
}) {
  if (!active || !payload?.length) return null;
  const bucket = String((payload[0].payload as { bucket: string }).bucket);
  const entries = payload.filter((p) => Number(p.value));
  const id = (p: (typeof entries)[number]) => String(p.dataKey).replace(SCHEDULED, "");
  const sections = [
    { label: "Expenses", items: entries.filter((p) => !incomeIds.has(id(p))) },
    { label: "Income", items: entries.filter((p) => incomeIds.has(id(p))) },
  ].filter((s) => s.items.length);

  return (
    <div className="min-w-48 rounded-lg border border-line bg-surface-strong px-3 py-2 text-sm shadow-lg">
      <p className="mb-1 font-medium">{bucketTitle(bucket, group)}</p>
      {sections.length === 0 && <p className="text-muted">No transactions</p>}
      {sections.map((s) => {
        const total = s.items.reduce((sum, p) => sum + Number(p.value), 0);
        return (
          <div key={s.label} className="mt-1.5 first-of-type:mt-0">
            <p className="flex text-xs font-medium text-subtle">
              {s.label}
              <span className="tabular ml-auto pl-4">{formatMoney(total, currency)}</span>
            </p>
            {[...s.items]
              .sort((a, b) => Number(b.value) - Number(a.value))
              .map((p) => (
                <p key={String(p.dataKey)} className="flex items-center gap-2 text-muted">
                  <span
                    aria-hidden
                    className={`size-2.5 rounded-sm ${String(p.dataKey).startsWith(SCHEDULED) ? "opacity-40" : ""}`}
                    style={{ backgroundColor: p.color }}
                  />
                  {p.name}
                  {String(p.dataKey).startsWith(SCHEDULED) && <span className="text-xs text-subtle">scheduled</span>}
                  <span className="tabular ml-auto pl-4 font-medium text-fg">
                    {formatMoney(Number(p.value), currency)}
                  </span>
                </p>
              ))}
          </div>
        );
      })}
    </div>
  );
}
