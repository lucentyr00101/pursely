import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { ChevronLeft, Receipt, SearchX } from "lucide-react";
import { getLedger, getToday } from "@/lib/session";
import { getSettings, listCards, listCategories, searchTransactions, type TransactionSearch } from "@/lib/data";
import { getHousehold, listUsers } from "@/lib/household";
import { isIsoDate } from "@/lib/dates";
import { formatMoney, parseAmount } from "@/lib/money";
import { isFixedMethod } from "@/lib/statements";
import { SearchFilters, type SearchValues } from "@/components/search-filters";
import { TransactionList } from "@/components/transaction-list";
import { Card, EmptyState, PageHeader, Skeleton, Stat, TransactionsSkeleton } from "@/components/ui";

export const metadata: Metadata = { title: "Search" };

const PAGE_SIZE = 50;
const MAX_LIMIT = 1000;

type Params = Awaited<PageProps<"/transactions/search">["searchParams"]>;

export default function SearchPage({ searchParams }: PageProps<"/transactions/search">) {
  return (
    <>
      <Link href="/transactions" className="mb-2 inline-flex items-center gap-1 rounded text-sm font-medium text-muted transition-colors duration-150 hover:text-fg focus-visible:outline-2 focus-visible:outline-ring">
        <ChevronLeft className="size-4" aria-hidden />
        Daily log
      </Link>
      <PageHeader title="Search" description="Find transactions by note, category, amount, date or payment method." />
      <Suspense fallback={<SearchSkeleton />}>
        <Results searchParams={searchParams} />
      </Suspense>
    </>
  );
}

function one(value: Params[string]): string {
  return typeof value === "string" ? value : "";
}

/** The raw URL values, which the form shows back as typed. */
function readValues(params: Params): SearchValues {
  return {
    q: one(params.q).slice(0, 100),
    type: one(params.type),
    category: one(params.category),
    member: one(params.member),
    paidWith: one(params.paidWith),
    min: one(params.min),
    max: one(params.max),
    from: one(params.from),
    to: one(params.to),
  };
}

/** The values that are valid, as a query. Invalid ones are ignored rather than matching nothing. */
function toSearch(v: SearchValues): TransactionSearch {
  let min = parseAmount(v.min) ?? undefined;
  let max = parseAmount(v.max) ?? undefined;
  if (min !== undefined && max !== undefined && min > max) [min, max] = [max, min];
  let from = isIsoDate(v.from) ? v.from : undefined;
  let to = isIsoDate(v.to) ? v.to : undefined;
  if (from && to && from > to) [from, to] = [to, from];
  return {
    q: v.q.trim() || undefined,
    type: v.type === "expense" || v.type === "income" ? v.type : undefined,
    categoryId: /^[0-9a-f]{24}$/.test(v.category) ? v.category : undefined,
    createdBy: v.member || undefined,
    paidWith: v.paidWith === "none" || isFixedMethod(v.paidWith) || /^[0-9a-f]{24}$/.test(v.paidWith) ? v.paidWith : undefined,
    min,
    max,
    from,
    to,
  };
}

async function Results({ searchParams }: { searchParams: PageProps<"/transactions/search">["searchParams"] }) {
  const [ledger, today, params] = await Promise.all([getLedger(), getToday(), searchParams]);
  const values = readValues(params);
  const search = toSearch(values);
  const filtered = Object.values(search).some((v) => v !== undefined);
  const requested = Math.floor(Number(one(params.limit)));
  const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, PAGE_SIZE), MAX_LIMIT) : PAGE_SIZE;

  const [categories, settings, result, household, cards] = await Promise.all([
    listCategories(ledger.ledgerId),
    getSettings(ledger.ledgerId),
    searchTransactions(ledger.ledgerId, search, limit),
    ledger.householdId ? getHousehold(ledger.householdId) : null,
    listCards(ledger.ledgerId, { includeArchived: true }),
  ]);
  const { currency, methodColors } = settings;
  const canEdit = ledger.role !== "viewer";
  const shared = household && household.members.length > 1;
  const authors = shared ? await listUsers(result.transactions.map((t) => t.createdBy)) : undefined;
  const members = shared ? household.members.map((m) => ({ userId: m.userId, name: m.name || m.email })) : undefined;

  const more = new URLSearchParams();
  for (const [k, v] of Object.entries(values)) if (v) more.set(k, v);
  more.set("limit", String(limit + PAGE_SIZE));
  const shown = result.transactions.length;
  const net = result.income - result.expense;

  return (
    <SearchFilters
      initial={values}
      categories={categories}
      cards={cards}
      methodColors={methodColors}
      members={members}
      currency={currency}
      today={today}
    >
      <div className="mb-6 grid gap-2 sm:grid-cols-3 sm:gap-3">
        <Stat label="Spent" value={formatMoney(result.expense, currency)} />
        <Stat label="Earned" value={formatMoney(result.income, currency)} />
        <Stat label="Net" value={formatMoney(net, currency)} tone={net < 0 ? "danger" : "success"} />
      </div>

      <Card
        title={`${result.count.toLocaleString("en-US")} ${result.count === 1 ? "transaction" : "transactions"}`}
        description={shown < result.count ? `Showing the newest ${shown.toLocaleString("en-US")}` : undefined}
      >
        <p role="status" className="sr-only">
          {result.count} {result.count === 1 ? "match" : "matches"}
        </p>
        {shown ? (
          <>
            <TransactionList
              transactions={result.transactions}
              categories={categories}
              cards={cards}
              methodColors={methodColors}
              currency={currency}
              canEdit={canEdit}
              authors={authors}
              showDates
            />
            {shown < result.count && limit < MAX_LIMIT && (
              <Link href={`/transactions/search?${more}`} scroll={false} className="btn btn-ghost mt-4 w-full">
                Show more
              </Link>
            )}
          </>
        ) : filtered ? (
          <EmptyState icon={<SearchX className="size-8" aria-hidden />} title="No transactions match">
            Try a shorter word, a wider date range or fewer filters.
          </EmptyState>
        ) : (
          <EmptyState icon={<Receipt className="size-8" aria-hidden />} title="Nothing logged yet">
            Transactions you add show up here.
          </EmptyState>
        )}
      </Card>
    </SearchFilters>
  );
}

function SearchSkeleton() {
  return (
    <>
      <Skeleton className="mb-6 h-16" />
      <TransactionsSkeleton label="Loading search" />
    </>
  );
}
