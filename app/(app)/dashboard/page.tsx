import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Target } from "lucide-react";
import { getToday, getLedger } from "@/lib/session";
import { getBudgetStatus, getInsight, getSettings, getSummary, listCards, listCategories } from "@/lib/data";
import { geminiEnabled } from "@/lib/gemini";
import { endOf, resolveRange, startOf, type RangeParams } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { AddTransactionButton } from "@/components/add-transaction-button";
import { BudgetMeter } from "@/components/budget-meter";
import { CashFlowChart } from "@/components/cash-flow-chart";
import { CategoryBreakdown } from "@/components/category-breakdown";
import { CategoryIcon } from "@/components/category-icon";
import { InsightCard } from "@/components/insight-card";
import { RangePicker } from "@/components/range-picker";
import { Card, EmptyState, PageHeader, Skeleton } from "@/components/ui";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <Dashboard searchParams={searchParams} />
    </Suspense>
  );
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

async function Dashboard({ searchParams }: { searchParams: PageProps<"/dashboard">["searchParams"] }) {
  const [ledger, today, raw] = await Promise.all([getLedger(), getToday(), searchParams]);
  const params: RangeParams = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, first(v)]));
  const range = resolveRange(params, today);

  const ai = geminiEnabled();
  const [summary, settings, categories, budgets, insight, cards] = await Promise.all([
    getSummary(ledger.ledgerId, range),
    getSettings(ledger.ledgerId),
    listCategories(ledger.ledgerId),
    getBudgetStatus(ledger.ledgerId, startOf(today, "month"), endOf(today, "month")),
    ai ? getInsight(ledger.ledgerId) : null,
    listCards(ledger.ledgerId, { includeArchived: true }),
  ]);
  const { currency, methodColors } = settings;
  const net = summary.income - summary.expense;
  const { scheduled } = summary;
  const projectedNet = net + scheduled.income - scheduled.expense;
  const bills = summary.recurring.expense;
  const budgeted = budgets
    .filter((b) => b.budget !== null)
    .sort((a, b) => b.spent / b.budget! - a.spent / a.budget!)
    .slice(0, 4);

  return (
    <div className="flex flex-col gap-6">
      {/* The column's gap already spaces the header, so it drops its own bottom margin. */}
      <PageHeader
        className=""
        title={`Hi, ${ledger.user.name.split(" ")[0]}`}
        description="Here's how your money moved."
        actions={<AddTransactionButton categories={categories} cards={cards} methodColors={methodColors} currency={currency} date={today} canEdit={ledger.role !== "viewer"} />}
      />

      {ai && <InsightCard initial={insight} />}

      {/* Keyed so its local selection resets to the range actually shown; the page stays mounted across navigations. */}
      <RangePicker
        key={`${range.preset}|${range.from}|${range.to}|${params.group ?? ""}`}
        range={range}
        groupParam={params.group}
        today={today}
      />

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi
          label="Expenses"
          value={formatMoney(summary.expense, currency)}
          dot="var(--series-expense)"
          hint={scheduled.expense ? `+${formatMoney(scheduled.expense, currency)} scheduled` : undefined}
        />
        <Kpi
          label="Income"
          value={formatMoney(summary.income, currency)}
          dot="var(--series-income)"
          hint={scheduled.income ? `+${formatMoney(scheduled.income, currency)} scheduled` : undefined}
        />
        <Kpi
          label="Net"
          value={formatMoney(net, currency)}
          className={net < 0 ? "text-danger" : "text-success"}
          hint={scheduled.count ? `${formatMoney(projectedNet, currency)} with scheduled` : undefined}
        />
        <Kpi
          label="Avg. spent per day"
          value={formatMoney(Math.round(summary.expense / range.days), currency)}
          hint={`${summary.count} transaction${summary.count === 1 ? "" : "s"}`}
        />
        {/* Five cards leave one alone on the last row of two columns, so it takes the full row. */}
        <Kpi
          label="Recurring payments"
          value={formatMoney(bills.posted + bills.scheduled, currency)}
          hint={
            bills.scheduled
              ? `${formatMoney(bills.posted, currency)} paid · ${formatMoney(bills.scheduled, currency)} to come`
              : `${bills.count} payment${bills.count === 1 ? "" : "s"}`
          }
          span="col-span-2 lg:col-span-1"
        />
      </dl>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CashFlowChart
            data={summary.series}
            expense={summary.expenseByCategory}
            income={summary.incomeByCategory}
            scheduledExpense={scheduled.expenseByCategory}
            scheduledIncome={scheduled.incomeByCategory}
            group={range.group}
            currency={currency}
          />
        </Card>
        <Card title="By category" description="Select a category to see subcategories" className="lg:col-span-2">
          <CategoryBreakdown expense={summary.expenseByCategory} income={summary.incomeByCategory} currency={currency} />
        </Card>
      </div>

      <Card
        title="Budgets this month"
        actions={
          <Link href="/budgets" className="btn btn-ghost h-11 px-3 sm:h-9">
            Manage <ArrowRight className="size-4" aria-hidden />
          </Link>
        }
      >
        {budgeted.length ? (
          <ul className="grid gap-5 sm:grid-cols-2">
            {budgeted.map((b) => (
              <li key={b.categoryId} className="flex items-start gap-3">
                <CategoryIcon icon={b.icon} color={b.color} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="mb-1.5 truncate text-sm font-medium">{b.name}</p>
                  <BudgetMeter spent={b.spent} budget={b.budget!} currency={currency} />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={<Target className="size-8" aria-hidden />} title="No budgets yet">
            Set a monthly limit for a category to track it here.
          </EmptyState>
        )}
      </Card>
    </div>
  );
}

function Kpi({ label, value, hint, dot, className = "", span = "" }: {
  label: string;
  value: string;
  hint?: string;
  dot?: string;
  className?: string;
  span?: string;
}) {
  return (
    <div className={`glass min-w-0 rounded-2xl p-3 sm:p-4 ${span}`}>
      <dt className="flex items-center gap-2 text-xs text-muted min-[360px]:text-sm">
        {dot && <span aria-hidden className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: dot }} />}
        {label}
      </dt>
      <dd title={value} className={`tabular mt-1 truncate text-base font-bold tracking-tight min-[360px]:text-lg sm:text-2xl lg:text-xl xl:text-2xl ${className}`}>
        {value}
      </dd>
      {hint && <dd className="mt-0.5 text-xs text-subtle">{hint}</dd>}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div aria-busy aria-label="Loading dashboard" className="flex flex-col gap-6">
      <Skeleton className="h-16 w-64" />
      {geminiEnabled() && <Skeleton className="h-80 lg:h-96" />}
      <Skeleton className="h-28" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className={`h-24 ${i === 4 ? "col-span-2 lg:col-span-1" : ""}`} />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-5">
        <Skeleton className="h-96 lg:col-span-3" />
        <Skeleton className="h-96 lg:col-span-2" />
      </div>
    </div>
  );
}
