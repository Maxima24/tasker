"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, CloudUpload, Film, Trash2 } from "lucide-react";
import { api, get, post, toApiError } from "@/lib/api";
import { UploadDialog } from "@/components/video-upload-dialog";
import { keys } from "@/lib/query-keys";
import { ProtectedVideo } from "@/components/protected-video";

interface OnboardingVideo {
  id: string;
  order: number;
  title: string;
  description: string | null;
  streamUrl: string;
  durationSeconds: number;
  provider: string;
  _count: { progress: number };
}

/**
 * Where the onboarding series is maintained.
 *
 * This is the page a non-technical admin uses most, so it does the fiddly parts
 * itself: it reads the duration out of the file rather than asking, it renames
 * "cloudinary" into a sentence about what that means for taskers, and it says
 * plainly what changing the order does to people mid-way through.
 */
export default function VideosPage() {
  const queryClient = useQueryClient();
  const [adding, setAdding] = React.useState(false);

  const { data: videos, isLoading } = useQuery<OnboardingVideo[]>({
    queryKey: keys.onboardingVideos,
    queryFn: () => get("onboarding/videos"),
  });

  const { data: storage } = useQuery<{ provider: "r2" | "local"; bucket: string | null }>({
    queryKey: keys.videoStorage,
    queryFn: () => get("tutorials/storage"),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.onboardingVideos });

  const reorder = useMutation({
    mutationFn: (ids: string[]) => post("onboarding/videos/reorder", { ids }),
    onSuccess: refresh,
    onError: async (err) => toast.error((await toApiError(err)).message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`onboarding/videos/${id}`).json(),
    onSuccess: () => {
      toast.success("Video removed");
      refresh();
    },
    onError: async (err) => toast.error((await toApiError(err)).message),
  });

  const move = (index: number, direction: -1 | 1) => {
    if (!videos) return;
    const next = [...videos];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    reorder.mutate(next.map((v) => v.id));
  };

  if (isLoading) return <div className="h-64 animate-pulse rounded-xl bg-ink-100" />;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">Onboarding videos</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-500">
            Every new tasker watches these in order before they can claim anything. Task
            tutorials are set per spec version over on Task types.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-ink-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-ink-800"
        >
          <CloudUpload className="size-4" />
          Add a video
        </button>
      </header>

      {storage && (
        <p
          className={`rounded-lg px-4 py-2.5 text-sm ${
            storage.provider === "r2" ? "bg-tint-green text-ok" : "bg-tint-amber text-warn"
          }`}
        >
          {storage.provider === "r2"
            ? "Videos are stored on Cloudflare and streamed to taskers a piece at a time. They play in the app and cannot be downloaded."
            : "Cloudflare storage is not set up yet, so videos are kept on this server. They still stream in pieces and cannot be downloaded. Keep them short and compressed for taskers on mobile data."}
        </p>
      )}

      {!videos?.length ? (
        <div className="rounded-xl border border-dashed border-ink-200 px-6 py-12 text-center">
          <Film className="mx-auto size-8 text-ink-300" />
          <p className="mt-3 font-medium text-ink-900">No onboarding videos yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-ink-500">
            With none set, taskers skip straight to the queue. Add the ones everybody needs
            before they touch an account.
          </p>
        </div>
      ) : (
        <ol className="space-y-3">
          {videos.map((v, i) => (
            <li
              key={v.id}
              className="flex flex-wrap items-start gap-4 rounded-xl border border-ink-200 bg-white px-4 py-4"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-ink-900 text-xs font-medium tabular-nums text-white">
                {i + 1}
              </span>

              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink-900">{v.title}</p>
                {v.description && (
                  <p className="mt-0.5 text-sm leading-relaxed text-ink-500">{v.description}</p>
                )}
                <p className="mt-1 text-xs text-ink-400">
                  {Math.floor(v.durationSeconds / 60)}m {v.durationSeconds % 60}s
                  <span className="mx-1.5 text-ink-300">|</span>
                  {v._count.progress} {v._count.progress === 1 ? "tasker has" : "taskers have"}{" "}
                  started it
                </p>
                <ProtectedVideo
                  videoId={v.id}
                  streamUrl={v.streamUrl}
                  preload="none"
                  className="mt-3 w-full max-w-sm rounded-lg bg-ink-900"
                />
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  className="rounded-lg p-2 text-ink-500 hover:bg-ink-100 disabled:opacity-30"
                  aria-label="Move earlier"
                >
                  <ArrowUp className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === videos.length - 1}
                  className="rounded-lg p-2 text-ink-500 hover:bg-ink-100 disabled:opacity-30"
                  aria-label="Move later"
                >
                  <ArrowDown className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (
                      confirm(
                        `Remove "${v.title}"? Anyone part-way through it loses that progress.`,
                      )
                    ) {
                      remove.mutate(v.id);
                    }
                  }}
                  className="rounded-lg p-2 text-ink-500 hover:bg-tint-red hover:text-danger"
                  aria-label="Remove video"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}

      {adding && (
        <UploadDialog
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}
