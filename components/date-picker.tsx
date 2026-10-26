"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, addMonths, formatDate, startOf, todayIn } from "@/lib/dates";
import { FormValue, useFormReset, usePopover } from "./popover";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function clamp(iso: string, min?: string, max?: string) {
  if (min && iso < min) return min;
  if (max && iso > max) return max;
  return iso;
}

function localToday() {
  return todayIn(Intl.DateTimeFormat().resolvedOptions().timeZone);
}

/**
 * Calendar date picker for "YYYY-MM-DD" values, weeks starting Monday. A dialog popover on wider
 * screens and a bottom sheet on phones; the grid follows the WAI-ARIA APG date picker keys.
 * Controlled with `value`, or uncontrolled with `defaultValue`.
 */
export function DatePicker({
  id,
  name,
  value,
  defaultValue,
  onChange,
  min,
  max,
  required,
  disabled,
  placeholder = "Pick a date",
  size = "md",
  className = "",
  "aria-label": ariaLabel,
  "aria-describedby": describedBy,
}: {
  id?: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** "sm" is compact from the sm breakpoint up, for toolbars. */
  size?: "md" | "sm";
  /** Layout classes for the wrapper (width, flex); the trigger fills it. */
  className?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
}) {
  const uid = useId();
  const triggerId = id ?? `${uid}-trigger`;
  const dialogId = `${uid}-dialog`;
  const headingId = `${uid}-heading`;
  const errorId = `${uid}-error`;

  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // Set when the focused cell should take keyboard focus after the next render.
  const moveFocus = useRef(false);
  const [inner, setInner] = useState(defaultValue ?? "");
  const [cursor, setCursor] = useState(() => value ?? defaultValue ?? "");
  const [today, setToday] = useState("");
  const [view, setView] = useState<"days" | "months">("days");
  const [invalid, setInvalid] = useState(false);

  const current = value ?? inner;

  const open = usePopover(triggerRef, dialogRef, (next) => {
    if (!next) return;
    const now = localToday();
    setToday(now);
    setCursor(clamp(current || now, min, max));
    setView("days");
    moveFocus.current = true;
  });
  useFormReset(triggerRef, () => setInner(defaultValue ?? ""));

  useEffect(() => {
    if (!open || !moveFocus.current) return;
    moveFocus.current = false;
    // A click opens the popover after this render's microtask, so focus waits until it shows.
    const frame = requestAnimationFrame(() => bodyRef.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, cursor, view]);

  function choose(iso: string) {
    if (value === undefined) setInner(iso);
    setInvalid(false);
    if (iso !== current) onChange?.(iso);
    dialogRef.current?.hidePopover();
    triggerRef.current?.focus();
  }

  function focusCursor(iso: string) {
    moveFocus.current = true;
    setCursor(clamp(iso, min, max));
  }

  const inRange = (iso: string) => (!min || iso >= min) && (!max || iso <= max);
  // A month is pickable when clamping its first day into min/max stays in that month.
  const monthInRange = (first: string) => clamp(first, min, max).slice(0, 7) === first.slice(0, 7);

  function onDayKey(e: KeyboardEvent) {
    const steps: Record<string, () => string> = {
      ArrowLeft: () => addDays(cursor, -1),
      ArrowRight: () => addDays(cursor, 1),
      ArrowUp: () => addDays(cursor, -7),
      ArrowDown: () => addDays(cursor, 7),
      Home: () => startOf(cursor, "week"),
      End: () => addDays(startOf(cursor, "week"), 6),
      PageUp: () => addMonths(cursor, e.shiftKey ? -12 : -1),
      PageDown: () => addMonths(cursor, e.shiftKey ? 12 : 1),
    };
    if (!steps[e.key]) return;
    e.preventDefault();
    focusCursor(steps[e.key]());
  }

  function onMonthKey(e: KeyboardEvent) {
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3, PageUp: -12, PageDown: 12 };
    if (!(e.key in steps)) return;
    e.preventDefault();
    focusCursor(addMonths(cursor, steps[e.key]));
  }

  const month = cursor ? startOf(cursor, "month") : "";
  const year = cursor.slice(0, 4);
  const days = month ? Array.from({ length: 42 }, (_, i) => addDays(startOf(month, "week"), i)) : [];
  const step = view === "days" ? 1 : 12;
  const prevOk = !!cursor && (!min || startOf(addMonths(month, -step), view === "days" ? "month" : "year") >= startOf(min, view === "days" ? "month" : "year"));
  const nextOk = !!cursor && (!max || startOf(addMonths(month, step), view === "days" ? "month" : "year") <= startOf(max, view === "days" ? "month" : "year"));
  const navLabel = view === "days" ? "month" : "year";

  return (
    <div className={`relative min-w-0 ${className}`}>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        role="combobox"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={dialogId}
        aria-label={ariaLabel}
        aria-describedby={[describedBy, invalid ? errorId : ""].filter(Boolean).join(" ") || undefined}
        aria-invalid={invalid || undefined}
        aria-required={required || undefined}
        disabled={disabled}
        popoverTarget={dialogId}
        onKeyDown={(e) => {
          if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !open) {
            e.preventDefault();
            dialogRef.current?.showPopover();
          }
        }}
        className={`field flex cursor-pointer items-center gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60 aria-expanded:border-ring aria-invalid:border-danger ${
          size === "sm" ? "px-2 text-sm sm:h-9 sm:px-3" : ""
        }`}
      >
        <CalendarDays className="size-4 shrink-0 text-muted" aria-hidden />
        <span className={`tabular min-w-0 flex-1 truncate ${current ? "" : "text-subtle"}`}>
          {current ? formatDate(current, { month: "short", day: "numeric", year: "numeric" }) : placeholder}
        </span>
      </button>

      <div
        ref={dialogRef}
        id={dialogId}
        popover="auto"
        role="dialog"
        aria-labelledby={headingId}
        className="popover sm:w-80 sm:p-3"
      >
        {open && cursor && (
          <>
            <div className="mb-2 flex items-center justify-between gap-1">
              <button
                type="button"
                className="icon-btn sm:size-9"
                aria-label={`Previous ${navLabel}`}
                disabled={!prevOk}
                onClick={() => setCursor(clamp(addMonths(cursor, -step), min, max))}
              >
                <ChevronLeft className="size-5" aria-hidden />
              </button>
              <button
                type="button"
                id={headingId}
                aria-label={view === "days" ? `${formatDate(month, { month: "long", year: "numeric" })}, choose month` : `${year}, back to days`}
                onClick={() => {
                  moveFocus.current = true;
                  setView(view === "days" ? "months" : "days");
                }}
                className="btn btn-ghost h-11 gap-1 border-0 px-3 sm:h-9"
              >
                {view === "days" ? formatDate(month, { month: "long", year: "numeric" }) : year}
                <ChevronDown className={`size-4 text-muted transition-transform duration-150 ${view === "months" ? "rotate-180" : ""}`} aria-hidden />
              </button>
              <button
                type="button"
                className="icon-btn sm:size-9"
                aria-label={`Next ${navLabel}`}
                disabled={!nextOk}
                onClick={() => setCursor(clamp(addMonths(cursor, step), min, max))}
              >
                <ChevronRight className="size-5" aria-hidden />
              </button>
            </div>

            <div ref={bodyRef}>
              {view === "days" ? (
                <table role="grid" aria-labelledby={headingId} className="w-full table-fixed border-collapse" onKeyDown={onDayKey}>
                  <thead>
                    <tr>
                      {WEEKDAYS.map((d) => (
                        <th key={d} scope="col" abbr={d} className="pb-1 text-center text-xs font-medium text-subtle">
                          {d.slice(0, 2)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: 6 }, (_, w) => (
                      <tr key={w}>
                        {days.slice(w * 7, w * 7 + 7).map((d) => {
                          const isSelected = d === current;
                          const isToday = d === today;
                          const outside = !d.startsWith(month.slice(0, 7));
                          return (
                            <td key={d} aria-selected={isSelected} className="p-0.5 text-center">
                              <button
                                type="button"
                                tabIndex={d === cursor ? 0 : -1}
                                disabled={!inRange(d)}
                                aria-current={isToday ? "date" : undefined}
                                aria-label={formatDate(d, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
                                onClick={() => choose(d)}
                                className={`tabular inline-flex h-11 w-full cursor-pointer items-center justify-center rounded-lg text-base transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-35 sm:h-9 sm:text-sm ${
                                  isSelected
                                    ? "bg-primary font-semibold text-on-primary hover:bg-primary-hover active:bg-primary-hover"
                                    : `hover:bg-sunken active:bg-sunken ${isToday ? "font-semibold text-primary ring-1 ring-primary/50 ring-inset" : outside ? "text-subtle" : "text-fg"}`
                                }`}
                              >
                                {Number(d.slice(8))}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div role="group" aria-label={`Months of ${year}`} className="grid grid-cols-3 gap-1" onKeyDown={onMonthKey}>
                  {MONTHS.map((m, i) => {
                    const first = `${year}-${String(i + 1).padStart(2, "0")}-01`;
                    const isCursor = month === first;
                    const isSelected = current.slice(0, 7) === first.slice(0, 7);
                    return (
                      <button
                        key={m}
                        type="button"
                        tabIndex={isCursor ? 0 : -1}
                        disabled={!monthInRange(first)}
                        aria-pressed={isSelected}
                        onClick={() => {
                          focusCursor(addMonths(cursor, i - Number(cursor.slice(5, 7)) + 1));
                          setView("days");
                        }}
                        className={`h-11 cursor-pointer rounded-lg text-sm font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-35 ${
                          isSelected ? "bg-primary text-on-primary hover:bg-primary-hover active:bg-primary-hover" : "text-fg hover:bg-sunken active:bg-sunken"
                        }`}
                      >
                        {m}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="mt-2 flex items-center justify-between gap-2 border-t border-line pt-2">
              {!required && current ? (
                <button
                  type="button"
                  className="btn btn-ghost h-11 border-0 px-3 text-muted sm:h-9"
                  onClick={() => {
                    if (value === undefined) setInner("");
                    onChange?.("");
                    dialogRef.current?.hidePopover();
                    triggerRef.current?.focus();
                  }}
                >
                  Clear
                </button>
              ) : (
                <span />
              )}
              {inRange(today) && (
                <button type="button" className="btn btn-ghost h-11 border-0 px-3 text-primary sm:h-9" onClick={() => choose(today)}>
                  Today
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <FormValue
        name={name}
        value={current}
        required={required}
        disabled={disabled}
        onInvalid={() => {
          setInvalid(true);
          triggerRef.current?.focus();
        }}
      />
      {invalid && (
        <p id={errorId} className="mt-1 text-xs text-danger">
          {placeholder}
        </p>
      )}
    </div>
  );
}
