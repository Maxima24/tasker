"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  pageCount: number;
}

/**
 * One pager for every table.
 *
 * It always states the range and the total, because "showing 26-50 of 312" is
 * the sentence that tells a non-technical admin the list did not stop early.
 * A bare pair of arrows leaves them guessing whether there is more.
 */
export function Pagination({
  page,
  onPage,
  label = "rows",
}: {
  page: { page: number; limit: number; total: number; pageCount: number };
  onPage: (next: number) => void;
  label?: string;
}) {
  if (page.total === 0) return null;

  const from = (page.page - 1) * page.limit + 1;
  const to = Math.min(page.page * page.limit, page.total);
  const single = page.pageCount <= 1;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-200 px-4 py-3">
      <p className="text-xs text-ink-500">
        Showing{" "}
        <span className="tabular-nums font-medium text-ink-900">
          {from}–{to}
        </span>{" "}
        of <span className="tabular-nums font-medium text-ink-900">{page.total}</span> {label}
      </p>

      {!single && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onPage(page.page - 1)}
            disabled={page.page <= 1}
            className="inline-flex items-center gap-1 rounded-lg border border-ink-200 px-2.5 py-1.5 text-sm text-ink-700 transition-colors hover:bg-ink-100 disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <ChevronLeft className="size-4" />
            <span className="hidden sm:inline">Previous</span>
          </button>
          <span className="px-2 text-xs tabular-nums text-ink-500">
            {page.page} of {page.pageCount}
          </span>
          <button
            type="button"
            onClick={() => onPage(page.page + 1)}
            disabled={page.page >= page.pageCount}
            className="inline-flex items-center gap-1 rounded-lg border border-ink-200 px-2.5 py-1.5 text-sm text-ink-700 transition-colors hover:bg-ink-100 disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <span className="hidden sm:inline">Next</span>
            <ChevronRight className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Page state that resets to 1 when the filter underneath it changes - landing
 * on page 4 of a list that now has two pages is a dead end.
 */
export function usePage(resetKey?: unknown) {
  const [page, setPage] = React.useState(1);
  React.useEffect(() => setPage(1), [resetKey]);
  return [page, setPage] as const;
}
