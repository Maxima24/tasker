"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ClipboardCheck, ImageOff, Zap } from "lucide-react";
import { get, post, toApiError } from "@/lib/api";
import { keys } from "@/lib/query-keys";
import { relative, formatWAT } from "@/lib/utils";

interface QueueTask {
  id: string;
  code: string;
  submittedAt: string | null;
  taskType: { name: string };
  assignee: { id: string; name: string } | null;
  specVersion: { version: number };
  _count: { proofs: number };
}

interface Slot {
  key: string;
  label: string;
  requiresProof: boolean;
  proof: {
    id: string;
    url: string;
    receivedAt: string;
    duplicateOf: { taskCode: string } | null;
  } | null;
}

export default function ReviewPage() {
  const { data: queue, isLoading } = useQuery<QueueTask[]>({
    queryKey: keys.reviewQueue,
    queryFn: () => get("queues/review"),
    refetchInterval: 20000,
  });

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const current = queue?.find((t) => t.id === selectedId) ?? queue?.[0];
  const index = queue?.findIndex((t) => t.id === current?.id) ?? -1;

  if (isLoading) return <div className="h-64 animate-pulse rounded-lg bg-ink-100" />;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink-900">Review</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-500">
          Did the tasker do what the spec asked? Each requirement is shown beside the proof
          captured for it. Approving sends the task on for external verification.
        </p>
      </header>

      {!queue?.length ? (
        <div className="rounded-lg border border-dashed border-ink-200 px-6 py-12 text-center">
          <ClipboardCheck className="mx-auto size-8 text-ink-300" />
          <p className="mt-3 font-medium text-ink-900">Nothing waiting on review</p>
          <p className="mt-1 text-sm text-ink-500">
            Critical submissions land here the moment a tasker submits.
          </p>
        </div>
      ) : (
        <>
          {/* One task at a time. The strip is for moving between them, not browsing. */}
          <div className="flex flex-wrap items-center gap-2 border-b border-ink-200 pb-3">
            <span className="text-xs font-medium uppercase tracking-wide text-ink-400">
              {index + 1} of {queue.length} waiting
            </span>
            <div className="flex flex-wrap gap-1.5">
              {queue.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelectedId(t.id)}
                  className={`code rounded-md border px-2 py-1 text-xs transition-colors ${
                    current?.id === t.id
                      ? "border-ink-900 bg-ink-900 text-white"
                      : "border-ink-200 text-ink-600 hover:bg-ink-100"
                  }`}
                >
                  {t.code}
                </button>
              ))}
            </div>
            <span className="ml-auto text-xs text-ink-400">oldest first</span>
          </div>

          {current && <ReviewPanel task={current} />}
        </>
      )}
    </div>
  );
}

function ReviewPanel({ task }: { task: QueueTask }) {
  const queryClient = useQueryClient();
  const [citedProofId, setCitedProofId] = React.useState<string | null>(null);
  const [note, setNote] = React.useState("");

  const { data } = useQuery<{ slots: Slot[]; receiptSpread: any }>({
    queryKey: keys.proof(task.id),
    queryFn: () => get(`tasks/${task.id}/proof`),
  });

  React.useEffect(() => {
    setCitedProofId(null);
    setNote("");
  }, [task.id]);

  const decide = useMutation({
    mutationFn: (outcome: "PASS" | "FAIL") =>
      post(`tasks/${task.id}/review`, {
        outcome,
        note: note || undefined,
        reason: outcome === "FAIL" ? note || "Did not meet the checklist" : undefined,
        citedProofId: citedProofId ?? undefined,
      }),
    onSuccess: (_d, outcome) => {
      toast.success(outcome === "PASS" ? "Approved" : "Sent back", {
        description:
          outcome === "PASS"
            ? "Now waiting on the external platform's verdict."
            : "Back to the same tasker, on the same account.",
      });
      queryClient.invalidateQueries({ queryKey: keys.reviewQueue });
      queryClient.invalidateQueries({ queryKey: keys.today });
    },
    onError: async (err) => toast.error((await toApiError(err)).message),
  });

  const spread = data?.receiptSpread;
  const cited = data?.slots.find((s) => s.proof?.id === citedProofId);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="code text-sm text-ink-500">{task.code}</span>
        <h2 className="text-lg font-semibold text-ink-900">{task.taskType.name}</h2>
        <span className="text-sm text-ink-500">
          {task.assignee?.name} · spec v{task.specVersion.version} · submitted{" "}
          {relative(task.submittedAt)}
        </span>
      </div>

      {/* Section 11 - the spread of receipt times is the honest signal. */}
      {spread?.burst && (
        <p className="flex items-start gap-2 rounded-md bg-tint-amber px-3 py-2 text-sm text-state-in_review">
          <Zap className="mt-0.5 size-4 shrink-0" />
          <span>
            All {spread.count} files arrived within {spread.spreadSeconds}s of each other. Worth a
            closer look at whether they were captured as the work happened.
          </span>
        </p>
      )}

      {/* The pairing IS the review: requirement on the left, its evidence on the right. */}
      <ol className="divide-y divide-ink-200 overflow-hidden rounded-lg border border-ink-200">
        {data?.slots.map((slot, i) => {
          const isCited = citedProofId != null && slot.proof?.id === citedProofId;
          return (
            <li
              key={slot.key}
              className={`flex flex-col gap-4 p-4 sm:flex-row sm:items-start ${
                isCited ? "bg-tint-orange" : "bg-white"
              }`}
            >
              <div className="flex min-w-0 flex-1 gap-3">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-ink-100 text-xs font-medium tabular-nums text-ink-600">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="font-medium text-ink-900">{slot.label}</p>
                  {!slot.requiresProof ? (
                    <p className="mt-0.5 text-xs text-ink-400">No proof required for this step.</p>
                  ) : slot.proof ? (
                    <p className="mt-0.5 text-xs text-ink-500">
                      received {formatWAT(slot.proof.receivedAt)}
                    </p>
                  ) : (
                    <p className="mt-0.5 text-xs font-medium text-danger">Nothing uploaded</p>
                  )}

                  {slot.proof?.duplicateOf && (
                    <p className="mt-1.5 flex items-start gap-1.5 text-xs text-warn">
                      <AlertTriangle className="mt-px size-3.5 shrink-0" />
                      This image also appears on {slot.proof.duplicateOf.taskCode}. Legitimate
                      repeats exist — it is a note, not a verdict.
                    </p>
                  )}

                  {slot.proof && (
                    <button
                      type="button"
                      onClick={() => setCitedProofId(isCited ? null : slot.proof!.id)}
                      className={`mt-2 rounded border px-2 py-1 text-[0.7rem] transition-colors ${
                        isCited
                          ? "border-state-rework bg-white text-state-rework"
                          : "border-ink-200 text-ink-600 hover:bg-ink-100"
                      }`}
                    >
                      {isCited ? "Citing this frame" : "Cite this frame"}
                    </button>
                  )}
                </div>
              </div>

              <div className="shrink-0 sm:w-64">
                {slot.proof ? (
                  <a href={`/api${slot.proof.url}`} target="_blank" rel="noreferrer">
                    <img
                      src={`/api${slot.proof.url}`}
                      alt={slot.label}
                      className={`h-36 w-full rounded border bg-ink-50 object-cover sm:h-40 ${
                        isCited ? "border-state-rework" : "border-ink-200"
                      }`}
                    />
                  </a>
                ) : (
                  <div className="flex h-36 w-full items-center justify-center rounded border border-dashed border-ink-200 bg-ink-50 text-xs text-ink-400 sm:h-40">
                    <ImageOff className="mr-1.5 size-4" />
                    {slot.requiresProof ? "Missing" : "Not needed"}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="rounded-lg border border-ink-200 p-4">
        <label htmlFor="note" className="block text-sm font-medium text-ink-700">
          Note to the tasker
        </label>
        {cited && (
          <p className="mt-1 text-xs text-state-rework">
            Citing “{cited.label}” — the rework notice will point at that frame.
          </p>
        )}
        <textarea
          id="note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="On a send-back this is what they see. Point at the actual problem, not 'redo this'."
          className="mt-1.5 w-full rounded-md border border-ink-200 px-3 py-2 text-sm"
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => decide.mutate("PASS")}
            disabled={decide.isPending}
            className="rounded-md bg-ink-900 px-4 py-2 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-60"
          >
            Approve
          </button>
          <button
            type="button"
            onClick={() => decide.mutate("FAIL")}
            disabled={decide.isPending}
            className="rounded-md border border-state-rework px-4 py-2 text-sm font-medium text-state-rework hover:bg-tint-orange disabled:opacity-60"
          >
            Send back
          </button>
          <p className="ml-auto text-xs text-ink-400">
            Decisions act on the whole task, never one image.
          </p>
        </div>
      </div>
    </div>
  );
}
