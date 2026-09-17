"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, Check, Mail, Phone, Send } from "lucide-react";
import { get, post, toApiError } from "@/lib/api";
import { keys } from "@/lib/query-keys";
import { formatWAT, relative } from "@/lib/utils";
import { CATEGORY_LABEL } from "@/lib/ticket-meta";
import { stateLabel, type TaskState } from "@/components/state-badge";
import type { Me } from "@/components/app-shell";
import { AccountCard } from "@/components/account-card";

/**
 * A ticket, with everything needed to act on it already gathered: who is stuck,
 * what they were doing, which account, and how to reach them. The credential
 * itself is one tap away rather than sitting in the page - so it still goes
 * through the vault and still writes an audit row naming who looked.
 */
export default function TicketPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [reply, setReply] = React.useState("");
  const [resolution, setResolution] = React.useState("");

  const { data: me } = useQuery<Me>({ queryKey: keys.me, queryFn: () => get("auth/me") });
  const { data: ticket, isLoading } = useQuery<any>({
    queryKey: keys.ticket(id),
    queryFn: () => get(`tickets/${id}`),
    refetchInterval: 10000,
  });

  const isTasker = me?.role === "TASKER";
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.ticket(id) });

  const claim = useMutation({
    mutationFn: () => post<any>(`tickets/${id}/claim`),
    onSuccess: (r) => {
      if (r.won === false) {
        toast(`${r.claimedBy} got there first`, {
          description: "They are handling it, so you can leave this one.",
        });
      } else {
        toast.success("You have it", { description: "Reminders have stopped for everyone else." });
      }
      refresh();
      queryClient.invalidateQueries({ queryKey: keys.tickets });
    },
    onError: async (err) => toast.error((await toApiError(err)).message),
  });

  const sendReply = useMutation({
    mutationFn: () => post(`tickets/${id}/reply`, { body: reply }),
    onSuccess: () => {
      setReply("");
      refresh();
    },
    onError: async (err) => toast.error((await toApiError(err)).message),
  });

  const resolve = useMutation({
    mutationFn: () => post(`tickets/${id}/resolve`, { resolution }),
    onSuccess: () => {
      toast.success("Marked resolved");
      refresh();
      queryClient.invalidateQueries({ queryKey: keys.tickets });
    },
    onError: async (err) => toast.error((await toApiError(err)).message),
  });

  if (isLoading) return <div className="h-64 animate-pulse rounded-xl bg-ink-100" />;
  if (!ticket) return null;

  return (
    <div className="space-y-6">
      <Link
        href="/tickets"
        className="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-900"
      >
        <ArrowLeft className="size-4" />
        All tickets
      </Link>

      <header className="border-b border-ink-200 pb-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="code text-[0.8rem] text-ink-400">{ticket.code}</span>
          {ticket.priority === "URGENT" && ticket.status !== "RESOLVED" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-tint-red px-2 py-0.5 text-[0.7rem] font-medium text-danger">
              <AlertTriangle className="size-3" />
              Urgent
            </span>
          )}
          {ticket.status === "RESOLVED" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-tint-green px-2 py-0.5 text-[0.7rem] font-medium text-ok">
              <Check className="size-3" />
              Resolved
            </span>
          )}
        </div>
        <h1 className="mt-1.5 text-2xl font-semibold tracking-[-0.02em] text-ink-900">
          {ticket.subject}
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          {CATEGORY_LABEL[ticket.category] ?? ticket.category}
          <span className="mx-2 text-ink-300">·</span>
          raised {relative(ticket.createdAt)}
          {ticket.claimedBy && (
            <>
              <span className="mx-2 text-ink-300">·</span>
              {ticket.claimedBy.name} is handling it
            </>
          )}
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-10">
        <section className="lg:col-start-1 lg:row-start-1">
          <div className="rounded-xl border border-ink-200 px-5 py-4">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-800">
              {ticket.body}
            </p>
          </div>

          {ticket.messages?.length > 0 && (
            <ol className="mt-4 space-y-3">
              {ticket.messages.map((m: any) => (
                <li
                  key={m.id}
                  className={`rounded-xl px-4 py-3 ${
                    m.author.role === "TASKER" ? "bg-ink-50" : "border border-ink-200 bg-white"
                  }`}
                >
                  <p className="text-xs text-ink-500">
                    <span className="font-medium text-ink-900">{m.author.name}</span>
                    <span className="mx-1.5 text-ink-300">·</span>
                    {formatWAT(m.createdAt)}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink-800">
                    {m.body}
                  </p>
                </li>
              ))}
            </ol>
          )}

          {ticket.status !== "RESOLVED" && (
            <div className="mt-4 flex gap-2">
              <input
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && reply.trim()) sendReply.mutate();
                }}
                placeholder={isTasker ? "Add anything else you noticed" : "Reply to the tasker"}
                className="min-w-0 flex-1 rounded-lg border border-ink-200 px-3 py-2.5 text-sm outline-none focus:border-ink-500"
              />
              <button
                type="button"
                onClick={() => sendReply.mutate()}
                disabled={!reply.trim() || sendReply.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-ink-900 px-3.5 py-2.5 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-40"
              >
                <Send className="size-4" />
                <span className="hidden sm:inline">Send</span>
              </button>
            </div>
          )}

          {ticket.resolution && (
            <div className="mt-4 rounded-xl border-l-[3px] border-l-ok bg-tint-green px-5 py-4">
              <p className="text-sm font-semibold text-ok">How it was fixed</p>
              <p className="mt-1 text-sm leading-relaxed text-ink-800">{ticket.resolution}</p>
              <p className="mt-1.5 text-xs text-ink-500">{formatWAT(ticket.resolvedAt)}</p>
            </div>
          )}

          {!isTasker && ticket.status !== "RESOLVED" && (
            <div className="mt-6 rounded-xl border border-ink-200 px-5 py-4">
              <label htmlFor="resolution" className="text-sm font-semibold text-ink-900">
                Close it out
              </label>
              <p className="mt-0.5 text-sm text-ink-500">
                Say what fixed it. The next person with the same problem reads this.
              </p>
              <textarea
                id="resolution"
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                rows={2}
                placeholder="Swapped them to ACC-007 and put ACC-002 into cooldown."
                className="mt-2.5 w-full rounded-lg border border-ink-200 px-3 py-2.5 text-sm outline-none focus:border-ink-500"
              />
              <button
                type="button"
                onClick={() => resolve.mutate()}
                disabled={!resolution.trim() || resolve.isPending}
                className="mt-3 rounded-lg bg-ink-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-40"
              >
                Mark resolved
              </button>
            </div>
          )}
        </section>

        <aside className="order-first space-y-4 lg:order-none lg:col-start-2 lg:row-start-1">
          {!isTasker && ticket.status === "OPEN" && (
            <button
              type="button"
              onClick={() => claim.mutate()}
              disabled={claim.isPending}
              className="w-full rounded-xl bg-ink-900 px-5 py-3 text-sm font-semibold text-white hover:bg-ink-800 disabled:opacity-60"
            >
              I will handle this
            </button>
          )}

          {!isTasker && (
            <section className="rounded-xl border border-ink-200 px-4 py-4">
              <p className="text-xs text-ink-400">Raised by</p>
              <p className="mt-0.5 font-semibold text-ink-900">{ticket.raisedBy.name}</p>
              <div className="mt-2.5 space-y-1.5">
                <a
                  href={`mailto:${ticket.raisedBy.email}`}
                  className="flex items-center gap-2 text-sm text-ink-600 hover:text-ink-900"
                >
                  <Mail className="size-3.5 shrink-0 text-ink-400" />
                  <span className="truncate">{ticket.raisedBy.email}</span>
                </a>
                {ticket.raisedBy.phone ? (
                  <a
                    href={`tel:${ticket.raisedBy.phone}`}
                    className="flex items-center gap-2 text-sm text-ink-600 hover:text-ink-900"
                  >
                    <Phone className="size-3.5 shrink-0 text-ink-400" />
                    {ticket.raisedBy.phone}
                  </a>
                ) : (
                  <p className="flex items-center gap-2 text-sm text-ink-400">
                    <Phone className="size-3.5 shrink-0" />
                    No phone on file
                  </p>
                )}
              </div>
            </section>
          )}

          {ticket.task && (
            <section className="rounded-xl border border-ink-200 px-4 py-4">
              <p className="text-xs text-ink-400">Working on</p>
              <p className="code mt-0.5 font-semibold text-ink-900">{ticket.task.code}</p>
              <p className="text-sm text-ink-500">{ticket.task.taskType}</p>
              <p className="mt-1 text-xs text-ink-400">
                {stateLabel(ticket.task.state as TaskState)}
              </p>
            </section>
          )}

          {ticket.account && !isTasker && (
            <AccountCard
              account={ticket.account}
              heading="Account involved"
              revealNote="Revealing is logged against you, like every other reveal."
            />
          )}
        </aside>
      </div>
    </div>
  );
}
