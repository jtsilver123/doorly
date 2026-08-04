"use client";

import { useEffect, useMemo, useState } from "react";
import { AREAS } from "@/lib/areas";
import { LAYOUT_PRESETS, type SavedSearch } from "@/types";

/**
 * Editing what you're looking for, after setup.
 *
 * Onboarding runs once, but a search doesn't hold still: the budget moves, the
 * neighborhoods widen when nothing turns up, and "2B1B" becomes "2B2B" once
 * you've seen a few. Without this the only way to change any of it would be a
 * new account.
 */

const BOROUGH_ORDER = ["Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island"];

export default function SearchEditor({ onSaved }: { onSaved: () => void }) {
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [areas, setAreas] = useState<string[]>([]);
  const [priceMax, setPriceMax] = useState("4000");
  const [bedMin, setBedMin] = useState("0");
  const [bedMax, setBedMax] = useState("1");
  const [bathMin, setBathMin] = useState("0");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch("/api/searches")
      .then((r) => r.json())
      .then((b) => {
        const list: SavedSearch[] = b.searches ?? [];
        setSearches(list);
        const first = list[0];
        if (first) {
          setAreas(first.criteria.areas);
          setPriceMax(String(first.criteria.priceMax));
          setBedMin(String(first.criteria.bedMin));
          setBedMax(first.criteria.bedMax == null ? "any" : String(first.criteria.bedMax));
          setBathMin(String(first.criteria.bathMin ?? 0));
        }
      })
      .catch(() => {});
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof AREAS>();
    for (const area of AREAS) {
      if (area.isBorough) continue;
      const list = map.get(area.borough) ?? [];
      list.push(area);
      map.set(area.borough, list);
    }
    return BOROUGH_ORDER.filter((b) => map.has(b)).map((b) => [b, map.get(b)!] as const);
  }, []);

  const labels = useMemo(
    () => areas.map((slug) => AREAS.find((a) => a.slug === slug)?.label ?? slug),
    [areas]
  );

  async function save() {
    if (!areas.length) {
      setNote("Pick at least one neighborhood.");
      return;
    }
    setBusy(true);
    const previous = searches[0]?.searchKey;

    const res = await fetch("/api/searches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        label: "My search",
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

    // Criteria are keyed by their content, so an edit creates a new row rather
    // than updating the old one. Drop the previous one or every poll would
    // scrape both — quietly doubling the request cost.
    if (!body.error && previous) {
      const stillThere = (body.searches ?? []).some(
        (s: SavedSearch) => s.searchKey === previous
      );
      const replaced = (body.searches ?? []).length > 1;
      if (stillThere && replaced) {
        await fetch("/api/searches", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ searchKey: previous }),
        });
      }
    }

    setBusy(false);
    setNote(body.error ? body.error : "Saved — press Check for new to pull fresh listings.");
    if (!body.error) {
      const refreshed = await fetch("/api/searches").then((r) => r.json());
      setSearches(refreshed.searches ?? []);
      onSaved();
    }
  }

  function toggle(slug: string) {
    setAreas((list) =>
      list.includes(slug) ? list.filter((s) => s !== slug) : [...list, slug]
    );
  }

  return (
    <div className="surface" style={{ padding: 20, maxWidth: 560, display: "grid", gap: 12 }}>
      <div>
        <div style={{ fontWeight: 600 }}>What you&apos;re looking for</div>
        <div className="muted" style={{ fontSize: 12 }}>
          {labels.length ? labels.join(", ") : "No neighborhoods set"} ·{" "}
          {bedMin === bedMax ? bedLabel(bedMin) : `${bedLabel(bedMin)}–${bedLabel(bedMax)}`}
          {Number(bathMin) > 0 ? ` · ${bathMin}+ bath` : ""} · up to $
          {Number(priceMax).toLocaleString()}
        </div>
      </div>

      <button className="btn" onClick={() => setOpen((v) => !v)}>
        {open ? "Close" : "Change search"}
      </button>

      {open && (
        <>
          <div style={{ display: "grid", gap: 5, fontSize: 12 }}>
            <span className="muted">Layout</span>
            <div className="welcome-chips">
              {LAYOUT_PRESETS.map((preset) => {
                const active =
                  Number(bedMin) === preset.bedMin &&
                  (preset.bedMax === null
                    ? bedMax === "any"
                    : Number(bedMax) === preset.bedMax) &&
                  Number(bathMin) === preset.bathMin;
                return (
                  <button
                    key={preset.label}
                    className={active ? "btn btn-primary" : "btn"}
                    style={{ fontSize: 12, padding: "4px 9px" }}
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
          </div>

          <div style={{ display: "grid", gap: 5, fontSize: 12 }}>
            <span className="muted">
              Neighborhoods · <strong>{areas.length} selected</strong>
            </span>
            <div className="welcome-areas">
              {grouped.map(([borough, list]) => (
                <div key={borough}>
                  <div className="welcome-borough">{borough}</div>
                  <div className="welcome-chips">
                    {list.map((area) => (
                      <button
                        key={area.slug}
                        className={areas.includes(area.slug) ? "btn btn-primary" : "btn"}
                        style={{ fontSize: 12, padding: "4px 9px" }}
                        onClick={() => toggle(area.slug)}
                      >
                        {area.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
            <span className="muted">Max rent</span>
            <input
              className="field"
              inputMode="numeric"
              value={priceMax}
              onChange={(e) => setPriceMax(e.target.value.replace(/[^\d]/g, ""))}
            />
          </label>

          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save search"}
          </button>
        </>
      )}

      {note && (
        <span className="muted" style={{ fontSize: 12 }}>
          {note}
        </span>
      )}
    </div>
  );
}

function bedLabel(value: string): string {
  if (value === "any") return "any size";
  return value === "0" ? "studio" : `${value} bed`;
}
