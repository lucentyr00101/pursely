"use client";

import { useActionState, useCallback, useEffect, useState, useTransition } from "react";
import { Check, ChevronLeft, ChevronRight, LoaderCircle, Pencil, Plus, ReceiptText } from "lucide-react";
import { archiveCardAction, markStatementPaid, saveCard, saveMethodColor, type ActionState } from "@/app/actions";
import type { PaymentCard } from "@/lib/data";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import {
  FIXED_METHODS,
  METHOD_COLOR_NAMES,
  METHOD_COLORS,
  METHOD_LABELS,
  nextCardColor,
  dueFor,
  ordinal,
  statementAt,
  statementFor,
  statementStart,
  type FixedMethod,
  type MethodColor,
} from "@/lib/statements";
import { MethodIcon } from "./method-icon";
import { Modal } from "./modal";
import { Select, type SelectOption } from "./select";
import { TransactionsDialog, type DetailContext } from "./transactions-dialog";
import { FormError } from "./ui";

type Dialog =
  | { kind: "create" }
  | { kind: "edit"; card: PaymentCard }
  | { kind: "archive"; card: PaymentCard }
  | { kind: "method"; method: FixedMethod };

const CUTOFF_OPTIONS: SelectOption[] = Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: ordinal(i + 1) }));
const DUE_OPTIONS: SelectOption[] = [{ value: "", label: "Not set" }, ...CUTOFF_OPTIONS];

/** `cards` includes archived ones, so old purchases still name their card; only active ones are listed. */
export function CardManager({ today, ...context }: DetailContext & { today: string }) {
  const { cards, methodColors, canEdit } = context;
  const [dialog, setDialog] = useState<Dialog | null>(null);
  // An id, so the dialog follows the card's latest props after marking a statement paid.
  const [statementsOf, setStatementsOf] = useState<string | null>(null);
  const statements = cards.find((c) => c.id === statementsOf) ?? null;
  const close = useCallback(() => setDialog(null), []);
  const active = cards.filter((c) => !c.archived);

  const title =
    dialog?.kind === "create"
      ? "Add card"
      : dialog?.kind === "edit"
        ? "Edit card"
        : dialog?.kind === "archive"
          ? `Archive ${dialog.card.name}?`
          : dialog?.kind === "method"
            ? `Edit ${METHOD_LABELS[dialog.method]}`
            : "";

  return (
    <>
      <ul className="divide-y divide-line">
        {active.map((card) => (
          <li key={card.id} className="flex items-center gap-3 py-2">
            <MethodIcon method="card" color={card.color} size="md" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{card.name}</p>
              <p className="tabular text-sm text-subtle">
                ••{card.last4} · cutoff {ordinal(card.cutoffDay)}
                {card.dueDay && ` · due ${ordinal(card.dueDay)}`}
              </p>
            </div>
            <button
              type="button"
              aria-haspopup="dialog"
              className={`icon-btn ${canEdit ? "" : "-mr-2"}`}
              aria-label={`${card.name} statements`}
              title="Statements"
              onClick={() => setStatementsOf(card.id)}
            >
              <ReceiptText className="size-4" aria-hidden />
            </button>
            {canEdit && (
              <button type="button" className="icon-btn -mr-2" aria-label={`Edit ${card.name}`} onClick={() => setDialog({ kind: "edit", card })}>
                <Pencil className="size-4" aria-hidden />
              </button>
            )}
          </li>
        ))}
        {FIXED_METHODS.map((method) => (
          <li key={method} className="flex items-center gap-3 py-2">
            <MethodIcon method={method} color={methodColors[method]} size="md" />
            <p className="min-w-0 flex-1 truncate font-medium">{METHOD_LABELS[method]}</p>
            {canEdit && (
              <button
                type="button"
                className="icon-btn -mr-2"
                aria-label={`Edit ${METHOD_LABELS[method]}`}
                onClick={() => setDialog({ kind: "method", method })}
              >
                <Pencil className="size-4" aria-hidden />
              </button>
            )}
          </li>
        ))}
      </ul>

      {canEdit && (
        <button type="button" className="btn btn-primary mt-4" onClick={() => setDialog({ kind: "create" })}>
          <Plus className="size-5" aria-hidden />
          Add card
        </button>
      )}

      <Modal open={dialog !== null} onClose={close} title={title}>
        {dialog?.kind === "create" && <CardForm defaultColor={nextCardColor(active, methodColors)} onDone={close} />}
        {dialog?.kind === "edit" && (
          <CardForm card={dialog.card} defaultColor={dialog.card.color} onDone={close} onArchive={() => setDialog({ kind: "archive", card: dialog.card })} />
        )}
        {dialog?.kind === "archive" && (
          <ConfirmArchive card={dialog.card} onDone={close} onCancel={() => setDialog({ kind: "edit", card: dialog.card })} />
        )}
        {dialog?.kind === "method" && <MethodColorForm method={dialog.method} defaultColor={methodColors[dialog.method]} onDone={close} />}
      </Modal>

      {/* Keyed so each card opens on its current statement. */}
      <CardStatements key={statements?.id} card={statements} today={today} context={context} onClose={() => setStatementsOf(null)} />
    </>
  );
}

/** Each swatch sits in a 44px target; the ring marks the chosen one. */
function ColorField({ defaultColor }: { defaultColor: MethodColor }) {
  const [color, setColor] = useState(defaultColor);
  return (
    <fieldset>
      <legend className="label">Color</legend>
      <div className="flex flex-wrap">
        {METHOD_COLORS.map((c) => (
          <label key={c} className="flex size-11 cursor-pointer items-center justify-center">
            <input type="radio" name="color" value={c} checked={color === c} onChange={() => setColor(c)} className="peer sr-only" />
            <span
              className="block size-8 rounded-full ring-offset-2 ring-offset-surface-strong peer-checked:ring-2 peer-checked:ring-fg peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-ring"
              style={{ backgroundColor: c }}
            >
              <span className="sr-only">{METHOD_COLOR_NAMES[c]}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function MethodColorForm({ method, defaultColor, onDone }: { method: FixedMethod; defaultColor: MethodColor; onDone: () => void }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveMethodColor, { ok: false });

  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="method" value={method} />
      <ColorField defaultColor={defaultColor} />
      <FormError message={state.error} />
      <button type="submit" disabled={pending} className="btn btn-primary w-full">
        {pending && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
        Save changes
      </button>
    </form>
  );
}

function CardForm({ card, defaultColor, onDone, onArchive }: { card?: PaymentCard; defaultColor: MethodColor; onDone: () => void; onArchive?: () => void }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveCard, { ok: false });

  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);

  return (
    <form action={action} className="flex flex-col gap-4">
      {card && <input type="hidden" name="id" value={card.id} />}
      <div>
        <label htmlFor="card-name" className="label">
          Name
        </label>
        <input id="card-name" name="name" required maxLength={40} data-autofocus placeholder="e.g. RCBC Black" defaultValue={card?.name} className="field" />
      </div>
      <div>
        <label htmlFor="card-last4" className="label">
          Last 4 digits
        </label>
        <input
          id="card-last4"
          name="last4"
          required
          inputMode="numeric"
          autoComplete="off"
          maxLength={4}
          pattern="\d{4}"
          placeholder="1234"
          defaultValue={card?.last4}
          className="field tabular"
        />
      </div>
      <div>
        <label htmlFor="card-cutoff" className="label">
          Statement cutoff day
        </label>
        <Select
          id="card-cutoff"
          name="cutoffDay"
          required
          options={CUTOFF_OPTIONS}
          defaultValue={String(card?.cutoffDay ?? 10)}
          aria-describedby="card-cutoff-help"
        />
        <p id="card-cutoff-help" className="mt-1.5 text-sm text-subtle">
          Purchases up to and including this day go on that month&apos;s statement.
        </p>
      </div>
      <div>
        <label htmlFor="card-due" className="label">
          Payment due day <span className="font-normal text-subtle">(optional)</span>
        </label>
        <Select
          id="card-due"
          name="dueDay"
          options={DUE_OPTIONS}
          defaultValue={card?.dueDay ? String(card.dueDay) : ""}
          aria-describedby="card-due-help"
        />
        <p id="card-due-help" className="mt-1.5 text-sm text-subtle">
          The first one after each cutoff. Pursely reminds you a week before it.
        </p>
      </div>
      <ColorField defaultColor={defaultColor} />

      <FormError message={state.error} />
      <button type="submit" disabled={pending} className="btn btn-primary w-full">
        {pending && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
        {card ? "Save changes" : "Add card"}
      </button>
      {onArchive && (
        <button type="button" className="btn btn-danger w-full" onClick={onArchive}>
          Archive card
        </button>
      )}
    </form>
  );
}

function ConfirmArchive({ card, onDone, onCancel }: { card: PaymentCard; onDone: () => void; onCancel: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted">It disappears from the Paid with list. Purchases already tagged keep it.</p>
      <FormError message={error} />
      <div className="grid grid-cols-2 gap-3">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          disabled={pending}
          className="btn btn-danger"
          onClick={() =>
            start(async () => {
              const result = await archiveCardAction(card.id);
              if (result.ok) onDone();
              else setError(result.error);
            })
          }
        >
          {pending && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
          Archive
        </button>
      </div>
    </div>
  );
}

/**
 * One statement's purchases at a time, opening on `initial` or the one that closes next. Later
 * statements can hold purchases moved there by hand, so the next one is reachable too. A closed
 * statement shows its due date and can be marked paid, which records nothing as spending.
 */
export function CardStatements({ card, today, context, initial, onClose }: {
  card: PaymentCard | null;
  today: string;
  context: DetailContext;
  initial?: string;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState(initial ?? null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  if (!card) return <TransactionsDialog {...context} query={null} title="" onClose={onClose} />;
  const close = picked ?? statementAt(today, card.cutoffDay, 0);
  const last = statementAt(today, card.cutoffDay, 1);
  const begin = statementStart(close, card.cutoffDay);
  const closed = close <= today;
  const paid = card.paid.includes(close);
  const due = card.dueDay ? dueFor(close, card.dueDay) : null;
  const day = (iso: string) => formatDate(iso, { month: "short", day: "numeric", year: iso.slice(0, 4) === today.slice(0, 4) ? undefined : "numeric" });
  const move = (offset: -1 | 1) => {
    setError(undefined);
    setPicked(statementFor(close, card.cutoffDay, offset));
  };
  const status = !closed ? "Open" : paid ? "Paid" : due && due < today ? `Overdue since ${day(due)}` : due ? `Due ${day(due)}` : "Closed";

  return (
    <TransactionsDialog
      {...context}
      query={{ from: close, to: close, paidWith: card.id }}
      title={`${card.name} ••${card.last4}`}
      header={
        <div className="mb-3">
          <div className="flex items-center gap-2">
            <button type="button" className="icon-btn shrink-0 border border-line-strong" aria-label="Previous statement" onClick={() => move(-1)}>
              <ChevronLeft className="size-5" aria-hidden />
            </button>
            <div className="min-w-0 flex-1 text-center" aria-live="polite">
              <p className="font-semibold">{formatDate(close, { month: "long", year: "numeric" })} statement</p>
              <p className="text-xs text-muted">
                Purchases {day(begin)} – {day(close)} ·{" "}
                <span className={closed && !paid && due && due < today ? "font-medium text-danger" : paid ? "font-medium text-success" : ""}>{status}</span>
              </p>
            </div>
            <button
              type="button"
              className="icon-btn shrink-0 border border-line-strong disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Next statement"
              disabled={close >= last}
              onClick={() => move(1)}
            >
              <ChevronRight className="size-5" aria-hidden />
            </button>
          </div>
          {closed && context.canEdit && (
            <button
              type="button"
              disabled={pending}
              aria-pressed={paid}
              className={`btn mt-3 w-full ${paid ? "btn-ghost" : "btn-primary"}`}
              onClick={() =>
                start(async () => {
                  const result = await markStatementPaid(card.id, close, !paid);
                  setError(result.ok ? undefined : result.error);
                })
              }
            >
              {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : paid && <Check className="size-4" aria-hidden />}
              {paid ? "Paid · mark unpaid" : "Mark as paid"}
            </button>
          )}
          <FormError message={error} />
        </div>
      }
      note={
        closed
          ? "Marking a statement paid adds no expense: its purchases are already counted. Purchases moved to another statement by hand show on that one."
          : "Purchases moved to another statement by hand show on that one."
      }
      onClose={onClose}
    />
  );
}

/** Statements due within a week, unpaid, with a balance: shown on the dashboard. */
export function StatementsDue({ items, today, context }: {
  items: { cardId: string; statement: string; due: string; amount: number }[];
  today: string;
  context: DetailContext;
}) {
  const [open, setOpen] = useState<{ cardId: string; statement: string } | null>(null);
  const card = open ? (context.cards.find((c) => c.id === open.cardId) ?? null) : null;
  const { currency } = context;
  if (!items.length) return null;
  return (
    <section aria-label="Card payments due" className="flex flex-col gap-2">
      {items.map((d) => {
        const c = context.cards.find((x) => x.id === d.cardId);
        if (!c) return null;
        const overdue = d.due < today;
        const days = Math.round((Date.parse(d.due) - Date.parse(today)) / 86_400_000);
        const when = overdue ? `was due ${formatDate(d.due, { month: "short", day: "numeric" })}` : days === 0 ? "due today" : `due in ${days} day${days === 1 ? "" : "s"}`;
        return (
          <div
            key={d.cardId}
            role={overdue ? "alert" : undefined}
            className={`flex items-center gap-3 rounded-2xl border px-3 py-2 sm:px-4 ${overdue ? "border-danger/40 bg-danger-soft" : "border-warning/40 bg-warning-soft"}`}
          >
            <MethodIcon method="card" color={c.color} size="md" />
            <p className="min-w-0 flex-1 text-sm">
              <span className="font-medium">{c.name} ••{c.last4}</span>{" "}
              <span className="tabular font-semibold">{formatMoney(d.amount, currency)}</span>{" "}
              <span className={overdue ? "font-medium text-danger" : "text-muted"}>{when}</span>
            </p>
            <button type="button" aria-haspopup="dialog" className="btn btn-ghost h-11 shrink-0 px-3 sm:h-9" onClick={() => setOpen({ cardId: d.cardId, statement: d.statement })}>
              View
            </button>
          </div>
        );
      })}
      <CardStatements key={open ? `${open.cardId}|${open.statement}` : "none"} card={card} initial={open?.statement} today={today} context={context} onClose={() => setOpen(null)} />
    </section>
  );
}
