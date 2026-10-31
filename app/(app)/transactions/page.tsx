import { Suspense } from "react";
import type { Metadata } from "next";
import { Plus, Receipt } from "lucide-react";
import { getToday, getLedger } from "@/lib/session";
import { dailyTotals, getSettings, listCards, listCategories, listTransactions } from "@/lib/data";
import { getHousehold, listUsers } from "@/lib/household";
import { addDays, isIsoDate, startOf } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { DailyView } from "@/components/daily-view";
import { TransactionList } from "@/components/transaction-list";
import { Card, EmptyState, Skeleton, Stat } from "@/components/ui";

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
  const { currency, methodColors } = settings;
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

  return (
    <DailyView date={date} today={today} week={week} categories={categories} cards={cards} methodColors={methodColors} currency={currency} canEdit={canEdit}>
      <div className="mb-6 grid gap-2 sm:grid-cols-3 sm:gap-3">
        <Stat label="Spent" value={formatMoney(spent, currency)} />
        <Stat label="Earned" value={formatMoney(earned, currency)} />
        <Stat label="Net" value={formatMoney(earned - spent, currency)} tone={earned - spent < 0 ? "danger" : "success"} />
      </div>

      <Card title="Transactions">
        {transactions.length ? (
          <TransactionList transactions={transactions} categories={categories} cards={cards} methodColors={methodColors} currency={currency} canEdit={canEdit} authors={authors} />
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
    </DailyView>
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
