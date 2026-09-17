"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFocusTrap } from "@/lib/use-focus-trap";

/** A minimal accessible modal dialog: Esc + backdrop to close, focus trapped
 *  while open and restored to the opener on close. */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  const panelRef = useFocusTrap<HTMLDivElement>(open, onClose);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="absolute inset-0 bg-ink-900/40" onClick={onClose} />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          "relative z-10 flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-lg border border-ink-300 bg-white shadow-xl outline-none",
          className,
        )}
      >
        <div className="flex items-start justify-between border-b border-ink-100 px-5 py-4">
          <div>
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
        {children && <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>}
        {footer && (
          <div className="flex flex-col gap-2 border-t border-ink-100 px-5 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
