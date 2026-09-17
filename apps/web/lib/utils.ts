import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(value?: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatDateTime(value?: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function titleCase(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Section 24 assumption 7 - all times are recorded in UTC and displayed in
 * West Africa Time. Formatting in one place means no surface can quietly
 * render a local timezone and make two people read the same row differently.
 */
const WAT = "Africa/Lagos";

export function formatWAT(value?: string | Date | null): string {
  if (!value) return "-";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("en-GB", {
    timeZone: WAT,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** "12m ago", "3h ago" - queue age is the thing a reviewer actually reads. */
export function relative(value?: string | Date | null): string {
  if (!value) return "-";
  const d = typeof value === "string" ? new Date(value) : value;
  const diff = Date.now() - d.getTime();
  const mins = Math.round(diff / 60000);
  if (Math.abs(mins) < 1) return "just now";
  if (Math.abs(mins) < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (Math.abs(hours) < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** "in 3h", "2h overdue" - a due time only matters relative to now. */
export function untilDue(value?: string | Date | null): { text: string; overdue: boolean } {
  if (!value) return { text: "No due time", overdue: false };
  const d = typeof value === "string" ? new Date(value) : value;
  const diff = d.getTime() - Date.now();
  const mins = Math.round(Math.abs(diff) / 60000);
  const text = mins < 60 ? `${mins}m` : `${Math.round(mins / 60)}h`;
  return diff < 0 ? { text: `${text} overdue`, overdue: true } : { text: `Due in ${text}`, overdue: false };
}
