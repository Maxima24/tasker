"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Check, ImageOff, X } from "lucide-react";
import { get } from "@/lib/api";
import { keys } from "@/lib/query-keys";
import { StateBadge, type TaskState } from "@/components/state-badge";
import { CapacityMeter } from "@/components/capacity-meter";
import { formatWAT, relative } from "@/lib/utils";
import { formatDayWAT } from "@/lib/utils";
import { Pagination, usePage } from "@/components/pagination";

interface Evidence {
  id: string;
  checklistKey: string;
  url: string;
  receivedAt: string;
  duplicateOfId: string | null;
}

interface Gate {
  stage: "INTERNAL" | "EXTERNAL";
  outcome: "PASS" | "FAIL";
  reason: string | null;
  note: string | null;
  decidedAt: string;
  onBehalfOfId: string | null;
  channel: string;
}

interface Submission {
  id: string;
  code: string;
  state: TaskState;
  taskType: string;
  specVersion: number;
  account: string | null;
  submittedAt: string | null;
  hoursReported: string | null;
  hoursFlagged: boolean;
  hoursFlagReason: string | null;
  reworkCount: number;
  evidence: Evidence[];
  gates: Gate[];
}

/**
 * The answer to "what has this person actually done". Everything they
 * submitted, the screenshots they attached, and what each gate decided -
 * because an audit that does not show the evidence is just a list of claims.
 */
export default function TaskerAuditPage() {
  const { id } = useParams<{ id: string }>();
  const [open, setOpen] = React.useState<string | null>(null);

  const [page, setPage] = usePage();
  const { data, isLoading } = useQuery<any>({
    queryKey: [...keys.taskerSubmissions(id), page],
    queryFn: () => get(`taskers/${id}/submissions?page=${page}&limit=20`),
  });

  if (isLoading) return <div className="h-64 animate-pulse rounded-lg bg-ink-100" />;
  if (!data) return null;

  const { tasker, totals, capacity, submissions, accounts } = data as {
    tasker: any;
    totals: any;
    capacity: any;
    submissions: Submission[];
    accounts: {
      assignmentId: string;
      ref: string;
      label: string | null;
      role: string;
      active: boolean;
      assignedAt: string;
      collectedAt: string | null;
    }[];
  };

  return (
    <div className="space-y-6">
      <Link
        href="/taskers"
        className="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-900"
      >
        <ArrowLeft className="size-4" />
        All taskers
      </Link>

      <header>
        <h1 className="text-xl font-semibold text-ink-900">{tasker.name}</h1>
        <p className="mt-1 text-sm text-ink-500">
          {tasker.email} · joined {formatWAT(tasker.createdAt)}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Submitted" value={totals.submitted} />
        <Stat label="Closed" value={totals.closed} />
        <Stat label="Reworked" value={totals.reworked} tone={totals.reworked > 0 ? "warn" : undefined} />
        <Stat label="Hours" value={totals.hours.toFixed(2)} />
        <Stat
          label="Hours flagged"
          value={totals.flaggedHours}
          tone={totals.flaggedHours > 0 ? "warn" : undefined}
        />
      </div>

      <CapacityMeter capacity={capacity} />

      <section>
        <h2 className="mb-3 text-sm font-semibold text-ink-900">Accounts</h2>
        {!accounts?.length ? (
          <p className="rounded-lg border border-dashed border-ink-200 px-4 py-4 text-sm text-ink-500">
            No account has been assigned to {tasker.name.split(" ")[0]} yet. Assign one from Accounts.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-ink-200">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead className="border-b border-ink-200 bg-ink-50 text-xs text-ink-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Account ID</th>
                  <th className="px-4 py-2 font-medium">Account Name</th>
                  <th className="px-4 py-2 font-medium">Role</th>
                  <th className="px-4 py-2 font-medium">Currently Active?</th>
                  <th className="px-4 py-2 font-medium">Date Assigned</th>
                  <th className="px-4 py-2 font-medium">Collected</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {accounts.map((a) => (
                  <tr key={a.assignmentId}>
                    <td className="code px-4 py-2 font-medium text-ink-900">{a.ref}</td>
                    <td className="px-4 py-2 text-ink-700">{a.label ?? "-"}</td>
                    <td className="px-4 py-2 text-ink-700">{a.role}</td>
                    <td className="px-4 py-2">{a.active ? "Yes" : "No"}</td>
                    <td className="whitespace-nowrap px-4 py-2 tabular-nums text-ink-700">
                      {formatDayWAT(a.assignedAt)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-ink-500">
                      {a.collectedAt ? formatDayWAT(a.collectedAt) : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.08em] text-ink-700">
          Submissions
        </h2>

        {submissions.length === 0 ? (
          <p className="rounded-lg border border-dashed border-ink-200 px-4 py-8 text-center text-sm text-ink-400">
            Nothing submitted yet.
          </p>
        ) : (
          <div className="space-y-2">
            {submissions.map((sub) => {
              const isOpen = open === sub.id;
              return (
                <div key={sub.id} className="overflow-hidden rounded-lg border border-ink-200 bg-white">
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : sub.id)}
                    className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-left hover:bg-ink-50"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="code text-xs text-ink-500">{sub.code}</span>
                        <span className="font-medium text-ink-900">{sub.taskType}</span>
                        {sub.reworkCount > 0 && (
                          <span className="rounded-full bg-tint-orange px-2 py-0.5 text-[0.7rem] font-medium text-state-rework">
                            {sub.reworkCount}× reworked
                          </span>
                        )}
                        {sub.hoursFlagged && (
                          <span
                            title={sub.hoursFlagReason ?? undefined}
                            className="inline-flex items-center gap-1 rounded-full bg-tint-amber px-2 py-0.5 text-[0.7rem] font-medium text-warn"
                          >
                            <AlertTriangle className="size-3" />
                            hours flagged
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-ink-500">
                        submitted {relative(sub.submittedAt)}
                        {sub.account && (
                          <>
                            <span className="mx-1.5 text-ink-300">|</span>
                            <span className="code">{sub.account}</span>
                          </>
                        )}
                        <span className="mx-1.5 text-ink-300">|</span>
                        <span>{sub.evidence.length} screenshots</span>
                        {sub.hoursReported && (
                          <>
                            <span className="mx-1.5 text-ink-300">|</span>
                            <span>{sub.hoursReported}h</span>
                          </>
                        )}
                      </p>
                    </div>
                    <StateBadge state={sub.state} />
                  </button>

                  {isOpen && (
                    <div className="space-y-4 border-t border-ink-200 bg-ink-50 px-4 py-4">
                      {sub.hoursFlagged && sub.hoursFlagReason && (
                        <p className="rounded-md bg-tint-amber px-3 py-2 text-xs text-warn">
                          {sub.hoursFlagReason}
                        </p>
                      )}

                      <div>
                        <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-500">
                          Evidence submitted
                        </h3>
                        {sub.evidence.length === 0 ? (
                          <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-400">
                            <ImageOff className="size-3.5" />
                            None attached.
                          </p>
                        ) : (
                          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                            {sub.evidence.map((e) => (
                              <a
                                key={e.id}
                                href={`/api${e.url}`}
                                target="_blank"
                                rel="noreferrer"
                                className="group"
                              >
                                <img
                                  src={`/api${e.url}`}
                                  alt={e.checklistKey}
                                  className="h-24 w-full rounded border border-ink-200 bg-white object-cover group-hover:border-ink-400"
                                />
                                <p className="mt-1 truncate text-[0.7rem] text-ink-500">
                                  {e.checklistKey}
                                </p>
                                <p className="text-[0.65rem] text-ink-400">
                                  {formatWAT(e.receivedAt)}
                                </p>
                              </a>
                            ))}
                          </div>
                        )}
                      </div>

                      <div>
                        <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-500">
                          What each gate decided
                        </h3>
                        {sub.gates.length === 0 ? (
                          <p className="mt-2 text-xs text-ink-400">Not reviewed yet.</p>
                        ) : (
                          <ol className="mt-2 space-y-1.5">
                            {sub.gates.map((g, i) => (
                              <li
                                key={i}
                                className="flex flex-wrap items-center gap-2 rounded-md bg-white px-3 py-2 text-xs"
                              >
                                {g.outcome === "PASS" ? (
                                  <Check className="size-3.5 shrink-0 text-ok" />
                                ) : (
                                  <X className="size-3.5 shrink-0 text-danger" />
                                )}
                                <span className="font-medium text-ink-900">
                                  {g.stage === "INTERNAL" ? "Internal review" : "External verdict"}
                                </span>
                                <span className={g.outcome === "PASS" ? "text-ok" : "text-danger"}>
                                  {g.outcome.toLowerCase()}
                                </span>
                                {(g.reason || g.note) && (
                                  <span className="text-ink-600">— {g.reason || g.note}</span>
                                )}
                                <span className="ml-auto text-ink-400">
                                  {formatWAT(g.decidedAt)} · {g.channel.toLowerCase()}
                                  {g.onBehalfOfId && " · on the admin's behalf"}
                                </span>
                              </li>
                            ))}
                          </ol>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {data.page && data.page.pageCount > 1 && (
          <div className="mt-3 overflow-hidden rounded-xl border border-ink-200">
            <Pagination page={data.page} onPage={setPage} label="submissions" />
          </div>
        )}
      </section>
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
    <div className="rounded-lg border border-ink-200 px-3 py-2.5">
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
