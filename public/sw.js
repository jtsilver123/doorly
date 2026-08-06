/**
 * The service worker exists for exactly one thing: showing a push while the
 * app is closed, and opening the right listing when it's tapped. No caching,
 * no offline — a listings app with stale prices is worse than one that needs
 * a connection, so the network keeps its honesty.
 */

self.addEventListener("push", (event) => {
  let payload = { title: "DamnLease", body: "", url: "/app" };
  try {
    payload = { ...payload, ...event.data.json() };
  } catch {
    /* an empty push still shows something rather than nothing */
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icon.svg",
      badge: "/icon.svg",
      data: { url: payload.url },
      // One notification per listing: a second change to the same place
      // replaces the first instead of stacking.
      tag: payload.url,
      renotify: true,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  let url = event.notification.data?.url || "/app";
  // Notifications delivered before the app moved to /app carry root URLs;
  // clicking one should still land in the app, not on the pitch.
  url = url.replace(/^(https?:\/\/[^/]+)?\/(\?|#|$)/, "$1/app$2");
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      // Re-use an open tab if there is one — a stack of identical tabs is
      // what every badly-behaved push notification does.
      for (const win of wins) {
        if (win.url.startsWith(self.registration.scope)) {
          win.navigate(url);
          return win.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
