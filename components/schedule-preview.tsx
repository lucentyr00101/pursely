"use client";

import { CalendarClock, TriangleAlert } from "lucide-react";
import type { PaymentCard } from "@/lib/data";
import { formatDate, type Granularity } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { firstOccurrence, keepEnd, MAX_EVERY, occurrence, remaining } from "@/lib/recurring";
import { ordinal } from "@/lib/statements";

const shortDate = (iso: string) => formatDate(iso, { month: "short", day: "numeric" });
const longDate = (iso: string) => formatDate(iso, { month: "short", day: "numeric", year: "numeric" });

/**
 * What a recurring form will schedule, worked out the way the server saves it. `editing` means `start`
 * is the rule's next date, and entries it already added stay. `amount` is in cents, for the total.
 * `endPending` means an end was asked for but isn't filled in yet.
 */
export function SchedulePreview({ id, start, end = "", endPending = false, unit, every, amount = null, card, currency, today, editing = false }: {
  id?: string;
  start: string;
  end?: string;
  endPending?: boolean;
  unit: Granularity;
  every: number;
  amount?: number | null;
  card?: PaymentCard;
  currency: string;
  today: string;
  editing?: boolean;
}) {
  if (!start || !Number.isInteger(every) || every < 1 || every > MAX_EVERY) return null;

  if (end && end < start) {
    return (
      <p id={id} role="status" className="flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2.5 text-sm text-warning-strong">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        The end date is before {editing ? "the next entry" : "the start date"}. Pick a later one.
      </p>
    );
  }

  const followsCutoff = card && unit === "month";
  const first = firstOccurrence(start, unit, card?.cutoffDay);
  const last = end ? keepEnd(end, start, first) : null;
  const count = last && remaining(first, unit, every, first, last);
  const dueBy = last && last < today ? last : today;
  const due = !editing && first <= today ? remaining(first, unit, every, first, dueBy) : 0;

  return (
    <div id={id} role="status" className="rounded-lg bg-accent-soft px-3 py-2.5 text-sm">
      <p className="tabular flex items-center gap-2 font-semibold">
        <CalendarClock className="size-4 shrink-0 text-accent" aria-hidden />
        {editing ? "Next" : "First"} entry {longDate(first)}
      </p>
      <div className="mt-1 flex flex-col gap-1 text-muted">
        {followsCutoff && (
          <p>
            {first === start ? "Entries follow " : `${shortDate(start)} falls on the ${shortDate(first)} statement, so entries follow `}
            {card.name}&apos;s cutoff ({ordinal(card.cutoffDay)}).
          </p>
        )}
        <p className="tabular">
          {endPending
            ? "Set when it ends to see the total."
            : !last
            ? "Repeats until you pause or delete it."
            : !count
              ? `Ends ${longDate(last)}.`
              : `${count === 1 ? "1 entry" : `${count} entries, last on ${longDate(occurrence(first, unit, every, count - 1))}`}${amount ? ` · ${formatMoney(amount * count, currency)} total` : ""}`}
        </p>
        {due !== 0 && <p>{due === 1 ? "Adds this entry right away." : `Adds ${due ?? "1,000+"} entries right away, up to today.`}</p>}
        {editing && <p>Changes apply from this date on. Entries already added stay as they are.</p>}
      </div>
    </div>
  );
}
