"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { post, toApiError } from "@/lib/api";

/**
 * Demo shortcuts exist for local development only. A live server never
 * pre-fills a login or advertises which accounts exist.
 */
const SHOW_DEMO = process.env.NEXT_PUBLIC_DEMO_LOGINS === "true";

const DEMO = [
  { label: "Admin", email: "admin@tasker.dev" },
  { label: "Sub-admin", email: "sub@tasker.dev" },
  { label: "Tasker", email: "chidi@tasker.dev" },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = React.useState(SHOW_DEMO ? "admin@tasker.dev" : "");
  const [password, setPassword] = React.useState(SHOW_DEMO ? "password" : "");
  const [error, setError] = React.useState<string | null>(null);

  const login = useMutation({
    mutationFn: () =>
      post<{ user: { role: string; mustChangePassword?: boolean } }>("auth/login", {
        email,
        password,
      }),
    onSuccess: (data) => {
      if (data.user.mustChangePassword) {
        router.push("/password");
        return;
      }
      router.push(data.user.role === "TASKER" ? "/queue" : "/board");
    },
    onError: async (err) => setError((await toApiError(err)).message),
  });

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Tasker</h1>
          <p className="mt-1 text-sm text-ink-500">
            Invite only. Sign in with the email and password your admin gave you.
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            login.mutate();
          }}
          className="space-y-4 rounded-lg border border-ink-200 bg-white p-6"
        >
          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-ink-700">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm outline-none focus:border-ink-500"
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-ink-700">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm outline-none focus:border-ink-500"
            />
          </div>

          {error && (
            <p className="rounded-md bg-tint-red px-3 py-2 text-sm text-state-expired">{error}</p>
          )}

          <button
            type="submit"
            disabled={login.isPending}
            className="w-full rounded-md bg-ink-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-ink-800 disabled:opacity-60"
          >
            {login.isPending ? "Signing in..." : "Sign in"}
          </button>
        </form>

        {SHOW_DEMO && (
          <div className="mt-6 rounded-lg border border-dashed border-ink-200 p-4">
            <p className="mb-2 text-xs font-medium text-ink-500">Demo accounts</p>
            <div className="flex flex-wrap gap-2">
              {DEMO.map((d) => (
                <button
                  key={d.email}
                  type="button"
                  onClick={() => {
                    setEmail(d.email);
                    setPassword("password");
                  }}
                  className="rounded-md border border-ink-200 px-2.5 py-1 text-xs text-ink-700 hover:bg-ink-100"
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
