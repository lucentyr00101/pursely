"use client";

import { useCallback, useState } from "react";
import { Plus } from "lucide-react";
import type { CategoryNode, PaymentCard } from "@/lib/data";
import { Modal } from "./modal";
import { TransactionForm } from "./transaction-form";

export function AddTransactionButton({ categories, cards, currency, date, canEdit }: {
  categories: CategoryNode[];
  cards: PaymentCard[];
  currency: string;
  date: string;
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  if (!canEdit) return null;
  return (
    <>
      {/* Below lg it floats above the bottom nav, within thumb reach; from lg it sits in the page header. */}
      <button
        type="button"
        className="btn btn-primary fixed right-[calc(env(safe-area-inset-right)+1rem)] bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-30 size-14 rounded-full p-0 shadow-lg lg:static lg:h-11 lg:w-auto lg:rounded-lg lg:px-4 lg:shadow-none"
        onClick={() => setOpen(true)}
      >
        <Plus className="size-6 lg:size-5" aria-hidden />
        <span className="sr-only lg:not-sr-only">Add transaction</span>
      </button>
      <Modal open={open} onClose={close} title="New transaction">
        <TransactionForm categories={categories} cards={cards} currency={currency} date={date} onDone={close} />
      </Modal>
    </>
  );
}
