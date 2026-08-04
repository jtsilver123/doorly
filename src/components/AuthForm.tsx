"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { AuthResult } from "@/app/auth/actions";

export default function AuthForm({
  mode,
  action,
  initialError,
}: {
  mode: "signin" | "signup";
  action: (prev: AuthResult, data: FormData) => Promise<AuthResult>;
  initialError?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {
    error: initialError,
  } as AuthResult);

  const signup = mode === "signup";

  return (
    <main className="auth-shell">
      <form className="surface auth-card" action={formAction}>
        <div>
          <div className="brand" style={{ fontSize: 20 }}>
            Homefinder
          </div>
          <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
            {signup
              ? "Create an account to keep your pipeline, notes and saved searches."
              : "Sign in to pick up where you left off."}
          </div>
        </div>

        <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
          <span className="muted">Email</span>
          <input
            className="field"
            name="email"
            type="email"
            autoComplete="email"
            required
            autoFocus
          />
        </label>

        <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
          <span className="muted">Password</span>
          <input
            className="field"
            name="password"
            type="password"
            autoComplete={signup ? "new-password" : "current-password"}
            minLength={signup ? 8 : undefined}
            required
          />
          {signup && (
            <span className="muted" style={{ fontSize: 11 }}>
              At least 8 characters.
            </span>
          )}
        </label>

        {state.error && <div className="auth-error">{state.error}</div>}
        {state.message && <div className="auth-note">{state.message}</div>}

        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? "Working…" : signup ? "Create account" : "Sign in"}
        </button>

        <div className="muted" style={{ fontSize: 12, textAlign: "center" }}>
          {signup ? (
            <>
              Already have one? <Link href="/login">Sign in</Link>
            </>
          ) : (
            <>
              New here? <Link href="/signup">Create an account</Link>
            </>
          )}
        </div>
      </form>
    </main>
  );
}
