"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { FormValue, useFormReset, usePopover } from "./popover";

export type SelectOption<T extends string = string> = {
  value: T;
  /** Shown on the trigger and matched by typeahead. */
  label: string;
  /** Shown in the list instead of `label`, e.g. a subcategory without its parent's name. */
  display?: string;
  icon?: ReactNode;
  /** Indents the option under the one before it. */
  depth?: 0 | 1;
  disabled?: boolean;
};

const TYPEAHEAD_MS = 600;
const PAGE = 8;

/**
 * Select-only combobox (WAI-ARIA APG): focus stays on the trigger and arrow keys move through the
 * list via aria-activedescendant. Controlled with `value`, or uncontrolled with `defaultValue`.
 */
export function Select<T extends string>({
  id,
  name,
  options,
  value,
  defaultValue,
  onChange,
  placeholder = "Select",
  required,
  disabled,
  size = "md",
  className = "",
  "aria-label": ariaLabel,
  "aria-describedby": describedBy,
}: {
  id?: string;
  name?: string;
  options: SelectOption<T>[];
  value?: T;
  defaultValue?: T;
  onChange?: (value: T) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  /** "sm" is compact from the sm breakpoint up, for toolbars. */
  size?: "md" | "sm";
  /** Layout classes for the wrapper (width, flex); the trigger fills it. */
  className?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
}) {
  const uid = useId();
  const triggerId = id ?? `${uid}-trigger`;
  const listId = `${uid}-list`;
  const errorId = `${uid}-error`;
  const optionId = (i: number) => `${uid}-o${i}`;

  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const [inner, setInner] = useState<string>(defaultValue ?? "");
  const [active, setActive] = useState(-1);
  const [invalid, setInvalid] = useState(false);

  const current = value ?? inner;
  const selectedIndex = options.findIndex((o) => o.value === current);
  const selected = options[selectedIndex];
  const enabled = options.flatMap((o, i) => (o.disabled ? [] : [i]));

  const open = usePopover(triggerRef, listRef, (next) => {
    if (next) setActive(selected && !selected.disabled ? selectedIndex : (enabled[0] ?? -1));
  });
  useFormReset(triggerRef, () => setInner(defaultValue ?? ""));

  useEffect(() => {
    if (open && active >= 0) document.getElementById(optionId(active))?.scrollIntoView({ block: "nearest" });
    // optionId only depends on uid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active]);

  function choose(i: number) {
    const option = options[i];
    if (!option || option.disabled) return;
    if (value === undefined) setInner(option.value);
    setInvalid(false);
    if (option.value !== current) onChange?.(option.value);
    listRef.current?.hidePopover();
    triggerRef.current?.focus();
  }

  /** Moves to the enabled option `step` places from the active one, clamped to the ends. */
  function move(step: number) {
    const pos = enabled.indexOf(active);
    const next = pos === -1 ? (step > 0 ? 0 : enabled.length - 1) : Math.min(enabled.length - 1, Math.max(0, pos + step));
    setActive(enabled[next] ?? -1);
  }

  /** Finds the next option whose label starts with what was typed, cycling on a repeated letter. */
  function typeahead(key: string) {
    const now = Date.now();
    const t = typed.current;
    t.text = now - t.at > TYPEAHEAD_MS ? key : t.text + key;
    t.at = now;
    const query = t.text.toLowerCase();
    const repeat = query.length > 1 && [...query].every((c) => c === query[0]);
    const needle = repeat ? query[0] : query;
    const from = repeat || query.length === 1 ? active + 1 : Math.max(active, 0);
    const order = [...enabled.filter((i) => i >= from), ...enabled.filter((i) => i < from)];
    return order.find((i) => options[i].label.toLowerCase().startsWith(needle)) ?? -1;
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    const list = listRef.current;
    if (!list) return;
    const printable = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;

    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        list.showPopover();
      } else if (printable && e.key !== " ") {
        const match = typeahead(e.key);
        list.showPopover();
        if (match >= 0) setActive(match);
      }
      return;
    }

    const keys: Record<string, () => void> = {
      ArrowDown: () => move(1),
      ArrowUp: () => (e.altKey ? choose(active) : move(-1)),
      Home: () => setActive(enabled[0] ?? -1),
      End: () => setActive(enabled.at(-1) ?? -1),
      PageDown: () => move(PAGE),
      PageUp: () => move(-PAGE),
      Enter: () => choose(active),
      " ": () => (typed.current.text && Date.now() - typed.current.at < TYPEAHEAD_MS ? setActive(typeahead(" ")) : choose(active)),
    };
    if (keys[e.key]) {
      e.preventDefault();
      keys[e.key]();
    } else if (e.key === "Tab") {
      list.hidePopover();
    } else if (printable) {
      const match = typeahead(e.key);
      if (match >= 0) setActive(match);
    }
  }

  return (
    <div className={`relative min-w-0 ${className}`}>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        aria-label={ariaLabel}
        aria-describedby={[describedBy, invalid ? errorId : ""].filter(Boolean).join(" ") || undefined}
        aria-invalid={invalid || undefined}
        aria-required={required || undefined}
        disabled={disabled}
        popoverTarget={listId}
        onKeyDown={onKeyDown}
        className={`field flex cursor-pointer items-center gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60 aria-expanded:border-ring aria-invalid:border-danger ${
          size === "sm" ? "text-sm sm:h-9" : ""
        }`}
      >
        {selected?.icon}
        {/* Every label sits invisibly in one grid cell, so the trigger is as wide as the longest, like a native select. */}
        <span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)]">
          {[placeholder, ...options.map((o) => o.label)].map((text, i) => (
            <span key={i} aria-hidden className="invisible col-start-1 row-start-1 truncate">
              {text}
            </span>
          ))}
          <span className={`col-start-1 row-start-1 truncate ${selected ? "" : "text-subtle"}`}>
            {selected ? selected.label : placeholder}
          </span>
        </span>
        <ChevronDown
          className={`size-4 shrink-0 text-muted transition-transform duration-150 ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      <ul ref={listRef} id={listId} popover="auto" role="listbox" aria-labelledby={triggerId} tabIndex={-1} className="popover">
        {options.map((o, i) => {
          const isSelected = i === selectedIndex;
          return (
            <li
              key={o.value}
              id={optionId(i)}
              role="option"
              aria-selected={isSelected}
              aria-disabled={o.disabled || undefined}
              // Keeps focus on the trigger so the list doesn't lose its keyboard state.
              onMouseDown={(e) => e.preventDefault()}
              onMouseMove={() => !o.disabled && active !== i && setActive(i)}
              onClick={() => choose(i)}
              className={`flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-3 text-base sm:min-h-9 sm:text-sm ${
                o.depth ? "pl-8 sm:pl-8" : ""
              } ${i === active ? "bg-sunken" : ""} ${isSelected ? "font-semibold text-fg" : "text-muted"} ${
                o.disabled ? "cursor-not-allowed opacity-50" : "active:bg-sunken"
              }`}
            >
              {o.icon}
              <span className="min-w-0 flex-1 truncate">{o.display ?? o.label}</span>
              <Check className={`size-4 shrink-0 text-primary ${isSelected ? "" : "invisible"}`} aria-hidden />
            </li>
          );
        })}
      </ul>

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
