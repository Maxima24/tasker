"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, UserPlus, X } from "lucide-react";
import { post, toApiError } from "@/lib/api";
import { keys } from "@/lib/query-keys";

/**
 * Invite-only, so this form is the only way anybody joins.
 *
 * Phone is here because a ticket without a way to reach the person is a ticket
 * somebody has to chase by email and wait. Preferred name is what shows
 * everywhere else - people answer to what they are called, not what is on their
 * documents.
 */
export function InviteDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = React.useState("");
  const [preferredName, setPreferredName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [role, setRole] = React.useState<"TASKER" | "SUB_ADMIN">("TASKER");
  const [created, setCreated] = React.useState<any>(null);

  const invite = useMutation({
    mutationFn: () =>
      post<any>("taskers/invite", {
        name,
        preferredName: preferredName || undefined,
        email,
        phone: phone || undefined,
        role,
      }),
    onSuccess: (user) => {
      setCreated(user);
      queryClient.invalidateQueries({ queryKey: keys.taskers() });
    },
    onError: async (err) => toast.error((await toApiError(err)).message),
  });

  // The password is shown exactly once. It is hashed the moment it is created
  // and cannot be looked up again, so this screen says so rather than letting
  // somebody close it and come back expecting to find it.
  if (created) {
    return (
      <Shell onClose={onClose} heading={`${created.preferredName || created.name} is in`}>
        <p className="mt-1 text-sm text-ink-500">
          Send them these. The password is not stored in readable form, so this is the only
          time it can be shown.
        </p>

        <dl className="mt-4 divide-y divide-ink-200 overflow-hidden rounded-xl border border-ink-200">
          <Row label="Sign in at" value={typeof window !== "undefined" ? window.location.origin : ""} />
          <Row label="Email" value={created.email} copyable />
          <Row label="Temporary password" value={created.tempPassword} copyable mono />
        </dl>

        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(
              `Sign in at ${window.location.origin}\nEmail: ${created.email}\nPassword: ${created.tempPassword}`,
            );
            toast.success("Copied all three");
          }}
          className="mt-4 w-full rounded-lg bg-ink-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-ink-800"
        >
          Copy all three
        </button>
        <button
          type="button"
          onClick={onClose}
          className="mt-2 w-full rounded-lg border border-ink-200 px-4 py-2.5 text-sm font-medium text-ink-700 hover:bg-ink-100"
        >
          Done
        </button>
      </Shell>
    );
  }

  return (
    <Shell onClose={onClose} heading="Invite someone">
      <p className="mt-1 text-sm text-ink-500">
        They get a temporary password you hand over. Nobody can sign themselves up.
      </p>

      <Field
        id="i-name"
        label="Full name"
        value={name}
        onChange={setName}
        placeholder="Chidi Nwosu"
      />
      <Field
        id="i-preferred"
        label="Preferred name"
        hint="What they go by. Shown across the app and on tickets."
        value={preferredName}
        onChange={setPreferredName}
        placeholder="Chidi"
      />
      <Field
        id="i-email"
        label="Email"
        hint="This is their login."
        value={email}
        onChange={setEmail}
        type="email"
        placeholder="chidi@example.com"
      />
      <Field
        id="i-phone"
        label="Phone"
        hint="So you can reach them fast when they raise a ticket."
        value={phone}
        onChange={setPhone}
        type="tel"
        placeholder="+234 801 234 5678"
      />

      <fieldset className="mt-4">
        <legend className="text-sm font-medium text-ink-900">What can they do?</legend>
        <div className="mt-2 space-y-1.5">
          {[
            {
              value: "TASKER" as const,
              label: "Tasker",
              hint: "Claims and works tasks. Never sees the console or Telegram.",
            },
            {
              value: "SUB_ADMIN" as const,
              label: "Sub-admin",
              hint: "Assigns, reviews, records verdicts and handles tickets. Cannot publish specs or manage accounts.",
            },
          ].map((r) => (
            <label
              key={r.value}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                role === r.value ? "border-ink-900 bg-ink-50" : "border-ink-200"
              }`}
            >
              <input
                type="radio"
                name="role"
                className="mt-1"
                checked={role === r.value}
                onChange={() => setRole(r.value)}
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink-900">{r.label}</span>
                <span className="block text-xs leading-relaxed text-ink-500">{r.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

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
          onClick={() => invite.mutate()}
          disabled={!name.trim() || !email.trim() || invite.isPending}
          className="flex-1 rounded-lg bg-ink-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-40"
        >
          {invite.isPending ? "Creating…" : "Create the account"}
        </button>
      </div>
    </Shell>
  );
}

function Shell({
  onClose,
  heading,
  children,
}: {
  onClose: () => void;
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/40 p-4 sm:items-center">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
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
        {children}
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  hint,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div className="mt-4">
      <label htmlFor={id} className="block text-sm font-medium text-ink-900">
        {label}
      </label>
      {hint && <p className="mt-0.5 text-xs text-ink-500">{hint}</p>}
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1.5 w-full rounded-lg border border-ink-200 px-3 py-2.5 text-sm outline-none focus:border-ink-500"
      />
    </div>
  );
}

function Row({
  label,
  value,
  copyable,
  mono,
}: {
  label: string;
  value: string;
  copyable?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <dt className="w-36 shrink-0 text-xs text-ink-500">{label}</dt>
      <dd className={`min-w-0 flex-1 truncate text-sm text-ink-900 ${mono ? "code" : ""}`}>
        {value}
      </dd>
      {copyable && (
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(value);
            toast.success("Copied");
          }}
          className="shrink-0 rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-900"
          aria-label={`Copy ${label}`}
        >
          <Copy className="size-3.5" />
        </button>
      )}
    </div>
  );
}

export { UserPlus };
