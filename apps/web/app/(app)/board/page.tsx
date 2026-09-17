"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, HandHelping, Plus, Radio, UserPlus, X } from "lucide-react";
import { get, post, toApiError } from "@/lib/api";
import { keys } from "@/lib/query-keys";
import { StateBadge, type TaskState } from "@/components/state-badge";
import { untilDue, relative } from "@/lib/utils";
import { Pagination, usePage } from "@/components/pagination";

interface Task {
  id: string;
  code: string;
  state: TaskState;
  category: "STANDARD" | "CRITICAL";
  dueAt: string | null;
  specVersionId: string;
  taskType: { id: string; name: string };
  specVersion: { version: number };
  assignee: { id: string; name: string } | null;
  account: { ref: string } | null;
}

interface TaskType {
  id: string;
  name: string;
  category: "STANDARD" | "CRITICAL";
  specVersions: { id: string; version: number; publishedAt: string | null }[];
}

/**
 * The board is grouped by what it wants FROM YOU, not by enum name. The top
 * group is the only one that needs a decision; everything below is reported so
 * you can see it is moving, not so you can act on it.
 */
const GROUPS: { key: string; title: string; blurb: string; states: TaskState[] }[] = [
  {
    key: "unassigned",
    title: "Held back",
    blurb: "Created but not sent anywhere. Put them in the queue, or give them to someone.",
    states: ["DRAFT"],
  },
  {
    key: "waiting",
    title: "Waiting to be claimed",
    blurb: "In the queue for everyone, or given to one person who has not started yet.",
    states: ["OPEN", "ASSIGNED"],
  },
  {
    key: "running",
    title: "Being worked",
    blurb: "Accepted, account checked out. Nothing to do but watch the clock.",
    states: ["IN_PROGRESS", "REWORK", "PAUSED"],
  },
];

export default function BoardPage() {
  const queryClient = useQueryClient();
  const [assigning, setAssigning] = React.useState<Task | null>(null);
  const [creating, setCreating] = React.useState(false);

  const { data: summary } = useQuery<any>({
    queryKey: keys.today,
    queryFn: () => get("today"),
    refetchInterval: 30000,
  });

  const [page, setPage] = usePage();
  const { data: paged, isLoading } = useQuery<any>({
    queryKey: [...keys.tasks("board"), page],
    queryFn: () =>
      get(
        `tasks?state=DRAFT,OPEN,ASSIGNED,IN_PROGRESS,REWORK,PAUSED&page=${page}&limit=50`,
      ),
    refetchInterval: 20000,
  });
  const tasks: Task[] | undefined = paged?.items;

  const { data: requests } = useQuery<any[]>({
    queryKey: keys.workRequests,
    queryFn: () => get("work-requests"),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: keys.tasks("board") });
    queryClient.invalidateQueries({ queryKey: keys.today });
  };

  const grouped = React.useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const g of GROUPS) {
      map.set(
        g.key,
        (tasks ?? [])
          .filter((t) => g.states.includes(t.state))
          .sort((a, b) => (a.dueAt ?? "9").localeCompare(b.dueAt ?? "9")),
      );
    }
    return map;
  }, [tasks]);

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">Assignment</h1>
          <p className="mt-1 max-w-xl text-sm text-ink-500">
            Tasks go into the queue for any qualified tasker to claim. Give one to a named
            person only when it has to be them.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-ink-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-ink-800"
        >
          <Plus className="size-4" />
          New task
        </button>
      </header>

      {requests && requests.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-ink-200 bg-ink-50 px-4 py-3">
          <HandHelping className="size-4 shrink-0 text-ink-500" />
          <p className="text-sm text-ink-700">
            <span className="font-medium">{requests.map((r) => r.tasker.name).join(", ")}</span>{" "}
            {requests.length === 1 ? "is" : "are"} free and asking for work
          </p>
          <span className="text-xs text-ink-400">{relative(requests[0].requestedAt)}</span>
        </div>
      )}

      {isLoading ? (
        <div className="h-64 animate-pulse rounded-lg bg-ink-100" />
      ) : (
        GROUPS.map((group, i) => {
          const rows = grouped.get(group.key) ?? [];
          return (
            <section key={group.key}>
              <div className="flex items-baseline gap-2.5">
                <h2 className="text-sm font-semibold text-ink-900">
                  {group.title}
                </h2>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${
                    i === 0 && rows.length > 0
                      ? "bg-ink-900 text-white"
                      : "bg-ink-100 text-ink-500"
                  }`}
                >
                  {rows.length}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-ink-400">{group.blurb}</p>

              {rows.length === 0 ? (
                <p className="mt-3 rounded-lg border border-dashed border-ink-200 px-4 py-5 text-center text-sm text-ink-400">
                  Nothing here.
                </p>
              ) : (
                <div className="mt-3 divide-y divide-ink-200 overflow-hidden rounded-lg border border-ink-200">
                  {rows.map((t) => (
                    <TaskRow
                      key={t.id}
                      task={t}
                      actionable={group.key === "unassigned" || t.state === "OPEN"}
                      onAssign={() => setAssigning(t)}
                      onOpened={invalidate}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })
      )}

      {paged && paged.pageCount > 1 && (
        <div className="overflow-hidden rounded-xl border border-ink-200">
          <Pagination page={paged} onPage={setPage} label="tasks" />
        </div>
      )}

      {summary && (
        <footer className="flex flex-wrap gap-x-6 gap-y-1 border-t border-ink-200 pt-4 text-xs text-ink-500">
          <span>
            <span className="tabular-nums font-medium text-ink-900">{summary.freeAccounts}</span>{" "}
            accounts free
          </span>
          <span>
            <span className="tabular-nums font-medium text-ink-900">{summary.inReview}</span> awaiting
            review
          </span>
          <span>
            <span className="tabular-nums font-medium text-ink-900">
              {summary.pendingVerification}
            </span>{" "}
            awaiting verdict
          </span>
          {summary.overdue > 0 && (
            <span className="text-danger">
              <span className="tabular-nums font-medium">{summary.overdue}</span> overdue
            </span>
          )}
        </footer>
      )}

      {assigning && (
        <AssignDialog
          task={assigning}
          onClose={() => setAssigning(null)}
          onDone={() => {
            setAssigning(null);
            invalidate();
          }}
        />
      )}
      {creating && (
        <CreateDialog
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            invalidate();
          }}
        />
      )}
    </div>
  );
}

function TaskRow({
  task,
  actionable,
  onAssign,
  onOpened,
}: {
  task: Task;
  actionable: boolean;
  onAssign: () => void;
  onOpened: () => void;
}) {
  const due = untilDue(task.dueAt);
  const open = useMutation({
    mutationFn: () => post(`tasks/${task.id}/open`),
    onSuccess: () => {
      toast.success(`${task.code} is in the queue`, {
        description: "Anyone who has watched its tutorial can claim it.",
      });
      onOpened();
    },
    onError: async (err) => toast.error((await toApiError(err)).message),
  });
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-white px-4 py-3 hover:bg-ink-50">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="code text-xs text-ink-500">{task.code}</span>
          <span className="font-medium text-ink-900">{task.taskType.name}</span>
          {task.category === "CRITICAL" && (
            <span className="rounded-full bg-tint-amber px-2 py-0.5 text-[0.7rem] font-medium text-state-in_review">
              Reviewed
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-ink-500">
          <span className={due.overdue ? "font-medium text-danger" : undefined}>{due.text}</span>
          <span className="mx-1.5 text-ink-300">|</span>
          <span>spec v{task.specVersion.version}</span>
          {task.assignee && (
            <>
              <span className="mx-1.5 text-ink-300">|</span>
              <span>{task.assignee.name}</span>
            </>
          )}
          {task.account && (
            <>
              <span className="mx-1.5 text-ink-300">|</span>
              <span className="code">{task.account.ref}</span>
            </>
          )}
        </p>
      </div>

      <StateBadge state={task.state} />

      {task.state === "DRAFT" && (
        <button
          type="button"
          onClick={() => open.mutate()}
          disabled={open.isPending}
          className="rounded-md bg-ink-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-ink-800 disabled:opacity-60"
        >
          Put in the queue
        </button>
      )}
      {actionable && (
        <button
          type="button"
          onClick={onAssign}
          className="rounded-md border border-ink-300 px-3 py-1.5 text-xs font-medium text-ink-800 hover:bg-white"
        >
          Give to someone
        </button>
      )}
    </div>
  );
}

/**
 * The pool is fetched for this task's exact spec version, so an uncertified
 * tasker never appears as an option rather than being rejected on submit.
 */
function AssignDialog({
  task,
  onClose,
  onDone,
}: {
  task: Task;
  onClose: () => void;
  onDone: () => void;
}) {
  const [mode, setMode] = React.useState<"direct" | "broadcast">("direct");
  const [selected, setSelected] = React.useState<string[]>([]);
  const [minScore, setMinScore] = React.useState(0);

  const { data: pool } = useQuery<any>({
    queryKey: keys.taskers(task.specVersionId),
    queryFn: () => get(`taskers?certifiedFor=${task.specVersionId}`),
  });

  const eligible = (pool?.ranked ?? []).filter((t: any) => t.score >= minScore);
  const unranked = pool?.unranked ?? [];

  const assign = useMutation({
    mutationFn: () =>
      mode === "direct"
        ? post(`tasks/${task.id}/assign`, { taskerId: selected[0] })
        : post(`tasks/${task.id}/broadcast`, { taskerIds: selected }),
    onSuccess: () => {
      toast.success(
        mode === "direct" ? "Assigned" : `Broadcast to ${selected.length}`,
        {
          description:
            mode === "direct"
              ? "They see it on their dashboard and accept."
              : "First to accept wins it.",
        },
      );
      onDone();
    },
    onError: async (err) => toast.error((await toApiError(err)).message),
  });

  const toggle = (id: string) => {
    if (mode === "direct") setSelected([id]);
    else setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-4">
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-semibold text-ink-900">
              Assign <span className="code text-ink-500">{task.code}</span>
            </h2>
            <p className="mt-0.5 text-sm text-ink-500">
              {task.taskType.name} · only taskers certified on spec v{task.specVersion.version}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-ink-500 hover:bg-ink-100"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-4 flex gap-2">
          {(["direct", "broadcast"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                setSelected([]);
              }}
              className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm ${
                mode === m ? "border-ink-900 bg-ink-900 text-white" : "border-ink-200 text-ink-700"
              }`}
            >
              {m === "direct" ? <UserPlus className="size-4" /> : <Radio className="size-4" />}
              {m === "direct" ? "One tasker" : "Broadcast"}
            </button>
          ))}
        </div>

        {mode === "broadcast" && (
          <div className="mt-4">
            <label className="flex items-center justify-between text-sm text-ink-700">
              <span>Minimum score</span>
              <span className="tabular-nums text-ink-500">{minScore.toFixed(2)}</span>
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={minScore}
              onChange={(e) => setMinScore(Number(e.target.value))}
              className="mt-1 w-full"
            />
            <p className="text-xs text-ink-400">
              {eligible.length} certified {eligible.length === 1 ? "tasker" : "taskers"} clear this
              bar.
            </p>
          </div>
        )}

        <div className="mt-4 space-y-1.5">
          {eligible.map((t: any) => (
            <PoolRow
              key={t.id}
              tasker={t}
              selected={selected.includes(t.id)}
              onToggle={() => toggle(t.id)}
            />
          ))}

          {unranked.length > 0 && (
            <>
              <p className="pt-3 text-xs font-medium uppercase tracking-wide text-ink-400">
                Not yet ranked
              </p>
              <p className="pb-1 text-xs text-ink-400">
                Under {pool?.minClosedToRank} closed tasks. Shown so new taskers are not starved.
              </p>
              {unranked.map((t: any) => (
                <PoolRow
                  key={t.id}
                  tasker={t}
                  selected={selected.includes(t.id)}
                  onToggle={() => toggle(t.id)}
                />
              ))}
            </>
          )}

          {eligible.length === 0 && unranked.length === 0 && (
            <p className="rounded-md bg-tint-amber px-3 py-2 text-sm text-state-in_review">
              Nobody is certified on this spec version yet.
            </p>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-ink-200 px-3 py-2 text-sm text-ink-700 hover:bg-ink-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => assign.mutate()}
            disabled={selected.length === 0 || assign.isPending}
            className="rounded-md bg-ink-900 px-4 py-2 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-50"
          >
            {mode === "direct" ? "Assign" : `Broadcast to ${selected.length}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function PoolRow({
  tasker,
  selected,
  onToggle,
}: {
  tasker: any;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left ${
        selected ? "border-ink-900 bg-ink-50" : "border-ink-200 hover:bg-ink-50"
      }`}
    >
      {selected && <CheckCircle2 className="size-4 shrink-0 text-ink-900" />}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink-900">
          {tasker.name}
          {tasker.busy && <span className="ml-2 text-xs font-normal text-warn">busy</span>}
        </p>
        <p className="text-xs text-ink-500">
          {Math.round(tasker.approvalRate * 100)}% approved · {tasker.closedCount} closed ·{" "}
          {tasker.medianSubmitMinutes}m median
        </p>
      </div>
      {tasker.ranked && (
        <span className="shrink-0 tabular-nums text-sm font-medium text-ink-700">
          {tasker.score.toFixed(2)}
        </span>
      )}
    </button>
  );
}

function CreateDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [taskTypeId, setTaskTypeId] = React.useState("");
  const [dueHours, setDueHours] = React.useState("8");
  const [toQueue, setToQueue] = React.useState(true);

  const { data: types } = useQuery<TaskType[]>({
    queryKey: keys.taskTypes,
    queryFn: () => get("task-types"),
  });

  const create = useMutation({
    mutationFn: async () => {
      const task = await post<{ id: string; code: string }>("tasks", {
        taskTypeId,
        dueAt: new Date(Date.now() + Number(dueHours) * 3600_000).toISOString(),
      });
      if (toQueue) await post(`tasks/${task.id}/open`);
      return task;
    },
    onSuccess: (task) => {
      toast.success(toQueue ? `${task.code} is in the queue` : `${task.code} created`, {
        description: toQueue
          ? "Anyone who has watched its tutorial can claim it."
          : "It is held back until you give it to someone.",
      });
      onDone();
    },
    onError: async (err) => toast.error((await toApiError(err)).message),
  });

  const selected = types?.find((t) => t.id === taskTypeId);
  const dispatchable = selected?.specVersions.some((v) => v.publishedAt);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between">
          <h2 className="font-semibold text-ink-900">New task</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-ink-500 hover:bg-ink-100"
          >
            <X className="size-4" />
          </button>
        </div>

        <label className="mt-4 block text-sm font-medium text-ink-700">Task type</label>
        <select
          value={taskTypeId}
          onChange={(e) => setTaskTypeId(e.target.value)}
          className="mt-1.5 w-full rounded-md border border-ink-200 px-3 py-2 text-sm"
        >
          <option value="">Choose one</option>
          {types?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.category === "CRITICAL" ? "critical" : "standard"})
            </option>
          ))}
        </select>

        {selected && !dispatchable && (
          <p className="mt-2 rounded-md bg-tint-amber px-3 py-2 text-xs text-state-in_review">
            {selected.name} has no published version yet. Write its steps and attach a tutorial on
            Task types, then publish it.
          </p>
        )}

        <fieldset className="mt-4">
          <legend className="text-sm font-medium text-ink-700">Where should it go?</legend>
          <div className="mt-1.5 space-y-1.5">
            <label className="flex cursor-pointer items-start gap-2.5 text-sm text-ink-800">
              <input
                type="radio"
                name="dest"
                checked={toQueue}
                onChange={() => setToQueue(true)}
                className="mt-1 accent-ink-900"
              />
              <span>
                Into the queue
                <span className="block text-xs text-ink-500">
                  Any tasker who has watched its tutorial can claim it.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2.5 text-sm text-ink-800">
              <input
                type="radio"
                name="dest"
                checked={!toQueue}
                onChange={() => setToQueue(false)}
                className="mt-1 accent-ink-900"
              />
              <span>
                Hold it back
                <span className="block text-xs text-ink-500">
                  Give it to a named person from the board.
                </span>
              </span>
            </label>
          </div>
        </fieldset>

        <label className="mt-4 block text-sm font-medium text-ink-700">Due in (hours)</label>
        <input
          type="number"
          min="1"
          value={dueHours}
          onChange={(e) => setDueHours(e.target.value)}
          className="mt-1.5 w-28 rounded-md border border-ink-200 px-3 py-2 text-sm"
        />

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-ink-200 px-3 py-2 text-sm text-ink-700 hover:bg-ink-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => create.mutate()}
            disabled={!taskTypeId || !dispatchable || create.isPending}
            className="rounded-md bg-ink-900 px-4 py-2 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-50"
          >
            {toQueue ? "Create and queue it" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
