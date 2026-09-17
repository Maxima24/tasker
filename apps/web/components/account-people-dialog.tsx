"use client";

import * as React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { X } from "lucide-react";
import { get, post, toApiError } from "@/lib/api";
import { formatWAT } from "@/lib/utils";
import type { Assignee } from "@/lib/accounts";

interface HistoryRow {
  id: string;
  name: string;
  role: string;
  active: boolean;
  assignedAt: string;
  assignedBy: string | null;
  collectedAt: string | null;
  collectedBy: string | null;
}

interface PoolTasker {
  id: string;
  name: string;
  busy: boolean;
}

function today(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/**
 * The manager's People tab for one account: who has it, since when, and who had
 * it before. Collecting ends an assignment; work already running on the account
 * finishes there, but nothing new goes to that person on it.
 */
export function AccountPeopleDialog({
  account,
  onClose,
  onChanged,
}: {
  account: { id: string; ref: string; assignedTo?: Assignee[] };
  onClose: () => void;
  onChanged: () => void;
}) {
  const [taskerId, setTaskerId] = React.useState("");
  const [role, setRole] = React.useState("Tasker");
  const [assignedAt, setAssignedAt] = React.useState(today());

  const { data: pool } = useQuery<{ ranked: PoolTasker[]; unranked: PoolTasker[] }>({
    queryKey: ["taskers", "all"],
    queryFn: () => get("taskers"),
  });
  const { data: history, refetch } = useQuery<HistoryRow[]>({
    queryKey: ["accounts", account.id, "assignments"],
    queryFn: () => get(`accounts/${account.id}/assignments`),
  });

  const live = history?.filter((h) => h.active) ?? [];
  const past = history?.filter((h) => !h.active) ?? [];
  const holding = new Set((account.assignedTo ?? []).map((a) => a.taskerId));
  const taskers = [...(pool?.ranked ?? []), ...(pool?.unranked ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  const assign = useMutation({
    mutationFn: () =>
      post(`accounts/${account.id}/assignments`, {
        taskerId,
        role,
        assignedAt: new Date(`${assignedAt}T09:00:00`).toISOString(),
      }),
    onSuccess: () => {
      const name = taskers.find((t) => t.id === taskerId)?.name ?? "They";
      toast.success(`${account.ref} assigned to ${name}`, {
        description: "Their tasks will use this account from now on.",
      });
      setTaskerId("");
      refetch();
      onChanged();
    },
    onError: async (err) => toast.error((await toApiError(err)).message),
  });

  const collect = useMutation({
    mutationFn: (assignmentId: string) =>
      post<{ stillFinishing: string | null; taskerName: string }>(
        `accounts/${account.id}/assignments/${assignmentId}/collect`,
      ),
    onSuccess: (r) => {
      toast.success(`${account.ref} collected from ${r.taskerName}`, {
        description: r.stillFinishing
          ? `${r.stillFinishing} is still running on it and finishes there. Nothing new goes to them on this account.`
          : "Nothing new goes to them on this account.",
      });
      refetch();
      onChanged();
    },
    onError: async (err) => toast.error((await toApiError(err)).message),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={`People on ${account.ref}`}
    >
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-ink-100 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-ink-900">People on {account.ref}</h2>
            <p className="mt-0.5 text-sm text-ink-500">
              Whoever has the account gets it for their tasks, until you collect it back.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-900"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-6 px-6 py-5">
          <section>
            <h3 className="text-sm font-semibold text-ink-900">Working on it now</h3>
            {live.length === 0 ? (
              <p className="mt-1.5 text-sm text-ink-500">No one currently working.</p>
            ) : (
              <ul className="mt-2 divide-y divide-ink-100 rounded-lg border border-ink-200">
                {live.map((h) => (
                  <li key={h.id} className="flex items-center gap-3 px-3.5 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink-900">{h.name}</p>
                      <p className="text-xs text-ink-500">
                        {h.role}, since {formatWAT(h.assignedAt)}
                        {h.assignedBy ? `, assigned by ${h.assignedBy}` : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`Collect ${account.ref} from ${h.name}?`)) collect.mutate(h.id);
                      }}
                      disabled={collect.isPending}
                      className="shrink-0 rounded-md border border-ink-300 px-3 py-1.5 text-xs font-medium text-ink-800 hover:bg-tint-red hover:text-danger disabled:opacity-60"
                    >
                      Collect
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="text-sm font-semibold text-ink-900">Assign to someone</h3>
            <div className="mt-2 grid gap-3 sm:grid-cols-[1fr_7rem]">
              <label className="block">
                <span className="mb-1 block text-xs text-ink-500">Tasker</span>
                <select
                  value={taskerId}
                  onChange={(e) => setTaskerId(e.target.value)}
                  className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm"
                >
                  <option value="">Choose a person</option>
                  {taskers.map((t) => (
                    <option key={t.id} value={t.id} disabled={holding.has(t.id)}>
                      {t.name}
                      {holding.has(t.id) ? " (already has it)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-ink-500">Role</span>
                <input
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-ink-500">Date assigned</span>
                <input
                  type="date"
                  value={assignedAt}
                  max={today()}
                  onChange={(e) => setAssignedAt(e.target.value)}
                  className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm"
                />
              </label>
            </div>
            <button
              type="button"
              onClick={() => assign.mutate()}
              disabled={!taskerId || assign.isPending}
              className="mt-3 rounded-lg bg-ink-900 px-4 py-2 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-40"
            >
              {assign.isPending ? "Assigning…" : "Assign"}
            </button>
          </section>

          {past.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-ink-900">Worked on it before</h3>
              <ul className="mt-2 space-y-1.5">
                {past.map((h) => (
                  <li key={h.id} className="text-sm text-ink-700">
                    {h.name}
                    <span className="text-xs text-ink-500">
                      {" "}
                      from {formatWAT(h.assignedAt)} to {formatWAT(h.collectedAt)}
                      {h.collectedBy ? `, collected by ${h.collectedBy}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
