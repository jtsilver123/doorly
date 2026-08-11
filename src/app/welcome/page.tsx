"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AreaPicker from "@/components/AreaPicker";
import { ALL_SOURCES } from "@/types";
import BedBathPicker from "@/components/BedBathPicker";
import { siteUrl } from "@/lib/site";

/**
 * Setup.
 *
 * This was one long screen with nine questions on it, which reads as a form to
 * survive rather than a product to use. Now it's three steps, ordered by what
 * earns the next answer:
 *
 *   1  What you want    The interesting question, and the one that makes the
 *                       Find page work: every site link opens carrying this
 *                       search. Never make somebody do admin before they've
 *                       seen the point.
 *   2  Power the watch  The API key. It's what lets a pasted address come
 *                       back priced and checked, and what re-checks your
 *                       places for price cuts — the only real work here, and
 *                       by now they've spent a step describing the apartment
 *                       it will guard.
 *   3  Your team        Optional and last, because it's the one step that
 *                       can wait — and ending on "invite someone" is a much
 *                       better final beat than ending on "paste a token".
 *
 * There used to be a "which sites should we search" step between these; it
 * described the crawl, and the crawl is gone. Search happens on the sites
 * themselves now, so there's nothing to configure about it.
 *
 * Your name isn't asked here any more; signup takes it, and asking twice
 * reads as an app that wasn't listening.
 */

type Step = 0 | 1 | 2;

const STEPS = ["What you want", "Power the watch", "Your team"];

export default function Welcome() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(0);

  // 1 — the place
  const [areas, setAreas] = useState<string[]>([]);
  const [priceMax, setPriceMax] = useState("4000");
  const [bedMin, setBedMin] = useState("0");
  const [bedMax, setBedMax] = useState("1");
  const [bathMin, setBathMin] = useState("0");
  const [moveIn, setMoveIn] = useState(defaultMoveIn());

  // 2 — the key
  const [apiKey, setApiKey] = useState("");

  // 3 — the crew
  const [crewMode, setCrewMode] = useState<"solo" | "partner" | "scout" | null>(null);
  const [inviteUrl, setInviteUrl] = useState("");
  const [copied, setCopied] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  /** Steps 1–2 are saved before the team step, so the crew has a search to join. */
  async function saveSearch(): Promise<boolean> {
    setBusy(true);
    setError("");
    const res = await fetch("/api/searches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        label: "My search",
        moveInDate: moveIn,
        criteria: {
          areas,
          bedMin: Number(bedMin),
          bedMax: bedMax === "any" ? null : Number(bedMax),
          bathMin: Number(bathMin),
          priceMin: 0,
          priceMax: Number(priceMax) || 4000,
          // Nothing to choose any more: sources only scope ratings and
          // paste matching, and all of them is always the right answer.
          sources: [...ALL_SOURCES],
          noFeeOnly: false,
        },
      }),
    });
    const body = await res.json();
    if (body.error) {
      setBusy(false);
      setError(body.error);
      return false;
    }

    if (apiKey.trim()) {
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ realtyApiKey: apiKey.trim() }),
      }).catch(() => {});
    }
    await fetch("/api/profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: { moveInDate: moveIn } }),
    }).catch(() => {});
    setBusy(false);
    return true;
  }

  async function makeCrew(role: "partner" | "scout") {
    setCrewMode(role);
    setBusy(true);
    await fetch("/api/crew", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "create", name: "Our search" }),
    }).catch(() => {});
    const body = await fetch("/api/crew", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "invite", role }),
    })
      .then((r) => r.json())
      .catch(() => ({}));
    setBusy(false);
    if (body?.token) setInviteUrl(siteUrl(`/join/${body.token}`));
  }

  function finish() {
    // The tour flag rides along so the app shows a first-timer around;
    // the shell reads it once and strips it from the address.
    router.push("/app?tour=1");
    router.refresh();
  }

  const canAdvance = step === 0 ? areas.length > 0 : true;

  async function next() {
    if (step === 1) {
      // Everything the app needs to work is now answered; persist before the
      // optional step so abandoning at "team" still leaves a working account.
      if (await saveSearch()) setStep(2);
      return;
    }
    setStep((s) => Math.min(2, s + 1) as Step);
  }

  return (
    <main className="welcome">
      <div className="surface welcome-card">
        <header className="welcome-head">
          <div className="brand" style={{ fontSize: 22 }}>
            {step === 0 && "What are you looking for?"}
            {step === 1 && "Power the watch"}
            {step === 2 && "Hunting alone?"}
          </div>
          <div className="muted" style={{ fontSize: 13, marginTop: 3 }}>
            {step === 0 &&
              "Every site link on the Find page opens carrying this search. Neighborhoods are the one thing nobody can guess for you."}
            {step === 1 &&
              "About a minute. It's what prices the places you paste, and re-checks them for you."}
            {step === 2 &&
              "Apartment hunting is a team sport, even when one name goes on the lease."}
          </div>

          <ol className="welcome-progress" aria-label="Setup progress">
            {STEPS.map((label, i) => (
              <li
                key={label}
                data-state={i === step ? "on" : i < step ? "done" : undefined}
              >
                <span>{label}</span>
              </li>
            ))}
          </ol>
        </header>

        {/* --- 1 · the place ------------------------------------------- */}
        {step === 0 && (
          <>
            <div className="welcome-field">
              <span className="muted">
                Where are you looking? <strong>{areas.length} selected</strong>
              </span>
              <AreaPicker selected={areas} onChange={setAreas} />
            </div>

            <div className="welcome-field">
              <span className="muted">What layout?</span>
              <BedBathPicker
                value={{
                  bedMin: Number(bedMin) || 0,
                  bedMax: bedMax === "any" ? null : Number(bedMax),
                  bathMin: Number(bathMin) || 0,
                }}
                onChange={(next) => {
                  setBedMin(String(next.bedMin));
                  setBedMax(next.bedMax == null ? "any" : String(next.bedMax));
                  setBathMin(String(next.bathMin));
                }}
              />
            </div>

            <div className="welcome-row">
              <label className="welcome-field">
                <span className="muted">Max rent</span>
                <input
                  className="field"
                  inputMode="numeric"
                  value={priceMax}
                  onChange={(e) => setPriceMax(e.target.value.replace(/[^\d]/g, ""))}
                />
              </label>
              <label className="welcome-field">
                <span className="muted">Move in by</span>
                <input
                  className="field"
                  type="date"
                  value={moveIn}
                  onChange={(e) => setMoveIn(e.target.value)}
                />
              </label>
            </div>
            <span className="muted welcome-hint">
              New York listings appear about 30 days before they&apos;re free, so
              your move-in date is really when the search starts.
            </span>
          </>
        )}

        {/* --- 2 · the key ---------------------------------------------- */}
        {step === 1 && (
          <div className="welcome-field welcome-key">
            <span className="muted welcome-hint">
              When you paste a place, the key is what looks it up: the real
              price history, the honest comps, whether it&apos;s still live.
              And it keeps looking after everything on your board, so a price
              cut or a quiet delisting finds you first.
            </span>
            <ol className="welcome-steps">
              <li>
                Open{" "}
                <a href="https://realtyapi.io" target="_blank" rel="noreferrer">
                  realtyapi.io
                </a>{" "}
                and sign up. The free tier is 250 requests a month — plenty for
                a hunt.
              </li>
              <li>
                Copy the key from your dashboard. It starts with <code>rt_</code>.
              </li>
              <li>Paste it here.</li>
            </ol>
            <input
              className="field"
              value={apiKey}
              placeholder="rt_…"
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setApiKey(e.target.value.trim())}
            />
            <span className="muted welcome-hint">
              Skippable: pasting and tracking work without it, just without the
              lookups. You can add or change this any time under your account.
            </span>
          </div>
        )}

        {/* --- 3 · the crew --------------------------------------------- */}
        {step === 2 && (
          <>
            {!inviteUrl && (
              <div className="welcome-field">
                <div className="crew-pitch">
                  <button
                    type="button"
                    className="welcome-pick"
                    data-on={crewMode === "partner" ? "true" : undefined}
                    onClick={() => makeCrew("partner")}
                    disabled={busy}
                  >
                    <b>I&apos;m moving in with someone</b>
                    <span>
                      One shared pipeline you both fill and work, with a point
                      person on each place so you never both text the same agent.
                    </span>
                  </button>
                  <button
                    type="button"
                    className="welcome-pick"
                    data-on={crewMode === "scout" ? "true" : undefined}
                    onClick={() => makeCrew("scout")}
                    disabled={busy}
                  >
                    <b>Friends and family are helping me look</b>
                    <span>
                      They drop places into your pipeline, tagged with who found
                      them. You keep the final say.
                    </span>
                  </button>
                  <button
                    type="button"
                    className="welcome-pick"
                    onClick={finish}
                    disabled={busy}
                  >
                    <b>Just me for now</b>
                    <span>You can invite people any time from your account.</span>
                  </button>
                </div>
              </div>
            )}

            {inviteUrl && (
              <div className="welcome-field">
                <div className="crew-invite">
                  <code>{inviteUrl}</code>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(inviteUrl);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1800);
                      } catch {
                        setCopied(false);
                      }
                    }}
                  >
                    {copied ? "Copied" : "Copy invite link"}
                  </button>
                  <span className="muted" style={{ fontSize: 11 }}>
                    Paste it in your group chat. Whoever opens it joins as a{" "}
                    {crewMode === "partner" ? "partner" : "scout"}. You can make
                    more links later.
                  </span>
                </div>
              </div>
            )}
          </>
        )}

        {error && <div className="auth-error">{error}</div>}

        <div className="welcome-nav">
          {step > 0 ? (
            <button
              type="button"
              className="btn"
              onClick={() => setStep((s) => Math.max(0, s - 1) as Step)}
              disabled={busy}
            >
              Back
            </button>
          ) : (
            <span />
          )}

          {step < 2 ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={next}
              disabled={busy || !canAdvance}
            >
              {busy
                ? "Saving…"
                : step === 1
                  ? apiKey.trim()
                    ? "Save and continue"
                    : "Skip for now"
                  : "Continue"}
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={finish} disabled={busy}>
              Start hunting
            </button>
          )}
        </div>
      </div>
    </main>
  );
}

/** Most people are looking about a month out; start there. */
function defaultMoveIn(): string {
  const date = new Date();
  date.setDate(date.getDate() + 28);
  return date.toISOString().slice(0, 10);
}
