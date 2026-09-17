"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, ChevronRight, FilePlus2, GraduationCap, Plus, ScrollText, Users } from "lucide-react";
import { get } from "@/lib/api";
import { keys } from "@/lib/query-keys";
import { formatWAT } from "@/lib/utils";
import type { Me } from "@/components/app-shell";
import { ProtectedVideo } from "@/components/protected-video";
import {
  type ChecklistItem,
  NewTaskTypeDialog,
  PublishDialog,
  VersionBuilder,
} from "@/components/task-type-builder";

interface SpecVersion {
  id: string;
  version: number;
  checklist: ChecklistItem[];
  publishedAt: string | null;
  tutorial: { id: string; title: string; streamUrl: string; durationSeconds: number } | null;
  certifications: { tasker: { id: string; name: string } }[];
  _count: { certifications: number; tasks: number };
}

interface TaskType {
  id: string;
  name: string;
  category: "STANDARD" | "CRITICAL";
  status: string;
  currentSpecVersionId: string | null;
  specVersions: SpecVersion[];
  _count: { tasks: number };
}

export default function TaskTypesPage() {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [building, setBuilding] = React.useState<TaskType | null>(null);
  const [publishing, setPublishing] = React.useState<string | null>(null);

  const { data: me } = useQuery<Me>({ queryKey: keys.me, queryFn: () => get("auth/me") });
  const { data: types, isLoading } = useQuery<TaskType[]>({
    queryKey: keys.taskTypes,
    queryFn: () => get("task-types"),
  });

  // Open the newest published version of the first type, so the page is never
  // a wall of collapsed rows on arrival.
  React.useEffect(() => {
    if (expanded || !types?.length) return;
    const first = types.find((t) => t.specVersions.some((v) => v.publishedAt));
    const version = first?.specVersions.find((v) => v.publishedAt);
    if (version) setExpanded(version.id);
  }, [types, expanded]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.taskTypes });

  if (isLoading) return <div className="h-64 animate-pulse rounded-lg bg-ink-100" />;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">Task types</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-500">
            What each kind of work requires. Changing the steps makes a new version, so work
            already under way is never changed underneath a tasker.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-ink-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-ink-800"
        >
          <Plus className="size-4" />
          New task type
        </button>
      </header>

      {!types?.length && (
        <div className="rounded-xl border border-dashed border-ink-200 px-6 py-12 text-center">
          <ScrollText className="mx-auto size-8 text-ink-300" />
          <p className="mt-3 font-medium text-ink-900">No task types yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-ink-500">
            Create one, write its steps, attach its tutorial and publish it. Then you can put
            tasks of that type in the queue.
          </p>
        </div>
      )}

      <div className="space-y-4">
        {types?.map((t) => {
          const hasDraft = t.specVersions.some((v) => !v.publishedAt);
          return (
            <article key={t.id} className="overflow-hidden rounded-lg border border-ink-200 bg-white">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-ink-200 px-4 py-3">
                <h2 className="font-semibold text-ink-900">{t.name}</h2>
                <span
                  className={`rounded-full px-2 py-0.5 text-[0.7rem] font-medium ${
                    t.category === "CRITICAL"
                      ? "bg-tint-amber text-state-in_review"
                      : "bg-tint-blue text-state-open"
                  }`}
                >
                  {t.category === "CRITICAL" ? "Critical" : "Standard"}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[0.7rem] font-medium ${
                    t.status === "active" ? "bg-tint-green text-ok" : "bg-tint-grey text-state-draft"
                  }`}
                >
                  {t.status === "active" ? "In use" : t.status === "retired" ? "Retired" : "Draft"}
                </span>
                <span className="ml-auto text-xs text-ink-400">
                  {t._count.tasks} {t._count.tasks === 1 ? "task" : "tasks"} run
                </span>
                <button
                  type="button"
                  onClick={() => setBuilding(t)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-ink-300 px-2.5 py-1 text-xs font-medium text-ink-800 hover:bg-ink-50"
                >
                  <FilePlus2 className="size-3.5" />
                  {t.specVersions.length ? "Change the steps" : "Write the steps"}
                </button>
              </div>

              {t.specVersions.length === 0 ? (
                <p className="m-4 rounded-md bg-tint-amber px-3 py-2 text-sm text-state-in_review">
                  No steps yet, so no task of this type can be put in the queue. Write the steps
                  and attach a tutorial video, then publish.
                </p>
              ) : (
                <>
                  {hasDraft && (
                    <p className="border-b border-ink-100 bg-ink-50 px-4 py-2 text-xs text-ink-600">
                      A draft version is waiting to be published. Taskers keep seeing the current
                      one until it is.
                    </p>
                  )}
                  <div className="divide-y divide-ink-200">
                    {t.specVersions.map((v) => (
                      <SpecVersionRow
                        key={v.id}
                        version={v}
                        isCurrent={t.currentSpecVersionId === v.id}
                        open={expanded === v.id}
                        onToggle={() => setExpanded(expanded === v.id ? null : v.id)}
                        onPublish={() => setPublishing(v.id)}
                      />
                    ))}
                  </div>
                </>
              )}
            </article>
          );
        })}
      </div>

      {creating && (
        <NewTaskTypeDialog
          onClose={() => setCreating(false)}
          onCreated={async (created) => {
            setCreating(false);
            await queryClient.invalidateQueries({ queryKey: keys.taskTypes });
            const fresh = queryClient
              .getQueryData<TaskType[]>(keys.taskTypes)
              ?.find((x) => x.id === created.id);
            // Straight on to the steps: a task type without them is not usable.
            setBuilding(fresh ?? { ...created, category: "STANDARD", status: "draft", currentSpecVersionId: null, specVersions: [], _count: { tasks: 0 } });
          }}
        />
      )}
      {building && (
        <VersionBuilder
          taskType={building}
          onClose={() => setBuilding(null)}
          onSaved={() => {
            setBuilding(null);
            refresh();
          }}
        />
      )}
      {publishing && (
        <PublishDialog
          specVersionId={publishing}
          canPublish={me?.role === "ADMIN"}
          onClose={() => setPublishing(null)}
          onPublished={() => {
            setExpanded(publishing);
            setPublishing(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function SpecVersionRow({
  version,
  isCurrent,
  open,
  onToggle,
  onPublish,
}: {
  version: SpecVersion;
  isCurrent: boolean;
  open: boolean;
  onToggle: () => void;
  onPublish: () => void;
}) {
  const photos = version.checklist?.filter((c) => c.requiresProof).length ?? 0;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-ink-50">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-left"
        >
          <ChevronRight
            className={`size-4 shrink-0 text-ink-400 transition-transform ${open ? "rotate-90" : ""}`}
          />
          <span className="font-medium text-ink-900">Version {version.version}</span>
          {isCurrent && (
            <span className="rounded-full bg-ink-900 px-2 py-0.5 text-[0.7rem] font-medium text-white">
              Current
            </span>
          )}
          <span className="text-xs text-ink-500">
            {version.publishedAt ? `Published ${formatWAT(version.publishedAt)}` : "Draft, not published"}
          </span>
          <span className="text-xs text-ink-400">
            {version.checklist?.length ?? 0} steps, {version._count.certifications} qualified
          </span>
        </button>

        {!version.publishedAt && (
          <button
            type="button"
            onClick={onPublish}
            className="rounded-md bg-ink-900 px-3 py-1 text-xs font-medium text-white hover:bg-ink-800"
          >
            Publish
          </button>
        )}
      </div>

      {open && (
        <div className="space-y-5 border-t border-ink-200 bg-ink-50 px-4 py-4 sm:px-8">
          <section>
            <h3 className="text-sm font-semibold text-ink-900">
              Steps
              <span className="ml-2 font-normal text-ink-500">
                {photos} of {version.checklist?.length ?? 0} need a screenshot
              </span>
            </h3>
            <ol className="mt-2 space-y-1">
              {version.checklist?.map((item, i) => (
                <li
                  key={item.key}
                  className="flex items-center gap-3 rounded-md bg-white px-3 py-2 text-sm"
                >
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-ink-100 text-[0.7rem] tabular-nums text-ink-600">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 text-ink-900">{item.label}</span>
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

          <div className="grid gap-4 sm:grid-cols-2">
            <section className="rounded-md bg-white p-3">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink-900">
                <GraduationCap className="size-4 text-ink-400" />
                Tutorial
              </h3>
              {version.tutorial ? (
                <>
                  <p className="mt-1.5 text-sm text-ink-900">{version.tutorial.title}</p>
                  <p className="text-xs text-ink-400">
                    {Math.floor(version.tutorial.durationSeconds / 60)}m{" "}
                    {version.tutorial.durationSeconds % 60}s
                  </p>
                  <ProtectedVideo
                    videoId={version.tutorial.id}
                    streamUrl={version.tutorial.streamUrl}
                    preload="none"
                    className="mt-2 w-full rounded bg-ink-900"
                  />
                </>
              ) : (
                <p className="mt-1.5 text-sm text-warn">
                  No video attached, so this version cannot be published.
                </p>
              )}
            </section>

            <section className="rounded-md bg-white p-3">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink-900">
                <Users className="size-4 text-ink-400" />
                Qualified on this version
              </h3>
              {version.certifications?.length ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {version.certifications.map((c) => (
                    <span
                      key={c.tasker.id}
                      className="rounded-full bg-ink-100 px-2.5 py-1 text-xs text-ink-700"
                    >
                      {c.tasker.name}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-1.5 text-sm text-ink-500">
                  Nobody yet. Taskers qualify by watching this version&apos;s tutorial through.
                </p>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
