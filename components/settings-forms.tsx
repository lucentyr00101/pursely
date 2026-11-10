"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Download, FileUp, LoaderCircle, Trash2, Upload } from "lucide-react";
import { deleteAccountAction, importCsv, saveSettings, type ActionState, type ImportState } from "@/app/actions";
import { MAX_IMPORT_BYTES } from "@/lib/csv";
import type { DeletionPlan } from "@/lib/household";
import { CURRENCIES } from "@/lib/money";
import { DatePicker } from "./date-picker";
import { Modal } from "./modal";
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

const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/**
 * Two steps on one file: "Check file" reports what an import would do, then "Import" does it. The
 * file is kept in state and sent by hand, because React clears a form's file input after its action.
 */
export function ImportForm() {
  const [state, action, pending] = useActionState<ImportState, FormData>(importCsv, { ok: false });
  const [, start] = useTransition();
  const [file, setFile] = useState<File | null>(null);
  const [tooLarge, setTooLarge] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const fileKey = file ? `${file.name}:${file.size}:${file.lastModified}` : "";
  // A result only counts for the file it was made from.
  const result = state.fileKey === fileKey && fileKey ? state : null;
  const checked = result?.ok && !result.committed ? result.summary : undefined;
  const imported = result?.ok && result.committed ? result.summary : undefined;

  const send = (intent: "check" | "import") => {
    if (!file) return;
    const body = new FormData();
    body.set("file", file);
    body.set("fileKey", fileKey);
    body.set("intent", intent);
    start(() => action(body));
  };

  return (
    <div className="flex flex-col gap-3" aria-busy={pending}>
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={input}
          id="import-file"
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={(e) => {
            const picked = e.target.files?.[0] ?? null;
            setTooLarge(Boolean(picked && picked.size > MAX_IMPORT_BYTES));
            setFile(picked);
          }}
        />
        <label
          htmlFor="import-file"
          className="btn btn-ghost cursor-pointer has-focus-visible:outline-2 has-focus-visible:outline-ring"
          // The input is visually hidden, so the label carries its focus ring.
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
        >
          <FileUp className="size-4" aria-hidden />
          {file ? "Choose another file" : "Choose CSV file"}
        </label>
        {file && <span className="min-w-0 truncate text-sm text-muted">{file.name}</span>}
      </div>

      {tooLarge && <FormError message="That file is too large. Split it and import each part." />}
      {result && !result.ok && <FormError message={result.error} />}

      {(checked || imported) && result && (
        <div role="status" className="flex flex-col gap-1.5 rounded-xl bg-sunken px-4 py-3 text-sm">
          {imported ? (
            <p className="flex items-center gap-1.5 font-medium text-success">
              <Check className="size-4 shrink-0" aria-hidden /> Added {count(imported.added, "transaction")}
            </p>
          ) : (
            <p className="font-medium">
              {checked!.added ? `${count(checked!.added, "transaction")} to add` : "Nothing new to add"}
            </p>
          )}
          {(checked ?? imported)!.duplicates > 0 && (
            <p className="text-muted">{count((checked ?? imported)!.duplicates, "row")} already in your ledger, left out.</p>
          )}
          {(checked ?? imported)!.unknownCategories.length > 0 && (
            <p className="text-muted">
              No category named {(checked ?? imported)!.unknownCategories.join(", ")}. {imported ? "Those rows went" : "Those rows go"} under
              Other or the main category{checked ? "; add the categories first to keep them" : ""}.
            </p>
          )}
          {(checked ?? imported)!.unknownMethods.length > 0 && (
            <p className="text-muted">
              No payment method named {(checked ?? imported)!.unknownMethods.join(", ")}. {imported ? "Those rows have" : "Those rows get"} none.
            </p>
          )}
          {(result.skippedCount ?? 0) > 0 && (
            <div className="text-muted">
              <p>{count(result.skippedCount!, "row")} can&apos;t be read and {result.skippedCount === 1 ? "is" : "are"} skipped:</p>
              <ul className="mt-1 list-disc pl-5">
                {result.skipped!.map((e) => (
                  <li key={e.line}>
                    Line {e.line}: {e.message}
                  </li>
                ))}
                {result.skippedCount! > result.skipped!.length && <li>and {count(result.skippedCount! - result.skipped!.length, "more")}</li>}
              </ul>
            </div>
          )}
        </div>
      )}

      {file && !tooLarge && !imported && (
        <div>
          {checked ? (
            checked.added > 0 && (
              <button type="button" disabled={pending} className="btn btn-primary" onClick={() => send("import")}>
                {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />}
                Import {count(checked.added, "transaction")}
              </button>
            )
          ) : (
            <button type="button" disabled={pending} className="btn btn-primary" onClick={() => send("check")}>
              {pending && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
              Check file
            </button>
          )}
        </div>
      )}

      <p className="text-sm text-subtle">
        Use the columns of the export: <span className="text-muted">date, type, category, subcategory, amount, paid_with, statement, note</span>.
        Only date (like 2026-01-31) and amount are required. Nothing is added until you confirm.
      </p>
    </div>
  );
}

const DELETION_TEXT: Record<DeletionPlan, string> = {
  erase: "This permanently deletes your account, your transactions, categories, budgets, recurring entries and cards.",
  leave: "This permanently deletes your account and removes you from your household. What you added to its ledger stays with the household.",
  blocked: "You own a household with other members. Transfer ownership or remove everyone first, then you can delete your account.",
};

export function DeleteAccount({ plan }: { plan: DeletionPlan }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const router = useRouter();
  const close = () => {
    setOpen(false);
    setTyped("");
    setError(undefined);
  };

  return (
    <>
      <p className="text-sm text-muted text-pretty">{DELETION_TEXT[plan]}</p>
      {plan !== "blocked" && (
        <button type="button" className="btn btn-danger mt-3" onClick={() => setOpen(true)}>
          <Trash2 className="size-4" aria-hidden />
          Delete account
        </button>
      )}
      <Modal open={open} onClose={close} title="Delete your account?">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const result = await deleteAccountAction(typed);
              if (!result.ok) return setError(result.error);
              router.replace("/");
              router.refresh();
            });
          }}
        >
          <p className="text-muted">
            {DELETION_TEXT[plan]} You can&apos;t undo this. Export your transactions first if you want a copy.
          </p>
          <div>
            <label htmlFor="delete-confirm" className="label">
              Type <span className="font-semibold text-fg">delete</span> to confirm
            </label>
            <input
              id="delete-confirm"
              data-autofocus
              className="field"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
          </div>
          <FormError message={error} />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-ghost" onClick={close}>
              Cancel
            </button>
            <button type="submit" className="btn btn-danger" disabled={pending || typed.trim().toLowerCase() !== "delete"}>
              {pending && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
              Delete account
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
