"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Search, Users } from "lucide-react";
import { get } from "@/lib/api";
import { keys } from "@/lib/query-keys";
import { formatDayWAT } from "@/lib/utils";
import { Pagination, usePage } from "@/components/pagination";
import type { AccessType } from "@/lib/accounts";

interface PersonRow {
  id: string;
  account: { id: string; ref: string; label: string | null; accessType: AccessType };
  taskerId: string;
  name: string;
  role: string;
  active: boolean;
  assignedAt: string;
  assignedBy: string | null;
  collectedAt: string | null;
  collectedBy: string | null;
}

type Active = "all" | "yes" | "no";

/**
 * The manager's People tab, column for column: Account ID, Account Name,
 * Person Name, Role, Currently Active?, Date Assigned - plus when an account
 * was collected back, which the sheet had no column for.
 */
export function PeopleTable() {
  const [active, setActive] = React.useState<Active>("yes");
  const [search, setSearch] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [page, setPage] = usePage(`${active}|${query}`);

  React.useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading } = useQuery<{
    items: PersonRow[];
    total: number;
    page: number;
    limit: number;
    pageCount: number;
  }>({
    queryKey: [...keys.accounts, "people", page, active, query],
    queryFn: () =>
      get(
        `accounts/people?page=${page}&limit=50${active === "all" ? "" : `&active=${active}`}${
          query ? `&q=${encodeURIComponent(query)}` : ""
        }`,
      ),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-ink-200 p-0.5" role="group" aria-label="Currently active">
          {(
            [
              ["yes", "Currently active"],
              ["no", "Collected"],
              ["all", "Everyone"],
            ] as [Active, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setActive(key)}
              aria-pressed={active === key}
              className={`rounded-md px-3 py-1.5 text-sm ${
                active === key ? "bg-ink-900 font-medium text-white" : "text-ink-600 hover:bg-ink-100"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="relative block w-full max-w-xs">
          <span className="sr-only">Search people</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by person or account"
            className="w-full rounded-lg border border-ink-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-ink-500"
          />
        </label>
      </div>

      {isLoading ? (
        <div className="h-48 animate-pulse rounded-lg bg-ink-100" />
      ) : !data?.items.length ? (
        <div className="rounded-xl border border-dashed border-ink-200 px-6 py-12 text-center">
          <Users className="mx-auto size-8 text-ink-300" />
          <p className="mt-3 font-medium text-ink-900">
            {active === "no" ? "No account has been collected back yet" : "No one is assigned to an account"}
          </p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-ink-500">
            Assign accounts from the Accounts tab, or import the Account Tracker spreadsheet.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-ink-200">
          <table className="w-full min-w-[46rem] text-left text-sm">
            <thead className="border-b border-ink-200 bg-ink-50 text-xs text-ink-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Account ID</th>
                <th className="px-4 py-2.5 font-medium">Account Name</th>
                <th className="px-4 py-2.5 font-medium">Person Name</th>
                <th className="px-4 py-2.5 font-medium">Role</th>
                <th className="px-4 py-2.5 font-medium">Currently Active?</th>
                <th className="px-4 py-2.5 font-medium">Date Assigned</th>
                <th className="px-4 py-2.5 font-medium">Collected</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {data.items.map((r) => (
                <tr key={r.id} className="hover:bg-ink-50">
                  <td className="code px-4 py-2.5 font-medium text-ink-900">{r.account.ref}</td>
                  <td className="max-w-[16rem] truncate px-4 py-2.5 text-ink-700">{r.account.label ?? "-"}</td>
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/taskers/${r.taskerId}`}
                      className="font-medium text-ink-900 underline-offset-2 hover:underline"
                    >
                      {r.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-ink-700">{r.role}</td>
                  <td className="px-4 py-2.5">
                    {r.active ? (
                      <span className="rounded-full bg-tint-green px-2 py-0.5 text-xs font-medium text-ok">Yes</span>
                    ) : (
                      <span className="rounded-full bg-tint-grey px-2 py-0.5 text-xs font-medium text-ink-600">No</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-ink-700">
                    {formatDayWAT(r.assignedAt)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-ink-500">
                    {r.collectedAt
                      ? `${formatDayWAT(r.collectedAt)}${r.collectedBy ? ` by ${r.collectedBy}` : ""}`
                      : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.pageCount > 1 && <Pagination page={data} onPage={setPage} label="people" />}
        </div>
      )}
    </div>
  );
}
