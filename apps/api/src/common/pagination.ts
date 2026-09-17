/**
 * One pagination shape for every list in the system.
 *
 * Tables that can only grow - the audit log, a tasker's submissions, the
 * accounts pool - must not silently truncate or silently fetch everything.
 * Both are how a console gets slow six months in without anyone noticing.
 */
export interface Page {
  page: number;
  limit: number;
}

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;

export function parsePage(pageRaw?: string, limitRaw?: string): Page {
  const page = Math.max(1, Number.parseInt(pageRaw ?? '1', 10) || 1);
  const requested = Number.parseInt(limitRaw ?? '', 10) || DEFAULT_LIMIT;
  const limit = Math.min(Math.max(1, requested), MAX_LIMIT);
  return { page, limit };
}

/** Spread into a Prisma findMany. */
export function paginate(page?: Page): { skip?: number; take?: number } {
  if (!page) return {};
  return { skip: (page.page - 1) * page.limit, take: page.limit };
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  pageCount: number;
}

export function pageResult<T>(items: T[], total: number, page: Page): Paged<T> {
  return {
    items,
    total,
    page: page.page,
    limit: page.limit,
    pageCount: Math.max(1, Math.ceil(total / page.limit)),
  };
}
