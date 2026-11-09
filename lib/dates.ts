// Calendar dates are "YYYY-MM-DD" strings, stored in MongoDB as UTC midnight.
// All math here is done in UTC so the server's own timezone never matters.

export type Granularity = "day" | "week" | "month" | "year";
export type Preset = "today" | "week" | "month" | "year" | "last" | "custom";

export const GRANULARITIES: Granularity[] = ["day", "week", "month", "year"];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  return toIso(toUtc(value)) === value;
}

export function toUtc(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function todayIn(timeZone: string): string {
  try {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
  } catch {
    return toIso(new Date());
  }
}

export function addDays(iso: string, days: number): string {
  const d = toUtc(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toIso(d);
}

export function addMonths(iso: string, months: number): string {
  const d = toUtc(iso);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return toIso(d);
}

/** Start of the bucket containing `iso`. Weeks start on Monday. */
export function startOf(iso: string, unit: Granularity): string {
  const d = toUtc(iso);
  switch (unit) {
    case "day":
      return iso;
    case "week": {
      const offset = (d.getUTCDay() + 6) % 7;
      return addDays(iso, -offset);
    }
    case "month":
      return iso.slice(0, 8) + "01";
    case "year":
      return iso.slice(0, 5) + "01-01";
  }
}

export function endOf(iso: string, unit: Granularity): string {
  return addDays(next(startOf(iso, unit), unit), -1);
}

/** Start of the following bucket. */
export function next(bucketStart: string, unit: Granularity, count = 1): string {
  switch (unit) {
    case "day":
      return addDays(bucketStart, count);
    case "week":
      return addDays(bucketStart, 7 * count);
    case "month":
      return addMonths(bucketStart, count);
    case "year":
      return addMonths(bucketStart, 12 * count);
  }
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000) + 1;
}

/** Bucket start dates covering [from, to]. */
export function buckets(from: string, to: string, unit: Granularity): string[] {
  const out: string[] = [];
  for (let cur = startOf(from, unit); cur <= to; cur = next(cur, unit)) out.push(cur);
  return out;
}

const MAX_BUCKETS = 400;

function autoGranularity(days: number): Granularity {
  if (days <= 31) return "day";
  if (days <= 26 * 7) return "week";
  if (days <= 3 * 366) return "month";
  return "year";
}

/** Coarsen until the chart has a sane number of bars. */
function fitGranularity(from: string, to: string, unit: Granularity): Granularity {
  let i = GRANULARITIES.indexOf(unit);
  while (i < GRANULARITIES.length - 1 && buckets(from, to, GRANULARITIES[i]).length > MAX_BUCKETS) i++;
  return GRANULARITIES[i];
}

export type RangeParams = {
  preset?: string;
  n?: string;
  unit?: string;
  offset?: string;
  from?: string;
  to?: string;
  group?: string;
};

export type Range = {
  preset: Preset;
  n: number;
  unit: Granularity;
  offset: number;
  from: string;
  to: string;
  group: Granularity;
  /** True when the requested grouping was too fine and had to be coarsened. */
  groupAdjusted: boolean;
  days: number;
  label: string;
};

const PRESETS: Preset[] = ["today", "week", "month", "year", "last", "custom"];

function asGranularity(value: unknown): Granularity | undefined {
  return GRANULARITIES.includes(value as Granularity) ? (value as Granularity) : undefined;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Resolve URL params into a concrete date range and grouping.
 *  - today | week | month | year: the current period, shifted by `offset` periods
 *  - last: the last `n` days/weeks/months/years, ending today
 *  - custom: any `from`..`to`
 * `group` overrides the automatic bar size.
 */
export function resolveRange(params: RangeParams, today: string): Range {
  const preset = PRESETS.includes(params.preset as Preset) ? (params.preset as Preset) : "month";
  const unit = asGranularity(params.unit) ?? "day";
  const n = clampInt(params.n, 30, 1, 1000);
  const offset = clampInt(params.offset, 0, -1000, 0);

  let from: string;
  let to: string;

  switch (preset) {
    case "today":
      from = to = addDays(today, offset);
      break;
    case "week":
    case "month":
    case "year": {
      const start = next(startOf(today, preset), preset, offset);
      from = start;
      to = addDays(next(start, preset), -1);
      break;
    }
    case "last":
      to = today;
      from = unit === "day" ? addDays(today, -(n - 1)) : next(startOf(today, unit), unit, -(n - 1));
      break;
    case "custom": {
      const a = isIsoDate(params.from) ? params.from : startOf(today, "month");
      const b = isIsoDate(params.to) ? params.to : today;
      [from, to] = a <= b ? [a, b] : [b, a];
      break;
    }
  }

  const days = daysBetween(from, to);
  const requested =
    asGranularity(params.group) ?? (preset === "last" && unit !== "day" ? unit : autoGranularity(days));
  const group = fitGranularity(from, to, requested);

  return {
    preset,
    n,
    unit,
    offset,
    from,
    to,
    group,
    groupAdjusted: group !== requested,
    days,
    label: describeRange(preset, from, to, n, unit),
  };
}

/**
 * The period to compare `range` with: the one before it, of the same kind. While `range` is still
 * running, both cover only its days so far, so half a month isn't compared with a whole one.
 * Returns the current and previous spans and a short label for the previous one.
 */
export function comparison(range: Pick<Range, "preset" | "from" | "to">, today: string): {
  current: { from: string; to: string };
  previous: { from: string; to: string };
  label: string;
} | null {
  const { preset, from, to } = range;
  if (from > today) return null;
  let prevFrom: string;
  let prevTo: string;
  if (preset === "week" || preset === "month" || preset === "year") {
    prevFrom = next(from, preset, -1);
    prevTo = addDays(from, -1);
  } else {
    const days = daysBetween(from, to);
    prevFrom = addDays(from, -days);
    prevTo = addDays(from, -1);
  }
  const partial = to > today;
  const end = partial ? today : to;
  if (partial) {
    const cut = addDays(prevFrom, daysBetween(from, end) - 1);
    if (cut < prevTo) prevTo = cut;
  }
  const label = !partial && preset === "month"
    ? formatDate(prevFrom, { month: "short" })
    : !partial && preset === "year"
      ? prevFrom.slice(0, 4)
      : shortRange(prevFrom, prevTo);
  return { current: { from, to: end }, previous: { from: prevFrom, to: prevTo }, label };
}

/** "Oct 1–9", "Oct 27 – Nov 2" or, across years, the full range: short enough for a one-line note. */
function shortRange(from: string, to: string): string {
  if (from === to) return formatDate(from, { month: "short", day: "numeric" });
  if (from.slice(0, 7) === to.slice(0, 7)) return `${formatDate(from, { month: "short", day: "numeric" })}–${Number(to.slice(8))}`;
  if (from.slice(0, 4) === to.slice(0, 4)) return `${formatDate(from, { month: "short", day: "numeric" })} – ${formatDate(to, { month: "short", day: "numeric" })}`;
  return formatRange(from, to);
}

const UNIT_LABEL: Record<Granularity, string> = { day: "day", week: "week", month: "month", year: "year" };

function describeRange(preset: Preset, from: string, to: string, n: number, unit: Granularity): string {
  if (preset === "last") return `Last ${n} ${UNIT_LABEL[unit]}${n === 1 ? "" : "s"}`;
  if (preset === "today") return formatDate(from, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  if (preset === "month") return formatDate(from, { month: "long", year: "numeric" });
  if (preset === "year") return from.slice(0, 4);
  return formatRange(from, to);
}

export function formatDate(iso: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(toUtc(iso));
}

export function formatRange(from: string, to: string): string {
  if (from === to) return formatDate(from, { month: "short", day: "numeric", year: "numeric" });
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  const start = formatDate(from, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
  return `${start} – ${formatDate(to, { month: "short", day: "numeric", year: "numeric" })}`;
}

/** Short axis label for a bucket. */
export function bucketLabel(bucketStart: string, unit: Granularity): string {
  switch (unit) {
    case "day":
      return formatDate(bucketStart, { month: "short", day: "numeric" });
    case "week":
      return formatDate(bucketStart, { month: "short", day: "numeric" });
    case "month":
      return formatDate(bucketStart, { month: "short", year: "2-digit" });
    case "year":
      return bucketStart.slice(0, 4);
  }
}

/** Long tooltip label for a bucket. */
export function bucketTitle(bucketStart: string, unit: Granularity): string {
  switch (unit) {
    case "day":
      return formatDate(bucketStart, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
    case "week":
      return `Week of ${formatRange(bucketStart, addDays(bucketStart, 6))}`;
    case "month":
      return formatDate(bucketStart, { month: "long", year: "numeric" });
    case "year":
      return bucketStart.slice(0, 4);
  }
}
