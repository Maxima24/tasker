"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { InviteDialog } from "@/components/invite-dialog";
import { get } from "@/lib/api";
import { keys } from "@/lib/query-keys";
import { formatDayWAT } from "@/lib/utils";

export default function TaskersPage() {
  const [inviting, setInviting] = React.useState(false);
  const { data, isLoading } = useQuery<any>({
    queryKey: keys.taskers(),
    queryFn: () => get("taskers"),
  });

  if (isLoading) return <div className="h-64 animate-pulse rounded-lg bg-ink-100" />;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
        <h1 className="text-xl font-semibold text-ink-900">Taskers</h1>
        <p className="mt-1 text-sm text-ink-500">
          Open anyone to audit what they submitted and the evidence they attached. Scored over
          a rolling 60-day window, where approval carries the most weight.
        </p>
        </div>
        <button
          type="button"
          onClick={() => setInviting(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-ink-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-ink-800"
        >
          <UserPlus className="size-4" />
          Invite someone
        </button>
      </header>

      <Table title="Ranked" rows={data?.ranked ?? []} />
      {inviting && <InviteDialog onClose={() => setInviting(false)} />}

      <Table
        title="Not yet ranked"
        note={`Under ${data?.minClosedToRank} closed tasks. Shown separately so new taskers are not starved.`}
        rows={data?.unranked ?? []}
      />
    </div>
  );
}

function Table({ title, rows, note }: { title: string; rows: any[]; note?: string }) {
  if (rows.length === 0) return null;
  return (
    <section>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-400">{title}</h2>
      {note && <p className="mt-1 text-xs text-ink-400">{note}</p>}
      <div className="mt-3 overflow-x-auto rounded-lg border border-ink-200">
        <table className="w-full min-w-[600px] text-sm">
          <thead className="border-b border-ink-200 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-400">
            <tr>
              <th className="px-4 py-2.5 font-medium">Tasker</th>
              <th className="px-4 py-2.5 font-medium">Account &amp; date assigned</th>
              <th className="px-4 py-2.5 font-medium">Score</th>
              <th className="px-4 py-2.5 font-medium">Approved</th>
              <th className="px-4 py-2.5 font-medium">Closed</th>
              <th className="px-4 py-2.5 font-medium">Median submit</th>
              <th className="px-4 py-2.5 font-medium">Rework</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-200">
            {rows.map((t) => (
              <tr key={t.id} className="hover:bg-ink-50">
                <td className="px-4 py-3">
                  <Link
                    href={`/taskers/${t.id}`}
                    className="font-medium text-ink-900 underline-offset-2 hover:underline"
                  >
                    {t.name}
                  </Link>
                  {t.busy && <span className="ml-2 text-xs text-warn">busy</span>}
                </td>
                <td className="px-4 py-3">
                  {t.accounts?.length ? (
                    t.accounts.map((a: any) => (
                      <p key={a.accountId} className="whitespace-nowrap text-ink-700">
                        <span className="code font-medium text-ink-900">{a.ref}</span>
                        <span className="text-xs text-ink-500"> assigned {formatDayWAT(a.assignedAt)}</span>
                      </p>
                    ))
                  ) : (
                    <span className="text-xs text-ink-400">No account</span>
                  )}
                </td>
                <td className="px-4 py-3 tabular-nums font-medium text-ink-900">
                  {t.score.toFixed(2)}
                </td>
                <td className="px-4 py-3 tabular-nums text-ink-700">
                  {Math.round(t.approvalRate * 100)}%
                </td>
                <td className="px-4 py-3 tabular-nums text-ink-700">{t.closedCount}</td>
                <td className="px-4 py-3 tabular-nums text-ink-700">{t.medianSubmitMinutes}m</td>
                <td className="px-4 py-3 tabular-nums text-ink-700">
                  {Math.round(t.reworkRate * 100)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
