"use client";

import { useActionState, useCallback, useEffect, useState, useTransition } from "react";
import { CreditCard, LoaderCircle, Pencil, Plus } from "lucide-react";
import { archiveCardAction, saveCard, type ActionState } from "@/app/actions";
import type { PaymentCard } from "@/lib/data";
import { ordinal } from "@/lib/statements";
import { Modal } from "./modal";
import { Select, type SelectOption } from "./select";
import { FormError } from "./ui";

type Dialog = { kind: "create" } | { kind: "edit"; card: PaymentCard } | { kind: "archive"; card: PaymentCard };

const CUTOFF_OPTIONS: SelectOption[] = Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: ordinal(i + 1) }));

export function CardManager({ cards, canEdit }: { cards: PaymentCard[]; canEdit: boolean }) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const close = useCallback(() => setDialog(null), []);
  const active = cards.filter((c) => !c.archived);

  const title =
    dialog?.kind === "create"
      ? "Add card"
      : dialog?.kind === "edit"
        ? "Edit card"
        : dialog?.kind === "archive"
          ? `Archive ${dialog.card.name}?`
          : "";

  return (
    <>
      {active.length > 0 ? (
        <ul className="divide-y divide-line">
          {active.map((card) => (
            <li key={card.id} className="flex items-center gap-3 py-2">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-sunken text-muted">
                <CreditCard className="size-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{card.name}</p>
                <p className="tabular text-sm text-subtle">
                  ••{card.last4} · cutoff {ordinal(card.cutoffDay)}
                </p>
              </div>
              {canEdit && (
                <button type="button" className="icon-btn -mr-2" aria-label={`Edit ${card.name}`} onClick={() => setDialog({ kind: "edit", card })}>
                  <Pencil className="size-4" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No cards yet.</p>
      )}

      {canEdit && (
        <button type="button" className="btn btn-primary mt-4" onClick={() => setDialog({ kind: "create" })}>
          <Plus className="size-5" aria-hidden />
          Add card
        </button>
      )}
      <p className="mt-4 text-sm text-subtle">Cash, GCash, Maya and Others are always available.</p>

      <Modal open={dialog !== null} onClose={close} title={title}>
        {dialog?.kind === "create" && <CardForm onDone={close} />}
        {dialog?.kind === "edit" && (
          <CardForm card={dialog.card} onDone={close} onArchive={() => setDialog({ kind: "archive", card: dialog.card })} />
        )}
        {dialog?.kind === "archive" && <ConfirmArchive card={dialog.card} onDone={close} />}
      </Modal>
    </>
  );
}

function CardForm({ card, onDone, onArchive }: { card?: PaymentCard; onDone: () => void; onArchive?: () => void }) {
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

function ConfirmArchive({ card, onDone }: { card: PaymentCard; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted">It disappears from the Paid with list. Purchases already tagged keep it.</p>
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
