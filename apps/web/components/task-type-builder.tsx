"use client";

import * as React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Camera, CloudUpload, Film, Plus, Trash2, X } from "lucide-react";
import { get, post, toApiError } from "@/lib/api";
import { UploadDialog } from "@/components/video-upload-dialog";

export interface ChecklistItem {
  key: string;
  label: string;
  requiresProof: boolean;
}

function Shell({
  title,
  description,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
  wide?: boolean;
}) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={`flex max-h-[92vh] w-full flex-col overflow-hidden rounded-2xl bg-white shadow-xl ${
          wide ? "max-w-2xl" : "max-w-md"
        }`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-ink-100 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-ink-900">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-ink-500">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-900"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        <div className="flex gap-2 border-t border-ink-100 px-6 py-4">{footer}</div>
      </div>
    </div>
  );
}

const CATEGORIES = [
  {
    value: "STANDARD" as const,
    title: "Standard",
    body: "Closes the moment the tasker submits. Paid on the hours they report. Nobody reviews it.",
  },
  {
    value: "CRITICAL" as const,
    title: "Critical",
    body: "Reviewed by you or a sub-admin, then checked on the platform before it closes.",
  },
];

export function NewTaskTypeDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (taskType: { id: string; name: string }) => void;
}) {
  const [name, setName] = React.useState("");
  const [category, setCategory] = React.useState<"STANDARD" | "CRITICAL">("STANDARD");

  const create = useMutation({
    mutationFn: () => post<{ id: string; name: string }>("task-types", { name, category }),
    onSuccess: (t) => {
      toast.success(`${t.name} created`, {
        description: "Next, write its steps and attach the tutorial video.",
      });
      onCreated(t);
    },
    onError: async (err) => toast.error((await toApiError(err)).message),
  });

  return (
    <Shell
      title="New task type"
      description="A kind of work taskers can be given. You write its steps and attach its video next."
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-ink-200 px-3 py-2.5 text-sm font-medium text-ink-700 hover:bg-ink-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => create.mutate()}
            disabled={!name.trim() || create.isPending}
            className="flex-1 rounded-lg bg-ink-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-40"
          >
            Create task type
          </button>
        </>
      }
    >
      <label htmlFor="tt-name" className="block text-sm font-medium text-ink-800">
        Name
      </label>
      <input
        id="tt-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
        placeholder="Listing verification"
        className="mt-1.5 w-full rounded-lg border border-ink-200 px-3 py-2.5 text-sm outline-none focus:border-ink-500"
      />

      <p className="mt-5 text-sm font-medium text-ink-800">How is it checked?</p>
      <div className="mt-2 space-y-2" role="radiogroup">
        {CATEGORIES.map((c) => (
          <label
            key={c.value}
            className={`flex cursor-pointer gap-3 rounded-lg border px-3.5 py-3 transition-colors ${
              category === c.value ? "border-ink-900 bg-ink-50" : "border-ink-200 hover:border-ink-300"
            }`}
          >
            <input
              type="radio"
              name="category"
              checked={category === c.value}
              onChange={() => setCategory(c.value)}
              className="mt-1 accent-ink-900"
            />
            <span>
              <span className="block text-sm font-medium text-ink-900">{c.title}</span>
              <span className="block text-xs leading-relaxed text-ink-500">{c.body}</span>
            </span>
          </label>
        ))}
      </div>
      <p className="mt-3 text-xs text-ink-400">This cannot be changed later.</p>
    </Shell>
  );
}

/** Stable, readable keys from labels: "Upload the listing" becomes "upload-the-listing". */
function keyFor(label: string, taken: Set<string>): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "step";
  let key = base;
  let n = 2;
  while (taken.has(key)) key = `${base}-${n++}`;
  return key;
}

interface Draft {
  id: number;
  label: string;
  requiresProof: boolean;
}

type TutorialChoice =
  | { kind: "reuse"; id: string; title: string }
  | {
      kind: "new";
      title: string;
      description?: string;
      videoUrl: string;
      durationSeconds: number;
      provider: string;
      storageRef?: string;
    }
  | null;

/**
 * Writes the next version of a task type. It never edits an existing version -
 * tasks already running keep the steps they started with - so this always
 * starts from a copy of the latest one.
 */
export function VersionBuilder({
  taskType,
  onClose,
  onSaved,
}: {
  taskType: {
    id: string;
    name: string;
    specVersions: {
      version: number;
      checklist: ChecklistItem[];
      tutorial: { id: string; title: string } | null;
    }[];
  };
  onClose: () => void;
  onSaved: () => void;
}) {
  const latest = taskType.specVersions[0];
  const nextVersion = (latest?.version ?? 0) + 1;
  const counter = React.useRef(0);
  const [steps, setSteps] = React.useState<Draft[]>(() =>
    latest?.checklist?.length
      ? latest.checklist.map((c) => ({
          id: counter.current++,
          label: c.label,
          requiresProof: c.requiresProof,
        }))
      : [{ id: counter.current++, label: "", requiresProof: true }],
  );
  const [tutorial, setTutorial] = React.useState<TutorialChoice>(
    latest?.tutorial ? { kind: "reuse", id: latest.tutorial.id, title: latest.tutorial.title } : null,
  );
  const [uploading, setUploading] = React.useState(false);
  const listEnd = React.useRef<HTMLInputElement>(null);

  const update = (id: number, patch: Partial<Draft>) =>
    setSteps((s) => s.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  const move = (index: number, dir: -1 | 1) =>
    setSteps((s) => {
      const next = [...s];
      const target = index + dir;
      if (target < 0 || target >= next.length) return s;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const filled = steps.filter((s) => s.label.trim());
  const photos = filled.filter((s) => s.requiresProof).length;

  const save = useMutation({
    mutationFn: () => {
      const taken = new Set<string>();
      const checklist = filled.map((s) => {
        const key = keyFor(s.label, taken);
        taken.add(key);
        return { key, label: s.label.trim(), requiresProof: s.requiresProof };
      });
      return post(`task-types/${taskType.id}/spec-versions`, {
        checklist,
        ...(tutorial?.kind === "reuse" ? { reuseTutorialId: tutorial.id } : {}),
        ...(tutorial?.kind === "new"
          ? {
              tutorial: {
                title: tutorial.title,
                description: tutorial.description,
                videoUrl: tutorial.videoUrl,
                durationSeconds: tutorial.durationSeconds,
                provider: tutorial.provider,
                storageRef: tutorial.storageRef,
              },
            }
          : {}),
      });
    },
    onSuccess: () => {
      toast.success(`Version ${nextVersion} saved`, {
        description: "Taskers do not see it until it is published.",
      });
      onSaved();
    },
    onError: async (err) => toast.error((await toApiError(err)).message),
  });

  return (
    <>
      <Shell
        wide
        title={`${taskType.name}, version ${nextVersion}`}
        description={
          latest
            ? `Starts as a copy of version ${latest.version}. Tasks already running keep the version they started on.`
            : "The steps a tasker follows, and the video that shows them how."
        }
        onClose={onClose}
        footer={
          <>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-ink-200 px-3 py-2.5 text-sm font-medium text-ink-700 hover:bg-ink-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => save.mutate()}
              disabled={save.isPending || filled.length === 0}
              className="flex-1 rounded-lg bg-ink-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-40"
            >
              {save.isPending ? "Saving…" : "Save as draft"}
            </button>
          </>
        }
      >
        <section>
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-semibold text-ink-900">Steps</h3>
            <p className="text-xs tabular-nums text-ink-500">
              {filled.length} {filled.length === 1 ? "step" : "steps"}, {photos} needing a
              screenshot
            </p>
          </div>
          <p className="mt-0.5 text-xs text-ink-500">
            In the order the tasker does them. Tick the ones they must prove with a screenshot.
          </p>

          <ol className="mt-3 space-y-2">
            {steps.map((step, i) => (
              <li
                key={step.id}
                className="flex items-center gap-2 rounded-lg border border-ink-200 bg-white py-1.5 pl-2 pr-1.5"
              >
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-ink-100 text-xs tabular-nums text-ink-600">
                  {i + 1}
                </span>
                <input
                  ref={i === steps.length - 1 ? listEnd : undefined}
                  value={step.label}
                  onChange={(e) => update(step.id, { label: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      setSteps((s) => [
                        ...s.slice(0, i + 1),
                        { id: counter.current++, label: "", requiresProof: true },
                        ...s.slice(i + 1),
                      ]);
                      setTimeout(() => listEnd.current?.focus(), 0);
                    }
                  }}
                  aria-label={`Step ${i + 1}`}
                  placeholder={i === 0 ? "Open the listing and check every field" : "Next step"}
                  className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-sm outline-none focus:bg-ink-50"
                />
                <label
                  className={`inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                    step.requiresProof ? "bg-tint-blue text-state-open" : "text-ink-400 hover:bg-ink-50"
                  }`}
                  title="Needs a screenshot"
                >
                  <input
                    type="checkbox"
                    checked={step.requiresProof}
                    onChange={(e) => update(step.id, { requiresProof: e.target.checked })}
                    className="sr-only"
                  />
                  <Camera className="size-3.5" />
                  <span className="hidden sm:inline">Screenshot</span>
                </label>
                <div className="flex shrink-0">
                  <button
                    type="button"
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    aria-label="Move up"
                    className="rounded p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-900 disabled:opacity-30"
                  >
                    <ArrowUp className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(i, 1)}
                    disabled={i === steps.length - 1}
                    aria-label="Move down"
                    className="rounded p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-900 disabled:opacity-30"
                  >
                    <ArrowDown className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setSteps((s) => s.filter((d) => d.id !== step.id))}
                    disabled={steps.length === 1}
                    aria-label="Remove step"
                    className="rounded p-1.5 text-ink-400 hover:bg-tint-red hover:text-danger disabled:opacity-30"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ol>
          <button
            type="button"
            onClick={() => {
              setSteps((s) => [...s, { id: counter.current++, label: "", requiresProof: true }]);
              setTimeout(() => listEnd.current?.focus(), 0);
            }}
            className="mt-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-ink-700 hover:bg-ink-100"
          >
            <Plus className="size-4" />
            Add a step
          </button>
        </section>

        <section className="mt-7">
          <h3 className="text-sm font-semibold text-ink-900">Tutorial video</h3>
          <p className="mt-0.5 text-xs text-ink-500">
            Taskers watch it through before they can claim this work. Watching it is what
            qualifies them.
          </p>

          {tutorial ? (
            <div className="mt-3 flex items-center gap-3 rounded-lg border border-ink-200 px-3.5 py-3">
              <Film className="size-5 shrink-0 text-ink-400" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink-900">{tutorial.title}</p>
                <p className="text-xs text-ink-500">
                  {tutorial.kind === "reuse"
                    ? `Same video as version ${latest?.version}`
                    : `New upload, ${Math.floor(tutorial.durationSeconds / 60)}m ${tutorial.durationSeconds % 60}s`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setUploading(true)}
                className="shrink-0 rounded-md border border-ink-300 px-2.5 py-1.5 text-xs font-medium text-ink-800 hover:bg-ink-50"
              >
                Replace
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setUploading(true)}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-ink-300 px-4 py-6 text-sm font-medium text-ink-700 hover:border-ink-400 hover:bg-ink-50"
            >
              <CloudUpload className="size-5 text-ink-400" />
              Upload the tutorial
            </button>
          )}
          {!tutorial && (
            <p className="mt-2 text-xs text-warn">
              You can save without one, but it cannot be published until a video is attached.
            </p>
          )}
        </section>
      </Shell>

      {uploading && (
        <UploadDialog
          heading="Upload the tutorial"
          submitLabel="Use this video"
          onClose={() => setUploading(false)}
          onUploaded={(v) => setTutorial({ kind: "new", ...v })}
          onDone={() => setUploading(false)}
        />
      )}
    </>
  );
}

interface Impact {
  taskType: string;
  version: number;
  ready: boolean;
  missing: string[];
  willRequalify: string[];
  inFlightUnaffected: number;
}

/**
 * Publishing reaches backwards: everyone qualified on the old version has to
 * watch the new video before they can claim this work again. This says so,
 * by name, before the click rather than after it.
 */
export function PublishDialog({
  specVersionId,
  canPublish,
  onClose,
  onPublished,
}: {
  specVersionId: string;
  canPublish: boolean;
  onClose: () => void;
  onPublished: () => void;
}) {
  const { data: impact, isLoading } = useQuery<Impact>({
    queryKey: ["spec-versions", specVersionId, "impact"],
    queryFn: () => get(`spec-versions/${specVersionId}/publish-impact`),
  });

  const publish = useMutation({
    mutationFn: () => post<{ supersededCertifications: number }>(`spec-versions/${specVersionId}/publish`),
    onSuccess: (data) => {
      toast.success("Published", {
        description:
          data.supersededCertifications > 0
            ? `${data.supersededCertifications} ${data.supersededCertifications === 1 ? "tasker needs" : "taskers need"} to watch the new video before claiming this work again.`
            : "Taskers can start watching it now.",
      });
      onPublished();
    },
    onError: async (err) => toast.error((await toApiError(err)).message),
  });

  const names = impact?.willRequalify ?? [];

  return (
    <Shell
      title={impact ? `Publish ${impact.taskType}, version ${impact.version}?` : "Publish this version?"}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-ink-200 px-3 py-2.5 text-sm font-medium text-ink-700 hover:bg-ink-100"
          >
            Not yet
          </button>
          <button
            type="button"
            onClick={() => publish.mutate()}
            disabled={!canPublish || !impact?.ready || publish.isPending}
            className="flex-1 rounded-lg bg-ink-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-40"
          >
            {publish.isPending ? "Publishing…" : "Publish"}
          </button>
        </>
      }
    >
      {isLoading || !impact ? (
        <div className="h-24 animate-pulse rounded-lg bg-ink-100" />
      ) : (
        <div className="space-y-4 text-sm leading-relaxed text-ink-700">
          {!impact.ready && (
            <p className="rounded-lg bg-tint-amber px-3.5 py-3 text-state-in_review">
              This version has no tutorial video. Attach one before publishing: watching it is how
              taskers qualify.
            </p>
          )}

          <p>New tasks of this type will use these steps and this video.</p>

          {names.length > 0 ? (
            <div>
              <p>
                {names.length === 1 ? "One tasker is" : `${names.length} taskers are`} qualified on
                the current version and will need to watch the new video before claiming this work
                again:
              </p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {names.map((n) => (
                  <li key={n} className="rounded-full bg-ink-100 px-2.5 py-1 text-xs text-ink-800">
                    {n}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p>Nobody is qualified on an earlier version, so nobody loses access.</p>
          )}

          {impact.inFlightUnaffected > 0 && (
            <p>
              {impact.inFlightUnaffected === 1 ? "One task" : `${impact.inFlightUnaffected} tasks`}{" "}
              already under way {impact.inFlightUnaffected === 1 ? "keeps" : "keep"} the version
              {impact.inFlightUnaffected === 1 ? " it" : " they"} started on.
            </p>
          )}

          {!canPublish && (
            <p className="rounded-lg bg-ink-50 px-3.5 py-3 text-ink-600">
              Only the admin can publish. Save your changes and let them know it is ready.
            </p>
          )}
        </div>
      )}
    </Shell>
  );
}
