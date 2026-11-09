"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ReceiptText } from "lucide-react";
import { loadDetail } from "@/app/actions";
import type { CategoryNode, DetailQuery, DetailResult, PaymentCard } from "@/lib/data";
import { formatMoney } from "@/lib/money";
import type { MethodColors } from "@/lib/statements";
import { Modal } from "./modal";
import { TransactionList } from "./transaction-list";
import { EmptyState, FormError, Skeleton } from "./ui";

// Matches DETAIL_LIMIT in app/actions.ts.
const LIMIT = 200;

type Loaded = { key: string; result: DetailResult } | { key: string; error: string };

export type DetailContext = {
  categories: CategoryNode[];
  cards: PaymentCard[];
  methodColors: MethodColors;
  currency: string;
  canEdit: boolean;
};

/**
 * The transactions behind a total, in a dialog, so the page that shows the total keeps its height.
 * Loads when `query` is set and again after an edit or delete inside it. `note` explains anything
 * the total includes that isn't a transaction, like scheduled occurrences.
 */
export function TransactionsDialog({ query, title, note, header, onClose, categories, cards, methodColors, currency, canEdit }: DetailContext & {
  query: DetailQuery | null;
  title: string;
  note?: ReactNode;
  /** Shown above the list even while it loads, such as controls that change `query`. */
  header?: ReactNode;
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [version, setVersion] = useState(0);
  const key = query ? `${JSON.stringify(query)}#${version}` : null;

  useEffect(() => {
    if (!key || !query) return;
    let live = true;
    loadDetail(query)
      .then((res) => live && setLoaded(res.ok ? { key, result: res } : { key, error: res.error }))
      .catch(() => live && setLoaded({ key, error: "Couldn't load the transactions. Try again." }));
    return () => {
      live = false;
    };
    // `query` is captured through `key`, its serialized form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  // A reload keeps the old list on screen instead of flashing the skeleton.
  const current = loaded && query && loaded.key.startsWith(`${JSON.stringify(query)}#`) ? loaded : null;

  return (
    <Modal open={query !== null} onClose={onClose} title={title}>
      {header}
      {!current ? (
        <div role="status" aria-label="Loading transactions" className="flex flex-col gap-2">
          <Skeleton className="h-5 w-40" />
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : "error" in current ? (
        <FormError message={current.error} />
      ) : (
        <>
          <Summary result={current.result} currency={currency} />
          {note && <p className="mb-3 text-sm text-muted">{note}</p>}
          {current.result.count ? (
            <TransactionList
              transactions={current.result.transactions}
              categories={categories}
              cards={cards}
              methodColors={methodColors}
              currency={currency}
              canEdit={canEdit}
              showDates
              onChanged={() => setVersion((v) => v + 1)}
            />
          ) : (
            <EmptyState icon={<ReceiptText className="size-8" aria-hidden />} title="No transactions" />
          )}
        </>
      )}
    </Modal>
  );
}

function Summary({ result, currency }: { result: DetailResult; currency: string }) {
  const { count, expense, income } = result;
  const parts = [
    `${count} transaction${count === 1 ? "" : "s"}`,
    expense ? `${formatMoney(expense, currency)} spent` : null,
    income ? `${formatMoney(income, currency)} earned` : null,
  ].filter(Boolean);
  return (
    <p className="tabular mb-2 text-sm text-muted">
      {parts.join(" · ")}
      {count > LIMIT && ` · newest ${LIMIT} shown`}
    </p>
  );
}

/** A button that opens a `TransactionsDialog`, for totals drawn by server components. */
export function DetailButton({ query, title, note, context, className, "aria-label": ariaLabel, children }: {
  query: DetailQuery;
  title: string;
  note?: ReactNode;
  context: DetailContext;
  className?: string;
  "aria-label"?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" aria-haspopup="dialog" aria-label={ariaLabel} className={className} onClick={() => setOpen(true)}>
        {children}
      </button>
      <TransactionsDialog {...context} query={open ? query : null} title={title} note={note} onClose={() => setOpen(false)} />
    </>
  );
}
