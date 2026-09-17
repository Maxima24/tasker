/*
 * Tasker service worker: receives ticket alerts for admins and sub-admins and
 * turns them into notifications, even when no Tasker tab is open.
 *
 * Deliberately does nothing else - no caching, no offline pages - so it can
 * never serve a stale console.
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Tasker", body: event.data ? event.data.text() : "" };
  }

  const urgent = Boolean(data.urgent);
  const actions =
    data.claimable && data.ticketId
      ? [
          { action: "claim", title: "I will handle this" },
          { action: "open", title: "Open ticket" },
        ]
      : [];

  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/badge-96.png",
    // One notification per ticket: a reminder or "picked up" replaces the alert
    // instead of piling up beside it.
    tag: data.tag || undefined,
    renotify: Boolean(data.tag && (data.renotify || urgent)),
    // Urgent tickets stay on screen and buzz; the rest arrive quietly.
    requireInteraction: urgent,
    silent: !urgent,
    vibrate: urgent ? [300, 120, 300, 120, 600] : undefined,
    timestamp: Date.now(),
    actions,
    data: { url: data.url || "/tickets", ticketId: data.ticketId || null },
  };

  event.waitUntil(self.registration.showNotification(data.title || "Tasker", options));
});

async function openUrl(url) {
  const target = new URL(url, self.location.origin).href;
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of windows) {
    if (new URL(client.url).origin !== self.location.origin) continue;
    try {
      if ("navigate" in client) await client.navigate(target);
    } catch {
      // An uncontrolled tab cannot be navigated; focusing it is still better
      // than opening a second console.
    }
    if ("focus" in client) return client.focus();
  }
  return self.clients.openWindow(target);
}

self.addEventListener("notificationclick", (event) => {
  const notification = event.notification;
  const data = notification.data || {};
  notification.close();

  if (event.action === "claim" && data.ticketId) {
    event.waitUntil(
      (async () => {
        let message;
        try {
          const res = await fetch(`/api/tickets/${data.ticketId}/claim`, {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: "{}",
          });
          if (res.status === 401) return openUrl("/login");
          const body = await res.json().catch(() => ({}));
          if (res.ok && body.won) {
            message = "You have it. Reminders have stopped for everyone else.";
          } else if (res.ok) {
            message = `${body.claimedBy || "Somebody"} is already handling it.`;
          } else {
            message = (body && body.message) || "That did not work. Open the ticket instead.";
          }
        } catch {
          message = "No connection. Open the ticket when you are back online.";
        }
        await self.registration.showNotification("Ticket", {
          body: message,
          tag: notification.tag || undefined,
          icon: "/icon-192.png",
          badge: "/badge-96.png",
          silent: true,
          data,
        });
      })(),
    );
    return;
  }

  event.waitUntil(openUrl(data.url || "/tickets"));
});

function keyBytes(base64) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

// Browsers occasionally rotate a subscription. Re-register quietly so the
// device keeps receiving alerts without anybody noticing it happened.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const res = await fetch("/api/push/config", { credentials: "include" });
      if (!res.ok) return;
      const config = await res.json();
      if (!config.publicKey) return;
      const subscription = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(config.publicKey),
      });
      await fetch("/api/push/subscribe", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
    })(),
  );
});
