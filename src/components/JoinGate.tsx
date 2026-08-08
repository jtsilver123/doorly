"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { signUp, type AuthResult } from "@/app/auth/actions";
import { supabaseBrowser } from "@/lib/supabase/client";
import { siteUrl } from "@/lib/site";
import Icon from "@/components/Icon";

/**
 * The account modal a visitor meets the moment they try to act.
 *
 * The app itself is the pitch now — a guest is already standing in it,
 * looking at real listings — so this asks for exactly what the action
 * needs (an account) on top of the thing they were doing, instead of
 * bouncing them to a signup page that has to re-make the case from zero.
 * Two panels: the left says what an account actually buys, the right is
 * the shortest possible way to get one. Same server action as /signup;
 * success lands in the welcome flow.
 */

const CLAIMS: { stat: string; text: string }[] = [
  { stat: "5", text: "listing sites checked hourly, deduplicated into one scored list" },
  { stat: "2", text: "taps to text an agent — the message is already written" },
  { stat: "1", text: "pipeline from first text to signed lease, saved forever" },
];

export default function JoinGate({ onClose }: { onClose: () => void }) {
  const [state, formAction, pending] = useActionState(signUp, {} as AuthResult);
  const [oauthBusy, setOauthBusy] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const googleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // The first tab lands on the fastest way in, not on the close button.
    googleRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // A failed attempt must never fold the field it happened in.
  useEffect(() => {
    if (state.error) setEmailOpen(true);
  }, [state.error]);

  return (
    <div
      className="compare-modal joingate-scrim"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="joingate"
        role="dialog"
        aria-modal="true"
        aria-label="Create your account"
      >
        <button className="joingate-close" aria-label="Keep looking without an account" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>

        <div className="joingate-pitch">
          <span className="joingate-mark">DamnLease</span>
          <h2>Make it yours</h2>
          <p>
            You&apos;re in the live app. An account is what lets it remember
            you: the places you star, the agents you text, the packet you
            build.
          </p>
          <ul className="joingate-claims">
            {CLAIMS.map((c) => (
              <li key={c.stat}>
                <b>{c.stat}</b>
                <span>{c.text}</span>
              </li>
            ))}
          </ul>
          <span className="joingate-free">Free, forever. Two minutes to set up.</span>
        </div>

        <div className="joingate-panel">
          <div className="joingate-panel-head">
            <b>Create your account</b>
            <span className="muted">Pick up exactly where this leaves off.</span>
          </div>

          <button
            ref={googleRef}
            type="button"
            className="btn auth-google joingate-google"
            disabled={oauthBusy}
            onClick={async () => {
              setOauthBusy(true);
              const { error } = await supabaseBrowser().auth.signInWithOAuth({
                provider: "google",
                options: { redirectTo: siteUrl("/auth/callback") },
              });
              if (error) setOauthBusy(false);
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M23.5 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.4 3.62v3h3.87c2.27-2.09 3.58-5.17 3.58-8.81Z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.87-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A12 12 0 0 0 12 24Z"
              />
              <path
                fill="#FBBC05"
                d="M5.27 14.28a7.2 7.2 0 0 1 0-4.56V6.63H1.29a12.04 12.04 0 0 0 0 10.74l3.98-3.09Z"
              />
              <path
                fill="#EA4335"
                d="M12 4.76c1.76 0 3.35.6 4.6 1.8l3.44-3.44A11.98 11.98 0 0 0 1.29 6.63l3.98 3.09C6.22 6.87 8.87 4.76 12 4.76Z"
              />
            </svg>
            {oauthBusy ? "Off to Google…" : "Continue with Google"}
          </button>

          <div className="joingate-or" aria-hidden="true">
            <span>or</span>
          </div>

          {!emailOpen ? (
            <button
              type="button"
              className="btn joingate-email-toggle"
              onClick={() => setEmailOpen(true)}
            >
              <Icon name="mail" size={15} />
              Continue with email
            </button>
          ) : (
            <form className="joingate-form" action={formAction}>
              <label className="auth-field">
                <span>Your name</span>
                <input
                  className="field"
                  name="name"
                  type="text"
                  autoComplete="name"
                  placeholder="First name is fine"
                  maxLength={80}
                  required
                  autoFocus
                />
              </label>
              <label className="auth-field">
                <span>Email</span>
                <input
                  className="field"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  required
                />
              </label>
              <label className="auth-field">
                <span>Password</span>
                <input
                  className="field"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  placeholder="At least 8 characters"
                  required
                />
              </label>

              {state.error && (
                <div className="auth-error" role="alert">
                  {state.error}
                </div>
              )}
              {state.message && <div className="auth-note">{state.message}</div>}

              <button className="btn btn-primary joingate-submit" type="submit" disabled={pending}>
                {pending ? "Working…" : "Create account"}
              </button>
            </form>
          )}

          <div className="joingate-alt">
            Already have an account? <a href="/login">Sign in</a>
          </div>
        </div>
      </div>
    </div>
  );
}
