// Payment methods and card statements, shared by the form preview and the server.
// A card purchase goes on the statement that closes on or after its date: the cutoff day belongs to
// the statement that closes that day. A cutoff past the end of a short month closes on its last day.
// The statement's month is the budget month the purchase counts in.
import { addMonths, startOf } from "./dates";

export const FIXED_METHODS = ["cash", "gcash", "maya", "others"] as const;
export type FixedMethod = (typeof FIXED_METHODS)[number];
export type Method = FixedMethod | "card";

export const METHOD_LABELS: Record<FixedMethod, string> = { cash: "Cash", gcash: "GCash", maya: "Maya", others: "Others" };

export function isFixedMethod(value: unknown): value is FixedMethod {
  return typeof value === "string" && (FIXED_METHODS as readonly string[]).includes(value);
}

/** The cutoff date in the month containing `month`, clamped to that month's last day. */
export function cutoffIn(month: string, cutoffDay: number): string {
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month.slice(0, 8)}${String(Math.min(cutoffDay, lastDay)).padStart(2, "0")}`;
}

/** The statement date for a purchase on `date`, moved by `offset` whole statements. */
export function statementFor(date: string, cutoffDay: number, offset: -1 | 0 | 1 = 0): string {
  const here = cutoffIn(date, cutoffDay);
  const auto = date <= here ? here : cutoffIn(addMonths(startOf(date, "month"), 1), cutoffDay);
  return offset === 0 ? auto : cutoffIn(addMonths(startOf(auto, "month"), offset), cutoffDay);
}

/** The previous, automatic and next statement for a purchase on `date`. */
export function statementChoices(date: string, cutoffDay: number): [string, string, string] {
  return [statementFor(date, cutoffDay, -1), statementFor(date, cutoffDay), statementFor(date, cutoffDay, 1)];
}

export function ordinal(day: number): string {
  const teen = day % 100 >= 11 && day % 100 <= 13;
  const suffix = teen ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[day % 10] ?? "th";
  return `${day}${suffix}`;
}

export function cardLabel(card: { name: string; last4: string }): string {
  return `${card.name} ••${card.last4}`;
}
