"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, LifeBuoy, Plus, X } from "lucide-react";
import { get, post, toApiError } from "@/lib/api";
import { keys } from "@/lib/query-keys";
import { relative } from "@/lib/utils";
import { Pagination, usePage } from "@/components/pagination";
import type { Me } from "@/components/app-shell";
import {
  TICKET_CATEGORIES as CATEGORIES,
  CATEGORY_LABEL,
  TICKET_STATUS_STYLE as STATUS_STYLE,
  TICKET_STATUS_LABEL as STATUS_LABEL,
} from "@/lib/ticket-meta";

interface Ticket {
  id: string;
  code: string;
  category: string;
  priority: "NORMAL" | "URGENT";
  subject: string;
  status: "OPEN" | "CLAIMED" | "RESOLVED";
  createdAt: string;
  claimedBy: { name: string } | null;
  raisedBy: { name: string; email: string; phone: string | null };
  task: { code: string; taskType: string } | null;
  account: { ref: string } | null;
}

export default function TicketsPage() {
  const { data: me } = useQuery<Me>({ queryKey: keys.me, queryFn: () => get("auth/me") });
  const isTasker = me?.role === "TASKER";

  const [filter, setFilter] = React.useState<string>("OPEN,CLAIMED");
  const [page, setPage] = usePage(filter);
  const [raising, setRaising] = React.useState(false);

  const { data: paged, isLoading } = useQuery<any>({
    queryKey: [...keys.tickets, filter, page],
    queryFn: () => get(`tickets?status=${filter}&page=${page}&limit=25`),
    refetchInterval: 15000,
  });

  const tickets: Ticket[] = paged?.items ?? [];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">
            {isTasker ? "Get help" : "Tickets"}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-500">
            {isTasker
              ? "Blocked by an account or a step that does not make sense? Raise it here and somebody will pick it up."
              : "Raised by taskers who are stuck. Each one arrives with the task, the account and how to reach them."}
          </p>
        </div>
        {isTasker && (
          <button
            type="button"
            onClick={() => setRaising(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-ink-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-ink-800"
          >
            <Plus className="size-4" />
            Report a problem
          </button>
        )}
      </header>

      <div className="flex flex-wrap gap-1.5">
        {[
          { value: "OPEN,CLAIMED", label: "Active" },
          { value: "OPEN", label: "Waiting" },
          { value: "RESOLVED", label: "Resolved" },
        ].map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
              filter === f.value
                ? "border-ink-900 bg-ink-900 text-white"
                : "border-ink-200 text-ink-700 hover:bg-ink-100"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="h-48 animate-pulse rounded-xl bg-ink-100" />
      ) : tickets.length === 0 ? (
        <div className="rounded-xl border border-dashed border-ink-200 px-6 py-12 text-center">
          <LifeBuoy className="mx-auto size-8 text-ink-300" />
          <p className="mt-3 font-medium text-ink-900">
            {isTasker ? "You have not reported anything" : "Nothing outstanding"}
          </p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-ink-500">
            {isTasker
              ? "If an account stops working or a step does not match what you see, say so here rather than guessing."
              : "Tickets land here the moment a tasker raises one, and on Telegram at the same time."}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-ink-200">
          <ul className="divide-y divide-ink-200">
            {tickets.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/tickets/${t.id}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-white px-4 py-3.5 transition-colors hover:bg-ink-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="code text-xs text-ink-400">{t.code}</span>
                      <span className="font-medium text-ink-900">{t.subject}</span>
                      {t.priority === "URGENT" && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-tint-red px-2 py-0.5 text-[0.7rem] font-medium text-danger">
                          <AlertTriangle className="size-3" />
                          Urgent
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-ink-500">
                      {!isTasker && <span>{t.raisedBy.name} · </span>}
                      <span>{CATEGORY_LABEL[t.category] ?? t.category}</span>
                      {t.task && (
                        <>
                          <span className="mx-1.5 text-ink-300">|</span>
                          <span className="code">{t.task.code}</span>
                        </>
                      )}
                      {t.account && (
                        <>
                          <span className="mx-1.5 text-ink-300">|</span>
                          <span className="code">{t.account.ref}</span>
                        </>
                      )}
                      <span className="mx-1.5 text-ink-300">|</span>
                      <span>{relative(t.createdAt)}</span>
                    </p>
                  </div>

                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[t.status]}`}
                  >
                    {t.status === "CLAIMED" && t.claimedBy
                      ? `${t.claimedBy.name} has it`
                      : STATUS_LABEL[t.status]}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {paged && <Pagination page={paged} onPage={setPage} label="tickets" />}
        </div>
      )}

      {raising && <RaiseDialog onClose={() => setRaising(false)} />}
    </div>
  );
}

/**
 * The form asks for as little as possible. Everything else - which task, which
 * account, who they are and how to reach them - the server already knows and
 * attaches, so a blocked tasker is not doing admin while they are blocked.
 */
function RaiseDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [category, setCategory] = React.useState(CATEGORIES[0].value);
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");
  const [urgent, setUrgent] = React.useState(false);

  const { data: active } = useQuery<any[]>({
    queryKey: keys.activeTask,
    queryFn: () => get("tasks/mine/active"),
  });
  const task = active?.[0];

  const raise = useMutation({
    mutationFn: () =>
      post<any>("tickets", {
        category,
        subject,
        body,
        priority: urgent ? "URGENT" : "NORMAL",
        taskId: task?.id,
      }),
    onSuccess: (t) => {
      toast.success(`Reported as ${t.code}`, {
        description: "The admin has been alerted on Telegram.",
      });
      queryClient.invalidateQueries({ queryKey: keys.tickets });
      onClose();
    },
    onError: async (err) => toast.error((await toApiError(err)).message),
  });

  const hint = CATEGORIES.find((c) => c.value === category)?.hint;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/40 p-4 sm:items-center">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-ink-900">What went wrong?</h2>
            <p className="mt-1 text-sm text-ink-500">
              {task
                ? `This will be attached to ${task.code}, along with the account you are on.`
                : "You are not on a task right now, so this comes through on its own."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-900"
          >
            <X className="size-4" />
          </button>
        </div>

        <fieldset className="mt-5">
          <legend className="text-sm font-medium text-ink-900">Kind of problem</legend>
          <div className="mt-2 space-y-1.5">
            {CATEGORIES.map((c) => (
              <label
                key={c.value}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                  category === c.value ? "border-ink-900 bg-ink-50" : "border-ink-200"
                }`}
              >
                <input
                  type="radio"
                  name="category"
                  className="mt-1"
                  checked={category === c.value}
                  onChange={() => setCategory(c.value)}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink-900">{c.label}</span>
                  <span className="block text-xs text-ink-500">{c.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <label htmlFor="subject" className="mt-5 block text-sm font-medium text-ink-900">
          One line summary
        </label>
        <input
          id="subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Account asks for a code I do not have"
          className="mt-1.5 w-full rounded-lg border border-ink-200 px-3 py-2.5 text-sm outline-none focus:border-ink-500"
        />

        <label htmlFor="body" className="mt-4 block text-sm font-medium text-ink-900">
          What happened?
        </label>
        <textarea
          id="body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          placeholder={hint}
          className="mt-1.5 w-full rounded-lg border border-ink-200 px-3 py-2.5 text-sm outline-none focus:border-ink-500"
        />

        <label className="mt-4 flex items-start gap-2.5 rounded-lg border border-ink-200 px-3 py-2.5">
          <input
            type="checkbox"
            className="mt-1"
            checked={urgent}
            onChange={(e) => setUrgent(e.target.checked)}
          />
          <span>
            <span className="block text-sm font-medium text-ink-900">
              I cannot carry on until this is fixed
            </span>
            <span className="block text-xs text-ink-500">
              Marks it urgent so it goes to the top of the queue.
            </span>
          </span>
        </label>

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-ink-200 px-3 py-2.5 text-sm font-medium text-ink-700 hover:bg-ink-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => raise.mutate()}
            disabled={!subject.trim() || !body.trim() || raise.isPending}
            className="flex-1 rounded-lg bg-ink-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-40"
          >
            {raise.isPending ? "Sending…" : "Send it"}
          </button>
        </div>
      </div>
    </div>
  );
}
