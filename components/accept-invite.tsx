"use client";

import { useState, useTransition } from "react";
import { LoaderCircle } from "lucide-react";
import { respondToInvite } from "@/app/actions";
import type { AcceptPreview, IncomingInvite } from "@/lib/household";
import { Modal } from "./modal";
import { FormError } from "./ui";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function AcceptInvite({ invite, preview }: { invite: IncomingInvite; preview: AcceptPreview }) {
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const empty = preview.transactions + preview.categories + preview.budgets + preview.recurring + preview.cards === 0;
  const counts = `${plural(preview.transactions, "transaction")}, ${plural(preview.recurring, "recurring entry", "recurring entries")}, ${plural(preview.categories, "custom category", "custom categories")}, ${plural(preview.budgets, "budget")} and ${plural(preview.cards, "card")}`;

  const respond = (response: "merge" | "replace" | "decline") =>
    start(async () => {
      const result = await respondToInvite(invite.id, response);
      if (result.ok) setOpen(false);
      else setError(result.error);
    });

  const close = () => {
    setOpen(false);
    setConfirmed(false);
  };

  return (
    <>
      <button
        type="button"
        disabled={pending}
        className="btn btn-primary h-10"
        onClick={() => (empty ? respond("merge") : setOpen(true))}
      >
        {pending && !open && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
        Accept
      </button>
      <button type="button" disabled={pending} className="btn btn-ghost h-10" onClick={() => respond("decline")}>
        Decline
      </button>
      {!open && error && <FormError message={error} />}

      <Modal open={open} onClose={close} title={`Join ${invite.ownerName}'s household`}>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">Choose what happens to the data in your current ledger.</p>

          <section className="flex flex-col gap-2 rounded-xl border border-line p-3">
            <h3 className="font-medium">Merge my data</h3>
            <p className="text-sm text-muted">Moves {counts} into the household.</p>
            {preview.currency !== preview.householdCurrency && (
              <p className="text-sm text-muted">Amounts aren&apos;t converted. The household uses {preview.householdCurrency}.</p>
            )}
            <button type="button" disabled={pending} data-autofocus className="btn btn-primary" onClick={() => respond("merge")}>
              {pending && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
              Merge my data
            </button>
          </section>

          <section className="flex flex-col gap-2 rounded-xl border border-line p-3">
            <h3 className="font-medium">Replace (delete my data)</h3>
            <p className="text-sm text-muted">Permanently deletes {counts}.</p>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="size-4 cursor-pointer accent-danger"
              />
              I understand this can&apos;t be undone
            </label>
            <button type="button" disabled={pending || !confirmed} className="btn btn-danger" onClick={() => respond("replace")}>
              {pending && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
              Replace (delete my data)
            </button>
          </section>

          <FormError message={error} />
        </div>
      </Modal>
    </>
  );
}
