"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, History } from "lucide-react";
import { get } from "@/lib/api";
import { keys } from "@/lib/query-keys";
import { StateBadge, type TaskState } from "@/components/state-badge";
import { formatWAT } from "@/lib/utils";
import { Pagination, usePage } from "@/components/pagination";

interface Row {
  id: string;
  code: string;
  state: TaskState;
  hoursReported: string | null;
  hoursFlagged: boolean;
  hoursFlagReason: string | null;
  submittedAt: string | null;
  taskType: { name: string };
  specVersion: { version: number };
}

export default function HistoryPage() {
  const [page, setPage] = usePage();

  const { data, isLoading } = useQuery<any>({
    queryKey: [...keys.tasks("mine-history"), page],
    queryFn: () => get(`tasks/mine/history?page=${page}&limit=25`),
  });

  if (isLoading) return <div className="h-64 animate-pulse rounded-xl bg-ink-100" />;

  const rows: Row[] = data?.items ?? [];
  const totals = data?.totals ?? { finished: 0, hours: 0, flagged: 0 };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink-900">History</h1>
        <p className="mt-1 text-sm text-ink-500">
          Everything you have submitted, and the hours recorded against it.
        </p>
      </header>

      {/* Totals are across all of it, never just this page - this is the screen
          where somebody checks what they are owed. */}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Finished" value={totals.finished} />
        <Stat label="Hours recorded" value={totals.hours.toFixed(2)} />
        <Stat
          label="Flagged"
          value={totals.flagged}
          tone={totals.flagged > 0 ? "warn" : undefined}
        />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-ink-200 px-6 py-12 text-center">
          <History className="mx-auto size-8 text-ink-300" />
          <p className="mt-3 font-medium text-ink-900">Nothing finished yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-ink-500">
            Work you submit shows up here with the hours it was recorded against.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-ink-200">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="border-b border-ink-200 bg-ink-50 text-left text-xs text-ink-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Task</th>
                  <th className="px-4 py-2.5 font-medium">State</th>
                  <th className="px-4 py-2.5 font-medium">Hours</th>
                  <th className="px-4 py-2.5 font-medium">Submitted</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-200">
                {rows.map((t) => (
                  <tr key={t.id} className="hover:bg-ink-50">
                    <td className="px-4 py-3">
                      <div className="code text-xs text-ink-400">{t.code}</div>
                      <div className="font-medium text-ink-900">{t.taskType.name}</div>
                    </td>
                    <td className="px-4 py-3">
                      <StateBadge state={t.state} />
                    </td>
                    <td className="px-4 py-3 tabular-nums text-ink-700">
                      {t.hoursReported ?? "—"}
                      {t.hoursFlagged && (
                        <span
                          title={t.hoursFlagReason ?? undefined}
                          className="ml-2 inline-flex items-center gap-1 text-xs text-warn"
                        >
                          <AlertTriangle className="size-3" />
                          flagged
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-ink-600">
                      {formatWAT(t.submittedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data && <Pagination page={data} onPage={setPage} label="tasks" />}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: "warn";
}) {
  return (
    <div className="rounded-xl border border-ink-200 px-4 py-3">
      <p
        className={`text-xl font-semibold tabular-nums ${
          tone === "warn" ? "text-warn" : "text-ink-900"
        }`}
      >
        {value}
      </p>
      <p className="mt-0.5 text-xs text-ink-500">{label}</p>
    </div>
  );
}
