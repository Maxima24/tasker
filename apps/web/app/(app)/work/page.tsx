"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Briefcase, Clock, Lock, PlayCircle } from "lucide-react";
import { get } from "@/lib/api";
import { keys } from "@/lib/query-keys";
import { StateBadge, type TaskState } from "@/components/state-badge";
import { untilDue } from "@/lib/utils";
import { CapacityMeter, type Capacity } from "@/components/capacity-meter";
import { ActiveTask } from "@/components/active-task";

interface Held {
  id: string;
  code: string;
  state: TaskState;
  category: "STANDARD" | "CRITICAL";
  dueAt: string | null;
  taskType: { name: string };
  specVersion: { version: number };
  account: { id: string; ref: string; label: string | null; platform: string | null; state: string } | null;
  proofs: { checklistKey: string }[];
  reviews: any[];
}

export default function WorkPage() {
  const { data: tasks, isLoading } = useQuery<Held[]>({
    queryKey: keys.activeTask,
    queryFn: () => get("tasks/mine/active"),
    refetchInterval: 15000,
  });

  const { data: capacity } = useQuery<Capacity>({
    queryKey: keys.capacity,
    queryFn: () => get("me/capacity"),
    refetchInterval: 20000,
  });

  const { data: onboarding } = useQuery<{ complete: boolean; totalCount: number; completedCount: number }>({
    queryKey: keys.onboarding,
    queryFn: () => get("onboarding"),
  });

  const [openId, setOpenId] = React.useState<string | null>(null);

  React.useEffect(() => {
    // Holding exactly one task is the common case — open it rather than making
    // them click through a list of one.
    if (tasks?.length === 1) setOpenId(tasks[0].id);
  }, [tasks]);

  if (isLoading) return <div className="h-64 animate-pulse rounded-lg bg-ink-100" />;

  if (onboarding && !onboarding.complete) {
    const left = onboarding.totalCount - onboarding.completedCount;
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-xl font-semibold text-ink-900">My work</h1>
        </header>
        <div className="rounded-lg border border-ink-200 bg-ink-50 px-6 py-10 text-center">
          <Lock className="mx-auto size-8 text-ink-300" />
          <p className="mt-3 font-medium text-ink-900">Finish onboarding first</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-ink-500">
            {left} {left === 1 ? "video" : "videos"} left. They cover what you need to work
            anything here.
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

  const open = tasks?.find((t) => t.id === openId);

  if (open) {
    return (
      <div className="space-y-4">
        {(tasks?.length ?? 0) > 1 && (
          <button
            type="button"
            onClick={() => setOpenId(null)}
            className="text-sm text-ink-500 hover:text-ink-900"
          >
            ‹ My {tasks!.length} tasks
          </button>
        )}
        <ActiveTask task={open as any} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">My work</h1>
          <p className="mt-1 text-sm text-ink-500">
            {tasks?.length
              ? "Everything you are holding right now."
              : "Nothing checked out to you."}
          </p>
        </div>
        <Link
          href="/queue"
          className="inline-flex items-center gap-1.5 rounded-md bg-ink-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-ink-800"
        >
          Browse tasks
          <ArrowRight className="size-4" />
        </Link>
      </header>

      {capacity && <CapacityMeter capacity={capacity} />}

      {!tasks?.length ? (
        <div className="rounded-lg border border-dashed border-ink-200 px-6 py-12 text-center">
          <Briefcase className="mx-auto size-8 text-ink-300" />
          <p className="mt-3 font-medium text-ink-900">Nothing on your plate</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-ink-500">
            Pick something from the queue. Each task has a short video showing how it is done.
          </p>
          <Link
            href="/queue"
            className="mt-5 inline-flex items-center gap-2 rounded-md bg-ink-900 px-4 py-2 text-sm font-medium text-white hover:bg-ink-800"
          >
            Browse tasks
            <ArrowRight className="size-4" />
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {tasks.map((t) => {
            const due = untilDue(t.dueAt);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setOpenId(t.id)}
                className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-ink-200 bg-white px-4 py-3.5 text-left transition-colors hover:border-ink-300 hover:bg-ink-50"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="code text-xs text-ink-500">{t.code}</span>
                    <span className="font-medium text-ink-900">{t.taskType.name}</span>
                  </div>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-500">
                    <Clock className="size-3.5" />
                    <span className={due.overdue ? "text-danger" : undefined}>{due.text}</span>
                    {t.account && (
                      <>
                        <span className="text-ink-300">|</span>
                        <span>
                          {t.account.platform ? `${t.account.platform} ` : ""}
                          <span className="code">{t.account.ref}</span>
                        </span>
                      </>
                    )}
                    <span className="text-ink-300">|</span>
                    <span>{t.proofs.length} screenshots uploaded</span>
                  </p>
                </div>
                <StateBadge state={t.state} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
