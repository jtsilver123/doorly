"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AreaPicker from "@/components/AreaPicker";
import type { Source } from "@/types";
import { ALL_SOURCES, DEFAULT_PREFERRED_SOURCE, SOURCE_LABEL } from "@/types";
import BedBathPicker from "@/components/BedBathPicker";
import { siteUrl } from "@/lib/site";

/**
 * Setup.
 *
 * This was one long screen with nine questions on it, which reads as a form to
 * survive rather than a product to use. Now it's four steps, ordered by what
 * earns the next answer:
 *
 *   1  What you want      The interesting question. Answering it is what makes
 *                         the rest feel worth doing, so it goes first — never
 *                         make somebody do admin before they've seen the point.
 *   2  Where we look      Cheap, all defaults already correct, and it sets up
 *                         the tie-breaker question that only makes sense once
 *                         more than one site is on.
 *   3  Connect listings   The API key. Deliberately third: it's the only real
 *                         work, and by now they've spent two steps describing
 *                         the apartment they want.
 *   4  Your team          Optional and last, because it's the one step that
 *                         can wait — and ending on "invite someone" is a much
 *                         better final beat than ending on "paste a token".
 *
 * Your name isn't asked here any more; signup takes it, and asking twice
 * reads as an app that wasn't listening.
 */

type Step = 0 | 1 | 2 | 3;

const STEPS = ["What you want", "Where we look", "Connect listings", "Your team"];

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

  // 2 — the sources
  const [sources, setSources] = useState<Source[]>([...ALL_SOURCES]);
  const [preferred, setPreferred] = useState<Source>(DEFAULT_PREFERRED_SOURCE);

  // 3 — the key
  const [apiKey, setApiKey] = useState("");

  // 4 — the crew
  const [crewMode, setCrewMode] = useState<"solo" | "partner" | "scout" | null>(null);
  const [inviteUrl, setInviteUrl] = useState("");
  const [copied, setCopied] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function toggleSource(source: Source) {
    setSources((list) => {
      const next = list.includes(source)
        ? list.filter((s) => s !== source)
        : [...list, source];
      // The tie-breaker has to be a site we're actually searching.
      if (next.length && !next.includes(preferred)) setPreferred(next[0]);
      return next;
    });
  }

  /** Steps 1–3 are saved before the team step, so the crew has a search to join. */
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
          sources,
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
      body: JSON.stringify({ profile: { moveInDate: moveIn, preferredSource: preferred } }),
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
    router.push("/app");
    router.refresh();
  }

  const canAdvance =
    step === 0 ? areas.length > 0 : step === 1 ? sources.length > 0 : true;

  async function next() {
    if (step === 2) {
      // Everything the app needs to work is now answered; persist before the
      // optional step so abandoning at "team" still leaves a working account.
      if (await saveSearch()) setStep(3);
      return;
    }
    setStep((s) => Math.min(3, s + 1) as Step);
  }

  return (
    <main className="welcome">
      <div className="surface welcome-card">
        <header className="welcome-head">
          <div className="brand" style={{ fontSize: 22 }}>
            {step === 0 && "What are you looking for?"}
            {step === 1 && "Where should we look?"}
            {step === 2 && "Connect the listings"}
            {step === 3 && "Hunting alone?"}
          </div>
          <div className="muted" style={{ fontSize: 13, marginTop: 3 }}>
            {step === 0 &&
              "Neighborhoods are the one thing nobody can guess for you. Everything else has a sensible default."}
            {step === 1 &&
              "One key covers the big four. Craigslist is free and always on."}
            {step === 2 && "About a minute, and it's what fills your first screen."}
            {step === 3 &&
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

        {/* --- 2 · the sources ------------------------------------------ */}
        {step === 1 && (
          <>
            <div className="welcome-field">
              <span className="muted">
                Sites to search <strong>{sources.length} on</strong>
              </span>
              <div className="welcome-chips">
                {ALL_SOURCES.map((source) => (
                  <button
                    key={source}
                    type="button"
                    className={sources.includes(source) ? "btn btn-primary" : "btn"}
                    style={{ fontSize: 12, padding: "5px 10px" }}
                    aria-pressed={sources.includes(source)}
                    onClick={() => toggleSource(source)}
                  >
                    {sources.includes(source) ? "✓ " : ""}
                    {SOURCE_LABEL[source]}
                  </button>
                ))}
              </div>
              <span className="muted welcome-hint">
                More sites means better coverage and more of your monthly
                request budget per check. All five is the right default.
              </span>
            </div>

            {/* Only a question once there's something to break a tie between. */}
            {sources.length > 1 && (
              <div className="welcome-field">
                <span className="muted">
                  When a place is on several of them, which do we open?
                </span>
                <div className="welcome-chips">
                  {sources.map((source) => (
                    <button
                      key={source}
                      type="button"
                      className={preferred === source ? "btn btn-primary" : "btn"}
                      style={{ fontSize: 12, padding: "5px 10px" }}
                      onClick={() => setPreferred(source)}
                    >
                      {SOURCE_LABEL[source]}
                    </button>
                  ))}
                </div>
                <span className="muted welcome-hint">
                  The same apartment is usually listed three or four times. This
                  picks the one the buttons open. Every card still shows all of
                  them.
                </span>
              </div>
            )}
          </>
        )}

        {/* --- 3 · the key ---------------------------------------------- */}
        {step === 2 && (
          <div className="welcome-field welcome-key">
            <ol className="welcome-steps">
              <li>
                Open{" "}
                <a href="https://realtyapi.io" target="_blank" rel="noreferrer">
                  realtyapi.io
                </a>{" "}
                and sign up. The free tier is 250 requests a month.
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
              One key covers StreetEasy, Zillow, Apartments.com and HotPads.
              Craigslist needs none, so you&apos;ll see listings either way, just
              fewer. You can add or change this any time under your account.
            </span>
          </div>
        )}

        {/* --- 4 · the crew --------------------------------------------- */}
        {step === 3 && (
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

          {step < 3 ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={next}
              disabled={busy || !canAdvance}
            >
              {busy
                ? "Saving…"
                : step === 2
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
