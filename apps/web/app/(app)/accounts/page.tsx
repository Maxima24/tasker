"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, FileSpreadsheet, KeyRound, Pencil, Plus, Search, Users, X } from "lucide-react";
import { get, post, toApiError } from "@/lib/api";
import { keys } from "@/lib/query-keys";
import { AccountBadge } from "@/components/state-badge";
import { relative, formatWAT, formatDayWAT } from "@/lib/utils";
import { Pagination, usePage } from "@/components/pagination";
import { AccountPeopleDialog } from "@/components/account-people-dialog";
import { AccountImportDialog } from "@/components/account-import-dialog";
import { PeopleTable } from "@/components/people-table";
import {
  type AccessType,
  type AccountDetails,
  type LoginField,
  ACCESS_LABEL,
  FIELD_LABEL,
  LOGIN_FIELDS,
  MULTILINE_FIELDS,
  addedViaLabel,
  describeFields,
  hostOf,
} from "@/lib/accounts";

interface Account extends AccountDetails {
  revealCount: number;
  heldBy: {
    taskerName: string;
    taskCode: string;
    taskState: string;
    heldAt: string;
    displacedByRework: boolean;
  } | null;
}

interface AccountPage {
  items: Account[];
  total: number;
  page: number;
  limit: number;
  pageCount: number;
  free: number;
  summary: {
    totalAccounts: number;
    beingWorkedOn: number;
    noOneWorking: number;
    peopleAssigned: number;
  };
}

type Worked = "all" | "yes" | "no";

export default function AccountsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [worked, setWorked] = React.useState<Worked>("all");
  const [page, setPage] = usePage(`${query}|${worked}`);
  const [editing, setEditing] = React.useState<Account | "new" | null>(null);
  const [changingState, setChangingState] = React.useState<Account | null>(null);
  const [people, setPeople] = React.useState<Account | null>(null);
  const [importing, setImporting] = React.useState(false);
  // The sheet's two working tabs: one row per account, or one row per person.
  const [tab, setTab] = React.useState<"accounts" | "people">("accounts");

  // Search as they type, without a request per keystroke.
  React.useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data: paged, isLoading } = useQuery<AccountPage>({
    queryKey: [...keys.accounts, page, query, worked],
    queryFn: () =>
      get(
        `accounts?page=${page}&limit=25${query ? `&q=${encodeURIComponent(query)}` : ""}${
          worked === "all" ? "" : `&worked=${worked}`
        }`,
      ),
    refetchInterval: 20000,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.accounts });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">Accounts</h1>
          <p className="mt-1 max-w-xl text-sm text-ink-500">
            Each account is assigned to the people working it, and their tasks run on it until
            you collect it back. Taskers only ever see the account on their own task.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setImporting(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-ink-300 px-3.5 py-2 text-sm font-medium text-ink-800 hover:bg-ink-50"
          >
            <FileSpreadsheet className="size-4" />
            Import from spreadsheet
          </button>
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="inline-flex items-center gap-1.5 rounded-md bg-ink-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-ink-800"
          >
            <Plus className="size-4" />
            Add account
          </button>
        </div>
      </header>

      <div className="flex gap-6 border-b border-ink-200" role="tablist">
        {(
          [
            ["accounts", "Accounts"],
            ["people", "People"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 pb-2.5 text-sm ${
              tab === key
                ? "border-ink-900 font-semibold text-ink-900"
                : "border-transparent text-ink-500 hover:text-ink-900"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "people" ? (
        <PeopleTable />
      ) : (
      <>
      {/* The manager's Dashboard tab, and the filters it implies. */}
      {paged?.summary && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="Filter accounts">
          {(
            [
              { key: "all", label: "Total accounts", value: paged.summary.totalAccounts },
              { key: "yes", label: "Being worked on", value: paged.summary.beingWorkedOn },
              { key: "no", label: "No one currently working", value: paged.summary.noOneWorking },
            ] as { key: Worked; label: string; value: number }[]
          ).map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setWorked(s.key)}
              aria-pressed={worked === s.key}
              className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                worked === s.key
                  ? "border-ink-900 bg-ink-900 text-white"
                  : "border-ink-200 bg-white text-ink-900 hover:border-ink-300"
              }`}
            >
              <span className="block text-2xl font-semibold tabular-nums">{s.value}</span>
              <span className={`block text-xs ${worked === s.key ? "text-ink-200" : "text-ink-500"}`}>
                {s.label}
              </span>
            </button>
          ))}
          <div className="rounded-xl border border-ink-200 bg-white px-4 py-3">
            <span className="block text-2xl font-semibold tabular-nums text-ink-900">
              {paged.summary.peopleAssigned}
            </span>
            <span className="block text-xs text-ink-500">People assigned</span>
          </div>
        </div>
      )}

      <label className="relative block max-w-sm">
        <span className="sr-only">Search accounts</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by ID, name, owner or tasker"
          className="w-full rounded-lg border border-ink-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-ink-500"
        />
      </label>

      {isLoading ? (
        <div className="h-64 animate-pulse rounded-lg bg-ink-100" />
      ) : !paged?.items.length ? (
        <div className="rounded-xl border border-dashed border-ink-200 px-6 py-12 text-center">
          <KeyRound className="mx-auto size-8 text-ink-300" />
          <p className="mt-3 font-medium text-ink-900">
            {query
              ? `Nothing matches "${query}"`
              : worked === "yes"
                ? "No account is assigned to anyone"
                : worked === "no"
                  ? "Every account has someone on it"
                  : "No accounts yet"}
          </p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-ink-500">
            {query
              ? "Try the account ID, like ACC-002, the owner, or a tasker's name."
              : worked === "all"
                ? "Import the Account Tracker spreadsheet, or add the first account by hand."
                : "Choose Total accounts to see them all."}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-ink-200 overflow-hidden rounded-xl border border-ink-200">
          {paged.items.map((a) => (
            <AccountRow
              key={a.id}
              account={a}
              onEdit={() => setEditing(a)}
              onChangeState={() => setChangingState(a)}
              onPeople={() => setPeople(a)}
            />
          ))}
        </ul>
      )}

      {paged && paged.pageCount > 1 && (
        <div className="overflow-hidden rounded-xl border border-ink-200">
          <Pagination page={paged} onPage={setPage} label="accounts" />
        </div>
      )}
      </>
      )}

      {editing && (
        <AccountDialog
          account={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
      {people && (
        <AccountPeopleDialog
          account={people}
          onClose={() => setPeople(null)}
          onChanged={refresh}
        />
      )}
      {importing && (
        <AccountImportDialog
          onClose={() => setImporting(false)}
          onDone={() => {
            refresh();
            queryClient.invalidateQueries({ queryKey: keys.taskTypes });
          }}
        />
      )}
      {changingState && (
        <StateDialog
          account={changingState}
          onClose={() => setChangingState(null)}
          onSaved={() => {
            setChangingState(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function AccountRow({
  account: a,
  onEdit,
  onChangeState,
  onPeople,
}: {
  account: Account;
  onEdit: () => void;
  onChangeState: () => void;
  onPeople: () => void;
}) {
  const assigned = a.assignedTo ?? [];
  const [open, setOpen] = React.useState(false);

  return (
    <li className="bg-white">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3 px-4 py-4">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-ink-100 text-base font-semibold text-ink-900"
        >
          {(a.platform || a.ref).charAt(0).toUpperCase()}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="code font-semibold text-ink-900">{a.ref}</span>
            <span className="text-sm text-ink-700">
              {[a.label, a.platform].filter(Boolean).join(", ") || "No name set"}
            </span>
            {a.accessType && a.accessType !== "OTHER" && (
              <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[0.7rem] font-medium text-ink-700">
                {a.accessType === "RDP" ? "RDP" : "Morelogin"}
              </span>
            )}
            <AccountBadge state={a.state} />
          </div>

          <p className="mt-1 text-sm text-ink-600">
            {assigned.length ? (
              <>
                <span className="font-medium text-ink-900">
                  {assigned.map((x) => x.name).join(", ")}
                </span>
                {assigned.length === 1 ? `, assigned ${formatDayWAT(assigned[0].since)}` : ""}
              </>
            ) : (
              <span className="text-warn">No one currently working</span>
            )}
            {a.owner && <span className="text-ink-500">, owner {a.owner}</span>}
          </p>
          <p className="mt-0.5 text-xs text-ink-500">
            {a.heldBy ? (
              <>
                In use on <span className="code">{a.heldBy.taskCode}</span> by {a.heldBy.taskerName},{" "}
                {relative(a.heldBy.heldAt)}
              </>
            ) : a.state === "COOLDOWN" && a.cooldownUntil ? (
              `Resting until ${formatWAT(a.cooldownUntil)}`
            ) : a.state === "HEALTHY" ? (
              a.fields.length ? "Not on a task right now" : "Cannot be used until its login details are added"
            ) : (
              "Not handed out while in this state"
            )}
          </p>

          <p className="mt-1 text-xs text-ink-400">
            {describeFields(a.fields).replace(/^./, (c) => c.toUpperCase())} on file.{" "}
            {a.addedBy ? `Added by ${a.addedBy.name} ` : "Added "}
            {addedViaLabel(a.addedVia)}.
          </p>

          {/* The one legitimate case of a tasker holding two accounts. Said out
              loud here so it does not read as a bug in the pool. */}
          {a.heldBy?.displacedByRework && (
            <p className="mt-2 rounded-md bg-tint-violet px-3 py-2 text-xs text-state-paused">
              This hold is kept while {a.heldBy.taskerName} works an interrupting rework. The
              paused task resumes on this same account.
            </p>
          )}
        </div>

        <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto">
          <button
            type="button"
            onClick={onPeople}
            className="inline-flex items-center gap-1.5 rounded-md border border-ink-300 px-3 py-1.5 text-xs font-medium text-ink-800 hover:bg-ink-50"
          >
            <Users className="size-3.5" />
            {assigned.length ? "People" : "Assign"}
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex items-center gap-1.5 rounded-md border border-ink-300 px-3 py-1.5 text-xs font-medium text-ink-800 hover:bg-ink-50"
          >
            <Pencil className="size-3.5" />
            Edit
          </button>
          <button
            type="button"
            onClick={onChangeState}
            className="rounded-md border border-ink-300 px-3 py-1.5 text-xs font-medium text-ink-800 hover:bg-ink-50"
          >
            Change state
          </button>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-ink-500 hover:bg-ink-100 hover:text-ink-900"
          >
            {a.revealCount} {a.revealCount === 1 ? "reveal" : "reveals"}
            <ChevronDown className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {open && <AccountExtras account={a} />}
    </li>
  );
}

/** Sign-in link, instructions and the reveal log - read on demand, not on page load. */
function AccountExtras({ account }: { account: Account }) {
  const { data: reveals, isLoading } = useQuery<
    { id: string; revealedAt: string; actorName: string; actorRole: string | null; taskCode: string | null }[]
  >({
    queryKey: [...keys.accounts, account.id, "reveals"],
    queryFn: () => get(`accounts/${account.id}/reveals`),
  });

  return (
    <div className="grid gap-4 border-t border-ink-100 bg-ink-50 px-4 py-4 sm:grid-cols-2 sm:pl-[4.5rem]">
      <div className="space-y-3 text-sm">
        <div>
          <p className="text-xs text-ink-400">Sign in at</p>
          {account.loginUrl ? (
            <a
              href={account.loginUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="text-ink-800 underline decoration-ink-300 underline-offset-4 hover:text-ink-900"
            >
              {hostOf(account.loginUrl)}
            </a>
          ) : (
            <p className="text-ink-500">No link set</p>
          )}
        </div>
        <div>
          <p className="text-xs text-ink-400">Instructions for the tasker</p>
          <p className="whitespace-pre-wrap text-ink-800">{account.notes || "None"}</p>
        </div>
      </div>

      <div>
        <p className="text-xs text-ink-400">Who revealed the login details</p>
        {isLoading ? (
          <div className="mt-2 h-16 animate-pulse rounded bg-ink-100" />
        ) : !reveals?.length ? (
          <p className="mt-1 text-sm text-ink-500">Nobody has revealed them yet.</p>
        ) : (
          <ul className="mt-1.5 space-y-1.5">
            {reveals.slice(0, 8).map((r) => (
              <li key={r.id} className="flex flex-wrap justify-between gap-x-3 text-sm">
                <span className="text-ink-800">
                  {r.actorName}
                  {r.taskCode && <span className="code ml-1.5 text-xs text-ink-500">{r.taskCode}</span>}
                </span>
                <span className="text-xs tabular-nums text-ink-400">{formatWAT(r.revealedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const FIELD_PLACEHOLDER: Record<LoginField, string> = {
  host: "185.10.20.30:3389",
  username: "ops.acc006",
  email: "ops.acc006@mail.com",
  password: "The account password",
  phone: "+234 800 000 0000",
  twoFactor: "Backup codes, one per line, or the authenticator key",
  recoveryEmail: "recovery@mail.com",
  extra: "Security answers, PINs, anything else needed to sign in",
};

/**
 * Add or edit. Login fields on an existing account are write-only: the form
 * never shows what is stored, it shows WHICH fields are stored, and a blank box
 * leaves the stored value alone. Reading them goes through Reveal, which is
 * logged.
 */
function AccountDialog({
  account,
  onClose,
  onSaved,
}: {
  account: Account | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = !!account;
  const [ref, setRef] = React.useState(account?.ref ?? "");
  const [platform, setPlatform] = React.useState(account?.platform ?? "");
  const [label, setLabel] = React.useState(account?.label ?? "");
  const [loginUrl, setLoginUrl] = React.useState(account?.loginUrl ?? "");
  const [notes, setNotes] = React.useState(account?.notes ?? "");
  const [owner, setOwner] = React.useState(account?.owner ?? "");
  const [access, setAccess] = React.useState<AccessType>(account?.accessType ?? "OTHER");
  const [creds, setCreds] = React.useState<Partial<Record<LoginField, string>>>({});
  const [removing, setRemoving] = React.useState<LoginField[]>([]);
  const [showSecrets, setShowSecrets] = React.useState(false);

  const stored = new Set(account?.fields ?? []);

  const save = useMutation({
    mutationFn: () => {
      const credentials = Object.fromEntries(
        Object.entries(creds).filter(([, v]) => v && v.trim()),
      );
      const body = {
        platform,
        label,
        loginUrl,
        notes,
        owner,
        accessType: access,
        credentials,
        ...(editing ? { removeFields: removing } : { ref }),
      };
      return editing ? post(`accounts/${account!.id}`, body) : post("accounts", body);
    },
    onSuccess: () => {
      toast.success(editing ? "Account saved" : "Account added", {
        description: editing
          ? undefined
          : "It is free to be checked out on the next claim.",
      });
      onSaved();
    },
    onError: async (err) => toast.error((await toApiError(err)).message),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={editing ? `Edit ${account!.ref}` : "Add an account"}
    >
      <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white shadow-xl">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-ink-100 bg-white px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-ink-900">
              {editing ? `Edit ${account!.ref}` : "Add an account"}
            </h2>
            <p className="mt-0.5 text-sm text-ink-500">
              Taskers see the platform, the sign-in link and your instructions. Login details
              stay hidden until they press Reveal.
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

        <form
          className="space-y-6 px-6 py-5"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-3 text-sm font-semibold text-ink-900">The account</legend>
            <Field label="Reference" hint={editing ? "Cannot be changed." : "How everyone refers to it."}>
              <input
                value={ref}
                onChange={(e) => setRef(e.target.value.toUpperCase())}
                disabled={editing}
                required
                placeholder="ACC-006"
                className="code w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-ink-500 disabled:bg-ink-50 disabled:text-ink-500"
              />
            </Field>
            <Field label="Platform">
              <input
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
                placeholder="Upwork"
                className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-ink-500"
              />
            </Field>
            <Field label="Label" hint="Optional. A name that helps you tell accounts apart.">
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Lagos listings"
                className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-ink-500"
              />
            </Field>
            <Field label="Account owner" hint="Who the account belongs to.">
              <input
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                placeholder="Owner's name"
                className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-ink-500"
              />
            </Field>
            <Field label="How taskers get in">
              <select
                value={access}
                onChange={(e) => setAccess(e.target.value as AccessType)}
                className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm"
              >
                {(Object.keys(ACCESS_LABEL) as AccessType[]).map((k) => (
                  <option key={k} value={k}>
                    {ACCESS_LABEL[k]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Sign-in link">
              <input
                value={loginUrl}
                onChange={(e) => setLoginUrl(e.target.value)}
                placeholder="upwork.com/login"
                inputMode="url"
                className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-ink-500"
              />
            </Field>
          </fieldset>

          <fieldset>
            <div className="mb-3 flex items-center justify-between gap-3">
              <legend className="text-sm font-semibold text-ink-900">Login details</legend>
              <button
                type="button"
                onClick={() => setShowSecrets((s) => !s)}
                className="text-xs font-medium text-ink-600 underline decoration-ink-300 underline-offset-4 hover:text-ink-900"
              >
                {showSecrets ? "Hide what I type" : "Show what I type"}
              </button>
            </div>
            {editing && (
              <p className="-mt-1 mb-3 text-xs text-ink-500">
                Leave a box empty to keep what is stored. Type in it to replace it.
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              {LOGIN_FIELDS.filter((f) => f !== "host" || access === "RDP" || stored.has("host")).map((field) => {
                const multiline = MULTILINE_FIELDS.includes(field);
                const isStored = stored.has(field) && !removing.includes(field);
                const common = {
                  value: creds[field] ?? "",
                  autoComplete: "off",
                  spellCheck: false,
                  disabled: removing.includes(field),
                  placeholder: isStored ? "Stored. Leave empty to keep." : FIELD_PLACEHOLDER[field],
                  className:
                    "w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-ink-500 disabled:bg-ink-50",
                };
                return (
                  <div key={field} className={multiline ? "sm:col-span-2" : undefined}>
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <label htmlFor={`f-${field}`} className="text-sm font-medium text-ink-800">
                        {FIELD_LABEL[field]}
                      </label>
                      {editing && stored.has(field) && (
                        <button
                          type="button"
                          onClick={() =>
                            setRemoving((r) =>
                              r.includes(field) ? r.filter((x) => x !== field) : [...r, field],
                            )
                          }
                          className="text-xs text-ink-500 hover:text-danger"
                        >
                          {removing.includes(field) ? "Keep it" : "Remove"}
                        </button>
                      )}
                    </div>
                    {multiline ? (
                      <textarea
                        id={`f-${field}`}
                        rows={2}
                        {...common}
                        onChange={(e) => setCreds((c) => ({ ...c, [field]: e.target.value }))}
                        style={showSecrets ? undefined : ({ WebkitTextSecurity: "disc" } as React.CSSProperties)}
                      />
                    ) : (
                      <input
                        id={`f-${field}`}
                        type={
                          field === "password" && !showSecrets
                            ? "password"
                            : field === "email" || field === "recoveryEmail"
                              ? "email"
                              : "text"
                        }
                        {...common}
                        autoComplete={field === "password" ? "new-password" : "off"}
                        onChange={(e) => setCreds((c) => ({ ...c, [field]: e.target.value }))}
                      />
                    )}
                    {removing.includes(field) && (
                      <p className="mt-1 text-xs text-danger">Will be deleted when you save.</p>
                    )}
                  </div>
                );
              })}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-1.5 text-sm font-semibold text-ink-900">
              Instructions for the tasker
            </legend>
            <p className="mb-2 text-xs text-ink-500">
              Shown on their task, under the account. What to do, and what never to touch.
            </p>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Sign in from the Lagos proxy only. If it asks for a code, raise a ticket."
              className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-ink-500"
            />
          </fieldset>

          <div className="flex gap-2 border-t border-ink-100 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-ink-200 px-3 py-2.5 text-sm font-medium text-ink-700 hover:bg-ink-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={save.isPending || (!editing && !ref.trim())}
              className="flex-1 rounded-lg bg-ink-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-40"
            >
              {save.isPending ? "Saving…" : editing ? "Save account" : "Add account"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink-800">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-400">{hint}</span>}
    </label>
  );
}

const STATES: { value: string; title: string; body: string }[] = [
  { value: "HEALTHY", title: "Healthy", body: "Ready to be checked out on the next claim." },
  {
    value: "COOLDOWN",
    title: "Cooldown",
    body: "Rests for a while, then is free again on its own.",
  },
  {
    value: "CHALLENGED",
    title: "Challenged",
    body: "Asked for a code, captcha or device check. Held back until you clear it.",
  },
  {
    value: "SUSPENDED",
    title: "Suspended",
    body: "Blocked or flagged by the platform. Nobody is given it.",
  },
  { value: "RETIRED", title: "Retired", body: "Finished with for good. Kept only for the record." },
];

function StateDialog({
  account,
  onClose,
  onSaved,
}: {
  account: Account;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [state, setState] = React.useState(account.state);
  const [hours, setHours] = React.useState("6");

  const save = useMutation({
    mutationFn: () =>
      post(`accounts/${account.id}/state`, {
        state,
        cooldownMinutes: state === "COOLDOWN" ? Math.round(Number(hours) * 60) : undefined,
      }),
    onSuccess: () => {
      toast.success(`${account.ref} is now ${STATES.find((s) => s.value === state)?.title.toLowerCase()}`);
      onSaved();
    },
    onError: async (err) => toast.error((await toApiError(err)).message),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={`Change state of ${account.ref}`}
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-ink-900">{account.ref}</h2>
            <p className="mt-0.5 text-sm text-ink-500">
              {account.heldBy
                ? `${account.heldBy.taskerName} is working on it now. Changing the state does not take it off them.`
                : "What should happen to this account?"}
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

        <div className="mt-4 space-y-2" role="radiogroup">
          {STATES.map((s) => (
            <label
              key={s.value}
              className={`flex cursor-pointer gap-3 rounded-lg border px-3.5 py-3 transition-colors ${
                state === s.value ? "border-ink-900 bg-ink-50" : "border-ink-200 hover:border-ink-300"
              }`}
            >
              <input
                type="radio"
                name="state"
                value={s.value}
                checked={state === s.value}
                onChange={() => setState(s.value)}
                className="mt-1 accent-ink-900"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink-900">{s.title}</span>
                <span className="block text-xs leading-relaxed text-ink-500">{s.body}</span>
                {s.value === "COOLDOWN" && state === "COOLDOWN" && (
                  <span className="mt-2 flex items-center gap-2 text-sm text-ink-700">
                    For
                    <input
                      type="number"
                      min="0.5"
                      step="0.5"
                      value={hours}
                      onChange={(e) => setHours(e.target.value)}
                      className="w-20 rounded-md border border-ink-200 px-2 py-1 text-sm tabular-nums"
                    />
                    hours
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>

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
            onClick={() => save.mutate()}
            disabled={save.isPending || (state === "COOLDOWN" && !(Number(hours) > 0))}
            className="flex-1 rounded-lg bg-ink-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-40"
          >
            Save state
          </button>
        </div>
      </div>
    </div>
  );
}
