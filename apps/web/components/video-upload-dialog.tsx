"use client";

import * as React from "react";
import { toast } from "sonner";
import { CloudUpload, X } from "lucide-react";
import { api, post, toApiError } from "@/lib/api";

export function UploadDialog({
  onClose,
  onDone,
  heading = "Add an onboarding video",
  submitLabel = "Add to the series",
  onUploaded,
}: {
  onClose: () => void;
  onDone?: () => void;
  heading?: string;
  submitLabel?: string;
  /** When given, the caller stores the result instead of the onboarding series. */
  onUploaded?: (v: {
    title: string;
    description?: string;
    videoUrl: string;
    durationSeconds: number;
    provider: string;
    storageRef?: string;
  }) => Promise<void> | void;
}) {
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [duration, setDuration] = React.useState(0);
  const [preview, setPreview] = React.useState<string | null>(null);
  const [progress, setProgress] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  /**
   * Read the duration from the file in the browser. The server has no decoder,
   * and asking an admin to type "how many seconds is it" is the kind of
   * question that makes software feel hostile.
   */
  const take = (f: File) => {
    setFile(f);
    const url = URL.createObjectURL(f);
    setPreview(url);
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.onloadedmetadata = () => setDuration(Math.round(probe.duration) || 0);
    probe.src = url;
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "));
  };

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setProgress(10);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("durationSeconds", String(duration));
      setProgress(40);
      const stored: any = await api.post("tutorials/upload", { body: form }).json();
      setProgress(80);

      const payload = {
        title: title.trim(),
        description: description.trim() || undefined,
        videoUrl: stored.url,
        durationSeconds: stored.durationSeconds || duration,
        provider: stored.provider,
        storageRef: stored.storageRef,
      };

      if (onUploaded) {
        await onUploaded(payload);
      } else {
        await post("onboarding/videos", payload);
      }
      setProgress(100);
      toast.success(onUploaded ? "Video uploaded" : "Video added", {
        description: onUploaded
          ? "It is attached when you save."
          : "Taskers can stream it now. It cannot be downloaded.",
      });
      onDone?.();
    } catch (err) {
      toast.error((await toApiError(err)).message);
    } finally {
      setBusy(false);
      setProgress(0);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/40 p-4 sm:items-center">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold text-ink-900">{heading}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-900"
          >
            <X className="size-4" />
          </button>
        </div>

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) take(f);
          }}
          className="mt-4"
        >
          {preview ? (
            <video src={preview} controls className="w-full rounded-lg bg-ink-900" />
          ) : (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-ink-300 transition-colors hover:border-ink-400 hover:bg-ink-50"
            >
              <CloudUpload className="size-7 text-ink-300" />
              <span className="text-sm font-medium text-ink-700">
                Drop a video here, or browse
              </span>
              <span className="text-xs text-ink-400">MP4 or MOV, up to 500MB</span>
            </button>
          )}
          <input
            ref={inputRef}
            type="file"
            accept="video/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) take(f);
              e.target.value = "";
            }}
          />
        </div>

        {file && (
          <p className="mt-2 text-xs text-ink-500">
            {file.name} · {(file.size / 1024 / 1024).toFixed(1)}MB
            {duration > 0 && ` · ${Math.floor(duration / 60)}m ${duration % 60}s`}
          </p>
        )}

        <label htmlFor="v-title" className="mt-4 block text-sm font-medium text-ink-900">
          Title
        </label>
        <input
          id="v-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Working an account safely"
          className="mt-1.5 w-full rounded-lg border border-ink-200 px-3 py-2.5 text-sm outline-none focus:border-ink-500"
        />

        <label htmlFor="v-desc" className="mt-4 block text-sm font-medium text-ink-900">
          What it covers
        </label>
        <textarea
          id="v-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="One line, shown under the title while they watch."
          className="mt-1.5 w-full rounded-lg border border-ink-200 px-3 py-2.5 text-sm outline-none focus:border-ink-500"
        />

        {busy && (
          <div className="mt-4">
            <div className="h-1.5 overflow-hidden rounded-full bg-ink-200">
              <div
                className="h-full bg-ink-900 transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="mt-1.5 text-xs text-ink-500">
              Uploading. Large files take a minute — leave this open.
            </p>
          </div>
        )}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-ink-200 px-3 py-2.5 text-sm font-medium text-ink-700 hover:bg-ink-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!file || !title.trim() || busy}
            className="flex-1 rounded-lg bg-ink-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-40"
          >
            {busy ? "Uploading…" : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
