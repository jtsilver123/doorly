"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Device notifications, as a hook.
 *
 * The dance is standard but fiddly — service worker registration, permission
 * prompt, PushManager subscription, telling the server — and the states that
 * matter to the UI are only these four. "unsupported" covers iOS Safari
 * outside an installed PWA and any http origin.
 */

export type PushState = "unsupported" | "off" | "pending" | "on";

/**
 * Base64url VAPID key to the BufferSource PushManager wants. Built on an
 * explicit ArrayBuffer because TypeScript 5.7's DOM types distinguish
 * ArrayBufferLike-backed views, and `Uint8Array.from` produces the wrong one.
 */
function decodeKey(base64: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const buffer = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buffer;
}

export function usePush(): { state: PushState; enable: () => void; disable: () => void } {
  const [state, setState] = useState<PushState>("off");

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    ) {
      setState("unsupported");
      return;
    }
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setState(sub ? "on" : "off"))
      .catch(() => setState("unsupported"));
  }, []);

  const enable = useCallback(async () => {
    setState("pending");
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState("off");
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeKey(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!),
      });
      await fetch("/api/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      setState("on");
    } catch {
      setState("off");
    }
  }, []);

  const disable = useCallback(async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
    } finally {
      setState("off");
    }
  }, []);

  return { state, enable, disable };
}
