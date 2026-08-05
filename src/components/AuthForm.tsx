"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { AuthResult } from "@/app/auth/actions";

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

  const signup = mode === "signup";

  return (
    <main className="auth">
      <section className="auth-pitch">
        {children}
        <div className="auth-pitch-inner">
          <div className="auth-mark">Homefinder</div>
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

          <label className="auth-field">
            <span>Email</span>
            <input
              className="field"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              required
              autoFocus
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
