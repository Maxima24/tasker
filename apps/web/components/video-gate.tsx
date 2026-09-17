"use client";

import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, Lock, PlayCircle } from "lucide-react";
import { post } from "@/lib/api";
import { ProtectedVideo } from "@/components/protected-video";

export interface WatchableVideo {
  id: string;
  title: string;
  description?: string | null;
  /** A signed, per-person stream link. Never a file address. */
  streamUrl: string;
  durationSeconds: number;
  furthestSeconds: number;
  completed: boolean;
}

/**
 * A video that has to actually be watched.
 *
 * The watermark advances by at most one heartbeat per heartbeat, so dragging
 * the scrubber to the end grants nothing - the bar only fills at the speed the
 * video plays. That is the whole point: this gate exists because the content
 * matters, not because a box needs ticking.
 */
export function VideoGate({
  video,
  locked,
  onComplete,
  compact,
}: {
  video: WatchableVideo;
  locked?: boolean;
  onComplete?: () => void;
  compact?: boolean;
}) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const watermark = React.useRef(video.furthestSeconds);
  const [seconds, setSeconds] = React.useState(video.furthestSeconds);
  const [done, setDone] = React.useState(video.completed);

  const report = useMutation({
    mutationFn: (positionSeconds: number) =>
      post<any>(`tutorials/${video.id}/progress`, { positionSeconds }),
    onSuccess: (data) => {
      if (data.completed && !done) {
        setDone(true);
        onComplete?.();
      }
    },
  });

  React.useEffect(() => {
    if (locked || done) return;
    const id = setInterval(() => {
      const el = videoRef.current;
      if (!el || el.paused) return;
      // Credit contiguous playback only. A seek forward moves currentTime, but
      // the watermark can never gain more than the wall-clock that elapsed.
      watermark.current = Math.min(el.currentTime, watermark.current + 6);
      setSeconds(watermark.current);
      report.mutate(Math.floor(watermark.current));
    }, 5000);
    return () => clearInterval(id);
  }, [locked, done]);

  const pct = Math.min(100, Math.round((seconds / video.durationSeconds) * 100));

  if (locked) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-dashed border-ink-200 bg-ink-50 px-4 py-3">
        <Lock className="size-4 shrink-0 text-ink-300" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink-500">{video.title}</p>
          <p className="text-xs text-ink-400">Finish the video above first.</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`overflow-hidden rounded-lg border ${
        done ? "border-ok/30 bg-tint-green" : "border-ink-200 bg-white"
      }`}
    >
      <div className="flex items-start gap-3 px-4 py-3">
        {done ? (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" />
        ) : (
          <PlayCircle className="mt-0.5 size-4 shrink-0 text-ink-400" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink-900">{video.title}</p>
          {video.description && (
            <p className="mt-0.5 text-xs text-ink-500">{video.description}</p>
          )}
        </div>
        <span className="shrink-0 text-xs tabular-nums text-ink-400">
          {done ? "Watched" : `${pct}%`}
        </span>
      </div>

      <ProtectedVideo
        ref={videoRef}
        videoId={video.id}
        streamUrl={video.streamUrl}
        preload="metadata"
        className={`w-full bg-ink-900 ${compact ? "max-h-56" : "max-h-96"}`}
        onEnded={() => {
          watermark.current = video.durationSeconds;
          setSeconds(video.durationSeconds);
          report.mutate(video.durationSeconds);
        }}
      />

      <div className="h-1.5 w-full bg-ink-200">
        <div
          className={`h-full transition-all ${done ? "bg-ok" : "bg-ink-700"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
