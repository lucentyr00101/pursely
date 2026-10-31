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

/**
 * Colors a payment method can have. Tags are solid, so each one is paired with text in
 * `onMethodColor` and that pairing reaches at least 5:1. Check a new color before adding it.
 */
export const METHOD_COLORS = [
  "#1c1917", "#475569", "#b91c1c", "#c2410c", "#eab308", "#84cc16",
  "#15803d", "#0f766e", "#2563eb", "#4338ca", "#7e22ce", "#be185d",
] as const;
export type MethodColor = (typeof METHOD_COLORS)[number];
export type MethodColors = Record<FixedMethod, MethodColor>;

export const METHOD_COLOR_NAMES: Record<MethodColor, string> = {
  "#1c1917": "Charcoal", "#475569": "Slate", "#b91c1c": "Red", "#c2410c": "Orange", "#eab308": "Yellow", "#84cc16": "Lime",
  "#15803d": "Green", "#0f766e": "Teal", "#2563eb": "Blue", "#4338ca": "Indigo", "#7e22ce": "Purple", "#be185d": "Pink",
};

/** Cards saved before colors existed have none stored and read as this. */
export const DEFAULT_CARD_COLOR: MethodColor = "#1c1917";
export const DEFAULT_METHOD_COLORS: MethodColors = { cash: "#eab308", gcash: "#2563eb", maya: "#15803d", others: "#475569" };

/** The text color that stays readable on a solid `color`. */
export function onMethodColor(color: MethodColor): string {
  return color === "#eab308" || color === "#84cc16" ? "var(--fg)" : "var(--on-primary)";
}

/** The color of a transaction's method. A card that can't be found gets the default. */
export function methodColor(method: Method, card: { color: MethodColor } | undefined, colors: MethodColors): MethodColor {
  return method === "card" ? (card?.color ?? DEFAULT_CARD_COLOR) : colors[method];
}

/** The first color no other method uses, for a new card. The first color once they are all taken. */
export function nextCardColor(cards: { color: MethodColor }[], colors: MethodColors): MethodColor {
  const used = new Set<MethodColor>([...cards.map((c) => c.color), ...Object.values(colors)]);
  return METHOD_COLORS.find((c) => !used.has(c)) ?? METHOD_COLORS[0];
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

/** "RCBC Black ••4444", "GCash", or "Card" when the card can't be found; null when no method is set. */
export function methodLabel(method: Method | null, card: { name: string; last4: string } | undefined): string | null {
  if (!method) return null;
  if (method !== "card") return METHOD_LABELS[method];
  return card ? cardLabel(card) : "Card";
}
