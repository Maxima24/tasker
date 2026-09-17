"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Copy, ExternalLink, Eye, EyeOff } from "lucide-react";
import { post, toApiError } from "@/lib/api";
import { AccountBadge } from "@/components/state-badge";
import { formatWAT, relative } from "@/lib/utils";
import {
  type AccountDetails,
  type LoginDetails,
  type LoginField,
  ACCESS_LABEL,
  FIELD_LABEL,
  MULTILINE_FIELDS,
  addedViaLabel,
  hostOf,
} from "@/lib/accounts";

/**
 * The account a task runs on, as the admin or sub-admin loaded it - from the
 * console or from Telegram.
 *
 * Everything that is not a secret is on the card from the start: the platform,
 * where to sign in, which login details exist, and the instructions left for
 * whoever works it. The values themselves sit in the dark panel, masked, until
 * somebody reveals them. Revealing writes an audit row, and the values clear
 * themselves after a minute rather than sitting on a screen.
 */
export function AccountCard({
  account,
  heading = "Account for this task",
  revealNote = "Revealing is logged against you and this task.",
  helpHref,
}: {
  account: AccountDetails;
  heading?: string;
  revealNote?: string;
  /** Where to send someone whose login does not work. Taskers get a ticket link. */
  helpHref?: string;
}) {
  const [details, setDetails] = React.useState<LoginDetails | null>(null);
  const [total, setTotal] = React.useState(60);
  const [left, setLeft] = React.useState(0);

  React.useEffect(() => {
    if (!details) return;
    if (left <= 0) {
      setDetails(null);
      return;
    }
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [details, left]);

  // Never carry revealed values over to a different account.
  React.useEffect(() => {
    setDetails(null);
    setLeft(0);
  }, [account.id]);

  const reveal = useMutation({
    mutationFn: () =>
      post<{ details: LoginDetails; fields: LoginField[]; expiresInSeconds: number }>(
        `accounts/${account.id}/reveal`,
      ),
    onSuccess: (data) => {
      const seconds = data.expiresInSeconds ?? 60;
      setTotal(seconds);
      setLeft(seconds);
      setDetails(data.details);
    },
    onError: async (err) => toast.error((await toApiError(err)).message),
  });

  const fields = details
    ? (Object.keys(FIELD_LABEL) as LoginField[]).filter((f) => details[f])
    : account.fields;
  const access =
    account.accessType && account.accessType !== "OTHER" ? ACCESS_LABEL[account.accessType] : null;
  const title = account.platform || account.label || access || "Account";
  const monogram = (account.platform || account.ref).trim().charAt(0).toUpperCase();

  return (
    <section className="overflow-hidden rounded-xl border border-ink-200 bg-white">
      <div className="px-4 pt-4">
        <p className="text-xs text-ink-400">{heading}</p>
        <div className="mt-2 flex items-start gap-3">
          <span
            aria-hidden
            className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-ink-100 text-base font-semibold text-ink-900"
          >
            {monogram}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold leading-tight text-ink-900">{title}</p>
            <p className="mt-0.5 truncate text-xs text-ink-500">
              <span className="code text-ink-700">{account.ref}</span>
              {account.platform && account.label ? ` ${account.label}` : ""}
            </p>
            {access && title !== access && (
              <p className="mt-0.5 text-xs text-ink-500">{access}</p>
            )}
          </div>
          <AccountBadge state={account.state} />
        </div>

        {account.state === "COOLDOWN" && account.cooldownUntil && (
          <p className="mt-3 text-xs text-warn">Resting until {formatWAT(account.cooldownUntil)}</p>
        )}

        {account.loginUrl && (
          <a
            href={account.loginUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-800 transition-colors hover:border-ink-400 hover:bg-ink-50"
          >
            <span className="min-w-0">
              <span className="block text-[0.7rem] text-ink-400">Sign in at</span>
              <span className="block truncate font-medium">{hostOf(account.loginUrl)}</span>
            </span>
            <ExternalLink className="size-4 shrink-0 text-ink-400" />
          </a>
        )}
      </div>

      {/* The one dark surface on the page: where the secrets live. */}
      <div className="relative mx-4 mt-3 overflow-hidden rounded-lg bg-ink-900 text-white">
        {details && (
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 h-0.5 origin-left bg-white/70 motion-safe:transition-transform motion-safe:duration-1000 motion-safe:ease-linear"
            style={{ transform: `scaleX(${Math.max(0, left / total)})` }}
          />
        )}

        {fields.length === 0 ? (
          <p className="px-3.5 py-4 text-sm text-ink-300">
            No login details have been loaded for this account yet.
          </p>
        ) : (
          <dl className="divide-y divide-white/10">
            {fields.map((field) => (
              <FieldRow key={field} field={field} value={details?.[field]} />
            ))}
          </dl>
        )}

        {fields.length > 0 && (
          <div className="border-t border-white/10 px-3.5 py-3">
            {details ? (
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs tabular-nums text-ink-300" aria-live="polite">
                  Hiding in {left}s
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setDetails(null);
                    setLeft(0);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-white hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
                >
                  <EyeOff className="size-3.5" />
                  Hide now
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => reveal.mutate()}
                disabled={reveal.isPending}
                className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-white px-3 py-2 text-sm font-semibold text-ink-900 transition-colors hover:bg-ink-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-60"
              >
                <Eye className="size-4" />
                {reveal.isPending ? "Revealing…" : "Reveal login details"}
              </button>
            )}
          </div>
        )}
      </div>
      <p className="mx-4 mt-2 text-xs leading-relaxed text-ink-400">{revealNote}</p>

      {account.notes && (
        <div className="mx-4 mt-4 border-l-2 border-ink-900 pl-3">
          <p className="text-xs font-medium text-ink-900">
            Instructions from {account.addedBy?.name ?? "the admin"}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink-700">
            {account.notes}
          </p>
        </div>
      )}

      <div className="mt-4 border-t border-ink-100 px-4 py-3">
        <p className="text-xs text-ink-400">
          {account.addedBy ? `Added by ${account.addedBy.name} ` : "Added "}
          {addedViaLabel(account.addedVia)}
          {account.detailsUpdatedAt || account.updatedAt
            ? `, updated ${relative(account.detailsUpdatedAt ?? account.updatedAt)}`
            : ""}
        </p>
        {helpHref && (
          <Link
            href={helpHref}
            className="mt-1.5 inline-block text-xs font-medium text-ink-700 underline decoration-ink-300 underline-offset-4 hover:text-ink-900"
          >
            Login not working? Raise a ticket
          </Link>
        )}
      </div>
    </section>
  );
}

function FieldRow({ field, value }: { field: LoginField; value?: string }) {
  const [copied, setCopied] = React.useState(false);
  const multiline = MULTILINE_FIELDS.includes(field);

  const copy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Copying is blocked in this browser. Select the text instead.");
    }
  };

  return (
    <div className="flex items-start gap-2 px-3.5 py-2.5">
      <div className="min-w-0 flex-1">
        <dt className="text-[0.7rem] text-ink-300">{FIELD_LABEL[field]}</dt>
        <dd
          className={`mt-0.5 text-sm ${
            value
              ? `code break-all text-white ${multiline ? "whitespace-pre-wrap" : ""}`
              : "select-none tracking-[0.2em] text-ink-400"
          }`}
        >
          {value ?? "••••••••"}
        </dd>
      </div>
      {value && (
        <button
          type="button"
          onClick={copy}
          aria-label={`Copy ${FIELD_LABEL[field].toLowerCase()}`}
          className="mt-2 shrink-0 rounded p-1.5 text-ink-300 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
      )}
    </div>
  );
}
