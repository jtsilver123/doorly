"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import type { AuthResult } from "@/app/auth/actions";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Sign in and sign up.
 *
 * These were a 400px card floating in an empty page — the kind of screen that
 * reads as scaffolding somebody meant to come back to. It's the first thing
 * anyone sees, and for a product about moving to New York it should say what
 * the product is for before asking for a password.
 *
 * So: a full-bleed split. The city on one side with the three claims that
 * actually distinguish this from the listing sites, the form on the other,
 * unchanged in what it asks for. Nothing here is decoration for its own sake —
 * the numbers are real, and the map is the same geometry the app uses to place
 * a listing.
 */

const CLAIMS: { stat: string; label: string; detail: string }[] = [
  {
    stat: "5",
    label: "sites, one list",
    detail: "StreetEasy, Zillow, Apartments.com, HotPads and Craigslist, deduplicated.",
  },
  {
    stat: "1–100",
    label: "on every place",
    detail: "Priced against real comparables, weighed against what you actually get.",
  },
  {
    stat: "2×",
    label: "a day, watched",
    detail: "Price drops, relists and disappearances — the things no listing site tells you.",
  },
];

export default function AuthForm({
  mode,
  action,
  initialError,
  children,
}: {
  mode: "signin" | "signup";
  action: (prev: AuthResult, data: FormData) => Promise<AuthResult>;
  initialError?: string;
  /** The map, rendered on the server so its geometry stays out of this bundle. */
  children?: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, {
    error: initialError,
  } as AuthResult);
  const [oauthBusy, setOauthBusy] = useState(false);

  const signup = mode === "signup";

  return (
    <main className="auth">
      <section className="auth-pitch">
        {children}
        <div className="auth-pitch-inner">
          <div className="auth-mark">Doorly</div>
          <h1>
            Find the one before
            <br />
            everybody else does.
          </h1>
          <p className="auth-lede">
            New York apartments go in a day. This watches every listing site at
            once, tells you which places are genuinely a good deal, and keeps
            track of who you&apos;ve contacted — so the search stops living in
            twelve browser tabs.
          </p>

          <ul className="auth-claims">
            {CLAIMS.map((claim) => (
              <li key={claim.label}>
                <b>{claim.stat}</b>
                <span>
                  <strong>{claim.label}</strong>
                  {claim.detail}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="auth-panel">
        <form className="auth-form" action={formAction}>
          <div className="auth-form-head">
            <h2>{signup ? "Start your search" : "Welcome back"}</h2>
            <p>
              {signup
                ? "Two minutes to set up. Your pipeline, notes and saved searches stay put."
                : "Pick up where you left off."}
            </p>
          </div>

          {/* A real name, because a crew card saying "via Emma" is the whole
              point — nobody wants help from "jt.silver.92". */}
          {signup && (
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
          )}

          <label className="auth-field">
            <span>Email</span>
            <input
              className="field"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              required
              autoFocus={!signup}
            />
          </label>

          <label className="auth-field">
            <span>Password</span>
            <input
              className="field"
              name="password"
              type="password"
              autoComplete={signup ? "new-password" : "current-password"}
              minLength={signup ? 8 : undefined}
              placeholder={signup ? "At least 8 characters" : ""}
              required
            />
          </label>

          {state.error && (
            <div className="auth-error" role="alert">
              {state.error}
            </div>
          )}
          {state.message && <div className="auth-note">{state.message}</div>}

          <button className="btn btn-primary auth-submit" type="submit" disabled={pending}>
            {pending ? "Working…" : signup ? "Create account" : "Sign in"}
          </button>

          <div className="auth-or" aria-hidden="true">
            <span>or</span>
          </div>

          {/*
            One OAuth hop instead of a password nobody wanted to invent.
            The redirect goes through /auth/callback, which exchanges the
            code server-side — PKCE, so an intercepted redirect is worthless.
          */}
          <button
            type="button"
            className="btn auth-google"
            disabled={oauthBusy}
            onClick={async () => {
              setOauthBusy(true);
              const { error } = await supabaseBrowser().auth.signInWithOAuth({
                provider: "google",
                options: { redirectTo: `${window.location.origin}/auth/callback` },
              });
              // Success navigates away; only a failure leaves us here.
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

          <div className="auth-alt">
            {signup ? (
              <>
                Already have an account? <Link href="/login">Sign in</Link>
              </>
            ) : (
              <>
                New here? <Link href="/signup">Create an account</Link>
              </>
            )}
          </div>

          <p className="auth-fineprint">
            Listing data comes from the sites above, not from us. We don&apos;t
            contact anyone on your behalf — every message is one you send.
          </p>
        </form>
      </section>
    </main>
  );
}
