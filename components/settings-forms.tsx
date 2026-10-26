"use client";

import { useActionState } from "react";
import { Check, Download, LoaderCircle } from "lucide-react";
import { saveSettings, type ActionState } from "@/app/actions";
import { CURRENCIES } from "@/lib/money";
import { DatePicker } from "./date-picker";
import { Select } from "./select";
import { FormError } from "./ui";

const CURRENCY_OPTIONS = CURRENCIES.map((c) => ({ value: c.code, label: `${c.code} — ${c.name}` }));

export function CurrencyForm({ currency, canEdit }: { currency: string; canEdit: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveSettings, { ok: false });
  return (
    <form action={action} className="flex flex-col gap-3">
      <div>
        <label htmlFor="currency" className="label">
          Display currency
        </label>
        <div className="flex gap-2">
          <Select
            id="currency"
            name="currency"
            options={CURRENCY_OPTIONS}
            defaultValue={currency}
            disabled={!canEdit}
            className="flex-1 sm:max-w-xs"
          />
          <button type="submit" disabled={pending || !canEdit} className="btn btn-primary">
            {pending && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
            Save
          </button>
        </div>
        <p className="mt-1.5 text-sm text-subtle">Changes how amounts are shown. Amounts aren&apos;t converted.</p>
      </div>
      {state.ok && (
        <p role="status" className="flex items-center gap-1.5 text-sm text-success">
          <Check className="size-4" aria-hidden /> Saved
        </p>
      )}
      <FormError message={state.error} />
    </form>
  );
}

export function ExportForm({ from, to }: { from: string; to: string }) {
  return (
    // Phones put the two dates side by side with a full-width button below; wider screens fit one row.
    <form action="/api/export" method="get" className="grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap">
      <div className="min-w-0">
        <label htmlFor="export-from" className="label">
          From
        </label>
        <DatePicker id="export-from" name="from" required defaultValue={from} />
      </div>
      <div className="min-w-0">
        <label htmlFor="export-to" className="label">
          To
        </label>
        <DatePicker id="export-to" name="to" required defaultValue={to} />
      </div>
      <button type="submit" className="btn btn-ghost col-span-2">
        <Download className="size-4" aria-hidden />
        Download CSV
      </button>
    </form>
  );
}
