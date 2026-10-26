"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, LoaderCircle } from "lucide-react";
import type { Granularity, Preset, Range } from "@/lib/dates";
import { setDashboardHref } from "./dashboard-href";
import { DatePicker } from "./date-picker";
import { Select } from "./select";

const PRESETS: { value: Preset; label: string }[] = [
  { value: "today", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
  { value: "last", label: "Last N" },
  { value: "custom", label: "Custom" },
];

const UNITS: { value: Granularity; label: string }[] = [
  { value: "day", label: "days" },
  { value: "week", label: "weeks" },
  { value: "month", label: "months" },
  { value: "year", label: "years" },
];

const GROUPS: { value: "" | Granularity; label: string }[] = [
  { value: "", label: "Auto" },
  { value: "day", label: "Daily" },
  { value: "week", label: "Weekly" },
  { value: "month", label: "Monthly" },
  { value: "year", label: "Yearly" },
];

type Params = Record<string, string | number | undefined>;

export function RangePicker({ range, groupParam, today }: { range: Range; groupParam?: string; today: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [preset, setPreset] = useState<Preset>(range.preset);
  const [n, setN] = useState(String(range.n));
  const [unit, setUnit] = useState<Granularity>(range.unit);
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);

  function hrefFor(params: Params) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries({ group: groupParam, ...params })) {
      if (v !== undefined && v !== "") qs.set(k, String(v));
    }
    return `/dashboard?${qs}`;
  }

  function go(params: Params) {
    start(() => router.push(hrefFor(params), { scroll: false }));
  }

  const current: Params =
    range.preset === "last"
      ? { preset: "last", n: range.n, unit: range.unit }
      : range.preset === "custom"
        ? { preset: "custom", from: range.from, to: range.to }
        : { preset: range.preset, offset: range.offset || undefined };

  const currentHref = hrefFor(current);
  useEffect(() => setDashboardHref(currentHref), [currentHref]);

  function pickPreset(p: Preset) {
    setPreset(p);
    if (p !== "last" && p !== "custom") go({ preset: p });
  }

  const steppable = preset === range.preset && ["today", "week", "month", "year"].includes(range.preset);

  return (
    <div className="glass flex flex-col gap-3 rounded-2xl p-3 sm:p-4">
      {/* Phones get two side-by-side dropdowns; six segmented buttons don't fit one row there. */}
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <div className="flex flex-col gap-1 sm:hidden">
          <label htmlFor="rp-range" className="text-xs text-muted">
            Range
          </label>
          <Select id="rp-range" options={PRESETS} value={preset} onChange={pickPreset} size="sm" />
        </div>

        <div role="group" aria-label="Time range" className="hidden flex-wrap gap-1 rounded-lg bg-sunken p-1 sm:flex">
          {PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              aria-pressed={preset === p.value}
              onClick={() => pickPreset(p.value)}
              className={`h-9 cursor-pointer rounded-md px-3 text-sm font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-ring ${
                preset === p.value ? "bg-surface-strong text-fg shadow-sm" : "text-muted hover:text-fg"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-1 sm:ml-auto sm:flex-row sm:items-center sm:gap-2">
          <label htmlFor="rp-group" className="text-xs text-muted sm:text-sm">
            Group by
          </label>
          <Select
            id="rp-group"
            options={GROUPS}
            value={(groupParam ?? "") as "" | Granularity}
            onChange={(group) => go({ ...current, group: group || undefined })}
            size="sm"
          />
        </div>
      </div>

      {preset === "last" && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            go({ preset: "last", n, unit });
          }}
        >
          <span className="pb-3 text-sm text-muted sm:pb-2.5">Last</span>
          <input
            aria-label="Number of periods"
            type="number"
            min={1}
            max={1000}
            required
            value={n}
            onChange={(e) => setN(e.target.value)}
            className="field tabular h-11 w-20 text-sm sm:h-9"
          />
          <Select aria-label="Period" options={UNITS} value={unit} onChange={setUnit} size="sm" />
          <button type="submit" className="btn btn-primary h-11 sm:h-9">
            Apply
          </button>
        </form>
      )}

      {preset === "custom" && (
        <form
          className="grid grid-cols-2 items-end gap-2 sm:flex sm:flex-wrap"
          onSubmit={(e) => {
            e.preventDefault();
            go({ preset: "custom", from, to });
          }}
        >
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor="rp-from" className="text-xs text-muted sm:text-sm">
              From
            </label>
            <DatePicker id="rp-from" required value={from} max={to} onChange={setFrom} size="sm" />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor="rp-to" className="text-xs text-muted sm:text-sm">
              To
            </label>
            <DatePicker id="rp-to" required value={to} min={from} max={today} onChange={setTo} size="sm" />
          </div>
          <button type="submit" className="btn btn-primary col-span-2 h-11 sm:h-9">
            Apply
          </button>
        </form>
      )}

      {/* On phones the period stretches between the arrows. */}
      <div className="flex items-center gap-2">
        {steppable && (
          <button
            type="button"
            className="icon-btn size-11 shrink-0 border border-line-strong sm:size-9 sm:border-0"
            aria-label="Previous period"
            onClick={() => go({ preset: range.preset, offset: range.offset - 1 })}
          >
            <ChevronLeft className="size-5" aria-hidden />
          </button>
        )}
        <p
          className={`text-sm font-medium sm:flex-none sm:text-left ${steppable ? "flex-1 text-center" : ""}`}
          aria-live="polite"
        >
          {range.label}
          <span className="ml-2 font-normal text-subtle">
            {range.days} day{range.days === 1 ? "" : "s"}
            {range.groupAdjusted && " · grouping widened to fit"}
          </span>
          {pending && <LoaderCircle className="ml-2 inline size-4 animate-spin align-[-0.125em] text-subtle" aria-label="Loading" />}
        </p>
        {steppable && (
          <button
            type="button"
            className="icon-btn size-11 shrink-0 border border-line-strong disabled:opacity-40 sm:size-9 sm:border-0"
            aria-label="Next period"
            disabled={range.offset >= 0}
            onClick={() => go({ preset: range.preset, offset: range.offset + 1 || undefined })}
          >
            <ChevronRight className="size-5" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}
