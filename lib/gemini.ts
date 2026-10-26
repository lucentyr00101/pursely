import "server-only";
import { z } from "zod";
import { getBudgetStatus, getSummary, listCategories, listRecurring, type CategoryTotal, type Recurring } from "./data";
import { addDays, daysBetween, endOf, next, resolveRange, startOf } from "./dates";
import { formatMoney } from "./money";
import { describeSchedule, monthlyTotals, remaining } from "./recurring";

/**
 * Free-tier models, tried in order. The full Flash models often answer 503 (high demand) or hang, and
 * retired ones (and the `-latest` aliases, for new keys) answer 404, so each failure moves to the next.
 */
const MODELS = [...new Set([process.env.GEMINI_MODEL, "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"].filter((m): m is string => !!m))];
const endpoint = (model: string) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

export const geminiEnabled = () => Boolean(process.env.GEMINI_API_KEY);

const SYSTEM = `You are a friendly, practical personal finance assistant inside a budgeting app.
You get a household's numbers for the current month, its recurring income (such as salary) and
recurring payments, and what is already scheduled for next month.
Return:
- overview: how the month is going, at most 3 sentences. Cover income against spending, how much of
  the recurring salary/income is already committed to recurring payments, and budgets that are over
  or on pace to go over given how far into the month it is.
- steps: 2 to 4 recommended steps for the rest of this month, each at most 2 sentences.
- nextMonth: the single most useful step for next month, at most 2 sentences. Use the scheduled
  income and payments for next month, and mention recurring payments that end soon (with how many
  months or payments are left) when that frees up money. It sits under a "For next month" heading,
  so don't start with "For next month" or "Next month".
Be concrete: name categories and amounts from the data. Don't invent data, don't recommend financial
products, and keep a supportive tone. Plain text, no markdown.`;

const responseJsonSchema = {
  type: "object",
  properties: {
    overview: { type: "string" },
    steps: { type: "array", items: { type: "string" } },
    nextMonth: { type: "string" },
  },
  required: ["overview", "steps", "nextMonth"],
};

const resultSchema = z.object({
  overview: z.string().trim().min(1).max(1500),
  steps: z.array(z.string().trim().min(1).max(500)).max(6),
  // The card heads it "For next month", which the model tends to repeat anyway.
  nextMonth: z
    .string()
    .trim()
    .min(1)
    .max(600)
    .transform((text) => {
      const rest = text.replace(/^(for )?(the )?next month,?\s*/i, "");
      return rest ? rest[0].toUpperCase() + rest.slice(1) : text;
    }),
});

export type Overview = z.infer<typeof resultSchema>;

/** Category totals as indented lines; only totals go out, never transaction notes. */
function categoryLines(totals: CategoryTotal[], currency: string): string[] {
  return totals.flatMap((c) => [
    `- ${c.name}: ${formatMoney(c.amount, currency)} (${c.count} transactions)`,
    ...c.children.filter((s) => s.id).map((s) => `  - ${s.name}: ${formatMoney(s.amount, currency)}`),
  ]);
}

/** Whole months from `today`'s month to `end`'s month (0 when it ends this month). */
function monthsUntil(today: string, end: string): number {
  const months = (iso: string) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7));
  return Math.max(0, months(end) - months(today));
}

/** One line per recurring rule, named by its category (rule notes stay private). */
function recurringLines(rules: Recurring[], names: Map<string, string>, today: string, money: (cents: number) => string): string[] {
  return rules
    .filter((r) => r.nextDate !== null)
    .map((r) => {
      const name = [names.get(r.categoryId), r.subcategoryId && names.get(r.subcategoryId)].filter(Boolean).join(" > ");
      const parts = [`${money(r.amount)}, ${describeSchedule(r.unit, r.every, r.startDate).toLowerCase()}`, `next on ${r.nextDate}`];
      if (r.endDate) {
        const left = remaining(r.startDate, r.unit, r.every, r.nextDate!, r.endDate);
        const months = monthsUntil(today, r.endDate);
        parts.push(`ends ${r.endDate} (${left ?? "many"} payment${left === 1 ? "" : "s"} left, ${months} month${months === 1 ? "" : "s"} after this one)`);
      } else {
        parts.push("no end date");
      }
      if (r.paused) parts.push("paused");
      return `- ${name || "Uncategorized"}: ${parts.join(", ")}`;
    });
}

/** This month's figures, recurring rules and next month's schedule as plain text for the model. */
async function describeMonth(ledgerId: string, today: string, currency: string): Promise<string> {
  const month = resolveRange({ preset: "month" }, today);
  const last = resolveRange({ preset: "month", offset: "-1" }, today);
  const nextStart = next(month.from, "month");
  const upcoming = resolveRange({ preset: "custom", from: nextStart, to: addDays(next(nextStart, "month"), -1) }, today);
  const [now, prev, coming, budgets, rules, cats] = await Promise.all([
    getSummary(ledgerId, month),
    getSummary(ledgerId, last),
    getSummary(ledgerId, upcoming),
    getBudgetStatus(ledgerId, startOf(today, "month"), endOf(today, "month")),
    listRecurring(ledgerId),
    listCategories(ledgerId, { includeArchived: true }),
  ]);
  const money = (cents: number) => formatMoney(cents, currency);
  const budgeted = budgets.filter((b) => b.budget !== null);
  const names = new Map(cats.flatMap((c) => [[c.id, c.name] as const, ...c.children.map((s) => [s.id, s.name] as const)]));
  const perMonth = monthlyTotals(rules);
  const income = rules.filter((r) => r.type === "income");
  const payments = rules.filter((r) => r.type === "expense");

  return [
    `Today is ${today}, day ${daysBetween(month.from, today)} of ${month.days} in ${month.label}. Currency: ${currency}.`,
    "",
    `## ${month.label} so far`,
    `Income ${money(now.income)}, expenses ${money(now.expense)}, net ${money(now.income - now.expense)}.`,
    `Still scheduled this month from recurring rules: income ${money(now.scheduled.income)}, expenses ${money(now.scheduled.expense)}.`,
    `Recurring payments this month: ${money(now.recurring.expense.posted)} paid, ${money(now.recurring.expense.scheduled)} to come.`,
    "Expenses by category:",
    ...(now.expenseByCategory.length ? categoryLines(now.expenseByCategory, currency) : ["- none yet"]),
    "Income by category:",
    ...(now.incomeByCategory.length ? categoryLines(now.incomeByCategory, currency) : ["- none yet"]),
    "",
    "## Budgets this month (they carry over to next month unless changed)",
    ...(budgeted.length
      ? budgeted.map((b) => `- ${b.name}: spent ${money(b.spent)} of ${money(b.budget!)} (${Math.round((b.spent / b.budget!) * 100)}%)`)
      : ["- no budgets set"]),
    "",
    "## Recurring income (salary and the like)",
    ...(income.length ? recurringLines(income, names, today, money) : ["- none set up"]),
    "",
    "## Recurring payments",
    ...(payments.length ? recurringLines(payments, names, today, money) : ["- none set up"]),
    `Active rules average ${money(perMonth.income)} income and ${money(perMonth.expense)} payments per month, leaving ${money(perMonth.net)}.`,
    "",
    `## ${upcoming.label} (next month, scheduled so far)`,
    `Income ${money(coming.scheduled.income + coming.income)}, payments ${money(coming.scheduled.expense + coming.expense)} (recurring rules plus anything already dated next month).`,
    `Budgets total ${money(budgeted.reduce((sum, b) => sum + b.budget!, 0))}.`,
    "",
    `## ${last.label} (full month)`,
    `Income ${money(prev.income)}, expenses ${money(prev.expense)}.`,
    ...categoryLines(prev.expenseByCategory, currency).filter((line) => !line.startsWith("  ")),
  ].join("\n");
}

function parseJson(text: string | undefined): unknown {
  try {
    return JSON.parse(text ?? "");
  } catch {
    return null;
  }
}

export class GeminiError extends Error {}

export async function generateOverview(ledgerId: string, today: string, currency: string): Promise<Overview> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new GeminiError("The AI overview isn't set up.");

  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: "user", parts: [{ text: await describeMonth(ledgerId, today, currency) }] }],
    generationConfig: { responseMimeType: "application/json", responseJsonSchema, temperature: 0.4 },
  });

  let limited = false;
  for (const model of MODELS) {
    const res = await fetch(endpoint(model), {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body,
      signal: AbortSignal.timeout(20_000),
    }).catch((error: unknown) => {
      console.error(`Gemini ${model} unreachable`, error);
      return null;
    });
    if (!res) continue;
    if (!res.ok) {
      // Quotas are per model, so another one may still have room.
      if (res.status === 429) limited = true;
      console.error(`Gemini ${model} error`, res.status, (await res.text().catch(() => "")).slice(0, 500));
      if (res.status === 400 || res.status === 401 || res.status === 403) break; // the key or request is wrong
      continue;
    }
    const json = await res.json();
    const text: string | undefined = json?.candidates?.[0]?.content?.parts?.find((p: { text?: string }) => p.text)?.text;
    const parsed = resultSchema.safeParse(parseJson(text));
    if (parsed.success) return parsed.data;
    console.error(`Unexpected Gemini ${model} response`, JSON.stringify(json).slice(0, 2000));
  }
  throw new GeminiError(
    limited ? "Gemini's free daily limit is used up. Try again later." : "Gemini is busy right now. Try again in a few minutes.",
  );
}
