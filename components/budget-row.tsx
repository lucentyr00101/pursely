"use client";

import { useActionState, useRef, useState } from "react";
import { Check, LoaderCircle } from "lucide-react";
import { saveBudget, type ActionState } from "@/app/actions";
import { centsToInput, formatMoney, parseAmount } from "@/lib/money";

/**
 * Saves on Enter or when the field loses focus, so a row needs no Save button and the name keeps
 * its width on phones. iOS's decimal keypad has no Enter key, so blur is how it saves there.
 * `max` is the most this budget can be under the recurring-net limit (null: no limit). It is checked
 * here for instant feedback; `saveBudget` enforces it.
 */
export function BudgetForm({ categoryId, name, budget, currency, canEdit, max }: {
  categoryId: string;
  name: string;
  budget: number | null;
  currency: string;
  canEdit: boolean;
  max: number | null;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveBudget, { ok: false });
  const [localError, setLocalError] = useState<string | null>(null);
  const error = localError ?? state.error;
  const id = `budget-${categoryId}`;
  const initial = budget ? centsToInput(budget) : "";
  // The last value sent (or loaded), so leaving an unchanged field doesn't save again.
  const saved = useRef(initial);

  return (
    <form action={action} className="flex shrink-0 flex-col items-end gap-1">
      <input type="hidden" name="categoryId" value={categoryId} />
      <label htmlFor={id} className="sr-only">
        Monthly budget for {name} ({currency})
      </label>
      <div className="relative">
        <input
          id={id}
          name="amount"
          inputMode="decimal"
          enterKeyHint="done"
          autoComplete="off"
          placeholder="No limit"
          disabled={!canEdit}
          defaultValue={initial}
          aria-describedby={error ? `${id}-error` : undefined}
          aria-invalid={error ? true : undefined}
          onChange={() => setLocalError(null)}
          onBlur={(e) => {
            const value = e.currentTarget.value.trim();
            if (value === saved.current) return;
            const cents = value ? parseAmount(value) : null;
            // Lowering is always allowed, matching the server, so an over-limit ledger can recover.
            if (max !== null && cents !== null && cents > (budget ?? 0) && cents > max) {
              setLocalError(`Over your recurring net per month. At most ${formatMoney(max, currency)} is left for this one.`);
              return;
            }
            saved.current = value;
            e.currentTarget.form?.requestSubmit();
          }}
          onKeyDown={(e) => {
            // Submit through blur so Enter and leaving the field share one path.
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          className="field tabular w-26 pr-8 text-sm min-[360px]:w-28 sm:w-36"
        />
        <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center" role="status">
          {pending ? (
            <LoaderCircle className="size-4 animate-spin text-subtle" aria-label="Saving" />
          ) : state.ok && !localError ? (
            <Check className="size-4 text-success" aria-label="Saved" />
          ) : null}
        </span>
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="max-w-44 text-right text-xs text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
