"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { LoaderCircle, Repeat } from "lucide-react";
import { saveTransaction, type ActionState } from "@/app/actions";
import type { CategoryNode, PaymentCard, Transaction } from "@/lib/data";
import type { MethodColors } from "@/lib/statements";
import type { TxType } from "@/lib/category-defs";
import { todayIn, type Granularity } from "@/lib/dates";
import { centsToInput } from "@/lib/money";
import { CategoryIcon } from "./category-icon";
import { DatePicker } from "./date-picker";
import { PAID_WITH_KEY, PaidWithField, useRememberedPaidWith } from "./paid-with";
import { SchedulePreview } from "./schedule-preview";
import { Select, type SelectOption } from "./select";
import { FormError } from "./ui";

const REPEAT_OPTIONS: SelectOption<"" | Granularity>[] = [
  { value: "", label: "Never" },
  { value: "day", label: "Daily" },
  { value: "week", label: "Weekly" },
  { value: "month", label: "Monthly" },
  { value: "year", label: "Yearly" },
];

export function TransactionForm({ categories, cards, methodColors, currency, date, transaction, onDone }: {
  categories: CategoryNode[];
  cards: PaymentCard[];
  methodColors: MethodColors;
  currency: string;
  date: string;
  transaction?: Transaction;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveTransaction, { ok: false });
  const [type, setType] = useState<TxType>(transaction?.type ?? "expense");
  const [txDate, setTxDate] = useState(transaction?.date ?? date);
  const remembered = useRememberedPaidWith(cards);
  const paidWith = transaction ? (transaction.cardId ?? transaction.method ?? "") : remembered;
  const [picked, setPicked] = useState<string | null>(null);
  const card = type === "expense" ? cards.find((c) => c.id === (picked ?? paidWith)) : undefined;
  const submitted = useRef<FormDataEntryValue | null>(null);

  useEffect(() => {
    if (!state.ok) return;
    if (!transaction && typeof submitted.current === "string" && submitted.current) {
      try {
        localStorage.setItem(PAID_WITH_KEY, submitted.current);
      } catch {}
    }
    onDone();
  }, [state, onDone, transaction]);

  const [repeat, setRepeat] = useState<"" | Granularity>("");

  return (
    <form
      action={(formData) => {
        submitted.current = formData.get("paidWith");
        action(formData);
      }}
      className="flex flex-col gap-4"
    >
      {transaction && <input type="hidden" name="id" value={transaction.id} />}
      <input type="hidden" name="type" value={type} />

      <TypeToggle type={type} onChange={setType} />

      <div>
        <label htmlFor="tx-amount" className="label">
          Amount ({currency})
        </label>
        <input
          id="tx-amount"
          name="amount"
          inputMode="decimal"
          autoComplete="off"
          required
          data-autofocus
          placeholder="0.00"
          defaultValue={transaction ? centsToInput(transaction.amount) : ""}
          className="field tabular text-lg font-semibold"
        />
      </div>

      <CategorySelect id="tx-category" categories={categories} type={type} selected={transaction?.subcategoryId ?? transaction?.categoryId} />

      {/* Hidden rather than removed for income, so switching back keeps the choice. The server ignores it for income. */}
      {paidWith !== null && (
        <div hidden={type !== "expense"}>
          <PaidWithField
            key={paidWith}
            id="tx-paid-with"
            cards={cards}
            methodColors={methodColors}
            date={txDate}
            defaultValue={paidWith}
            defaultStatement={transaction?.statementDate}
            showStatement={!repeat}
            onChange={setPicked}
          />
        </div>
      )}

      <div className={transaction ? "" : "grid grid-cols-2 gap-3"}>
        <div className="min-w-0">
          <label htmlFor="tx-date" className="label">
            {repeat ? "Starts" : "Date"}
          </label>
          <DatePicker id="tx-date" name="date" required value={txDate} onChange={setTxDate} />
        </div>
        {!transaction && (
          <div className="min-w-0">
            <label htmlFor="tx-repeat" className="label">
              Repeat
            </label>
            <Select id="tx-repeat" name="repeat" options={REPEAT_OPTIONS} value={repeat} onChange={setRepeat} />
          </div>
        )}
      </div>
      {repeat && (
        <SchedulePreview
          start={txDate}
          unit={repeat}
          every={1}
          card={card}
          currency={currency}
          today={todayIn(Intl.DateTimeFormat().resolvedOptions().timeZone)}
        />
      )}
      {transaction?.recurringId && (
        <p className="-mt-2 flex items-center gap-1.5 text-sm text-muted">
          <Repeat className="size-4 shrink-0" aria-hidden />
          From a recurring entry. Changes here apply to this one only.
        </p>
      )}

      <div>
        <label htmlFor="tx-note" className="label">
          Note <span className="font-normal text-subtle">(optional)</span>
        </label>
        <input
          id="tx-note"
          name="note"
          maxLength={200}
          placeholder="e.g. Lunch with team"
          defaultValue={transaction?.note ?? ""}
          className="field"
        />
      </div>

      <FormError message={state.error} />

      <button type="submit" disabled={pending} className="btn btn-primary w-full">
        {pending && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
        {transaction ? "Save changes" : repeat ? `Add recurring ${type}` : `Add ${type}`}
      </button>
    </form>
  );
}

export function TypeToggle({ type, onChange }: { type: TxType; onChange: (type: TxType) => void }) {
  return (
    <fieldset>
      <legend className="label">Type</legend>
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-sunken p-1">
        {(["expense", "income"] as const).map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={type === t}
            onClick={() => onChange(t)}
            className={`h-11 cursor-pointer rounded-md text-sm font-semibold capitalize transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-ring ${
              type === t ? "bg-surface-strong text-fg shadow-sm" : "text-muted hover:text-fg active:text-fg"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** Top-level categories (of `type`, if given) each followed by their subcategories. */
export function categoryOptions(categories: CategoryNode[], type?: TxType): SelectOption[] {
  return categories
    .filter((c) => !type || c.type === type)
    .flatMap((c) => [
      { value: c.id, label: c.name, icon: <CategoryIcon icon={c.icon} color={c.color} size="xs" /> },
      ...c.children.map((s) => ({
        value: s.id,
        label: `${c.name} › ${s.name}`,
        display: s.name,
        icon: <CategoryIcon icon={s.icon} color={s.color} size="xs" />,
        depth: 1 as const,
      })),
    ]);
}

/** Top-level categories of `type` and their subcategories; picking a subcategory sends its id. */
export function CategorySelect({ id, categories, type, selected = "" }: {
  id: string;
  categories: CategoryNode[];
  type: TxType;
  selected?: string;
}) {
  const options = categoryOptions(categories, type);
  return (
    <div>
      <label htmlFor={id} className="label">
        Category
      </label>
      <Select
        id={id}
        name="categoryId"
        required
        key={type}
        options={options}
        defaultValue={options.some((o) => o.value === selected) ? selected : undefined}
        placeholder="Choose a category"
      />
    </div>
  );
}
