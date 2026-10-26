"use client";

import { useActionState, useState } from "react";
import { CalendarClock, ChevronDown, RefreshCw, Sparkles } from "lucide-react";
import type { InsightState } from "@/app/api/insight/route";
import type { Insight } from "@/lib/data";
import { FormError } from "./ui";

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

/** "5 minutes ago", "yesterday"…, from the viewer's clock. */
function timeAgo(iso: string): string {
  const minutes = Math.round((Date.parse(iso) - Date.now()) / 60_000);
  if (minutes > -1) return "just now";
  if (minutes > -60) return relative.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours > -24) return relative.format(hours, "hour");
  return relative.format(Math.round(hours / 24), "day");
}

/** True when the overview was written in an earlier calendar month than the viewer's today. */
function fromEarlierMonth(iso: string): boolean {
  const then = new Date(iso);
  const now = new Date();
  return then.getFullYear() * 12 + then.getMonth() < now.getFullYear() * 12 + now.getMonth();
}

/** Runs in its own region (see app/api/insight/route.ts), so it's a fetch rather than a Server Action. */
async function generateInsight(previous: InsightState): Promise<InsightState> {
  try {
    const res = await fetch("/api/insight", { method: "POST" });
    const state: InsightState = await res.json();
    // Keep the last overview on screen under the error.
    return state.ok ? state : { ...state, insight: previous.insight };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Check your connection and try again.", insight: previous.insight };
  }
}

export function InsightCard({ initial }: { initial: Insight | null }) {
  const [state, action, pending] = useActionState<InsightState>(generateInsight, { ok: true, insight: initial ?? undefined });
  // Phones show the overview alone until asked, so the numbers below stay in reach.
  const [open, setOpen] = useState(false);
  // A failed refresh keeps showing the last overview under its error.
  const insight = state.insight ?? initial;
  const stale = insight && fromEarlierMonth(insight.createdAt);

  return (
    <section aria-labelledby="insight-title" aria-busy={pending} className="glass relative min-w-0 overflow-hidden rounded-2xl">
      {/* A plum wash marks this card as AI-written, apart from the gold of the app's own numbers. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-linear-to-b from-accent-soft to-transparent" />

      <div className="relative flex flex-col gap-4 p-4 sm:p-5">
        <header className="flex items-start gap-3">
          <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Sparkles className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h2 id="insight-title" className="font-semibold">
                Monthly overview
              </h2>
              <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">AI · Gemini</span>
            </div>
            <p className="mt-0.5 text-sm text-muted">
              {insight ? (
                <span
                  suppressHydrationWarning
                  title={new Date(insight.createdAt).toLocaleString()}
                  className={stale ? "font-medium text-warning-strong" : undefined}
                >
                  {stale ? "From an earlier month, refresh for this one" : `Updated ${timeAgo(insight.createdAt)}`}
                </span>
              ) : (
                "Spending, budgets and recurring money, summed up"
              )}
            </p>
          </div>
          {insight && (
            <form action={action}>
              <button type="submit" className="btn btn-ghost h-11 px-3 sm:h-9" disabled={pending}>
                <RefreshCw className={`size-4 ${pending ? "motion-safe:animate-spin" : ""}`} aria-hidden />
                <span className="max-sm:sr-only">{pending ? "Updating…" : "Refresh"}</span>
              </button>
            </form>
          )}
        </header>

        <div aria-live="polite" className="flex flex-col gap-4">
          <FormError message={state.error} />
          {pending ? (
            <OverviewSkeleton />
          ) : insight ? (
            <div className="grid gap-4 lg:grid-cols-5 lg:gap-6">
              <div className="flex min-w-0 flex-col gap-4 lg:col-span-3">
                <p className="text-[0.9375rem] leading-relaxed text-pretty">{insight.overview}</p>
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls="insight-steps insight-next"
                  onClick={() => setOpen(!open)}
                  className="btn btn-ghost w-full justify-between lg:hidden"
                >
                  {`${open ? "Hide" : "Show"} ${insight.steps.length ? `${insight.steps.length} steps and ` : ""}next month`}
                  <ChevronDown className={`size-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`} aria-hidden />
                </button>
                {insight.steps.length > 0 && (
                  <div id="insight-steps" className={open ? "" : "max-lg:hidden"}>
                    <h3 className="mb-2 text-sm font-semibold">Recommended steps</h3>
                    <ol className="flex flex-col gap-2.5">
                      {insight.steps.map((step, i) => (
                        <li key={i} className="flex gap-3 text-sm leading-relaxed">
                          <span
                            aria-hidden
                            className="tabular mt-px flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary-hover"
                          >
                            {i + 1}
                          </span>
                          <span className="min-w-0">{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
              <aside
                id="insight-next"
                aria-labelledby="insight-next-title"
                className={`self-start rounded-xl border border-accent/15 bg-accent-soft p-4 lg:col-span-2 ${open ? "" : "max-lg:hidden"}`}
              >
                <h3 id="insight-next-title" className="flex items-center gap-2 text-sm font-semibold text-accent">
                  <CalendarClock className="size-4" aria-hidden />
                  For next month
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed">{insight.nextMonth}</p>
              </aside>
            </div>
          ) : (
            <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-line-strong p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="max-w-prose text-sm text-muted">
                Get a quick read on this month&apos;s spending, budgets, salary and recurring payments, with steps for the
                rest of the month and the next one.
              </p>
              <form action={action} className="shrink-0 max-sm:w-full">
                <button type="submit" className="btn btn-primary w-full">
                  <Sparkles className="size-4" aria-hidden />
                  Get overview
                </button>
              </form>
            </div>
          )}
        </div>

        <p className="text-xs text-subtle">
          Written by Google Gemini from your totals and category names, never your notes. It can make mistakes, so check
          the numbers below.
        </p>
      </div>
    </section>
  );
}

function OverviewSkeleton() {
  const bar = "rounded-md bg-sunken motion-safe:animate-pulse";
  return (
    <div className="grid gap-4 lg:grid-cols-5 lg:gap-6">
      <span className="sr-only">Writing your overview…</span>
      <div aria-hidden className="flex flex-col gap-2.5 lg:col-span-3">
        <div className={`h-4 w-full ${bar}`} />
        <div className={`h-4 w-11/12 ${bar}`} />
        <div className={`h-4 w-4/5 ${bar}`} />
        <div className={`mt-3 h-4 w-2/3 ${bar}`} />
        <div className={`h-4 w-3/4 ${bar}`} />
      </div>
      <div aria-hidden className={`h-24 rounded-xl max-lg:hidden lg:col-span-2 ${bar}`} />
    </div>
  );
}
