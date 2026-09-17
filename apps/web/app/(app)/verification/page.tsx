"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ExternalLink, ShieldCheck } from "lucide-react";
import { get, post, toApiError } from "@/lib/api";
import { keys } from "@/lib/query-keys";
import { relative } from "@/lib/utils";

interface VerifyTask {
  id: string;
  code: string;
  submittedAt: string | null;
  taskType: { name: string };
  assignee: { name: string } | null;
  account: { ref: string } | null;
  reviews: { note: string | null; decidedAt: string }[];
}

const FAIL_REASONS = [
  "Platform rejected the submission",
  "Work not visible on the platform",
  "Wrong record updated",
  "Duplicate of an earlier submission",
];

/**
 * Nothing is judged here. Internal review already passed these; this page only
 * records what the external platform decided, because the platform's opinion
 * is the one that actually pays. Built to be worked down a list quickly.
 */
export default function VerificationPage() {
  const queryClient = useQueryClient();
  const { data: queue, isLoading } = useQuery<VerifyTask[]>({
    queryKey: keys.verificationQueue,
    queryFn: () => get("queues/verification"),
    refetchInterval: 20000,
  });

  const [openId, setOpenId] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState(FAIL_REASONS[0]);

  const verify = useMutation({
    mutationFn: (args: { id: string; outcome: "PASS" | "FAIL" }) =>
      post(`tasks/${args.id}/verify`, {
        outcome: args.outcome,
        reason: args.outcome === "FAIL" ? reason : undefined,
      }),
    onSuccess: (_d, args) => {
      toast.success(args.outcome === "PASS" ? "Accepted — task closed" : "Rejected — sent back", {
        description:
          args.outcome === "PASS"
            ? undefined
            : "Back to the same tasker on the same account. Anything they already started pauses.",
      });
      setOpenId(null);
      queryClient.invalidateQueries({ queryKey: keys.verificationQueue });
      queryClient.invalidateQueries({ queryKey: keys.today });
    },
    onError: async (err) => toast.error((await toApiError(err)).message),
  });

  if (isLoading) return <div className="h-64 animate-pulse rounded-lg bg-ink-100" />;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink-900">Verification</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-500">
          Open each record on the external platform, see whether it was accepted, and record
          the verdict here. You are not judging the work — review already did that.
        </p>
      </header>

      {!queue?.length ? (
        <div className="rounded-lg border border-dashed border-ink-200 px-6 py-12 text-center">
          <ShieldCheck className="mx-auto size-8 text-ink-300" />
          <p className="mt-3 font-medium text-ink-900">No verdicts outstanding</p>
          <p className="mt-1 text-sm text-ink-500">
            Approved work lands here until somebody checks the platform.
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between border-b border-ink-200 pb-2">
            <span className="text-xs font-medium uppercase tracking-wide text-ink-400">
              {queue.length} awaiting a verdict
            </span>
            <span className="text-xs text-ink-400">oldest first</span>
          </div>

          <div className="divide-y divide-ink-200 overflow-hidden rounded-lg border border-ink-200">
            {queue.map((t) => (
              <div key={t.id} className="bg-white">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="code text-xs text-ink-500">{t.code}</span>
                      <span className="font-medium text-ink-900">{t.taskType.name}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-ink-500">
                      {t.assignee?.name}
                      {t.account && (
                        <>
                          <span className="mx-1.5 text-ink-300">|</span>
                          <span className="code">{t.account.ref}</span>
                        </>
                      )}
                      <span className="mx-1.5 text-ink-300">|</span>
                      <span>waiting {relative(t.submittedAt)}</span>
                    </p>
                    {t.reviews[0]?.note && (
                      <p className="mt-1.5 border-l-2 border-ink-200 pl-2.5 text-xs italic text-ink-500">
                        {t.reviews[0].note}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <a
                      href="https://example.com/external-record"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-md border border-ink-200 px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-100"
                    >
                      Open on platform
                      <ExternalLink className="size-3.5" />
                    </a>
                    <button
                      type="button"
                      onClick={() => verify.mutate({ id: t.id, outcome: "PASS" })}
                      disabled={verify.isPending}
                      className="rounded-md bg-ink-900 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-60"
                    >
                      Accepted
                    </button>
                    <button
                      type="button"
                      onClick={() => setOpenId(openId === t.id ? null : t.id)}
                      className="rounded-md border border-state-rework px-3.5 py-1.5 text-sm font-medium text-state-rework hover:bg-tint-orange"
                    >
                      Rejected
                    </button>
                  </div>
                </div>

                {openId === t.id && (
                  <div className="border-t border-ink-200 bg-ink-50 px-4 py-3">
                    <label className="block text-sm font-medium text-ink-700">
                      Why did the platform reject it?
                    </label>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <select
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        className="rounded-md border border-ink-200 bg-white px-3 py-2 text-sm"
                      >
                        {FAIL_REASONS.map((r) => (
                          <option key={r}>{r}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => verify.mutate({ id: t.id, outcome: "FAIL" })}
                        disabled={verify.isPending}
                        className="rounded-md bg-state-rework px-3.5 py-2 text-sm font-medium text-white disabled:opacity-60"
                      >
                        Record rejection
                      </button>
                      <button
                        type="button"
                        onClick={() => setOpenId(null)}
                        className="rounded-md border border-ink-200 bg-white px-3 py-2 text-sm text-ink-700"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
