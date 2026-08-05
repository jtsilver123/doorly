"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "@/components/Icon";

/**
 * The bell.
 *
 * Everything the app noticed while you weren't looking: a crew member adding
 * a place, a listing you're pursuing changing under you, a price dropping
 * far enough to matter. The badge counts the unseen; opening the panel reads
 * them all, because a badge is for the unseen, not a todo list you have to
 * clear row by row.
 *
 * Polls every couple of minutes rather than holding a socket — a hunt's
 * notifications arrive on the poll's cadence anyway, so realtime plumbing
 * would be complexity spent on a latency nobody can perceive.
 */

export interface Notification {
  id: number;
  kind: "crew_add" | "watched" | "good_drop";
  listingId: string | null;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
}

const KIND_LABEL: Record<Notification["kind"], string> = {
  crew_add: "Crew",
  watched: "Following",
  good_drop: "Price drop",
};

function since(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 2) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export default function NotificationBell({
  onOpenListing,
}: {
  /** Resolves an id to the drawer; the bell doesn't know about listings. */
  onOpenListing: (listingId: string) => void;
}) {
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const body = await fetch("/api/notifications").then((r) => r.json());
      setItems(body.notifications ?? []);
      setUnread(body.unread ?? 0);
    } catch {
      /* the next poll gets another chance */
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 120_000);
    return () => clearInterval(timer);
  }, [load]);

  // Opening reads everything; the rows keep their unread tint until close so
  // you can still see what was new.
  useEffect(() => {
    if (!open || unread === 0) return;
    fetch("/api/notifications", { method: "PATCH" })
      .then(() => setUnread(0))
      .catch(() => {});
  }, [open, unread]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="bell" ref={wrapRef}>
      <button
        className="bell-btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
      >
        <Icon name="bell" size={17} />
        <span>Activity</span>
        {unread > 0 && <b className="bell-count">{unread > 99 ? "99+" : unread}</b>}
      </button>

      {open && (
        <div className="bellpanel" role="dialog" aria-label="Notifications">
          {items.length === 0 && (
            <p className="bellpanel-empty muted">
              Nothing yet. Price changes on places you&apos;re pursuing, big
              drops, and crew activity land here — and on your phone, if you
              turn that on in settings.
            </p>
          )}
          {items.map((n) => (
            <button
              key={n.id}
              className="bellrow"
              data-fresh={!n.read ? "true" : undefined}
              disabled={!n.listingId}
              onClick={() => {
                if (n.listingId) {
                  onOpenListing(n.listingId);
                  setOpen(false);
                }
              }}
            >
              <span className="bellrow-top">
                <i className="bellrow-kind" data-kind={n.kind}>
                  {KIND_LABEL[n.kind]}
                </i>
                <span className="muted">{since(n.createdAt)}</span>
              </span>
              <b>{n.title}</b>
              {n.body && <span className="muted">{n.body}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
