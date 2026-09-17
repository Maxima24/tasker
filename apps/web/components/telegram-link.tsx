"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Send, X } from "lucide-react";
import { post, toApiError } from "@/lib/api";
import { keys } from "@/lib/query-keys";

/**
 * Section 15 - identity binding. The console mints a short-lived nonce and
 * deep-links it into the bot, which exchanges it for a binding to the numeric
 * Telegram user id. Never a username or phone number: both are mutable and
 * recyclable, so binding to one is binding to nothing.
 */
export function TelegramLink({ linked }: { linked: boolean }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [link, setLink] = React.useState<{ url: string; expiresInSeconds: number } | null>(null);

  const mint = useMutation({
    mutationFn: () => post<any>("telegram/link"),
    onSuccess: (data) => {
      setLink(data);
      setOpen(true);
    },
    onError: async (err) => toast.error((await toApiError(err)).message),
  });

  const unbind = useMutation({
    mutationFn: () => post("telegram/unbind"),
    onSuccess: () => {
      toast.success("Telegram unbound", {
        description: "That device can no longer act on your behalf.",
      });
      queryClient.invalidateQueries({ queryKey: keys.me });
      setOpen(false);
    },
    onError: async (err) => toast.error((await toApiError(err)).message),
  });

  return (
    <>
      <button
        type="button"
        onClick={() => (linked ? setOpen(true) : mint.mutate())}
        disabled={mint.isPending}
        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm transition-colors ${
          linked
            ? "border-ok/30 bg-tint-green text-ok"
            : "border-ink-200 text-ink-700 hover:bg-ink-100"
        }`}
      >
        <Send className="size-4" />
        <span className="hidden sm:inline">{linked ? "Telegram linked" : "Link Telegram"}</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-semibold text-ink-900">
                  {linked ? "Telegram is linked" : "Link your Telegram"}
                </h2>
                <p className="mt-0.5 text-sm text-ink-500">
                  {linked
                    ? "You can run reviews and status checks from your phone."
                    : "Open this link on the device you use Telegram on. It expires in 10 minutes."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-ink-500 hover:bg-ink-100"
              >
                <X className="size-4" />
              </button>
            </div>

            {link && !linked && (
              <div className="mt-4 space-y-3">
                <div className="flex items-center gap-2 rounded-md border border-ink-200 bg-ink-50 p-2">
                  <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-xs text-ink-700">
                    {link.url}
                  </code>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(link.url);
                      toast.success("Copied");
                    }}
                    className="shrink-0 rounded p-1.5 text-ink-500 hover:bg-white"
                    aria-label="Copy link"
                  >
                    <Copy className="size-4" />
                  </button>
                </div>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-ink-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-ink-800"
                >
                  <Send className="size-4" />
                  Open in Telegram
                </a>
                <p className="text-xs text-ink-400">
                  Until a Telegram account is bound, the bot ignores it entirely — it will not
                  even say no.
                </p>
              </div>
            )}

            {linked && (
              <div className="mt-4 space-y-3">
                <p className="text-sm text-ink-600">
                  If you lose the device, unbind it here. A stolen phone with an unlocked
                  Telegram session would otherwise carry full operational control.
                </p>
                <button
                  type="button"
                  onClick={() => unbind.mutate()}
                  disabled={unbind.isPending}
                  className="w-full rounded-md border border-danger px-4 py-2 text-sm font-medium text-danger hover:bg-tint-red disabled:opacity-60"
                >
                  Unbind this Telegram account
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
