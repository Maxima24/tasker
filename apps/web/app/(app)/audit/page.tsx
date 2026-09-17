"use client";

import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import { keys } from "@/lib/query-keys";
import * as React from "react";
import { formatWAT } from "@/lib/utils";
import { Pagination, usePage } from "@/components/pagination";

/** Section 22 - TaskEvent is append-only and never hard-deleted. */
export default function AuditPage() {
  const [page, setPage] = usePage();
  const { data: paged, isLoading } = useQuery<any>({
    queryKey: [...keys.audit, page],
    queryFn: () => get(`audit?page=${page}&limit=50`),
  });
  const events: any[] | undefined = paged?.items;

  if (isLoading) return <div className="h-64 animate-pulse rounded-lg bg-ink-100" />;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink-900">Audit</h1>
        <p className="mt-1 text-sm text-ink-500">
          Every transition, with the actor, the authority and the channel it came from.
        </p>
      </header>

      <div className="overflow-x-auto rounded-lg border border-ink-200">
        <table className="w-full min-w-[680px] text-sm">
          <thead className="border-b border-ink-200 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-400">
            <tr>
              <th className="px-4 py-2.5 font-medium">When</th>
              <th className="px-4 py-2.5 font-medium">Task</th>
              <th className="px-4 py-2.5 font-medium">Transition</th>
              <th className="px-4 py-2.5 font-medium">Channel</th>
              <th className="px-4 py-2.5 font-medium">Reason</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-200">
            {events?.map((e) => (
              <tr key={e.id} className="hover:bg-ink-50">
                <td className="whitespace-nowrap px-4 py-2.5 text-ink-600">{formatWAT(e.at)}</td>
                <td className="code px-4 py-2.5 text-ink-700">{e.task.code}</td>
                <td className="px-4 py-2.5 text-ink-900">
                  {e.fromState ? `${e.fromState} -> ${e.toState}` : e.toState}
                </td>
                <td className="px-4 py-2.5">
                  <span className="rounded bg-ink-100 px-1.5 py-0.5 text-xs text-ink-600">
                    {e.actorId ? e.channel : "SYSTEM"}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-ink-500">{e.reason ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {paged && <Pagination page={paged} onPage={setPage} label="events" />}
      </div>
    </div>
  );
}
