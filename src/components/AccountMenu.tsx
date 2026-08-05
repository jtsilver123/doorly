"use client";

import { useEffect, useRef, useState } from "react";
import { signOut } from "@/app/auth/actions";
import Icon from "@/components/Icon";

/**
 * The account button, bottom-left.
 *
 * Everything that belongs to *you* rather than to the search now lives behind
 * one avatar: your details, the documents you can show, the search itself, the
 * API key, and signing out. It used to be a top-level nav item called
 * "Settings" sitting beside Today and Listings — which put four unrelated
 * configuration panels at the same level as the screens you use every day, and
 * left a bare email address and an underlined "Sign out" loose at the bottom of
 * the rail.
 *
 * The menu opens upward because the button is the last thing in the column;
 * dropping down would put it off-screen.
 */

export type ProfileSection = "search" | "details" | "packet" | "api" | "crew";

const ITEMS: { key: ProfileSection; label: string; hint: string }[] = [
  { key: "details", label: "Your details", hint: "Name, income, what you can show" },
  { key: "search", label: "Your search", hint: "Neighborhoods, budget, size" },
  { key: "crew", label: "Search together", hint: "Invite helpers or a roommate" },
  { key: "packet", label: "Application packet", hint: "Documents to get ready" },
  { key: "api", label: "Data & refresh", hint: "API key, how often we check" },
];

/** Initials from an email, since there's no name until the profile is filled in. */
function initials(email: string, name: string): string {
  const source = name.trim() || email.split("@")[0] || "?";
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : source.slice(0, 2);
  return letters.toUpperCase();
}

export default function AccountMenu({
  email,
  name,
  onOpenSection,
}: {
  email: string;
  name: string;
  onOpenSection: (section: ProfileSection) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="account" ref={wrapRef}>
      <button
        ref={buttonRef}
        className="account-btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="avatar" aria-hidden="true">
          {initials(email, name)}
        </span>
        <span className="account-who">
          <b>{name.trim() || "Your account"}</b>
          <span>{email || "Signed in"}</span>
        </span>
        <Icon name="chevron" size={14} className="account-caret" />
      </button>

      {open && (
        <div className="accountmenu" role="menu">
          {ITEMS.map((item) => (
            <button
              key={item.key}
              role="menuitem"
              className="accountmenu-item"
              onClick={() => {
                onOpenSection(item.key);
                setOpen(false);
              }}
            >
              <b>{item.label}</b>
              <span>{item.hint}</span>
            </button>
          ))}
          <form action={signOut} className="accountmenu-out">
            <button type="submit" role="menuitem" className="accountmenu-item">
              <b>Sign out</b>
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
