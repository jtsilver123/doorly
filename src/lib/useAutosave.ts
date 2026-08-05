"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Autosave.
 *
 * Every settings form in the app ended in a Save button, which is a way of
 * asking somebody to remember to press a thing after they've already finished
 * the actual work. It also means every unsaved edit is one navigation away
 * from being lost, silently.
 *
 * So the forms save themselves. A short debounce so it isn't one write per
 * keystroke, a serialised comparison so an edit-and-undo writes nothing, and
 * a status line that says which of the three states it's in — because
 * autosave with no feedback is just hoping.
 *
 * The first run only records the baseline. Mounting a form is not an edit, and
 * without that guard every page load would write the profile back to itself.
 */

export type SaveState = "idle" | "saving" | "saved";

export function useAutosave<T>(
  value: T,
  save: (value: T) => Promise<void> | void,
  { delay = 700, enabled = true }: { delay?: number; enabled?: boolean } = {}
): SaveState {
  const [state, setState] = useState<SaveState>("idle");
  const lastSaved = useRef<string | null>(null);
  const clearSaved = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Kept in a ref so a save function redefined on every render — which is
  // most of them — doesn't restart the debounce and stop it ever firing.
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    if (!enabled) return;
    const serialised = JSON.stringify(value);
    if (lastSaved.current === null) {
      lastSaved.current = serialised;
      return;
    }
    if (lastSaved.current === serialised) return;

    const timer = setTimeout(async () => {
      setState("saving");
      try {
        await saveRef.current(value);
        lastSaved.current = serialised;
        setState("saved");
        if (clearSaved.current) clearTimeout(clearSaved.current);
        clearSaved.current = setTimeout(() => setState("idle"), 1800);
      } catch {
        setState("idle");
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [value, delay, enabled]);

  useEffect(
    () => () => {
      if (clearSaved.current) clearTimeout(clearSaved.current);
    },
    []
  );

  return state;
}

/** The status line. Says what it's doing, or what it will do. */
export function saveLabel(state: SaveState): string {
  if (state === "saving") return "Saving…";
  if (state === "saved") return "Saved";
  return "Saves as you type";
}
