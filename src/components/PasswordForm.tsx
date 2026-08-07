"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { AuthResult } from "@/app/auth/actions";
import RecoverySession from "@/components/RecoverySession";

/**
 * The two password-recovery forms, which are the same shape twice.
 *
 * One asks for an address, one asks for a new password, and both are a
 * heading, a field or two, a button and one line of state. Splitting them into
 * separate components would mostly duplicate the plumbing around
 * `useActionState`.
 *
 * The panel matches sign-in exactly, on purpose: a recovery screen that looks
 * even slightly unlike the app is the moment a careful person decides the
 * email was a phishing attempt and gives up.
 */
export default function PasswordForm({
  mode,
  action,
  initialError,
}: {
  mode: "request" | "set";
  action: (prev: AuthResult, data: FormData) => Promise<AuthResult>;
  initialError?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {
    error: initialError,
  } as AuthResult);
  const asking = mode === "request";

  // Once the mail is away there is nothing more to do on this screen, so the
  // form gets out of the way rather than inviting a second and third attempt.
  const sent = asking && Boolean(state.message);

  return (
    <section className="auth-panel">
      <form className="auth-form" action={formAction}>
        {/* Cross-device links carry their session in the URL fragment; this
            picks it up and reloads. Set-mode only — the request form has no
            session to restore. */}
        {!asking && <RecoverySession />}
        <div className="auth-form-head">
          <h2>{asking ? "Reset your password" : "Choose a new password"}</h2>
          <p>
            {asking
              ? "We'll email you a link. It works once and expires in an hour."
              : "Then you're back in. Any other devices you're signed in on will be signed out."}
          </p>
        </div>

        {sent ? (
          <>
            <div className="auth-note" role="status">
              {state.message}
            </div>
            <p className="auth-fineprint">
              Nothing in your inbox after a minute or two? Check spam, and make
              sure you used the address you signed up with.
            </p>
          </>
        ) : (
          <>
            {asking ? (
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
            ) : (
              <>
                <label className="auth-field">
                  <span>New password</span>
                  <input
                    className="field"
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    placeholder="At least 8 characters"
                    required
                    autoFocus
                  />
                </label>
                <label className="auth-field">
                  <span>Again, to be sure</span>
                  <input
                    className="field"
                    name="confirm"
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    required
                  />
                </label>
              </>
            )}

            {state.error && (
              <div className="auth-error" role="alert">
                {state.error}
              </div>
            )}

            <button className="btn btn-primary auth-submit" type="submit" disabled={pending}>
              {pending ? "Working…" : asking ? "Send the link" : "Save it and sign in"}
            </button>
          </>
        )}

        <div className="auth-alt">
          {asking ? (
            <>
              Remembered it? <Link href="/login">Sign in</Link>
            </>
          ) : (
            <>
              Link expired? <Link href="/forgot">Ask for another</Link>
            </>
          )}
        </div>
      </form>
    </section>
  );
}
