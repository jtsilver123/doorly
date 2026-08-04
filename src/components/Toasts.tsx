"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Transient feedback, with an escape hatch.
 *
 * Triage runs on single keystrokes, so mistakes are inevitable and the app
 * shouldn't punish them. Every destructive action reports itself here with an
 * Undo attached, which is what makes it safe to go fast — the alternative is a
 * confirmation dialog on every card, which would make it unusable.
 *
 * Status lives here rather than in the sidebar because feedback belongs near
 * where you're looking, and because it should leave on its own.
 */

export interface Toast {
  id: number;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: "default" | "good" | "warn";
}

let nextId = 1;

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = nextId++;
      setToasts((list) => [...list.slice(-2), { ...toast, id }]);
      // Undoable toasts linger; plain confirmations get out of the way.
      const ttl = toast.onAction ? 7000 : 3200;
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), ttl)
      );
      return id;
    },
    [dismiss]
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  return { toasts, push, dismiss };
}

export default function Toasts({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  if (!toasts.length) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.tone ?? "default"}`}>
          <span>{toast.message}</span>
          {toast.actionLabel && toast.onAction && (
            <button
              className="toast-action"
              onClick={() => {
                toast.onAction?.();
                onDismiss(toast.id);
              }}
            >
              {toast.actionLabel}
            </button>
          )}
          <button
            className="toast-close"
            onClick={() => onDismiss(toast.id)}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
