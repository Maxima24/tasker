"use client";

import * as React from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Keeps keyboard focus inside an open overlay and hands it back when the overlay
 * closes — the half of `aria-modal` that the attribute alone doesn't provide.
 *
 * Attach the returned ref to the panel (give it `tabIndex={-1}` so it can hold
 * focus when it contains no controls of its own). While `active`, focus moves to
 * the first control inside, Tab and Shift+Tab wrap at the edges instead of
 * escaping to the page behind, and Escape calls `onEscape`. On close, focus
 * returns to whatever was focused before — so dismissing a dialog puts the user
 * back on the control that opened it rather than at the top of the document.
 */
export function useFocusTrap<T extends HTMLElement>(
  active: boolean,
  onEscape?: () => void,
) {
  const ref = React.useRef<T>(null);
  // Held in a ref so an inline arrow from the caller can't re-run the effect on
  // every render (which would yank focus back to the first control mid-typing).
  const escapeRef = React.useRef(onEscape);
  React.useEffect(() => {
    escapeRef.current = onEscape;
  });

  React.useEffect(() => {
    if (!active) return;
    const container = ref.current;
    if (!container) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // getClientRects() rather than offsetParent — the latter is null for the
    // position: fixed panels these overlays are built from.
    const focusable = () =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.getClientRects().length > 0,
      );

    (focusable()[0] ?? container).focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        escapeRef.current?.();
        return;
      }
      if (e.key !== "Tab" || !container) return;
      const items = focusable();
      if (items.length === 0) {
        e.preventDefault();
        container.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === container)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [active]);

  return ref;
}
