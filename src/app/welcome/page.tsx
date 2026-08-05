"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AreaPicker from "@/components/AreaPicker";
import type { Source } from "@/types";
import {
  ALL_SOURCES,
  DEFAULT_PREFERRED_SOURCE,
  LAYOUT_PRESETS,
  SOURCE_LABEL,
} from "@/types";

/**
 * Setup, in one screen.
 *
 * The app is worthless until it knows where you're looking, so this is the
 * first thing a new account sees — and it's kept to one screen because a
 * multi-step wizard would be four chances to abandon before seeing a single
 * apartment. Defaults are filled in for everything except neighborhoods, which
 * is the one answer nobody else can guess.
 */

export default function Welcome() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [areas, setAreas] = useState<string[]>([]);
  const [priceMax, setPriceMax] = useState("4000");
  const [bedMin, setBedMin] = useState("0");
  const [bedMax, setBedMax] = useState("1");
  const [bathMin, setBathMin] = useState("0");
  const [moveIn, setMoveIn] = useState(defaultMoveIn());
  const [apiKey, setApiKey] = useState("");
  const [preferred, setPreferred] = useState<Source>(DEFAULT_PREFERRED_SOURCE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!areas.length) {
      setError("Pick at least one neighborhood — it's the one thing we can't guess.");
      return;
    }
    setBusy(true);
    setError("");

    const res = await fetch("/api/searches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        label: "My search",
        name,
        moveInDate: moveIn,
        criteria: {
          areas,
          bedMin: Number(bedMin),
          bedMax: bedMax === "any" ? null : Number(bedMax),
          bathMin: Number(bathMin),
          priceMin: 0,
          priceMax: Number(priceMax) || 4000,
          sources: ["streeteasy", "zillow", "apartments", "hotpads", "craigslist"],
          noFeeOnly: false,
        },
      }),
    });
    const body = await res.json();
    if (body.error) {
      setBusy(false);
      setError(body.error);
      return;
    }

    // The key is what makes the next screen have anything in it, so it's saved
    // here rather than left for the user to find in settings afterwards.
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
      body: JSON.stringify({ profile: { name, moveInDate: moveIn, preferredSource: preferred } }),
    }).catch(() => {});

    setBusy(false);
    router.push("/");
    router.refresh();
  }

  return (
    <main className="welcome">
      <div className="surface welcome-card">
        <header>
          <div className="brand" style={{ fontSize: 22 }}>
            Let&apos;s set up your search
          </div>
          <div className="muted" style={{ fontSize: 13, marginTop: 3 }}>
            Doorly watches StreetEasy, Zillow, Apartments.com, HotPads and
            Craigslist for you, and tells you when something changes.
          </div>
        </header>

        <label className="welcome-field">
          <span className="muted">What should we call you?</span>
          <input
            className="field"
            value={name}
            placeholder="Jake"
            onChange={(e) => setName(e.target.value)}
          />
          <span className="muted welcome-hint">
            Used in the tour requests it drafts for you.
          </span>
        </label>

        <div className="welcome-field">
          <span className="muted">
            Where are you looking? <strong>{areas.length} selected</strong>
          </span>
          <AreaPicker selected={areas} onChange={setAreas} />
        </div>

        <div className="welcome-field">
          <span className="muted">What layout?</span>
          <div className="welcome-chips">
            {LAYOUT_PRESETS.map((preset) => {
              const active =
                Number(bedMin) === preset.bedMin &&
                (preset.bedMax === null ? bedMax === "any" : Number(bedMax) === preset.bedMax) &&
                Number(bathMin) === preset.bathMin;
              return (
                <button
                  key={preset.label}
                  type="button"
                  className={active ? "btn btn-primary" : "btn"}
                  style={{ fontSize: 12, padding: "5px 10px" }}
                  onClick={() => {
                    setBedMin(String(preset.bedMin));
                    setBedMax(preset.bedMax === null ? "any" : String(preset.bedMax));
                    setBathMin(String(preset.bathMin));
                  }}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
          <span className="muted welcome-hint">
            Or set it exactly below. Bathrooms are a minimum — a 2-bath place
            still shows up in a 1-bath search.
          </span>
        </div>

        <div className="welcome-field">
          <span className="muted">
            When a place is on several sites, which should we open?
          </span>
          <div className="welcome-chips">
            {ALL_SOURCES.map((source) => (
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
            The same apartment is usually listed three or four times. Every card
            still shows which sites carry it.
          </span>
        </div>

        {/*
          The listing data comes from one aggregator, and nothing works without
          a key for it. Burying that in settings means a new account lands on an
          empty screen with no idea why — so it's asked for here, with the two
          minutes of instruction it actually needs.
        */}
        <div className="welcome-field welcome-key">
          <span className="muted">
            Last thing — a data key <strong>(about a minute)</strong>
          </span>
          <ol className="welcome-steps">
            <li>
              Open{" "}
              <a href="https://realtyapi.io" target="_blank" rel="noreferrer">
                realtyapi.io
              </a>{" "}
              and sign up. The free tier is 250 requests a month.
            </li>
            <li>Copy the key from your dashboard — it starts with <code>rt_</code>.</li>
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
            Craigslist needs none, so you&apos;ll see listings either way — just
            fewer. You can add or change this later under your account.
          </span>
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
            <span className="muted">Smallest</span>
            <select className="field" value={bedMin} onChange={(e) => setBedMin(e.target.value)}>
              <option value="0">Studio</option>
              <option value="1">1 bed</option>
              <option value="2">2 bed</option>
              <option value="3">3 bed</option>
            </select>
          </label>
          <label className="welcome-field">
            <span className="muted">Largest</span>
            <select className="field" value={bedMax} onChange={(e) => setBedMax(e.target.value)}>
              <option value="0">Studio</option>
              <option value="1">1 bed</option>
              <option value="2">2 bed</option>
              <option value="3">3 bed</option>
              <option value="any">No limit</option>
            </select>
          </label>
          <label className="welcome-field">
            <span className="muted">Baths</span>
            <select className="field" value={bathMin} onChange={(e) => setBathMin(e.target.value)}>
              <option value="0">Any</option>
              <option value="1">1+</option>
              <option value="1.5">1.5+</option>
              <option value="2">2+</option>
              <option value="3">3+</option>
            </select>
          </label>
        </div>

        <label className="welcome-field">
          <span className="muted">When do you need to move in?</span>
          <input
            className="field"
            type="date"
            value={moveIn}
            onChange={(e) => setMoveIn(e.target.value)}
          />
          <span className="muted welcome-hint">
            New York listings appear about 30 days before they&apos;re free, so this
            sets when your search really starts.
          </span>
        </label>

        {error && <div className="auth-error">{error}</div>}

        <button className="btn btn-primary" onClick={submit} disabled={busy || !areas.length}>
          {busy ? "Setting up…" : "Start hunting"}
        </button>
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
