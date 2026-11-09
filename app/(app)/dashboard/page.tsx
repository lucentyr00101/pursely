import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, ChevronRight, OctagonAlert, Target, TrendingDown, TrendingUp, TriangleAlert } from "lucide-react";
import { getToday, getLedger } from "@/lib/session";
import { getBudgetStatus, getInsight, getSettings, getSummary, listCards, listCategories, periodTotals, statementsDue, type BudgetStatus, type PeriodTotals } from "@/lib/data";
import { geminiEnabled } from "@/lib/gemini";
import { comparison, endOf, formatDate, resolveRange, startOf, type RangeParams } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { AddTransactionButton } from "@/components/add-transaction-button";
import { BudgetMeter } from "@/components/budget-meter";
import { CashFlowChart } from "@/components/cash-flow-chart";
import { CategoryBreakdown } from "@/components/category-breakdown";
import { DetailButton, type DetailContext } from "@/components/transactions-dialog";
import { CategoryIcon } from "@/components/category-icon";
import { StatementsDue } from "@/components/card-manager";
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
  const compare = comparison(range, today);
  const [summary, settings, categories, budgets, insight, cards, due, periods] = await Promise.all([
    getSummary(ledger.ledgerId, range),
    getSettings(ledger.ledgerId),
    listCategories(ledger.ledgerId),
    getBudgetStatus(ledger.ledgerId, startOf(today, "month"), endOf(today, "month")),
    ai ? getInsight(ledger.ledgerId) : null,
    listCards(ledger.ledgerId, { includeArchived: true }),
    statementsDue(ledger.ledgerId, today),
    compare &&
      Promise.all([
        periodTotals(ledger.ledgerId, compare.current.from, compare.current.to),
        periodTotals(ledger.ledgerId, compare.previous.from, compare.previous.to),
      ]),
  ]);
  const trendOf = (key: keyof PeriodTotals, goodWhenUp: boolean): Trend | undefined => {
    if (!compare || !periods) return undefined;
    const [now, before] = periods.map((p) => p[key]);
    if (!before) return undefined;
    return { change: Math.round(((now - before) / before) * 100), label: compare.label, goodWhenUp };
  };
  const { currency, methodColors } = settings;
  const net = summary.income - summary.expense;
  const { scheduled } = summary;
  const projectedNet = net + scheduled.income - scheduled.expense;
  const bills = summary.recurring.expense;
  const canEdit = ledger.role !== "viewer";
  const detail: DetailContext = { categories, cards, methodColors, currency, canEdit };
  const { from, to } = range;
  const span = from === to ? formatDate(from, { month: "short", day: "numeric", year: "numeric" }) : `${formatDate(from, { month: "short", day: "numeric" })} – ${formatDate(to, { month: "short", day: "numeric", year: "numeric" })}`;
  const scheduledNote = (amount: number) =>
    amount ? `Plus ${formatMoney(amount, currency)} scheduled in this range, not added yet.` : undefined;
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
        description={`Here's how your money moved.${cards.length ? " Card purchases count in the month their statement closes." : ""}`}
        actions={<AddTransactionButton categories={categories} cards={cards} methodColors={methodColors} currency={currency} date={today} canEdit={ledger.role !== "viewer"} />}
      />

      <StatementsDue items={due} today={today} context={detail} />
      <BudgetAlerts budgets={budgets} currency={currency} />

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
          trend={trendOf("expense", false)}
          detail={{ context: detail, query: { from, to, type: "expense" }, title: `Expenses · ${span}`, note: [scheduledNote(scheduled.expense), "Card purchases count on their statement date."].filter(Boolean).join(" ") }}
          note={
            summary.billedLater ? (
              <DetailButton
                context={detail}
                query={{ from, to, type: "expense", billedLater: true }}
                title={`Billed later · ${span}`}
                note="Card purchases made in this range on a statement that closes after it, so they count later."
                className="relative z-10 -mx-1 inline-flex min-h-8 cursor-pointer items-center gap-0.5 rounded px-1 text-left underline underline-offset-2 transition-colors duration-150 hover:text-fg active:text-fg focus-visible:outline-2 focus-visible:outline-ring"
              >
                {formatMoney(summary.billedLater, currency)} swiped, billed later
              </DetailButton>
            ) : undefined
          }
        />
        <Kpi
          label="Income"
          value={formatMoney(summary.income, currency)}
          dot="var(--series-income)"
          hint={scheduled.income ? `+${formatMoney(scheduled.income, currency)} scheduled` : undefined}
          trend={trendOf("income", true)}
          detail={{ context: detail, query: { from, to, type: "income" }, title: `Income · ${span}`, note: scheduledNote(scheduled.income) }}
        />
        <Kpi
          label="Net"
          value={formatMoney(net, currency)}
          className={net < 0 ? "text-danger" : "text-success"}
          hint={scheduled.count ? `${formatMoney(projectedNet, currency)} with scheduled` : undefined}
          detail={{ context: detail, query: { from, to }, title: `All transactions · ${span}`, note: "Card purchases count on their statement date." }}
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
          trend={trendOf("recurringExpense", false)}
          detail={{ context: detail, query: { from, to, type: "expense", recurring: "only" }, title: `Recurring payments · ${span}`, note: scheduledNote(bills.scheduled) }}
          span="col-span-2 lg:col-span-1"
        />
      </dl>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CashFlowChart
            data={summary.series}
            {...summary.seriesCategories}
            group={range.group}
            from={from}
            to={to}
            detail={detail}
          />
        </Card>
        <Card title="By category" description="Without recurring payments. Select a category to see its subcategories and transactions." className="lg:col-span-2">
          <CategoryBreakdown
            {...detail}
            expense={summary.oneOffExpenseByCategory}
            income={summary.incomeByCategory}
            byPaid={summary.oneOffExpenseByPaid}
            from={from}
            to={to}
          />
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

/**
 * With `detail`, the value is a button whose hit area stretches over the whole card, so tapping
 * anywhere opens the transactions behind it; a `note` button sits above that layer.
 */
/** This month's budgets at 80% or more, worst first. Always this month, whatever range the page shows. */
function BudgetAlerts({ budgets, currency }: { budgets: BudgetStatus[]; currency: string }) {
  const hot = budgets
    .filter((b) => b.budget && b.spent >= b.budget * 0.8)
    .sort((a, b) => b.spent / b.budget! - a.spent / a.budget!);
  if (!hot.length) return null;
  const over = hot.filter((b) => b.spent > b.budget!);
  const close = hot.filter((b) => b.spent <= b.budget!);
  const Icon = over.length ? OctagonAlert : TriangleAlert;
  return (
    <section
      aria-label="Budget alerts"
      role={over.length ? "alert" : undefined}
      className={`flex items-start gap-3 rounded-2xl border px-3 py-2 sm:px-4 ${over.length ? "border-danger/40 bg-danger-soft" : "border-warning/40 bg-warning-soft"}`}
    >
      <Icon className={`mt-3 size-5 shrink-0 ${over.length ? "text-danger" : "text-warning-strong"}`} aria-hidden />
      <div className="min-w-0 flex-1 py-2 text-sm">
        {over.length > 0 && (
          <p>
            <span className="font-medium text-danger">Over budget:</span>{" "}
            {over.map((b, i) => (
              <span key={b.categoryId}>
                {i > 0 && ", "}
                <span className="font-medium">{b.name}</span>{" "}
                <span className="tabular text-muted">by {formatMoney(b.spent - b.budget!, currency)}</span>
              </span>
            ))}
          </p>
        )}
        {close.length > 0 && (
          <p className={over.length ? "mt-1" : ""}>
            <span className="font-medium">Close to limit:</span>{" "}
            {close.map((b, i) => (
              <span key={b.categoryId}>
                {i > 0 && ", "}
                <span className="font-medium">{b.name}</span>{" "}
                <span className="tabular text-muted">{Math.floor((b.spent / b.budget!) * 100)}% used</span>
              </span>
            ))}
          </p>
        )}
      </div>
      <Link href="/budgets" className="btn btn-ghost h-11 shrink-0 px-3 sm:mt-1 sm:h-9">
        Budgets
      </Link>
    </section>
  );
}

type Trend = { change: number; label: string; goodWhenUp: boolean };

/** "12% more than Oct", colored by whether that is good news, with an arrow so color isn't the only cue. */
function TrendLine({ trend }: { trend: Trend }) {
  const { change, label, goodWhenUp } = trend;
  const up = change > 0;
  const tone = change === 0 ? "text-subtle" : up === goodWhenUp ? "text-success" : "text-danger";
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <dd className={`mt-0.5 flex items-start gap-1 text-xs ${tone}`}>
      {change !== 0 && <Icon className="mt-px size-3.5 shrink-0" aria-hidden />}
      <span>
        {change === 0 ? "Same as " : `${Math.abs(change)}% ${up ? "more" : "less"} than `}
        <span className="whitespace-nowrap">{label}</span>
      </span>
    </dd>
  );
}

function Kpi({ label, value, hint, note, trend, dot, detail, className = "", span = "" }: {
  label: string;
  value: string;
  hint?: string;
  trend?: Trend;
  note?: React.ReactNode;
  dot?: string;
  detail?: { context: DetailContext; query: React.ComponentProps<typeof DetailButton>["query"]; title: string; note?: string };
  className?: string;
  span?: string;
}) {
  return (
    <div
      className={`glass relative min-w-0 rounded-2xl p-3 sm:p-4 ${detail ? "transition-colors duration-150 has-[>dd>button:hover]:bg-sunken has-[>dd>button:active]:bg-sunken" : ""} ${span}`}
    >
      <dt className="flex items-center gap-2 text-xs text-muted min-[360px]:text-sm">
        {dot && <span aria-hidden className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: dot }} />}
        {label}
      </dt>
      <dd title={value} className={`tabular mt-1 truncate text-base font-bold tracking-tight min-[360px]:text-lg sm:text-2xl lg:text-xl xl:text-2xl ${className}`}>
        {detail ? (
          <DetailButton
            context={detail.context}
            query={detail.query}
            title={detail.title}
            note={detail.note}
            aria-label={`${label}: ${value}. Show transactions`}
            className="cursor-pointer rounded-2xl text-left after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-ring"
          >
            {value}
          </DetailButton>
        ) : (
          value
        )}
      </dd>
      {detail && <ChevronRight aria-hidden className="pointer-events-none absolute top-3 right-2 size-4 text-subtle sm:top-4 sm:right-3" />}
      {trend && <TrendLine trend={trend} />}
      {hint && <dd className="mt-0.5 text-xs text-subtle">{hint}</dd>}
      {note && <dd className="mt-0.5 text-xs text-subtle">{note}</dd>}
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
