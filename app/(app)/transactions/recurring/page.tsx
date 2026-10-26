import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { ChevronLeft, Repeat } from "lucide-react";
import { getLedger, getToday } from "@/lib/session";
import { getSettings, listCategories, listRecurring } from "@/lib/data";
import { formatMoney } from "@/lib/money";
import { monthlyTotals } from "@/lib/recurring";
import { AddRecurringButton, RecurringList } from "@/components/recurring-manager";
import { Card, EmptyState, PageHeader, Skeleton, Stat } from "@/components/ui";

export const metadata: Metadata = { title: "Recurring" };

export default function RecurringPage() {
  return (
    <>
      <Link href="/transactions" className="-mt-3 -mb-1 inline-flex min-h-11 items-center gap-1 rounded text-sm font-medium text-muted transition-colors duration-150 hover:text-fg focus-visible:outline-2 focus-visible:outline-ring">
        <ChevronLeft className="size-4" aria-hidden />
        Daily log
      </Link>
      <Suspense fallback={<RecurringSkeleton />}>
        <Rules />
      </Suspense>
    </>
  );
}

async function Rules() {
  const [ledger, today] = await Promise.all([getLedger(), getToday()]);
  const [categories, settings, rules] = await Promise.all([
    listCategories(ledger.ledgerId),
    getSettings(ledger.ledgerId),
    listRecurring(ledger.ledgerId),
  ]);
  const { currency } = settings;
  const canEdit = ledger.role !== "viewer";

  const { net, ...monthly } = monthlyTotals(rules);

  return (
    <>
      <PageHeader
        title="Recurring"
        description="Bills, subscriptions and income that repeat. Each entry is added to your log on its day."
        actions={canEdit && <AddRecurringButton categories={categories} currency={currency} today={today} />}
      />

      {rules.length > 0 && (
        <div className="mb-6 grid gap-2 sm:grid-cols-3 sm:gap-3">
          <Stat label="Out per month" value={`≈ ${formatMoney(monthly.expense, currency)}`} />
          <Stat label="In per month" value={`≈ ${formatMoney(monthly.income, currency)}`} />
          <Stat label="Net per month" value={`≈ ${formatMoney(net, currency)}`} tone={net < 0 ? "danger" : "success"} />
        </div>
      )}

      <Card>
        {rules.length ? (
          <RecurringList rules={rules} categories={categories} currency={currency} canEdit={canEdit} today={today} />
        ) : (
          <EmptyState icon={<Repeat className="size-8" aria-hidden />} title="No recurring entries">
            {canEdit && "Add rent, subscriptions or your salary once, and they'll show up in your log every time they're due."}
          </EmptyState>
        )}
      </Card>
    </>
  );
}

function RecurringSkeleton() {
  return (
    <div aria-busy aria-label="Loading recurring entries" className="flex flex-col gap-6">
      <Skeleton className="h-16 w-72" />
      <div className="grid gap-2 sm:grid-cols-3 sm:gap-3">
        <Skeleton className="h-12 sm:h-20" />
        <Skeleton className="h-12 sm:h-20" />
        <Skeleton className="h-12 sm:h-20" />
      </div>
      <Skeleton className="h-72" />
    </div>
  );
}
