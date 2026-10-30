"use client";

import { useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { Banknote, CircleEllipsis, CreditCard, Smartphone, Wallet, type LucideIcon } from "lucide-react";
import type { PaymentCard } from "@/lib/data";
import { formatDate } from "@/lib/dates";
import { cardLabel, FIXED_METHODS, isFixedMethod, METHOD_LABELS, ordinal, statementChoices, type FixedMethod } from "@/lib/statements";
import { Select, type SelectOption } from "./select";

/** The method last used for a new expense on this device. */
export const PAID_WITH_KEY = "pursely.paidWith";

const METHOD_ICONS: Record<FixedMethod, LucideIcon> = { cash: Banknote, gcash: Smartphone, maya: Wallet, others: CircleEllipsis };

function MethodIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-sunken text-muted">
      <Icon className="size-4" aria-hidden />
    </span>
  );
}

/** Active cards in the order they were added, then the fixed methods. An archived card shows only when it is `keep`. */
export function paidWithOptions(cards: PaymentCard[], keep?: string | null): SelectOption[] {
  return [
    ...cards
      .filter((c) => !c.archived || c.id === keep)
      .map((c) => ({ value: c.id, label: cardLabel(c), icon: <MethodIcon icon={CreditCard} /> })),
    ...FIXED_METHODS.map((m) => ({ value: m, label: METHOD_LABELS[m], icon: <MethodIcon icon={METHOD_ICONS[m]} /> })),
  ];
}

/** The remembered method if it is still available, else Cash. */
export function rememberedPaidWith(cards: PaymentCard[]): string {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(PAID_WITH_KEY);
  } catch {}
  if (stored && (isFixedMethod(stored) || cards.some((c) => !c.archived && c.id === stored))) return stored;
  return "cash";
}

const noSubscribe = () => () => {};

/** `rememberedPaidWith` on the client, null on the server. Forms mount when their dialog opens, so there's no flash. */
export function useRememberedPaidWith(cards: PaymentCard[]): string | null {
  return useSyncExternalStore(noSubscribe, () => rememberedPaidWith(cards), () => null);
}

/**
 * The "Paid with" select, and for a card the statement the purchase lands on. `defaultStatement`
 * applies while the card and date are the ones the form opened with; changing either goes back to
 * the automatic statement.
 */
export function PaidWithField({ id, cards, date, defaultValue, defaultStatement, showStatement }: {
  id: string;
  cards: PaymentCard[];
  date: string;
  defaultValue: string;
  defaultStatement?: string | null;
  showStatement: boolean;
}) {
  const [value, setValue] = useState(defaultValue);
  const [initialDate] = useState(date);
  const card = cards.find((c) => c.id === value);
  const original = value === defaultValue && date === initialDate;

  return (
    <div>
      <label htmlFor={id} className="label">
        Paid with
      </label>
      <Select id={id} name="paidWith" options={paidWithOptions(cards, defaultValue)} value={value} onChange={setValue} placeholder="Not set" />
      {showStatement && card && (
        <StatementLine key={`${card.id} ${date}`} card={card} date={date} initial={original ? (defaultStatement ?? null) : null} />
      )}
    </div>
  );
}

const shortDate = (iso: string) => formatDate(iso, { month: "short", day: "numeric" });
const monthName = (iso: string) => formatDate(iso, { month: "long" });

/**
 * Where a card purchase lands, with the previous, automatic and next statement to pick from. The
 * hidden input stays empty until one is picked, so the server works out the automatic statement
 * from the card's current cutoff (and an edit keeps its stored one).
 */
function StatementLine({ card, date, initial }: { card: PaymentCard; date: string; initial: string | null }) {
  const choices = statementChoices(date, card.cutoffDay);
  const [picked, setPicked] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const shown = picked ?? initial ?? choices[1];
  const focusable = choices.includes(shown) ? shown : choices[0];

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const next = choices[(choices.indexOf(focusable) + step + choices.length) % choices.length];
    setPicked(next);
    e.currentTarget.querySelector<HTMLElement>(`[data-statement="${next}"]`)?.focus();
  }

  return (
    <div className="mt-2 rounded-lg bg-accent-soft px-3 py-2.5 text-sm">
      <input type="hidden" name="statement" value={picked ?? ""} />
      <div className="flex items-center justify-between gap-3">
        <p className="tabular">
          {shortDate(shown)} statement · counts in {monthName(shown)} budget
        </p>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="-my-2.5 -mr-2 min-h-11 shrink-0 cursor-pointer rounded-md px-2 font-semibold text-accent hover:underline focus-visible:outline-2 focus-visible:outline-ring active:underline"
        >
          {open ? "Done" : "Change"}
        </button>
      </div>
      {open && (
        <>
          <div role="radiogroup" aria-label="Statement" onKeyDown={onKeyDown} className="mt-2.5 grid grid-cols-3 gap-1 rounded-lg bg-sunken p-1">
            {choices.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={s === shown}
                tabIndex={s === focusable ? 0 : -1}
                data-statement={s}
                onClick={() => setPicked(s)}
                className={`flex min-h-11 cursor-pointer flex-col items-center justify-center rounded-md px-1 py-1 transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-ring ${
                  s === shown ? "bg-surface-strong text-fg shadow-sm" : "text-muted hover:text-fg active:text-fg"
                }`}
              >
                <span className="tabular font-semibold">{shortDate(s)}</span>
                <span className="text-xs">{monthName(s)}</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-muted">
            Picked automatically from {card.name}&apos;s cutoff ({ordinal(card.cutoffDay)}). Change it if your statement shows otherwise.
          </p>
        </>
      )}
    </div>
  );
}
