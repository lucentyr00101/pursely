import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getToday, getLedger } from "@/lib/session";
import { getBudgetLimit, getBudgetStatus, getSettings } from "@/lib/data";
import { addMonths, endOf, formatDate, isIsoDate, startOf } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { BudgetForm } from "@/components/budget-row";
import { BudgetMeter } from "@/components/budget-meter";
import { CategoryIcon } from "@/components/category-icon";
import { Card, PageHeader, Skeleton } from "@/components/ui";

export const metadata: Metadata = { title: "Budgets" };

export default function BudgetsPage({ searchParams }: PageProps<"/budgets">) {
  return (
    <>
      <PageHeader title="Budgets" description="Monthly spending limits per category. They repeat every month." />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Budgets searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Budgets({ searchParams }: { searchParams: PageProps<"/budgets">["searchParams"] }) {
  const [ledger, today, params] = await Promise.all([getLedger(), getToday(), searchParams]);
  const requested = `${params.month}-01`;
  const thisMonth = startOf(today, "month");
  const month = isIsoDate(requested) && requested <= thisMonth ? requested : thisMonth;

  const [rows, { currency }, limit] = await Promise.all([
    getBudgetStatus(ledger.ledgerId, month, endOf(month, "month")),
    getSettings(ledger.ledgerId),
    getBudgetLimit(ledger.ledgerId),
  ]);
  const canEdit = ledger.role !== "viewer";
  const withBudget = rows.filter((r) => r.budget !== null);
  const totalBudget = withBudget.reduce((s, r) => s + r.budget!, 0);
  const totalSpent = withBudget.reduce((s, r) => s + r.spent, 0);
  const prev = addMonths(month, -1).slice(0, 7);
  const next = addMonths(month, 1);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <Link href={`/budgets?month=${prev}`} className="icon-btn shrink-0 border border-line-strong" aria-label="Previous month">
          <ChevronLeft className="size-5" aria-hidden />
        </Link>
        <p className="flex-1 text-center font-semibold sm:min-w-36 sm:flex-none">{formatDate(month, { month: "long", year: "numeric" })}</p>
        <Link
          href={`/budgets?month=${next.slice(0, 7)}`}
          aria-label="Next month"
          aria-disabled={next > thisMonth}
          tabIndex={next > thisMonth ? -1 : undefined}
          className={`icon-btn shrink-0 border border-line-strong ${next > thisMonth ? "pointer-events-none opacity-40" : ""}`}
        >
          <ChevronRight className="size-5" aria-hidden />
        </Link>
      </div>

      {(withBudget.length > 0 || limit !== null) && (
        <Card title="All budgeted categories">
          {withBudget.length > 0 && <BudgetMeter spent={totalSpent} budget={totalBudget} currency={currency} />}
          {limit !== null && (
            <p className={`text-sm text-muted ${withBudget.length > 0 ? "mt-3 border-t border-line pt-3" : ""}`}>
              Budgets can total up to{" "}
              <Link href="/transactions/recurring" className="tabular font-medium text-fg underline underline-offset-2 hover:text-primary active:text-primary">
                {formatMoney(limit, currency)}
              </Link>
              , your recurring net per month.{" "}
              <span className={`tabular font-medium ${totalBudget > limit ? "text-danger" : "text-fg"}`}>
                {totalBudget > limit
                  ? `${formatMoney(totalBudget - limit, currency)} over`
                  : `${formatMoney(limit - totalBudget, currency)} unallocated`}
              </span>
              .
            </p>
          )}
        </Card>
      )}

      <Card title="Categories" description={`Amounts in ${currency}, saved when you leave the field. Leave empty for no limit.`}>
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            // Name and limit share the top line so each row stays short on phones; the meter spans beneath.
            <li key={r.categoryId} className="flex items-start gap-3 py-4">
              {/* Under 360px the icon would squeeze names like "Transportation" into a mid-word break. */}
              <span className="max-[359px]:hidden">
                <CategoryIcon icon={r.icon} color={r.color} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-3">
                  <p className="line-clamp-2 min-w-0 flex-1 pt-2.5 font-medium break-words">{r.name}</p>
                  <BudgetForm key={`${r.categoryId}-${r.budget}`} categoryId={r.categoryId} name={r.name} budget={r.budget} currency={currency} canEdit={canEdit} max={limit === null ? null : Math.max(0, limit - (totalBudget - (r.budget ?? 0)))} />
                </div>
                {r.budget !== null ? (
                  <div className="mt-2">
                    <BudgetMeter spent={r.spent} budget={r.budget} currency={currency} />
                  </div>
                ) : (
                  <p className="tabular mt-1 text-sm text-muted">Spent {formatMoney(r.spent, currency)}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
