"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getLedgerContext, getSession, getToday } from "@/lib/session";
import * as household from "@/lib/household";
import type { LedgerContext } from "@/lib/household";
import * as data from "@/lib/data";
import { CATEGORY_COLORS, ICON_KEYS } from "@/lib/category-defs";
import { GRANULARITIES, isIsoDate, startOf } from "@/lib/dates";
import { MAX_EVERY } from "@/lib/recurring";
import { isCurrency, parseAmount } from "@/lib/money";
import { GeminiError, generateOverview, geminiEnabled } from "@/lib/gemini";

export type ActionState = { ok: boolean; error?: string; at?: number };

const fail = (error: string): ActionState => ({ ok: false, error });
const done = (): ActionState => {
  refresh();
  return { ok: true, at: Date.now() };
};

/** The caller's ledger if they may change it, otherwise the failure to return. */
async function editorContext(): Promise<LedgerContext | ActionState> {
  const ctx = await getLedgerContext();
  if (!ctx) return fail("Your session expired. Sign in again.");
  if (ctx.role === "viewer") return fail("You have view-only access to this household.");
  return ctx;
}

/** Same, for actions only the household owner may run. */
async function ownerContext(): Promise<LedgerContext | ActionState> {
  const ctx = await getLedgerContext();
  if (!ctx) return fail("Your session expired. Sign in again.");
  if (ctx.role !== "owner") return fail("Only the household owner can do that.");
  return ctx;
}

const isFailure = (ctx: LedgerContext | ActionState): ctx is ActionState => "ok" in ctx;

/** Ids passed straight to an action are client-controlled: only a 24-char hex string gets through. */
const idSchema = z.string().regex(/^[0-9a-f]{24}$/);
const isId = (value: unknown): value is string => idSchema.safeParse(value).success;
const BAD_ID = "Something went wrong. Refresh and try again.";

const amount = z.string().transform((v, ctx) => {
  const cents = parseAmount(v);
  if (cents === null) {
    ctx.addIssue({ code: "custom", message: "Enter an amount greater than 0, with up to 2 decimals." });
    return z.NEVER;
  }
  return cents;
});

const txSchema = z.object({
  type: z.enum(["expense", "income"]),
  amount,
  date: z.string().refine(isIsoDate, "Pick a valid date."),
  categoryId: z.string().min(1, "Pick a category."),
  note: z.string().trim().max(200, "Keep the note under 200 characters.").default(""),
});

const recurringSchema = z
  .object({
    type: z.enum(["expense", "income"]),
    amount,
    categoryId: z.string().min(1, "Pick a category."),
    note: z.string().trim().max(200, "Keep the note under 200 characters.").default(""),
    every: z.coerce
      .number()
      .int("Repeat every whole number of days, weeks, months or years.")
      .min(1, "Repeat at least every 1.")
      .max(MAX_EVERY, `Repeat at most every ${MAX_EVERY}.`),
    unit: z.enum(GRANULARITIES),
    start: z.string().refine(isIsoDate, "Pick a valid start date."),
    end: z
      .string()
      .default("")
      .refine((v) => v === "" || isIsoDate(v), "Pick a valid end date.")
      .transform((v) => v || null),
  })
  .refine((v) => !v.end || v.end >= v.start, { message: "The end date can't be before the start date." });

/** Repeat options on the new-transaction form: every 1 of the unit, starting on the transaction's date. */
const repeatSchema = z.enum(GRANULARITIES).optional().catch(undefined);

const categorySchema = z.object({
  name: z.string().trim().min(1, "Give the category a name.").max(40, "Keep the name under 40 characters."),
  icon: z.enum(ICON_KEYS),
  color: z.enum(CATEGORY_COLORS),
});

function firstError(error: z.ZodError) {
  return error.issues[0]?.message ?? "Check the form and try again.";
}

function fields(formData: FormData) {
  return Object.fromEntries([...formData.entries()].filter(([, v]) => typeof v === "string"));
}

// ---------- Transactions ----------

export async function saveTransaction(_: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await editorContext();
  if (isFailure(ctx)) return ctx;
  const parsed = txSchema.safeParse(fields(formData));
  if (!parsed.success) return fail(firstError(parsed.error));

  const id = formData.get("id");
  const repeat = repeatSchema.parse(formData.get("repeat") || undefined);
  const error =
    typeof id === "string" && id
      ? await data.updateTransaction(ctx.ledgerId, id, parsed.data)
      : repeat
        ? // The first entry appears when the page reloads, like every later one.
          await data.createRecurring(ctx.ledgerId, ctx.userId, { ...parsed.data, every: 1, unit: repeat, start: parsed.data.date, end: null })
        : await data.createTransaction(ctx.ledgerId, ctx.userId, parsed.data);
  return error ? fail(error) : done();
}

// ---------- Recurring ----------

export async function saveRecurring(_: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await editorContext();
  if (isFailure(ctx)) return ctx;
  const parsed = recurringSchema.safeParse(fields(formData));
  if (!parsed.success) return fail(firstError(parsed.error));

  const id = formData.get("id");
  const error =
    typeof id === "string" && id
      ? await data.updateRecurring(ctx.ledgerId, id, parsed.data)
      : await data.createRecurring(ctx.ledgerId, ctx.userId, parsed.data);
  return error ? fail(error) : done();
}

export async function removeRecurring(id: string): Promise<ActionState> {
  if (!isId(id)) return fail(BAD_ID);
  const ctx = await editorContext();
  if (isFailure(ctx)) return ctx;
  await data.deleteRecurring(ctx.ledgerId, id);
  return done();
}

export async function pauseRecurring(id: string, paused: boolean): Promise<ActionState> {
  if (!isId(id) || typeof paused !== "boolean") return fail(BAD_ID);
  const ctx = await editorContext();
  if (isFailure(ctx)) return ctx;
  const error = await data.setRecurringPaused(ctx.ledgerId, id, paused, await getToday());
  return error ? fail(error) : done();
}

export async function removeTransaction(id: string): Promise<ActionState> {
  if (!isId(id)) return fail(BAD_ID);
  const ctx = await editorContext();
  if (isFailure(ctx)) return ctx;
  await data.deleteTransaction(ctx.ledgerId, id);
  return done();
}

// ---------- Categories ----------

export async function saveCategory(_: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await editorContext();
  if (isFailure(ctx)) return ctx;
  const parsed = categorySchema.safeParse(fields(formData));
  if (!parsed.success) return fail(firstError(parsed.error));

  const id = formData.get("id");
  let error: string | null;
  if (typeof id === "string" && id) {
    error = await data.updateCategory(ctx.ledgerId, id, parsed.data);
  } else {
    const type = formData.get("type") === "income" ? "income" : "expense";
    const parentId = formData.get("parentId");
    error = await data.createCategory(ctx.ledgerId, {
      ...parsed.data,
      type,
      parentId: typeof parentId === "string" && parentId ? parentId : null,
    });
  }
  return error ? fail(error) : done();
}

export async function removeCategory(id: string): Promise<ActionState> {
  if (!isId(id)) return fail(BAD_ID);
  const ctx = await editorContext();
  if (isFailure(ctx)) return ctx;
  const error = await data.archiveCategory(ctx.ledgerId, id);
  return error ? fail(error) : done();
}

// ---------- Budgets ----------

export async function saveBudget(_: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await editorContext();
  if (isFailure(ctx)) return ctx;
  const categoryId = String(formData.get("categoryId") ?? "");
  const raw = String(formData.get("amount") ?? "").trim();
  let cents: number | null = null;
  if (raw) {
    cents = parseAmount(raw);
    if (cents === null) return fail("Enter a budget greater than 0, or leave it empty to remove it.");
  }
  // Only the current month can change; past months keep the budgets they had.
  const month = startOf(await getToday(), "month");
  const error = await data.setBudget(ctx.ledgerId, categoryId, cents, month);
  return error ? fail(error) : done();
}

// ---------- Settings ----------

export async function saveSettings(_: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await editorContext();
  if (isFailure(ctx)) return ctx;
  const currency = formData.get("currency");
  if (!isCurrency(currency)) return fail("Pick a supported currency.");
  await data.updateSettings(ctx.ledgerId, { currency });
  return done();
}

// ---------- Household ----------

const inviteSchema = z.object({
  email: z.string().trim().pipe(z.email("Enter a valid email address.")),
  role: z.enum(["editor", "viewer"]),
});
const roleSchema = z.enum(["editor", "viewer"]);
const responseSchema = z.enum(["merge", "replace", "decline"]);

export async function sendInvite(_: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await ownerContext();
  if (isFailure(ctx)) return ctx;
  const parsed = inviteSchema.safeParse(fields(formData));
  if (!parsed.success) return fail(firstError(parsed.error));
  const error = await household.createInvite(ctx, parsed.data.email, parsed.data.role);
  return error ? fail(error) : done();
}

export async function cancelInviteAction(inviteId: string): Promise<ActionState> {
  if (!isId(inviteId)) return fail(BAD_ID);
  const ctx = await ownerContext();
  if (isFailure(ctx)) return ctx;
  await household.cancelInvite(ctx, inviteId);
  return done();
}

export async function changeMemberRole(memberId: string, role: "editor" | "viewer"): Promise<ActionState> {
  if (!isId(memberId)) return fail(BAD_ID);
  const ctx = await ownerContext();
  if (isFailure(ctx)) return ctx;
  const parsed = roleSchema.safeParse(role);
  if (!parsed.success) return fail("Pick a valid role.");
  const error = await household.setMemberRole(ctx, memberId, parsed.data);
  return error ? fail(error) : done();
}

export async function removeMemberAction(memberId: string): Promise<ActionState> {
  if (!isId(memberId)) return fail(BAD_ID);
  const ctx = await ownerContext();
  if (isFailure(ctx)) return ctx;
  const error = await household.removeMember(ctx, memberId);
  return error ? fail(error) : done();
}

export async function transferOwnershipAction(memberId: string): Promise<ActionState> {
  if (!isId(memberId)) return fail(BAD_ID);
  const ctx = await ownerContext();
  if (isFailure(ctx)) return ctx;
  const error = await household.transferOwnership(ctx, memberId);
  return error ? fail(error) : done();
}

export async function leaveHouseholdAction(): Promise<ActionState> {
  const ctx = await getLedgerContext();
  if (!ctx) return fail("Your session expired. Sign in again.");
  const error = await household.leaveHousehold(ctx);
  return error ? fail(error) : done();
}

export async function respondToInvite(
  inviteId: string,
  response: "merge" | "replace" | "decline",
): Promise<ActionState> {
  if (!isId(inviteId)) return fail(BAD_ID);
  const parsed = responseSchema.safeParse(response);
  if (!parsed.success) return fail("Choose what to do with this invitation.");
  const session = await getSession();
  const ctx = session ? await getLedgerContext() : null;
  if (!session || !ctx) return fail("Your session expired. Sign in again.");
  if (parsed.data === "decline") {
    await household.declineInvite(session.user.email, inviteId);
    return done();
  }
  const error = await household.acceptInvite(ctx, session.user.email, inviteId, parsed.data);
  return error ? fail(error) : done();
}

// ---------- AI overview ----------

/** The free Gemini tier allows few requests a day, so a ledger can ask at most this often. */
const INSIGHT_COOLDOWN_MS = 10 * 60_000;

export type InsightState = { ok: boolean; error?: string; insight?: data.Insight };

/** Any member, viewers included, may ask: it only reads the ledger. */
export async function generateInsight(): Promise<InsightState> {
  const ctx = await getLedgerContext();
  if (!ctx) return { ok: false, error: "Your session expired. Sign in again." };
  if (!geminiEnabled()) return { ok: false, error: "The AI overview isn't set up." };

  const previous = await data.getInsight(ctx.ledgerId);
  const wait = previous ? Date.parse(previous.createdAt) + INSIGHT_COOLDOWN_MS - Date.now() : 0;
  if (wait > 0) {
    const minutes = Math.ceil(wait / 60_000);
    return { ok: false, error: `The overview was just updated. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` };
  }

  try {
    const [today, settings] = await Promise.all([getToday(), data.getSettings(ctx.ledgerId)]);
    const overview = await generateOverview(ctx.ledgerId, today, settings.currency);
    return { ok: true, insight: await data.saveInsight(ctx.ledgerId, overview) };
  } catch (error) {
    if (error instanceof GeminiError) return { ok: false, error: error.message };
    throw error;
  }
}
