"use client";

import { useEffect, useEffectEvent, useState, type RefObject } from "react";

// Phones get a bottom sheet (styled in globals.css); wider screens anchor the popover to its trigger.
const SHEET_QUERY = "(max-width: 639px)";
const GAP = 6;
const EDGE = 8;

function place(anchor: HTMLElement, popover: HTMLElement) {
  const style = popover.style;
  if (matchMedia(SHEET_QUERY).matches) {
    for (const p of ["top", "bottom", "left", "right", "min-width", "max-height"]) style.removeProperty(p);
    return;
  }

  // Anchors by the near edges. Opens below when the content fits there (or nowhere fits better).
  // Properties are overwritten rather than cleared first: clearing max-height would reset the list's scroll.
  const r = anchor.getBoundingClientRect();
  const below = innerHeight - r.bottom - GAP - EDGE;
  const above = r.top - GAP - EDGE;
  const need = popover.scrollHeight;
  const down = below >= need || (above < need && below >= above);
  style.top = down ? `${r.bottom + GAP}px` : "auto";
  style.bottom = down ? "auto" : `${innerHeight - r.top + GAP}px`;
  style.maxHeight = `${down ? below : above}px`;
  const leftAligned = r.left + r.width / 2 <= innerWidth / 2;
  style.left = leftAligned ? `${Math.max(EDGE, r.left)}px` : "auto";
  style.right = leftAligned ? "auto" : `${Math.max(EDGE, innerWidth - r.right)}px`;
  style.minWidth = `${r.width}px`;
}

/** Positions a `popover="auto"` element next to `anchor` while it's open, and reports open state. */
export function usePopover(anchor: RefObject<HTMLElement | null>, popover: RefObject<HTMLElement | null>, onOpenChange?: (open: boolean) => void) {
  const [open, setOpen] = useState(false);
  const changed = useEffectEvent((next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  });

  useEffect(() => {
    const pop = popover.current;
    if (!pop) return;
    const reposition = () => anchor.current && place(anchor.current, pop);
    // Scrolling the list itself doesn't move the anchor.
    const onScroll = (e: Event) => !pop.contains(e.target as Node) && reposition();
    // Measures content as it renders, before paint; scrollHeight is 0 until the popover shows.
    const resized = new ResizeObserver(reposition);
    const stop = () => {
      resized.disconnect();
      removeEventListener("resize", reposition);
      removeEventListener("scroll", onScroll, true);
    };
    const onBeforeToggle = (e: Event) => {
      const next = (e as ToggleEvent).newState === "open";
      if (next) {
        reposition();
        resized.observe(pop);
        addEventListener("resize", reposition);
        // Capture catches scrolling inside dialogs and other scroll containers too.
        addEventListener("scroll", onScroll, true);
      } else {
        stop();
      }
      changed(next);
    };
    pop.addEventListener("beforetoggle", onBeforeToggle);
    return () => {
      pop.removeEventListener("beforetoggle", onBeforeToggle);
      stop();
    };
  }, [anchor, popover]);

  return open;
}

/**
 * Carries a custom control's value into its form. Unlike a hidden input it takes part in
 * validation, so `required` blocks submit; the control then shows `message` instead of a bubble.
 */
export function FormValue({ name, value, required, disabled, onInvalid }: {
  name?: string;
  value: string;
  required?: boolean;
  disabled?: boolean;
  onInvalid: () => void;
}) {
  if (!name && !required) return null;
  return (
    <input
      tabIndex={-1}
      aria-hidden
      name={name}
      value={value}
      required={required}
      disabled={disabled}
      onChange={() => {}}
      onInvalid={(e) => {
        e.preventDefault();
        onInvalid();
      }}
      className="sr-only"
    />
  );
}

/** Restores an uncontrolled control's default when its form resets (React resets forms after an action). */
export function useFormReset(ref: RefObject<HTMLElement | null>, reset: () => void) {
  const onReset = useEffectEvent(reset);
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const handler = () => onReset();
    form.addEventListener("reset", handler);
    return () => form.removeEventListener("reset", handler);
  }, [ref]);
}
