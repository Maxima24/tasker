"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Check, ImagePlus, PlayCircle, RotateCcw, X } from "lucide-react";
import { api, get, post, toApiError } from "@/lib/api";
import { keys } from "@/lib/query-keys";
import { StateBadge, type TaskState } from "@/components/state-badge";
import { untilDue, formatWAT } from "@/lib/utils";
import { AccountCard } from "@/components/account-card";
import { ProtectedVideo } from "@/components/protected-video";
import type { AccountDetails } from "@/lib/accounts";

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

interface Task {
  id: string;
  code: string;
  state: TaskState;
  category: "STANDARD" | "CRITICAL";
  dueAt: string | null;
  taskType: { name: string };
  specVersion: {
    version: number;
    tutorial: { id: string; title: string; streamUrl: string; durationSeconds: number } | null;
  };
  account: AccountDetails | null;
  reviews: { stage: string; outcome: string; reason: string | null; note: string | null }[];
}

export function ActiveTask({ task }: { task: Task }) {
  const queryClient = useQueryClient();
  const [hours, setHours] = React.useState("");
  const [missing, setMissing] = React.useState<string[]>([]);
  const [releasing, setReleasing] = React.useState(false);

  const { data: proofData } = useQuery<{ slots: Slot[] }>({
    queryKey: keys.proof(task.id),
    queryFn: () => get(`tasks/${task.id}/proof`),
  });

  const slots = proofData?.slots ?? [];
  const required = slots.filter((s) => s.requiresProof);
  const captured = required.filter((s) => s.proof).length;
  const due = untilDue(task.dueAt);
  const lastReview = task.reviews?.[0];
  const ready = captured === required.length && required.length > 0;

  const submit = useMutation({
    mutationFn: () =>
      post(`tasks/${task.id}/submit`, {
        hoursReported: task.category === "STANDARD" ? Number(hours) : undefined,
      }),
    onSuccess: () => {
      setMissing([]);
      toast.success(
        task.category === "STANDARD" ? "Submitted and closed" : "Sent for review",
      );
      queryClient.invalidateQueries({ queryKey: keys.activeTask });
      queryClient.invalidateQueries({ queryKey: keys.capacity });
    },
    onError: async (err) => {
      const e = await toApiError(err);
      // Name the empty steps on the steps themselves. A disabled button that
      // never says why is the thing this replaces.
      setMissing(e.missingKeys ?? []);
      toast.error(e.message);
    },
  });

  const ackRework = useMutation({
    mutationFn: () => post(`tasks/${task.id}/rework/ack`),
    onSuccess: () => {
      toast.success("Back in progress on the same account");
      queryClient.invalidateQueries({ queryKey: keys.activeTask });
    },
    onError: async (err) => toast.error((await toApiError(err)).message),
  });

  return (
    <div className="pb-24 lg:pb-0">
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b border-ink-200 pb-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="code text-[0.8rem] text-ink-400">{task.code}</span>
            <StateBadge state={task.state} />
          </div>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-[-0.02em] text-ink-900">
            {task.taskType.name}
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            <span className={due.overdue ? "font-medium text-danger" : undefined}>
              {due.text}
            </span>
            <span className="mx-2 text-ink-300">·</span>
            <span>Spec v{task.specVersion.version}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => setReleasing(true)}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900"
        >
          <RotateCcw className="size-4" />
          Give it back
        </button>
      </header>

      {task.state === "REWORK" && lastReview && (
        <div className="mt-5 rounded-xl border-l-[3px] border-l-state-rework bg-tint-orange px-5 py-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-state-rework">
            <AlertTriangle className="size-4" />
            Sent back
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-700">
            {lastReview.reason || lastReview.note || "No reason recorded."}
          </p>
          <button
            type="button"
            onClick={() => ackRework.mutate()}
            disabled={ackRework.isPending}
            className="mt-3 rounded-lg bg-ink-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-ink-800"
          >
            Pick it back up
          </button>
        </div>
      )}

      {task.state === "PAUSED" && (
        <div className="mt-5 rounded-xl border-l-[3px] border-l-state-paused bg-tint-violet px-5 py-4">
          <p className="text-sm font-semibold text-state-paused">Paused for a rework</p>
          <p className="mt-1 text-sm leading-relaxed text-ink-700">
            Work you already submitted came back and takes priority. This one keeps its
            account and resumes on its own once the rework closes.
          </p>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_19rem] lg:gap-10">
        {/* The work itself: a ledger of steps, each with the evidence it needs. */}
        <section className="lg:col-start-1 lg:row-start-1">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-base font-semibold text-ink-900">Evidence</h2>
            <p className="text-sm tabular-nums text-ink-500">
              {captured} of {required.length} captured
            </p>
          </div>

          <ol className="divide-y divide-ink-200 overflow-hidden rounded-xl border border-ink-200">
            {slots.map((slot, i) => (
              <ProofStep
                key={slot.key}
                index={i + 1}
                taskId={task.id}
                slot={slot}
                missing={missing.includes(slot.key)}
              />
            ))}
          </ol>

          {task.category === "STANDARD" && (
            <div className="mt-6 rounded-xl border border-ink-200 px-5 py-4">
              <label htmlFor="hours" className="text-sm font-semibold text-ink-900">
                Hours worked
              </label>
              <p className="mt-0.5 text-sm text-ink-500">
                This is what you are paid on. It is recorded against the time this task was
                open.
              </p>
              <input
                id="hours"
                type="number"
                step="0.25"
                min="0"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                placeholder="3.5"
                className="mt-3 w-28 rounded-lg border border-ink-200 px-3 py-2 text-lg tabular-nums outline-none transition-colors focus:border-ink-500"
              />
            </div>
          )}
        </section>

        {/* Context and the one action, kept out of the work column. */}
        <aside className="order-first space-y-4 lg:order-none lg:col-start-2 lg:row-start-1 lg:self-start">
          {/* Submit leads the rail on a desktop, so it is never below the fold. */}
          <div className="hidden lg:block">
            <Progress captured={captured} total={required.length} />
            <SubmitButton
              category={task.category}
              ready={ready}
              pending={submit.isPending}
              onSubmit={() => submit.mutate()}
            />
          </div>

          {task.account && (
            <AccountCard
              account={task.account}
              heading="Work this task on"
              helpHref="/tickets"
            />
          )}

          {task.specVersion.tutorial && (
            <Refresher tutorial={task.specVersion.tutorial} />
          )}
        </aside>
      </div>

      {/* On a phone the action follows you down the page. */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-ink-200 bg-white/95 px-4 py-3 backdrop-blur lg:hidden">
        <div className="mb-2">
          <Progress captured={captured} total={required.length} />
        </div>
        <SubmitButton
          category={task.category}
          ready={ready}
          pending={submit.isPending}
          onSubmit={() => submit.mutate()}
        />
      </div>

      {releasing && (
        <ReleaseDialog
          taskId={task.id}
          onClose={() => setReleasing(false)}
          onDone={() => {
            setReleasing(false);
            queryClient.invalidateQueries({ queryKey: keys.activeTask });
          }}
        />
      )}
    </div>
  );
}

/** Segments rather than a bar: there are three steps, not a percentage. */
function Progress({ captured, total }: { captured: number; total: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex flex-1 gap-1" role="img" aria-label={`${captured} of ${total} captured`}>
        {Array.from({ length: total }).map((_, i) => (
          <span
            key={i}
            className={`h-1.5 flex-1 rounded-full transition-colors ${
              i < captured ? "bg-ink-900" : "bg-ink-200"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

function SubmitButton({
  category,
  ready,
  pending,
  onSubmit,
}: {
  category: "STANDARD" | "CRITICAL";
  ready: boolean;
  pending: boolean;
  onSubmit: () => void;
}) {
  return (
    <div className="lg:mt-3">
      <button
        type="button"
        onClick={onSubmit}
        disabled={pending}
        className={`w-full rounded-xl px-5 py-3 text-sm font-semibold transition-colors ${
          ready
            ? "bg-ink-900 text-white hover:bg-ink-800"
            : "bg-ink-900/90 text-white hover:bg-ink-900"
        } disabled:opacity-60`}
      >
        {pending
          ? "Sending…"
          : category === "STANDARD"
            ? "Submit and close"
            : "Send for review"}
      </button>
      <p className="mt-2 hidden text-xs leading-relaxed text-ink-400 lg:block">
        {category === "STANDARD"
          ? "Closes this task straight away. Nobody reviews it."
          : "Goes to an internal review, then to the platform for its verdict."}
      </p>
    </div>
  );
}

/**
 * One row per step. The screenshot is the anchor, because that is the thing
 * that gets judged; an empty step reads as a target to drop onto rather than
 * a gap in the page.
 */
function ProofStep({
  index,
  taskId,
  slot,
  missing,
}: {
  index: number;
  taskId: string;
  slot: Slot;
  missing: boolean;
}) {
  const queryClient = useQueryClient();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("checklistKey", slot.key);
      const res: any = await api.post(`tasks/${taskId}/proof`, { body: form }).json();
      if (res.duplicateNote) {
        // A match is a note on the frame, never a rejection. Repeats happen.
        toast("Seen before", {
          description: `This image also appears on ${res.duplicateNote.taskCode}.`,
        });
      }
      queryClient.invalidateQueries({ queryKey: keys.proof(taskId) });
    } catch (err) {
      toast.error((await toApiError(err)).message);
    } finally {
      setUploading(false);
      setDragging(false);
    }
  };

  if (!slot.requiresProof) {
    return (
      <li className="flex items-center gap-4 bg-ink-50/60 px-5 py-3.5">
        <StepMark index={index} done />
        <span className="flex-1 text-sm text-ink-600">{slot.label}</span>
        <span className="text-xs text-ink-400">No screenshot needed</span>
      </li>
    );
  }

  return (
    <li
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files?.[0];
        if (file) upload(file);
      }}
      className={`flex items-center gap-4 px-4 py-3.5 transition-colors sm:px-5 sm:py-4 ${
        dragging ? "bg-tint-blue" : missing ? "bg-tint-red" : "bg-white"
      }`}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3 sm:gap-4">
        <StepMark index={index} done={!!slot.proof} missing={missing} />
        <div className="min-w-0">
          <p className="text-sm font-medium leading-snug text-ink-900 sm:text-base">
            {slot.label}
          </p>
          {slot.proof ? (
            <p className="mt-0.5 text-xs text-ink-400">
              Captured {formatWAT(slot.proof.receivedAt)}
            </p>
          ) : (
            <p
              className={`mt-0.5 text-xs ${missing ? "font-medium text-danger" : "text-ink-400"}`}
            >
              {missing ? "Still empty" : "Drop a screenshot here, or browse"}
            </p>
          )}

          {slot.proof?.duplicateOf && (
            <p className="mt-1.5 text-xs text-warn">
              Also on {slot.proof.duplicateOf.taskCode}
            </p>
          )}

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="mt-2 text-xs font-medium text-ink-600 underline decoration-ink-300 underline-offset-4 transition-colors hover:text-ink-900 disabled:opacity-60"
          >
            {uploading ? "Uploading…" : slot.proof ? "Replace" : "Browse files"}
          </button>
        </div>
      </div>

      <div className="w-24 shrink-0 sm:w-36 lg:w-44">
        {slot.proof ? (
          <a
            href={`/api${slot.proof.url}`}
            target="_blank"
            rel="noreferrer"
            className="block overflow-hidden rounded-lg border border-ink-200 transition-colors hover:border-ink-400"
          >
            <img
              src={`/api${slot.proof.url}`}
              alt={slot.label}
              className="aspect-[16/10] w-full bg-ink-50 object-cover"
            />
          </a>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className={`flex aspect-[16/10] w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed transition-colors ${
              dragging
                ? "border-state-open bg-white"
                : missing
                  ? "border-danger/50"
                  : "border-ink-300 hover:border-ink-400 hover:bg-ink-50"
            }`}
          >
            <ImagePlus className="size-5 text-ink-300" />
            <span className="text-xs text-ink-400">Screenshot</span>
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload(file);
          e.target.value = "";
        }}
      />
    </li>
  );
}

function StepMark({
  index,
  done,
  missing,
}: {
  index: number;
  done?: boolean;
  missing?: boolean;
}) {
  return (
    <span
      className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium tabular-nums transition-colors ${
        done
          ? "bg-ink-900 text-white"
          : missing
            ? "bg-danger text-white"
            : "border border-ink-300 text-ink-400"
      }`}
    >
      {done ? <Check className="size-3.5" strokeWidth={3} /> : index}
    </span>
  );
}

/**
 * A refresher, deliberately not a gate: they already watched this to claim the
 * task. It is here for the moment halfway through when a step stops making sense.
 */
function Refresher({
  tutorial,
}: {
  tutorial: { id: string; title: string; streamUrl: string; durationSeconds: number };
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <section className="rounded-xl border border-ink-200 px-4 py-4">
      <p className="text-xs text-ink-400">Stuck on a step?</p>
      <p className="mt-0.5 text-sm font-medium leading-snug text-ink-900">{tutorial.title}</p>
      {open ? (
        <ProtectedVideo
          videoId={tutorial.id}
          streamUrl={tutorial.streamUrl}
          autoPlay
          className="mt-3 w-full rounded-lg bg-ink-900"
        />
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-ink-300 px-3 py-2 text-sm font-medium text-ink-800 transition-colors hover:bg-ink-100"
        >
          <PlayCircle className="size-4" />
          Watch it again
        </button>
      )}
    </section>
  );
}

/**
 * Releasing is the most important control here. Without a blameless way to say
 * "I cannot finish this", people simply stop and the account stays out.
 */
function ReleaseDialog({
  taskId,
  onClose,
  onDone,
}: {
  taskId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = React.useState("Blocked on the platform");
  const [note, setNote] = React.useState("");

  const release = useMutation({
    mutationFn: () => post(`tasks/${taskId}/release`, { reason, progressNote: note }),
    onSuccess: () => {
      toast.success("Given back", { description: "The account is free for somebody else." });
      onDone();
    },
    onError: async (err) => toast.error((await toApiError(err)).message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/40 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-ink-900">Give this task back</h2>
            <p className="mt-1 text-sm leading-relaxed text-ink-500">
              Nothing is held against you. The account goes straight back to the pool and
              anything you uploaded stays on the task.
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

        <label htmlFor="reason" className="mt-5 block text-sm font-medium text-ink-900">
          What happened?
        </label>
        <select
          id="reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-ink-200 px-3 py-2.5 text-sm"
        >
          <option>Blocked on the platform</option>
          <option>Account challenged (2FA or captcha)</option>
          <option>Credentials not working</option>
          <option>Account already flagged</option>
          <option>Ran out of time</option>
          <option>Task is unclear</option>
        </select>

        <label htmlFor="note" className="mt-4 block text-sm font-medium text-ink-900">
          How far did you get?
        </label>
        <textarea
          id="note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="Optional. It saves whoever picks this up next."
          className="mt-1.5 w-full rounded-lg border border-ink-200 px-3 py-2.5 text-sm"
        />

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-ink-200 px-3 py-2.5 text-sm font-medium text-ink-700 hover:bg-ink-100"
          >
            Keep working
          </button>
          <button
            type="button"
            onClick={() => release.mutate()}
            disabled={release.isPending}
            className="flex-1 rounded-lg bg-ink-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-60"
          >
            Give it back
          </button>
        </div>
      </div>
    </div>
  );
}
