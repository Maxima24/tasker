"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFocusTrap } from "@/lib/use-focus-trap";

/**
 * A right-side slide-in panel, pinned below the top bar (`fixed right-0 top-16`). It
 * slides in on a transform (`translate-x-full → 0`) over the page's right edge — no
 * backdrop and focus is NOT trapped, so both sides stay usable (split-view feel). Stays
 * mounted through the close animation, then unmounts. Esc closes it.
 */
export function SidePanel({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = "w-[34rem]",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  width?: string;
}) {
  const [render, setRender] = React.useState(open);
  const [shown, setShown] = React.useState(false);
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;

  React.useEffect(() => {
    if (open) {
      setRender(true);
      return;
    }
    setShown(false);
    // Keep it mounted until the 300ms slide-out finishes (+20ms buffer) — unmounting early
    // clipped the closing animation.
    const t = window.setTimeout(() => setRender(false), 320);
    return () => window.clearTimeout(t);
  }, [open]);

  React.useEffect(() => {
    if (!render || !open) return;
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, [render, open]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!render) return null;

  return (
    <div
      className={cn(
        "fixed bottom-0 right-0 top-16 z-30 flex flex-col overflow-hidden border-l border-ink-300 bg-white shadow-xl transition-transform duration-300 ease-out",
        width,
        "max-w-[calc(100vw-4rem)]",
        shown ? "translate-x-0" : "translate-x-full",
      )}
      role="dialog"
      aria-label={title}
    >
        <div className="flex items-start justify-between gap-3 border-b border-ink-100 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink-900">{title}</h2>
            {description && (
              <p className="mt-0.5 truncate text-sm text-ink-500">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 text-ink-500 hover:text-ink-900"
          >
            <X className="size-5" />
          </button>
        </div>
        {children && (
          <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>
        )}
        {footer && (
          <div className="flex flex-col gap-2 border-t border-ink-100 px-5 py-4">
            {footer}
          </div>
        )}
    </div>
  );
}

/**
 * A right-anchored slide-in panel — the app's overlay recipe (fixed inset, coffee
 * backdrop, focus trap, Esc/backdrop to close) with an enter/exit transition. Stays
 * mounted through the close animation, then unmounts. No animation library needed.
 */
export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  /** Tailwind width class for the panel (default w-[30rem]). */
  width?: string;
}) {
  const panelRef = useFocusTrap<HTMLDivElement>(open, onClose);
  const [render, setRender] = React.useState(open);
  const [shown, setShown] = React.useState(false);

  // Mount immediately on open; keep mounted for the slide-out on close.
  React.useEffect(() => {
    if (open) {
      setRender(true);
      return;
    }
    setShown(false);
    const t = window.setTimeout(() => setRender(false), 220);
    return () => window.clearTimeout(t);
  }, [open]);

  // Once mounted (off-screen), flip to the shown state on the next frame so the
  // transform transition actually runs.
  React.useEffect(() => {
    if (!render || !open) return;
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, [render, open]);

  if (!render) return null;

  return (
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={cn(
          "absolute inset-0 bg-ink-900/40 transition-opacity duration-200",
          shown ? "opacity-100" : "opacity-0",
        )}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          "absolute right-0 top-0 flex h-full w-[30rem] max-w-[92vw] flex-col overflow-hidden border-l border-ink-300 bg-white shadow-xl outline-none transition-transform duration-200 ease-out",
          shown ? "translate-x-0" : "translate-x-full",
          width,
        )}
      >
        <div className="flex items-start justify-between border-b border-ink-100 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink-900">{title}</h2>
            {description && (
              <p className="mt-1 text-sm text-ink-500">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 text-ink-500 hover:text-ink-900"
          >
            <X className="size-5" />
          </button>
        </div>
        {children && (
          <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>
        )}
        {footer && (
          <div className="flex flex-col gap-2 border-t border-ink-100 px-5 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
