"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Clock, Inbox, Lock, PlayCircle, Sparkles } from "lucide-react";
import { get } from "@/lib/api";
import { keys } from "@/lib/query-keys";
import { untilDue } from "@/lib/utils";
import { CapacityMeter } from "@/components/capacity-meter";

interface QueueRow {
  id: string;
  code: string;
  state: string;
  category: "STANDARD" | "CRITICAL";
  dueAt: string | null;
  taskType: { id: string; name: string };
  specVersion: { id: string; version: number };
  checklistLength: number;
  forYou: boolean;
  tutorial: { id: string; title: string; durationSeconds: number; watched: boolean } | null;
  canClaim: boolean;
  blockedBy: "onboarding" | "tutorial" | "capacity" | null;
}

interface Queue {
  capacity: any;
  onboarding: { complete: boolean; remaining: number };
  tasks: QueueRow[];
}

export default function QueuePage() {
  const { data, isLoading } = useQuery<Queue>({
    queryKey: keys.queue,
    queryFn: () => get("tasks/mine/queue"),
    refetchInterval: 15000,
  });

  if (isLoading) return <div className="h-64 animate-pulse rounded-lg bg-ink-100" />;
  if (!data) return null;

  // The platform gate takes over the page. Showing a queue you cannot touch is
  // worse than showing the reason you cannot touch it.
  if (!data.onboarding.complete) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-xl font-semibold text-ink-900">Tasks</h1>
        </header>
        <div className="rounded-lg border border-ink-200 bg-ink-50 px-6 py-10 text-center">
          <Lock className="mx-auto size-8 text-ink-300" />
          <p className="mt-3 font-medium text-ink-900">The queue is not open to you yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-ink-500">
            {data.onboarding.remaining} onboarding{" "}
            {data.onboarding.remaining === 1 ? "video" : "videos"} left. They cover what you need
            to work anything here.
          </p>
          <Link
            href="/onboarding"
            className="mt-5 inline-flex items-center gap-2 rounded-md bg-ink-900 px-4 py-2 text-sm font-medium text-white hover:bg-ink-800"
          >
            <PlayCircle className="size-4" />
            Continue onboarding
          </Link>
        </div>
      </div>
    );
  }

  const forYou = data.tasks.filter((t) => t.forYou);
  const open = data.tasks.filter((t) => !t.forYou);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink-900">Tasks</h1>
        <p className="mt-1 text-sm text-ink-500">
          Pick anything here. Each one has a short video showing how it is done — watch it and
          the task is yours to claim.
        </p>
      </header>

      <CapacityMeter capacity={data.capacity} />

      {forYou.length > 0 && (
        <section>
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-[0.08em] text-ink-700">
            <Sparkles className="size-3.5" />
            Sent to you
          </h2>
          <div className="space-y-2">
            {forYou.map((t) => (
              <QueueCard key={t.id} task={t} />
            ))}
          </div>
        </section>
      )}

      <section>
        {forYou.length > 0 && (
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-[0.08em] text-ink-700">
            Open to everyone
          </h2>
        )}
        {open.length === 0 ? (
          <div className="rounded-lg border border-dashed border-ink-200 px-6 py-12 text-center">
            <Inbox className="mx-auto size-8 text-ink-300" />
            <p className="mt-3 font-medium text-ink-900">No tasks available right now</p>
            <p className="mt-1 text-sm text-ink-500">
              New work lands here as it is created. Check back shortly.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {open.map((t) => (
              <QueueCard key={t.id} task={t} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function QueueCard({ task }: { task: QueueRow }) {
  const due = untilDue(task.dueAt);
  const tutorialPct = task.tutorial
    ? Math.min(100, Math.round((0 / task.tutorial.durationSeconds) * 100))
    : 0;

  return (
    <Link
      href={`/queue/${task.id}`}
      className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-ink-200 bg-white px-4 py-3.5 transition-colors hover:border-ink-300 hover:bg-ink-50"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="code text-xs text-ink-500">{task.code}</span>
          <span className="font-medium text-ink-900">{task.taskType.name}</span>
          {task.category === "CRITICAL" && (
            <span className="rounded-full bg-tint-amber px-2 py-0.5 text-[0.7rem] font-medium text-state-in_review">
              Gets reviewed
            </span>
          )}
        </div>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-500">
          <Clock className="size-3.5" />
          <span className={due.overdue ? "text-danger" : undefined}>{due.text}</span>
          <span className="text-ink-300">|</span>
          <span>{task.checklistLength} steps</span>
          {task.tutorial && (
            <>
              <span className="text-ink-300">|</span>
              <span>{Math.round(task.tutorial.durationSeconds / 60) || 1} min video</span>
            </>
          )}
        </p>
      </div>

      {task.canClaim ? (
        <span className="rounded-md bg-ink-900 px-3.5 py-1.5 text-sm font-medium text-white">
          Claim
        </span>
      ) : task.blockedBy === "tutorial" ? (
        <span className="inline-flex items-center gap-1.5 rounded-md border border-ink-300 px-3 py-1.5 text-sm font-medium text-ink-800">
          <PlayCircle className="size-4" />
          Watch to unlock
        </span>
      ) : task.blockedBy === "capacity" ? (
        <span className="rounded-md bg-ink-100 px-3 py-1.5 text-xs text-ink-500">
          At your limit
        </span>
      ) : null}
    </Link>
  );
}
