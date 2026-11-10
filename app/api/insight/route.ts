import { getLedgerContext, getToday } from "@/lib/session";
import { claimInsight, getSettings, retryInsightAt, saveInsight, type Insight } from "@/lib/data";
import { GeminiError, generateOverview, geminiEnabled } from "@/lib/gemini";

// A route handler rather than a Server Action so it can run in its own region: the Gemini API refuses
// requests from Hong Kong, where the rest of the app runs. vercel.json pins this file to sin1.

/** The free Gemini tier allows few requests a day, so a ledger can ask at most this often. */
const INSIGHT_COOLDOWN_MS = 10 * 60_000;
/** A failed attempt may be retried sooner, but still not at once. */
const RETRY_AFTER_FAILURE_MS = 60_000;

export type InsightState = { ok: boolean; error?: string; insight?: Insight };

const reply = (state: InsightState, status = 200) => Response.json(state, { status });

/** Browsers send Origin on every POST, so a request without one, or with one that isn't ours, is refused. */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false; // "null", from a sandboxed frame or a redirect
  }
}

/** Any member, viewers included, may ask: it only reads the ledger. */
export async function POST(request: Request) {
  // Server Actions check this themselves; a route handler must, or another site could spend the quota.
  if (!sameOrigin(request)) return reply({ ok: false, error: "Forbidden" }, 403);

  const ctx = await getLedgerContext();
  if (!ctx) return reply({ ok: false, error: "Your session expired. Sign in again." }, 401);
  if (!geminiEnabled()) return reply({ ok: false, error: "The AI overview isn't set up." });

  const wait = await claimInsight(ctx.ledgerId, INSIGHT_COOLDOWN_MS);
  if (wait > 0) {
    const minutes = Math.ceil(wait / 60_000);
    return reply({ ok: false, error: `The overview was just requested. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` });
  }

  try {
    const [today, settings] = await Promise.all([getToday(), getSettings(ctx.ledgerId)]);
    const overview = await generateOverview(ctx.ledgerId, today, settings.currency);
    return reply({ ok: true, insight: await saveInsight(ctx.ledgerId, overview) });
  } catch (error) {
    await retryInsightAt(ctx.ledgerId, new Date(Date.now() + RETRY_AFTER_FAILURE_MS), INSIGHT_COOLDOWN_MS).catch(() => {});
    if (error instanceof GeminiError) return reply({ ok: false, error: error.message });
    throw error;
  }
}
