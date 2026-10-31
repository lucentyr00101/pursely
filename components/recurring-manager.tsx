"use client";

import { Fragment, useActionState, useCallback, useEffect, useState, useTransition } from "react";
import { CalendarClock, LoaderCircle, Pause, Pencil, Play, Plus, Repeat, Trash2 } from "lucide-react";
import { pauseRecurring, removeRecurring, saveRecurring, type ActionState } from "@/app/actions";
import type { CategoryNode, PaymentCard, Recurring } from "@/lib/data";
import type { MethodColors } from "@/lib/statements";
import type { TxType } from "@/lib/category-defs";
import { formatDate, GRANULARITIES, type Granularity } from "@/lib/dates";
import { centsToInput, formatMoney } from "@/lib/money";
import { describeSchedule, MAX_EVERY, perMonth, remaining } from "@/lib/recurring";
import { CategoryIcon } from "./category-icon";
import { DatePicker } from "./date-picker";
import { Modal } from "./modal";
import { PaidWithField, useRememberedPaidWith } from "./paid-with";
import { Select } from "./select";
import { CategorySelect, TypeToggle } from "./transaction-form";
import { buildLookup } from "./transaction-list";
import { FormError } from "./ui";

const UNIT_LABELS: Record<Granularity, [string, string]> = {
  day: ["day", "days"],
  week: ["week", "weeks"],
  month: ["month", "months"],
  year: ["year", "years"],
};

export function AddRecurringButton({ categories, cards, methodColors, currency, today }: {
  categories: CategoryNode[];
  cards: PaymentCard[];
  methodColors: MethodColors;
  currency: string;
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        <Plus className="size-5" aria-hidden />
        New recurring
      </button>
      <Modal open={open} onClose={close} title="New recurring entry">
        <RecurringForm categories={categories} cards={cards} methodColors={methodColors} currency={currency} today={today} onDone={close} />
      </Modal>
    </>
  );
}

function Chip({ tone, children }: { tone?: "warning" | "accent"; children: React.ReactNode }) {
  const colors = tone === "warning" ? "bg-warning-soft text-warning-strong" : tone === "accent" ? "bg-accent/10 text-accent" : "bg-sunken text-muted";
  return <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${colors}`}>{children}</span>;
}

/** Matches the order listRecurring returns: active, then paused, then ended. */
const rank = (r: Recurring) => (r.nextDate === null ? 2 : r.paused ? 1 : 0);

const SORTS = {
  "left-asc": "Fewest months left",
  "left-desc": "Most months left",
  "monthly-asc": "Lowest monthly amount",
  "monthly-desc": "Highest monthly amount",
  category: "Category",
} as const;
type Sort = keyof typeof SORTS;

/** Months left order by end date: rules without one never end, so they count as the most months left. */
const endKey = (r: Recurring) => r.endDate ?? "9999-12-31";
const monthly = (r: Recurring) => r.amount * perMonth(r.unit, r.every);

export function RecurringList({ rules, categories, cards, methodColors, currency, canEdit, today }: {
  rules: Recurring[];
  categories: CategoryNode[];
  cards: PaymentCard[];
  methodColors: MethodColors;
  currency: string;
  canEdit: boolean;
  today: string;
}) {
  const [editing, setEditing] = useState<Recurring | null>(null);
  const [deleting, setDeleting] = useState<Recurring | null>(null);
  const [pending, start] = useTransition();
  const [toggling, setToggling] = useState<string>();
  const [error, setError] = useState<string>();
  const [editError, setEditError] = useState<string>();
  const [sort, setSort] = useState<Sort>("left-asc");
  const lookup = buildLookup(categories);
  const categoryName = (r: Recurring) => {
    const cat = lookup.get(r.categoryId);
    const sub = r.subcategoryId ? lookup.get(r.subcategoryId) : null;
    return sub ? `${cat?.name} › ${sub.name}` : (cat?.name ?? "Uncategorized");
  };
  const label = (r: Recurring) => r.note || categoryName(r);
  // Sorting stays within the active, paused and ended groups.
  const sorted = rules.toSorted((a, b) => {
    const byGroup = rank(a) - rank(b);
    if (byGroup) return byGroup;
    let order = 0;
    if (sort === "left-asc") order = endKey(a).localeCompare(endKey(b));
    else if (sort === "left-desc") order = endKey(b).localeCompare(endKey(a));
    else if (sort === "monthly-asc") order = monthly(a) - monthly(b);
    else if (sort === "monthly-desc") order = monthly(b) - monthly(a);
    else order = categoryName(a).localeCompare(categoryName(b));
    return order || label(a).localeCompare(label(b));
  });
  const closeEdit = useCallback(() => {
    setEditing(null);
    setEditError(undefined);
  }, []);

  // From the editor, a failure shows in the dialog and success closes it.
  const togglePause = (rule: Recurring, fromEditor = false) => {
    setToggling(rule.id);
    start(async () => {
      const result = await pauseRecurring(rule.id, !rule.paused);
      if (fromEditor) {
        if (result.ok) closeEdit();
        else setEditError(result.error);
      } else {
        setError(result.ok ? undefined : result.error);
      }
    });
  };

  return (
    <>
      {rules.length > 1 && (
        <div className="mb-2 flex items-center justify-end gap-2">
          <label htmlFor="rc-sort" className="text-sm font-medium text-muted">
            Sort by
          </label>
          <Select
            id="rc-sort"
            options={(Object.entries(SORTS) as [Sort, string][]).map(([value, label]) => ({ value, label }))}
            value={sort}
            onChange={setSort}
          />
        </div>
      )}
      <FormError message={error} />
      <ul className="divide-y divide-line">
        {sorted.map((r, i) => {
          const group = rank(r);
          const cat = lookup.get(r.categoryId);
          const left = r.nextDate && r.endDate ? remaining(r.startDate, r.unit, r.every, r.nextDate, r.endDate) : null;
          const content = (
            <>
              <CategoryIcon icon={cat?.icon ?? "tag"} color={cat?.color ?? "#94a3b8"} />
              {/* On phones the amount shares the title's line so the lines below get the full width; from sm it is centered beside the row's buttons. */}
              <span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3">
                {/* The note names the bill, so it leads; the category drops to the line under it. */}
                <span className="line-clamp-2 min-w-0 font-medium break-words">{label(r)}</span>
                <span className={`tabular text-right font-semibold sm:row-span-3 sm:self-center ${group ? "text-muted" : r.type === "income" ? "text-success" : ""}`}>
                  <span className="sr-only">{r.type === "income" ? "Income" : "Expense"} </span>
                  {formatMoney(r.amount, currency)}
                </span>
                {r.note && <span className="col-span-2 truncate text-sm text-muted sm:col-span-1">{categoryName(r)}</span>}
                <span className="col-span-2 mt-1.5 flex flex-wrap gap-1.5 sm:col-span-1">
                  <Chip>
                    <Repeat className="size-3.5" aria-hidden />
                    {describeSchedule(r.unit, r.every, r.startDate)}
                  </Chip>
                  {r.nextDate === null ? (
                    <Chip>Ended</Chip>
                  ) : r.paused ? (
                    <Chip tone="warning">
                      <Pause className="size-3.5" aria-hidden />
                      Paused
                    </Chip>
                  ) : (
                    <Chip>
                      <CalendarClock className="size-3.5" aria-hidden />
                      Next {formatDate(r.nextDate, { month: "short", day: "numeric", year: r.nextDate.slice(0, 4) === today.slice(0, 4) ? undefined : "numeric" })}
                    </Chip>
                  )}
                  {left !== null && <Chip tone="accent">{left === 1 ? "Last one" : `${left} left`}</Chip>}
                </span>
              </span>
            </>
          );
          const header = group > 0 && group !== (i > 0 ? rank(sorted[i - 1]) : 0) && (
            <li className="border-b-0! pt-4 pb-1">
              <h3 className="text-sm font-semibold text-muted">{group === 1 ? "Paused" : "Ended"}</h3>
            </li>
          );
          return (
            <Fragment key={r.id}>
              {header}
              {/* Phones get the whole row for the name and amount; pause and delete are in the editor there. */}
              <li className="flex items-center gap-1 py-1.5">
                {canEdit ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setEditing(r)}
                      className="group -ml-2 flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg py-1.5 pr-2 pl-2 text-left transition-colors duration-150 hover:bg-sunken active:bg-sunken focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <span className="sr-only">Edit </span>
                      {content}
                      <Pencil className="hidden size-4 shrink-0 text-subtle transition-colors duration-150 group-hover:text-fg sm:block" aria-hidden />
                    </button>
                    {/* Ended rules keep an empty slot so amounts and buttons line up across rows. */}
                    {r.nextDate === null ? (
                      <span className="hidden size-11 shrink-0 sm:block" aria-hidden />
                    ) : (
                      <button
                        type="button"
                        className="icon-btn hidden shrink-0 disabled:cursor-not-allowed sm:inline-flex"
                        aria-label={r.paused ? "Resume" : "Pause"}
                        title={r.paused ? "Resume" : "Pause"}
                        disabled={pending}
                        onClick={() => togglePause(r)}
                      >
                        {pending && toggling === r.id ? (
                          <LoaderCircle className="size-4 animate-spin" aria-hidden />
                        ) : r.paused ? (
                          <Play className="size-4" aria-hidden />
                        ) : (
                          <Pause className="size-4" aria-hidden />
                        )}
                      </button>
                    )}
                    <button
                      type="button"
                      className="icon-btn -mr-2 hidden shrink-0 hover:text-danger active:text-danger sm:inline-flex"
                      aria-label="Delete recurring entry"
                      title="Delete"
                      onClick={() => setDeleting(r)}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </>
                ) : (
                  <div className="flex min-w-0 flex-1 items-center gap-3 py-1.5">{content}</div>
                )}
              </li>
            </Fragment>
          );
        })}
      </ul>

      <Modal open={editing !== null} onClose={closeEdit} title="Edit recurring entry">
        {editing && (
          <>
            <RecurringForm categories={categories} cards={cards} methodColors={methodColors} currency={currency} today={today} rule={editing} onDone={closeEdit} />
            <div className="mt-3 flex flex-col gap-3 border-t border-line pt-3">
              <FormError message={editError} />
              <div className="grid grid-cols-2 gap-3">
                {editing.nextDate !== null && (
                  <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => togglePause(editing, true)}>
                    {pending ? (
                      <LoaderCircle className="size-4 animate-spin" aria-hidden />
                    ) : editing.paused ? (
                      <Play className="size-4" aria-hidden />
                    ) : (
                      <Pause className="size-4" aria-hidden />
                    )}
                    {editing.paused ? "Resume" : "Pause"}
                  </button>
                )}
                <button
                  type="button"
                  className={`btn btn-ghost text-danger ${editing.nextDate === null ? "col-span-2" : ""}`}
                  onClick={() => {
                    setDeleting(editing);
                    closeEdit();
                  }}
                >
                  <Trash2 className="size-4" aria-hidden />
                  Delete
                </button>
              </div>
            </div>
          </>
        )}
      </Modal>

      <Modal open={deleting !== null} onClose={() => setDeleting(null)} title="Delete recurring entry?">
        {deleting && <ConfirmDelete rule={deleting} currency={currency} onDone={() => setDeleting(null)} />}
      </Modal>
    </>
  );
}

function RecurringForm({ categories, cards, methodColors, currency, today, rule, onDone }: {
  categories: CategoryNode[];
  cards: PaymentCard[];
  methodColors: MethodColors;
  currency: string;
  today: string;
  rule?: Recurring;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveRecurring, { ok: false });
  const [type, setType] = useState<TxType>(rule?.type ?? "expense");
  const [every, setEvery] = useState(String(rule?.every ?? 1));
  const remembered = useRememberedPaidWith(cards);
  const paidWith = rule ? (rule.cardId ?? rule.method ?? "") : remembered;

  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);

  const plural = every !== "1";

  return (
    <form action={action} className="flex flex-col gap-4">
      {rule && <input type="hidden" name="id" value={rule.id} />}
      <input type="hidden" name="type" value={type} />

      <TypeToggle type={type} onChange={setType} />

      <div>
        <label htmlFor="rc-amount" className="label">
          Amount ({currency})
        </label>
        <input
          id="rc-amount"
          name="amount"
          inputMode="decimal"
          autoComplete="off"
          required
          data-autofocus
          placeholder="0.00"
          defaultValue={rule ? centsToInput(rule.amount) : ""}
          className="field tabular text-lg font-semibold"
        />
      </div>

      <CategorySelect id="rc-category" categories={categories} type={type} selected={rule?.subcategoryId ?? rule?.categoryId} />

      {/* Hidden rather than removed for income, so switching back keeps the choice. The server ignores it for income. */}
      {paidWith !== null && (
        <div hidden={type !== "expense"}>
          <PaidWithField key={paidWith} id="rc-paid-with" cards={cards} methodColors={methodColors} date={today} defaultValue={paidWith} showStatement={false} />
        </div>
      )}

      <fieldset>
        <legend className="label">Repeats every</legend>
        <div className="grid grid-cols-[5rem_1fr] gap-2">
          <input
            name="every"
            aria-label="Interval"
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_EVERY}
            required
            value={every}
            onChange={(e) => setEvery(e.target.value)}
            className="field tabular text-center"
          />
          <Select
            name="unit"
            aria-label="Unit"
            options={GRANULARITIES.map((u) => ({ value: u, label: UNIT_LABELS[u][plural ? 1 : 0] }))}
            defaultValue={rule?.unit ?? "month"}
          />
        </div>
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <label htmlFor="rc-start" className="label">
            {rule ? "Next on" : "Starts"}
          </label>
          <DatePicker
            id="rc-start"
            name="start"
            required
            defaultValue={rule ? (rule.nextDate ?? today) : today}
            aria-describedby={rule ? "rc-start-hint" : undefined}
          />
        </div>
        <div className="min-w-0">
          <label htmlFor="rc-end" className="label">
            Ends <span className="font-normal text-subtle">(optional)</span>
          </label>
          <DatePicker id="rc-end" name="end" defaultValue={rule?.endDate ?? ""} placeholder="Never" />
        </div>
      </div>
      {rule && (
        <p id="rc-start-hint" className="-mt-2 text-sm text-muted">
          Changes apply from this date on. Entries already added stay as they are.
        </p>
      )}

      <div>
        <label htmlFor="rc-note" className="label">
          Note <span className="font-normal text-subtle">(optional)</span>
        </label>
        <input id="rc-note" name="note" maxLength={200} placeholder="e.g. Netflix" defaultValue={rule?.note ?? ""} className="field" />
      </div>

      <FormError message={state.error} />

      <button type="submit" disabled={pending} className="btn btn-primary w-full">
        {pending && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
        {rule ? "Save changes" : `Add recurring ${type}`}
      </button>
    </form>
  );
}

function ConfirmDelete({ rule, currency, onDone }: { rule: Recurring; currency: string; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted">
        This stops the recurring {rule.type} of <strong className="tabular text-fg">{formatMoney(rule.amount, currency)}</strong>.
        Entries it already added stay in your log.
      </p>
      <FormError message={error} />
      <div className="grid grid-cols-2 gap-3">
        <button type="button" className="btn btn-ghost" onClick={onDone}>
          Cancel
        </button>
        <button
          type="button"
          disabled={pending}
          className="btn btn-danger"
          onClick={() =>
            start(async () => {
              const result = await removeRecurring(rule.id);
              if (result.ok) onDone();
              else setError(result.error);
            })
          }
        >
          {pending && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
          Delete
        </button>
      </div>
    </div>
  );
}
