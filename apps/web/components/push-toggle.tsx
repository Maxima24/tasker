"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bell, BellOff, BellRing, X } from "lucide-react";
import { get, post, toApiError } from "@/lib/api";
import { useFocusTrap } from "@/lib/use-focus-trap";

type Support = "checking" | "ok" | "needs-install" | "needs-https" | "unsupported";

function keyBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function detectSupport(): Support {
  if (typeof window === "undefined") return "checking";
  if (!window.isSecureContext) return "needs-https";
  const apis = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (apis) return "ok";
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const installed =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;
  return ios && !installed ? "needs-install" : "unsupported";
}

/**
 * Ticket alerts on this device, for admins and sub-admins. Sits beside the
 * Telegram link in the header: Telegram reaches the phone app, this reaches
 * the browser or the Home Screen app - so an urgent ticket lands even when
 * one of them is not to hand.
 */
export function PushToggle() {
  const [support, setSupport] = React.useState<Support>("checking");
  const [permission, setPermission] = React.useState<NotificationPermission>("default");
  const [subscribed, setSubscribed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const panelRef = useFocusTrap<HTMLDivElement>(open, () => setOpen(false));

  const { data: config } = useQuery<{ configured: boolean; publicKey: string | null }>({
    queryKey: ["push", "config"],
    queryFn: () => get("push/config"),
    staleTime: 5 * 60 * 1000,
  });

  React.useEffect(() => {
    const s = detectSupport();
    setSupport(s);
    if (s !== "ok") return;
    setPermission(Notification.permission);
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => {
        setSubscribed(!!sub);
        // Keep the server's record in step with the browser - it may have
        // been cleared on the server side while this device stayed subscribed.
        if (sub && Notification.permission === "granted") {
          post("push/subscribe", sub.toJSON()).catch(() => undefined);
        }
      })
      .catch(() => setSupport("unsupported"));
  }, []);

  if (!config?.configured) return null;

  const enable = async () => {
    if (!config.publicKey) return;
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== "granted") {
        toast.error("Notifications were not allowed", {
          description: "Allow them for this site in your browser settings, then try again.",
        });
        return;
      }
      // A subscription made with an older server key cannot be reused.
      const existing = await reg.pushManager.getSubscription();
      if (existing) await existing.unsubscribe();
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(config.publicKey),
      });
      await post("push/subscribe", sub.toJSON());
      setSubscribed(true);
      toast.success("Alerts are on for this device", {
        description: "Send a test to hear what an urgent ticket sounds like.",
      });
    } catch (err) {
      // Browser refusals (a private window, a blocked push service) arrive as
      // DOMExceptions with developer wording. Say what to do instead.
      if (err instanceof DOMException) {
        toast.error("This browser could not sign up for alerts", {
          description:
            "Private or incognito windows cannot receive them. Open Tasker in a normal window and try again.",
        });
      } else {
        toast.error((await toApiError(err)).message);
      }
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await post("push/unsubscribe", { endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setSubscribed(false);
      toast.success("Alerts are off for this device");
    } catch (err) {
      toast.error((await toApiError(err)).message);
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    try {
      const result = await post<{ sent: number; failed: number }>("push/test");
      if (result.sent === 0) {
        toast.error("Nothing was delivered", {
          description: "Turn alerts off and on again on this device, then retry.",
        });
      }
    } catch (err) {
      toast.error((await toApiError(err)).message);
    } finally {
      setBusy(false);
    }
  };

  const on = support === "ok" && permission === "granted" && subscribed;
  const Icon = on ? BellRing : permission === "denied" ? BellOff : Bell;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={on ? "Ticket alerts: on for this device" : "Ticket alerts"}
        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm transition-colors ${
          on ? "border-ok/30 bg-tint-green text-ok" : "border-ink-200 text-ink-700 hover:bg-ink-100"
        }`}
      >
        <Icon className="size-4" />
        <span className="hidden sm:inline">{on ? "Alerts on" : "Alerts"}</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Ticket alerts">
          <div className="absolute inset-0 bg-ink-900/40" onClick={() => setOpen(false)} />
          <div ref={panelRef} tabIndex={-1} className="relative w-full max-w-md rounded-lg bg-white p-6 shadow-xl outline-none">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-semibold text-ink-900">
                  {on ? "Alerts are on for this device" : "Ticket alerts on this device"}
                </h2>
                <p className="mt-1 text-sm leading-relaxed text-ink-500">
                  The moment a tasker raises a ticket, this device shows it, even with the console
                  closed. Urgent ones buzz and stay on screen until you deal with them. Tap{" "}
                  <span className="font-medium text-ink-700">I will handle this</span> on the
                  notification to take it and stop the reminders for everyone.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="rounded p-1 text-ink-500 hover:bg-ink-100"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="mt-5 space-y-3">
              {support === "needs-install" && (
                <p className="rounded-md bg-tint-amber px-3.5 py-3 text-sm leading-relaxed text-ink-800">
                  On an iPhone or iPad, add Tasker to your Home Screen first: tap the Share button,
                  choose <span className="font-medium">Add to Home Screen</span>, then open Tasker
                  from there and turn alerts on.
                </p>
              )}
              {support === "needs-https" && (
                <p className="rounded-md bg-tint-amber px-3.5 py-3 text-sm leading-relaxed text-ink-800">
                  Alerts only work when the console is opened over a secure (https) address. Ask
                  whoever runs the server for the https link.
                </p>
              )}
              {support === "unsupported" && (
                <p className="rounded-md bg-tint-amber px-3.5 py-3 text-sm leading-relaxed text-ink-800">
                  This browser cannot receive notifications. Chrome, Edge, Firefox and Safari all
                  can.
                </p>
              )}
              {support === "ok" && permission === "denied" && (
                <p className="rounded-md bg-tint-red px-3.5 py-3 text-sm leading-relaxed text-ink-800">
                  Notifications are blocked for this site. Allow them in your browser&apos;s site
                  settings, then come back and turn alerts on.
                </p>
              )}

              {support === "ok" && permission !== "denied" && !on && (
                <button
                  type="button"
                  onClick={enable}
                  disabled={busy}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-ink-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-60"
                >
                  <BellRing className="size-4" />
                  {busy ? "Turning on…" : "Turn on alerts"}
                </button>
              )}

              {on && (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={test}
                    disabled={busy}
                    className="flex-1 rounded-md bg-ink-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-60"
                  >
                    Send a test
                  </button>
                  <button
                    type="button"
                    onClick={disable}
                    disabled={busy}
                    className="flex-1 rounded-md border border-ink-300 px-4 py-2.5 text-sm font-medium text-ink-800 hover:bg-ink-100 disabled:opacity-60"
                  >
                    Turn off here
                  </button>
                </div>
              )}

              <p className="text-xs text-ink-400">
                This covers this browser only. Turn it on separately on each phone or computer you
                use.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
