"use client";

import * as React from "react";
import { toast } from "sonner";
import { AlertTriangle, Check, FileSpreadsheet, X } from "lucide-react";
import { api, toApiError } from "@/lib/api";
import { ACCESS_LABEL, type AccessType } from "@/lib/accounts";

interface PersonPlan {
  name: string;
  role: string;
  active: boolean;
  assignedAt: string | null;
  match: { id: string; name: string } | null;
  action: "assign" | "already" | "collect" | "history" | "unmatched";
  note?: string;
}

interface AccountPlan {
  row: number;
  ref: string;
  label: string | null;
  owner: string | null;
  accessType: AccessType;
  action: "create" | "update";
  login: { host: boolean; username: boolean; email: boolean; password: boolean };
  people: PersonPlan[];
  outcome?: "done" | "failed";
  error?: string;
}

interface ImportResult {
  committed: boolean;
  sheets: { accounts: string; people: string | null; projects: string | null; tasks: string | null };
  accounts: AccountPlan[];
  projects: { name: string; accounts: number; exists: boolean; outcome?: "created" | "failed" }[];
  tasksInSheet: number;
  warnings: string[];
  totals: {
    create: number;
    update: number;
    withoutLogin: number;
    assign: number;
    unmatched: string[];
    failed: number;
  };
}

function loginSummary(a: AccountPlan): { text: string; warn: boolean } {
  const l = a.login;
  const parts = [
    l.host && "IP",
    l.username && "username",
    l.email && "email",
    l.password && "password",
  ].filter(Boolean);
  if (parts.length) return { text: parts.join(", "), warn: false };
  return a.action === "update"
    ? { text: "Keeps its current login", warn: false }
    : { text: "No login details yet", warn: true };
}

function personLine(p: PersonPlan): { text: string; tone: "ok" | "warn" | "muted" } {
  const who = p.match?.name ?? p.name;
  switch (p.action) {
    case "assign":
      return { text: `Assign to ${who}`, tone: "ok" };
    case "already":
      return { text: `${who} already has it`, tone: "muted" };
    case "collect":
      return { text: `Collect from ${who}`, tone: "warn" };
    case "history":
      return { text: `${who} (past, kept as history)`, tone: "muted" };
    default:
      return { text: `${p.name}: not on the platform yet`, tone: "warn" };
  }
}

/**
 * Brings the manager's Account Tracker spreadsheet in. The file is read twice:
 * once to show exactly what will happen, then again when confirmed. Passwords
 * never come back to the browser - the preview only says which details exist.
 */
export function AccountImportDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const [file, setFile] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<ImportResult | null>(null);
  const [result, setResult] = React.useState<ImportResult | null>(null);
  const [categories, setCategories] = React.useState<Record<string, "STANDARD" | "CRITICAL">>({});
  const [busy, setBusy] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);

  const send = async (chosen: File, commit: boolean) => {
    const form = new FormData();
    form.append("file", chosen);
    if (commit) form.append("categories", JSON.stringify(categories));
    return api
      .post(`accounts/import${commit ? "?commit=1" : ""}`, { body: form, timeout: 120_000 })
      .json<ImportResult>();
  };

  const choose = async (chosen: File) => {
    setFile(chosen);
    setPreview(null);
    setResult(null);
    setBusy(true);
    try {
      setPreview(await send(chosen, false));
    } catch (err) {
      toast.error((await toApiError(err)).message);
      setFile(null);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const done = await send(file, true);
      setResult(done);
      const ok = done.accounts.filter((a) => a.outcome === "done").length;
      toast.success(`${ok} ${ok === 1 ? "account" : "accounts"} imported`, {
        description: done.totals.failed ? `${done.totals.failed} could not be imported - see the list.` : undefined,
      });
      onDone();
    } catch (err) {
      toast.error((await toApiError(err)).message);
    } finally {
      setBusy(false);
    }
  };

  const shown = result ?? preview;
  const newProjects = preview?.projects.filter((p) => !p.exists) ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Import from spreadsheet"
    >
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-ink-100 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-ink-900">Import from spreadsheet</h2>
            <p className="mt-0.5 text-sm text-ink-500">
              Upload the Account Tracker workbook (.xlsx). You will see everything it would do
              before anything is saved.
            </p>
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

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {!shown && (
            <button
              type="button"
              onClick={() => input.current?.click()}
              disabled={busy}
              className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-ink-300 px-4 py-10 text-center hover:border-ink-400 hover:bg-ink-50 disabled:opacity-60"
            >
              <FileSpreadsheet className="size-8 text-ink-300" />
              <span className="text-sm font-medium text-ink-800">
                {busy ? "Reading the spreadsheet…" : "Choose the spreadsheet"}
              </span>
              <span className="max-w-md text-xs text-ink-500">
                An Accounts tab with Account ID, Account Name, Account Owner, Tasker, Login
                IP/Username and Login Password. People and Projects tabs are read too.
              </span>
            </button>
          )}
          <input
            ref={input}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) choose(f);
              e.target.value = "";
            }}
          />

          {shown && (
            <div className="space-y-5">
              <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-lg bg-ink-50 px-4 py-3 text-sm">
                {result ? (
                  <p className="flex items-center gap-1.5 font-medium text-ok">
                    <Check className="size-4" />
                    Imported
                  </p>
                ) : null}
                <p>
                  <span className="font-semibold tabular-nums text-ink-900">{shown.totals.create}</span>{" "}
                  new
                </p>
                <p>
                  <span className="font-semibold tabular-nums text-ink-900">{shown.totals.update}</span>{" "}
                  already here, will be updated
                </p>
                <p>
                  <span className="font-semibold tabular-nums text-ink-900">{shown.totals.assign}</span>{" "}
                  to assign
                </p>
                {shown.totals.withoutLogin > 0 && (
                  <p className="text-warn">
                    <span className="font-semibold tabular-nums">{shown.totals.withoutLogin}</span>{" "}
                    with no login details yet
                  </p>
                )}
              </div>

              {shown.totals.unmatched.length > 0 && (
                <div className="flex gap-2.5 rounded-lg bg-tint-amber px-4 py-3 text-sm text-ink-800">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />
                  <p>
                    Not on the platform yet, so their accounts come in without them:{" "}
                    <span className="font-medium">{shown.totals.unmatched.join(", ")}</span>. Invite
                    them from Taskers, then import again or assign by hand.
                  </p>
                </div>
              )}

              {shown.warnings.map((w) => (
                <p key={w} className="text-sm text-warn">
                  {w}
                </p>
              ))}

              <div className="overflow-x-auto rounded-lg border border-ink-200">
                <table className="w-full min-w-[40rem] text-left text-sm">
                  <thead className="bg-ink-50 text-xs text-ink-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">Account</th>
                      <th className="px-3 py-2 font-medium">Access</th>
                      <th className="px-3 py-2 font-medium">Login in the sheet</th>
                      <th className="px-3 py-2 font-medium">People</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {shown.accounts.map((a) => (
                      <tr key={a.ref} className={a.outcome === "failed" ? "bg-tint-red" : undefined}>
                        <td className="px-3 py-2 align-top">
                          <p className="code font-medium text-ink-900">{a.ref}</p>
                          <p className="text-xs text-ink-500">
                            {a.action === "create" ? "New" : "Update"}
                            {a.owner ? `, owner ${a.owner}` : ""}
                          </p>
                          {a.error && <p className="mt-1 text-xs text-danger">{a.error}</p>}
                        </td>
                        <td className="px-3 py-2 align-top text-ink-700">
                          <p>
                            {a.action === "update" && a.accessType === "OTHER"
                              ? "Unchanged"
                              : ACCESS_LABEL[a.accessType]}
                          </p>
                          {a.label && <p className="max-w-[12rem] truncate text-xs text-ink-500">{a.label}</p>}
                        </td>
                        <td
                          className={`px-3 py-2 align-top ${
                            loginSummary(a).warn ? "text-warn" : "text-ink-700"
                          }`}
                        >
                          {loginSummary(a).text}
                        </td>
                        <td className="px-3 py-2 align-top">
                          {a.people.length === 0 ? (
                            <span className="text-ink-400">No one</span>
                          ) : (
                            a.people.map((p, i) => {
                              const line = personLine(p);
                              return (
                                <p
                                  key={i}
                                  className={
                                    line.tone === "ok"
                                      ? "text-ink-900"
                                      : line.tone === "warn"
                                        ? "text-warn"
                                        : "text-ink-500"
                                  }
                                >
                                  {line.text}
                                </p>
                              );
                            })
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {shown.projects.length > 0 && (
                <section>
                  <h3 className="text-sm font-semibold text-ink-900">Projects become task types</h3>
                  <ul className="mt-2 space-y-2">
                    {shown.projects.map((p) => (
                      <li key={p.name} className="flex flex-wrap items-center gap-3 text-sm">
                        <span className="font-medium text-ink-900">{p.name}</span>
                        <span className="text-xs text-ink-500">
                          on {p.accounts} {p.accounts === 1 ? "account" : "accounts"}
                        </span>
                        {p.exists ? (
                          <span className="text-xs text-ink-500">already a task type</span>
                        ) : p.outcome ? (
                          <span className={`text-xs ${p.outcome === "created" ? "text-ok" : "text-danger"}`}>
                            {p.outcome === "created" ? "created as a draft" : "could not be created"}
                          </span>
                        ) : (
                          <select
                            value={categories[p.name] ?? "STANDARD"}
                            onChange={(e) =>
                              setCategories((c) => ({
                                ...c,
                                [p.name]: e.target.value as "STANDARD" | "CRITICAL",
                              }))
                            }
                            aria-label={`How ${p.name} is checked`}
                            className="rounded-md border border-ink-200 px-2 py-1 text-xs"
                          >
                            <option value="STANDARD">Standard: closes on submit</option>
                            <option value="CRITICAL">Critical: reviewed, then verified</option>
                          </select>
                        )}
                      </li>
                    ))}
                  </ul>
                  {newProjects.length > 0 && !result && (
                    <p className="mt-2 text-xs text-ink-500">
                      New task types arrive as drafts. Add their steps and tutorial on Task types
                      before tasks of that kind can go in the queue.
                    </p>
                  )}
                </section>
              )}

              {shown.tasksInSheet > 0 && (
                <p className="text-xs text-ink-500">
                  The Tasks tab ({shown.tasksInSheet} {shown.tasksInSheet === 1 ? "row" : "rows"}) is
                  not imported. Tasks are recorded here from now on, as they are claimed and
                  submitted.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-ink-100 px-6 py-4">
          {shown && !result && (
            <button
              type="button"
              onClick={() => input.current?.click()}
              disabled={busy}
              className="rounded-lg border border-ink-200 px-3 py-2.5 text-sm font-medium text-ink-700 hover:bg-ink-100"
            >
              Choose a different file
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-ink-200 px-4 py-2.5 text-sm font-medium text-ink-700 hover:bg-ink-100"
            >
              {result ? "Close" : "Cancel"}
            </button>
            {preview && !result && (
              <button
                type="button"
                onClick={confirm}
                disabled={busy || preview.accounts.length === 0}
                className="rounded-lg bg-ink-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-40"
              >
                {busy
                  ? "Importing…"
                  : `Import ${preview.accounts.length} ${preview.accounts.length === 1 ? "account" : "accounts"}`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
