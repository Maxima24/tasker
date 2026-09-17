"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { get } from "@/lib/api";
import { keys } from "@/lib/query-keys";
import { VideoGate, type WatchableVideo } from "@/components/video-gate";

interface Step extends WatchableVideo {
  order: number;
  unlocked: boolean;
}

interface Onboarding {
  steps: Step[];
  completedCount: number;
  totalCount: number;
  complete: boolean;
}

/**
 * The platform gate. These carry what a tasker needs to work anything at all,
 * so the queue stays locked until the series is finished. Watched in order,
 * because the later ones assume the earlier ones.
 */
export default function OnboardingPage() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<Onboarding>({
    queryKey: keys.onboarding,
    queryFn: () => get("onboarding"),
  });

  if (isLoading) return <div className="h-64 animate-pulse rounded-lg bg-ink-100" />;
  if (!data) return null;

  const pct = data.totalCount
    ? Math.round((data.completedCount / data.totalCount) * 100)
    : 100;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink-900">Getting started</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-500">
          Three short videos covering everything you need before taking on work. Watch them
          through and the task queue opens.
        </p>
      </header>

      <div className="rounded-lg border border-ink-200 p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-ink-900">
            {data.completedCount} of {data.totalCount} watched
          </span>
          <span className="tabular-nums text-ink-500">{pct}%</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink-200">
          <div
            className={`h-full rounded-full transition-all ${data.complete ? "bg-ok" : "bg-ink-900"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        {data.complete ? (
          <Link
            href="/queue"
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-ink-900 px-4 py-2 text-sm font-medium text-white hover:bg-ink-800"
          >
            <CheckCircle2 className="size-4" />
            You are cleared — browse tasks
            <ArrowRight className="size-4" />
          </Link>
        ) : (
          <p className="mt-2 text-xs text-ink-400">
            The queue unlocks once all {data.totalCount} are finished.
          </p>
        )}
      </div>

      <ol className="space-y-4">
        {data.steps.map((step, i) => (
          <li key={step.id}>
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-400">
              Video {i + 1} of {data.totalCount}
            </p>
            <VideoGate
              video={step}
              locked={!step.unlocked}
              onComplete={() => queryClient.invalidateQueries({ queryKey: keys.onboarding })}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}
