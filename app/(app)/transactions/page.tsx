import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { ChevronLeft, ChevronRight, Plus, Receipt, Repeat, Search } from "lucide-react";
import { getToday, getLedger } from "@/lib/session";
import { dailyTotals, getSettings, listCards, listCategories, listTransactions } from "@/lib/data";
import { getHousehold, listUsers } from "@/lib/household";
import { addDays, formatDate, isIsoDate, startOf } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { AddTransactionButton } from "@/components/add-transaction-button";
import { DateJump } from "@/components/date-jump";
import { TransactionList } from "@/components/transaction-list";
import { Card, EmptyState, PageHeader, Skeleton, Stat } from "@/components/ui";

export const metadata: Metadata = { title: "Daily log" };

export default function TransactionsPage({ searchParams }: PageProps<"/transactions">) {
  return (
    <Suspense fallback={<DailySkeleton />}>
      <Daily searchParams={searchParams} />
    </Suspense>
  );
}

async function Daily({ searchParams }: { searchParams: PageProps<"/transactions">["searchParams"] }) {
  const [ledger, today, params] = await Promise.all([getLedger(), getToday(), searchParams]);
  const date = isIsoDate(params.date) ? params.date : today;
  const weekStart = startOf(date, "week");

  const [categories, settings, transactions, week, cards] = await Promise.all([
    listCategories(ledger.ledgerId),
    getSettings(ledger.ledgerId),
    listTransactions(ledger.ledgerId, date, date),
    dailyTotals(ledger.ledgerId, weekStart, addDays(weekStart, 6)),
    listCards(ledger.ledgerId, { includeArchived: true }),
  ]);
  const { currency } = settings;
  const canEdit = ledger.role !== "viewer";
  let authors: Awaited<ReturnType<typeof listUsers>> | undefined;
  if (ledger.householdId) {
    const household = await getHousehold(ledger.householdId);
    if (household && household.members.length > 1) {
      authors = await listUsers([...new Set(transactions.map((t) => t.createdBy))]);
    }
  }
  const spent = transactions.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const earned = transactions.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const weekMax = Math.max(1, ...week.map((d) => d.expense));

  return (
    <>
      <PageHeader
        title="Daily log"
        description={formatDate(date, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
        actions={
          // Today sits here rather than in the date row, where it would squeeze the date input on phones.
          <div className="flex flex-wrap gap-2">
            <Link href="/transactions/search" className="btn btn-ghost">
              <Search className="size-4" aria-hidden />
              Search
            </Link>
            <Link href="/transactions/recurring" className="btn btn-ghost">
              <Repeat className="size-4" aria-hidden />
              Recurring
            </Link>
            {date !== today && (
              <Link href="/transactions" className="btn btn-ghost">
                Today
              </Link>
            )}
            <AddTransactionButton categories={categories} cards={cards} currency={currency} date={date} canEdit={canEdit} />
          </div>
        }
      />

      <div className="mb-4 flex items-center gap-2">
        <Link href={`/transactions?date=${addDays(date, -1)}`} className="icon-btn shrink-0 border border-line-strong" aria-label="Previous day">
          <ChevronLeft className="size-5" aria-hidden />
        </Link>
        <DateJump value={date} max={today} />
        <Link
          href={`/transactions?date=${addDays(date, 1)}`}
          aria-label="Next day"
          aria-disabled={date >= today}
          className={`icon-btn shrink-0 border border-line-strong ${date >= today ? "pointer-events-none opacity-40" : ""}`}
          tabIndex={date >= today ? -1 : undefined}
        >
          <ChevronRight className="size-5" aria-hidden />
        </Link>
      </div>

      <nav aria-label="This week" className="mb-6 grid grid-cols-7 gap-1.5 sm:gap-2">
        {week.map((d) => {
          const active = d.date === date;
          const future = d.date > today;
          return (
            <Link
              key={d.date}
              href={`/transactions?date=${d.date}`}
              aria-current={active ? "date" : undefined}
              aria-disabled={future}
              tabIndex={future ? -1 : undefined}
              className={`glass flex flex-col items-center gap-1 rounded-xl px-1 py-2.5 text-center transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-ring ${
                active ? "border-ring! bg-primary/15" : "hover:bg-sunken"
              } ${future ? "pointer-events-none opacity-40" : ""}`}
            >
              <span className="text-xs text-muted">{formatDate(d.date, { weekday: "short" })}</span>
              <span className="text-lg font-semibold">{Number(d.date.slice(8))}</span>
              <span className="h-1 w-full max-w-8 overflow-hidden rounded-full bg-sunken" aria-hidden>
                <span className="block h-full rounded-full bg-expense" style={{ width: `${(d.expense / weekMax) * 100}%` }} />
              </span>
              <span className="tabular hidden text-xs text-muted sm:block">
                {d.expense ? formatMoney(d.expense, currency, { compact: true }) : "—"}
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="mb-6 grid gap-2 sm:grid-cols-3 sm:gap-3">
        <Stat label="Spent" value={formatMoney(spent, currency)} />
        <Stat label="Earned" value={formatMoney(earned, currency)} />
        <Stat label="Net" value={formatMoney(earned - spent, currency)} tone={earned - spent < 0 ? "danger" : "success"} />
      </div>

      <Card title="Transactions">
        {transactions.length ? (
          <TransactionList transactions={transactions} categories={categories} cards={cards} currency={currency} canEdit={canEdit} authors={authors} />
        ) : (
          <EmptyState icon={<Receipt className="size-8" aria-hidden />} title="Nothing logged for this day">
            {canEdit && (
              <>
                Use the <Plus className="inline size-4 align-[-0.125em] text-fg" aria-label="Add transaction" /> button to record
                an expense or income.
              </>
            )}
          </EmptyState>
        )}
      </Card>
    </>
  );
}

function DailySkeleton() {
  return (
    <div aria-busy aria-label="Loading daily log" className="flex flex-col gap-6">
      <Skeleton className="h-16 w-72" />
      <Skeleton className="h-11 w-64" />
      <div className="grid grid-cols-7 gap-2">
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-72" />
    </div>
  );
}
