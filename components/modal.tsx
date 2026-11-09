"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

/** Native <dialog>: focus trap, Escape to close, and inert background for free. */
export function Modal({ open, onClose, title, children }: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // Unique per dialog: several can be on a page, and a shared id would name them all after the first.
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    // A dialog inherits text styles from where it is rendered, like a KPI value's large bold
    // truncated text, so it resets them. Only the body scrolls, so the title and close button stay
    // put and the scrollbar sits inside the rounded box instead of along its edge.
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-labelledby={titleId}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-hidden rounded-2xl border border-line bg-surface-strong p-0 text-left text-base font-normal tracking-normal whitespace-normal normal-nums text-fg shadow-2xl backdrop:bg-transparent open:flex open:flex-col"
    >
      {/* The inset for the scrollbar is padding on this wrapper, not the dialog, so a click there isn't read as a backdrop click. */}
      <div className="flex min-h-0 flex-1 flex-col pr-1.5 pb-1.5">
        <div className="flex shrink-0 items-center justify-between gap-4 pt-5 pr-3.5 pb-4 pl-5">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          <button type="button" className="icon-btn -mr-2" aria-label="Close" onClick={onClose}>
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-3.5 pb-3.5 pl-5 [scrollbar-color:var(--border-strong)_transparent] [scrollbar-width:thin]">
          {open && children}
        </div>
      </div>
    </dialog>
  );
}
