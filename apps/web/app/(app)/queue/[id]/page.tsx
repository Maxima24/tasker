"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Camera, Clock, Lock } from "lucide-react";
import { get, post, toApiError } from "@/lib/api";
import { keys } from "@/lib/query-keys";
import { untilDue } from "@/lib/utils";
import { VideoGate } from "@/components/video-gate";
import { CapacityMeter } from "@/components/capacity-meter";

interface Preview {
  id: string;
  code: string;
  state: string;
  category: "STANDARD" | "CRITICAL";
  dueAt: string | null;
  taskType: { name: string };
  specVersion: { version: number };
  checklist: { key: string; label: string; requiresProof: boolean }[];
  mine: boolean;
  takenByOther: boolean;
  tutorial: {
    id: string;
    title: string;
    description: string | null;
    streamUrl: string;
    durationSeconds: number;
    furthestSeconds: number;
    completed: boolean;
  } | null;
  capacity: any;
  onboardingComplete: boolean;
  canClaim: boolean;
  blockedBy: "onboarding" | "taken" | "tutorial" | "capacity" | null;
}

export default function TaskPreviewPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: task, isLoading } = useQuery<Preview>({
    queryKey: keys.taskPreview(id),
    queryFn: () => get(`tasks/${id}/preview`),
  });

  const claim = useMutation({
    mutationFn: () => post<any>(`tasks/${id}/claim`),
    onSuccess: (data) => {
      if (data.won === false) {
        toast("Already taken", { description: "Somebody else claimed it first." });
        queryClient.invalidateQueries({ queryKey: keys.queue });
        router.push("/queue");
        return;
      }
      toast.success("Task is yours", { description: "An account has been checked out to you." });
      queryClient.invalidateQueries({ queryKey: keys.activeTask });
      queryClient.invalidateQueries({ queryKey: keys.queue });
      router.push("/work");
    },
    onError: async (err) => toast.error((await toApiError(err)).message),
  });

  if (isLoading) return <div className="h-64 animate-pulse rounded-lg bg-ink-100" />;
  if (!task) return null;

  const due = untilDue(task.dueAt);
  const photos = task.checklist.filter((c) => c.requiresProof).length;

  return (
    <div className="space-y-6">
      <Link
        href="/queue"
        className="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-900"
      >
        <ArrowLeft className="size-4" />
        All tasks
      </Link>

      <header>
        <div className="flex flex-wrap items-center gap-2">
          <span className="code text-sm text-ink-500">{task.code}</span>
          {task.category === "CRITICAL" && (
            <span className="rounded-full bg-tint-amber px-2 py-0.5 text-[0.7rem] font-medium text-state-in_review">
              Gets reviewed
            </span>
          )}
        </div>
        <h1 className="mt-1 text-xl font-semibold text-ink-900">{task.taskType.name}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-sm text-ink-500">
          <Clock className="size-4" />
          <span className={due.overdue ? "text-danger" : undefined}>{due.text}</span>
          <span className="text-ink-300">|</span>
          <span>
            {task.checklist.length} steps, {photos} needing a screenshot
          </span>
        </p>
      </header>

      {task.takenByOther && (
        <p className="rounded-lg bg-tint-grey px-4 py-3 text-sm text-ink-600">
          Somebody claimed this while you were looking at it. Nothing lost — pick another.
        </p>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-[0.08em] text-ink-700">
          What the work involves
        </h2>
        <ol className="divide-y divide-ink-200 overflow-hidden rounded-lg border border-ink-200">
          {task.checklist.map((item, i) => (
            <li key={item.key} className="flex items-center gap-3 bg-white px-4 py-2.5">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-ink-100 text-[0.7rem] tabular-nums text-ink-600">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 text-sm text-ink-900">{item.label}</span>
              {item.requiresProof && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded bg-tint-blue px-1.5 py-0.5 text-[0.7rem] font-medium text-state-open">
                  <Camera className="size-3" />
                  screenshot
                </span>
              )}
            </li>
          ))}
        </ol>
      </section>

      {task.tutorial && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-[0.08em] text-ink-700">
            How it is done
          </h2>
          <p className="mb-2 text-sm text-ink-500">
            {task.tutorial.completed
              ? "You have watched this. The task is yours to claim."
              : "Watch this through and the claim button unlocks. It is the only training for this task."}
          </p>
          <VideoGate
            video={task.tutorial}
            onComplete={() => {
              toast.success("Tutorial complete", { description: "You can claim this task now." });
              queryClient.invalidateQueries({ queryKey: keys.taskPreview(id) });
              queryClient.invalidateQueries({ queryKey: keys.queue });
            }}
          />
        </section>
      )}

      <CapacityMeter capacity={task.capacity} />

      <div className="sticky bottom-0 -mx-4 border-t border-ink-200 bg-white px-4 py-3 md:-mx-6 md:px-6">
        {task.mine ? (
          <Link
            href="/work"
            className="inline-flex w-full items-center justify-center rounded-md bg-ink-900 px-5 py-2.5 text-sm font-medium text-white sm:w-auto"
          >
            Open it in my work
          </Link>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => claim.mutate()}
              disabled={!task.canClaim || claim.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-ink-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-40"
            >
              {!task.canClaim && <Lock className="size-4" />}
              {claim.isPending ? "Claiming..." : "Claim this task"}
            </button>
            <p className="text-xs text-ink-500">
              {task.blockedBy === "tutorial"
                ? "Finish the video above to unlock this."
                : task.blockedBy === "capacity"
                  ? task.capacity.reason
                  : task.blockedBy === "taken"
                    ? "This one is gone."
                    : task.blockedBy === "onboarding"
                      ? "Finish onboarding first."
                      : "An account gets checked out to you the moment you claim."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
