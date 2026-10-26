// Schedule math for recurring transactions, shared by client and server. Dates are YYYY-MM-DD strings.
import { addDays, addMonths, formatDate, type Granularity } from "./dates";

export const MAX_EVERY = 365;

/**
 * The k-th occurrence (0 = the start date). Always counted from the start, so a rule starting on the
 * 31st lands on the last day of shorter months and returns to the 31st after them.
 */
export function occurrence(start: string, unit: Granularity, every: number, k: number): string {
  switch (unit) {
    case "day":
      return addDays(start, k * every);
    case "week":
      return addDays(start, 7 * k * every);
    case "month":
      return addMonths(start, k * every);
    case "year":
      return addMonths(start, 12 * k * every);
  }
}

const UNIT_NAMES: Record<Granularity, [string, string]> = {
  day: ["day", "days"],
  week: ["week", "weeks"],
  month: ["month", "months"],
  year: ["year", "years"],
};

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}

const ADVERBS: Record<Granularity, string> = { day: "Daily", week: "Weekly", month: "Monthly", year: "Yearly" };

/** e.g. "Monthly on the 15th", "Every 2 weeks on Monday". */
export function describeSchedule(unit: Granularity, every: number, start: string): string {
  const base = every === 1 ? ADVERBS[unit] : `Every ${every} ${UNIT_NAMES[unit][1]}`;
  switch (unit) {
    case "day":
      return base;
    case "week":
      return `${base} on ${formatDate(start, { weekday: "long" })}`;
    case "month":
      return `${base} on the ${ordinal(Number(start.slice(8)))}`;
    case "year":
      return `${base} on ${formatDate(start, { month: "long", day: "numeric" })}`;
  }
}

/** Occurrences from `next` through `end`, or null past `cap` (a long daily rule isn't worth counting). */
export function remaining(start: string, unit: Granularity, every: number, next: string, end: string, cap = 999): number | null {
  let k = 0;
  while (occurrence(start, unit, every, k) < next) if (++k > 5000) return null;
  let n = 0;
  while (occurrence(start, unit, every, k + n) <= end) if (++n > cap) return null;
  return n;
}

/** Average occurrences per month, for a rough monthly total. */
export function perMonth(unit: Granularity, every: number): number {
  const perUnit = { day: 365.25 / 12, week: 365.25 / 12 / 7, month: 1, year: 1 / 12 }[unit];
  return perUnit / every;
}

/** Rough monthly totals of the rules still running (not paused or finished), in cents. */
export function monthlyTotals(rules: { type: "expense" | "income"; amount: number; unit: Granularity; every: number; paused: boolean; nextDate: string | null }[]) {
  const totals = { expense: 0, income: 0 };
  for (const r of rules) {
    if (!r.paused && r.nextDate !== null) totals[r.type] += r.amount * perMonth(r.unit, r.every);
  }
  const expense = Math.round(totals.expense);
  const income = Math.round(totals.income);
  return { expense, income, net: income - expense };
}
