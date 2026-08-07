"use client";

import { useEffect, useMemo, useState } from "react";
import { AREAS } from "@/lib/areas";
import AreaPicker from "@/components/AreaPicker";
import type { SavedSearch } from "@/types";
import BedBathPicker, { bedBathLabel } from "@/components/BedBathPicker";

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
  const [open, setOpen] = useState(true);

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
    setNote(body.error ? body.error : "Saved. Press Check for new to pull fresh listings.");
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
    <div className="surface" style={{ padding: 20, display: "grid", gap: 12 }}>
      <div>
        <div style={{ fontWeight: 600 }}>What you&apos;re looking for</div>
        <div className="muted" style={{ fontSize: 12 }}>
          {labels.length ? labels.join(", ") : "No neighborhoods set"} ·{" "}
          {bedBathLabel({
            bedMin: Number(bedMin) || 0,
            bedMax: bedMax === "any" ? null : Number(bedMax),
            bathMin: Number(bathMin) || 0,
          })}{" "}
          · up to ${Number(priceMax).toLocaleString()}
        </div>
      </div>

      {/* Opens one way only. A visible "hide" button was a control for
          managing controls; saving is the natural end of editing. */}
      {!open && (
        <button className="btn" onClick={() => setOpen(true)}>
          Change search
        </button>
      )}

      {open && (
        <>
          <div style={{ display: "grid", gap: 5, fontSize: 12 }}>
            <span className="muted">Layout</span>
            {/* Tap a size; tap a second to stretch it into a range. The old
                preset chips ("2B1B", "Studio–1B") were a vocabulary to learn
                and couldn't say "studio through 2 bed" at all. */}
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

          <div style={{ display: "grid", gap: 5, fontSize: 12 }}>
            <span className="muted">Neighborhoods</span>
            <AreaPicker selected={areas} onChange={setAreas} />
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

