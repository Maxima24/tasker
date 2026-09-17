"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { get, post, toApiError } from "@/lib/api";
import { keys } from "@/lib/query-keys";
import type { Me } from "@/components/app-shell";

const MIN_LENGTH = 10;

/**
 * Where a temporary password becomes the person's own. Required on first
 * sign-in after an invite; reachable any time after from the console header.
 */
export default function PasswordPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const { data: me, isError } = useQuery<Me>({
    queryKey: keys.me,
    queryFn: () => get("auth/me"),
    retry: false,
  });

  React.useEffect(() => {
    if (isError) router.replace("/login");
  }, [isError, router]);

  const forced = !!me?.mustChangePassword;
  const home = me?.role === "TASKER" ? "/queue" : "/board";

  const save = useMutation({
    mutationFn: () => post("auth/password", { currentPassword: current, newPassword: next }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.me });
      toast.success("Password changed");
      router.push(home);
    },
    onError: async (err) => setError((await toApiError(err)).message),
  });

  const tooShort = next.length > 0 && next.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && confirm !== next;

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900">
            {forced ? "Choose your own password" : "Change your password"}
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            {forced
              ? "The password you signed in with was set for you. Replace it before you start - nobody else should know yours."
              : `Signed in as ${me?.email ?? "…"}.`}
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            if (next.length < MIN_LENGTH || next !== confirm) return;
            save.mutate();
          }}
          className="space-y-4 rounded-lg border border-ink-200 bg-white p-6"
        >
          <input type="email" autoComplete="username" value={me?.email ?? ""} readOnly hidden />
          <div>
            <label htmlFor="current" className="mb-1.5 block text-sm font-medium text-ink-700">
              {forced ? "Password you were given" : "Current password"}
            </label>
            <input
              id="current"
              type="password"
              autoComplete="current-password"
              required
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm outline-none focus:border-ink-500"
            />
          </div>
          <div>
            <label htmlFor="next" className="mb-1.5 block text-sm font-medium text-ink-700">
              New password
            </label>
            <input
              id="next"
              type="password"
              autoComplete="new-password"
              required
              value={next}
              onChange={(e) => setNext(e.target.value)}
              aria-describedby="next-hint"
              className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm outline-none focus:border-ink-500"
            />
            <p id="next-hint" className={`mt-1 text-xs ${tooShort ? "text-danger" : "text-ink-400"}`}>
              At least {MIN_LENGTH} characters. A short sentence is easy to remember and hard to guess.
            </p>
          </div>
          <div>
            <label htmlFor="confirm" className="mb-1.5 block text-sm font-medium text-ink-700">
              Type it again
            </label>
            <input
              id="confirm"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm outline-none focus:border-ink-500"
            />
            {mismatch && <p className="mt-1 text-xs text-danger">The two passwords do not match.</p>}
          </div>

          {error && (
            <p className="rounded-md bg-tint-red px-3 py-2 text-sm text-state-expired">{error}</p>
          )}

          <button
            type="submit"
            disabled={save.isPending || tooShort || mismatch || !current || !next || !confirm}
            className="w-full rounded-md bg-ink-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-ink-800 disabled:opacity-60"
          >
            {save.isPending ? "Saving..." : "Save password"}
          </button>
        </form>

        {!forced && me && (
          <Link href={home} className="mt-4 inline-block text-sm text-ink-500 hover:text-ink-900">
            Back to Tasker
          </Link>
        )}
      </div>
    </main>
  );
}
