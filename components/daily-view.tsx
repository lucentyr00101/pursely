"use client";

import { useOptimistic, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Repeat, Search } from "lucide-react";
import type { CategoryNode, DayTotal, PaymentCard } from "@/lib/data";
import type { MethodColors } from "@/lib/statements";
import { addDays, formatDate, isIsoDate, startOf } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { AddTransactionButton } from "./add-transaction-button";
import { DatePicker } from "./date-picker";
import { Card, PageHeader, Skeleton } from "./ui";

/**
 * The daily log's controls, which move to the picked day at once. A change of `?date=` keeps the
 * page's Suspense boundary revealed, so `children` (that day's totals and list) would otherwise
 * stay on the old day until the server responds. They show a skeleton for that time instead.
 */
export function DailyView({ date, today, week, categories, cards, methodColors, currency, canEdit, children }: {
  date: string;
  today: string;
  week: DayTotal[];
  categories: CategoryNode[];
  cards: PaymentCard[];
  methodColors: MethodColors;
  currency: string;
  canEdit: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [shown, setShown] = useOptimistic(date);

  function go(next: string, href = `/transactions?date=${next}`) {
    if (next === shown) return;
    start(() => {
      setShown(next);
      router.push(href, { scroll: false });
    });
  }

  // onNavigate rather than onClick, so a modified click still opens a new tab.
  function navigateTo(next: string, href?: string) {
    return (event: { preventDefault(): void }) => {
      event.preventDefault();
      go(next, href);
    };
  }

  const expenses = new Map(week.map((d) => [d.date, d.expense]));
  const weekMax = Math.max(1, ...week.map((d) => d.expense));
  const weekStart = startOf(shown, "week");
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  return (
    <>
      <PageHeader
        title="Daily log"
        description={formatDate(shown, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
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
            {shown !== today && (
              <Link href="/transactions" onNavigate={navigateTo(today, "/transactions")} className="btn btn-ghost">
                Today
              </Link>
            )}
            <AddTransactionButton categories={categories} cards={cards} methodColors={methodColors} currency={currency} date={shown} canEdit={canEdit} />
          </div>
        }
      />

      <div className="mb-4 flex items-center gap-2">
        <Link
          href={`/transactions?date=${addDays(shown, -1)}`}
          onNavigate={navigateTo(addDays(shown, -1))}
          className="icon-btn shrink-0 border border-line-strong"
          aria-label="Previous day"
        >
          <ChevronLeft className="size-5" aria-hidden />
        </Link>
        <DatePicker
          aria-label="Go to date"
          value={shown}
          max={today}
          onChange={(next) => isIsoDate(next) && go(next)}
          required
          className="flex-1 sm:flex-none"
        />
        <Link
          href={`/transactions?date=${addDays(shown, 1)}`}
          onNavigate={navigateTo(addDays(shown, 1))}
          aria-label="Next day"
          aria-disabled={shown >= today}
          className={`icon-btn shrink-0 border border-line-strong ${shown >= today ? "pointer-events-none opacity-40" : ""}`}
          tabIndex={shown >= today ? -1 : undefined}
        >
          <ChevronRight className="size-5" aria-hidden />
        </Link>
      </div>

      <nav aria-label="This week" className="mb-6 grid grid-cols-7 gap-1.5 sm:gap-2">
        {days.map((day) => {
          const active = day === shown;
          const future = day > today;
          // Missing while moving to another week, until its totals arrive.
          const expense = expenses.get(day);
          return (
            <Link
              key={day}
              href={`/transactions?date=${day}`}
              onNavigate={navigateTo(day)}
              aria-current={active ? "date" : undefined}
              aria-disabled={future}
              tabIndex={future ? -1 : undefined}
              className={`glass flex flex-col items-center gap-1 rounded-xl px-1 py-2.5 text-center transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-ring ${
                active ? "border-ring! bg-primary/15" : "hover:bg-sunken active:bg-sunken"
              } ${future ? "pointer-events-none opacity-40" : ""}`}
            >
              <span className="text-xs text-muted">{formatDate(day, { weekday: "short" })}</span>
              <span className="text-lg font-semibold">{Number(day.slice(8))}</span>
              <span className="h-1 w-full max-w-8 overflow-hidden rounded-full bg-sunken" aria-hidden>
                <span className="block h-full rounded-full bg-expense" style={{ width: `${((expense ?? 0) / weekMax) * 100}%` }} />
              </span>
              {expense === undefined ? (
                <Skeleton className="hidden h-4 w-10 rounded sm:block" />
              ) : (
                <span className="tabular hidden text-xs text-muted sm:block">
                  {expense ? formatMoney(expense, currency, { compact: true }) : "—"}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {pending ? <DayContentSkeleton /> : children}
    </>
  );
}

function DayContentSkeleton() {
  return (
    <div role="status" aria-busy aria-label="Loading this day">
      <div className="mb-6 grid gap-2 sm:grid-cols-3 sm:gap-3">
        {["Spent", "Earned", "Net"].map((label) => (
          // Matches Stat, so the labels hold still when the amounts arrive.
          <div key={label} className="glass flex min-w-0 items-center justify-between gap-3 rounded-xl px-4 py-2.5 sm:block sm:p-4">
            <p className="text-sm font-medium text-muted">{label}</p>
            <Skeleton className="h-6 w-20 rounded-lg sm:mt-1 sm:h-7 sm:w-28" />
          </div>
        ))}
      </div>
      <Card title="Transactions">
        <ul className="divide-y divide-line">
          {[0, 1, 2].map((row) => (
            <li key={row} className="flex items-center gap-3 py-3">
              <Skeleton className="size-10 shrink-0 rounded-lg" />
              <Skeleton className="h-5 w-40 max-w-1/2 rounded-lg" />
              <Skeleton className="ml-auto h-5 w-20 shrink-0 rounded-lg" />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
