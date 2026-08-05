"use client";

import { useEffect, useRef, useState } from "react";
import { ALL_SOURCES, SOURCE_LABEL, type Source } from "@/types";
import SourceMark from "@/components/SourceMark";
import { SORT_OPTIONS } from "@/lib/filters";

/**
 * The toolbar.
 *
 * The previous version put nine controls across two rows — a text field, three
 * dropdowns, five site toggles and five pills — all permanently expanded. It
 * was complete, and it read as a form to fill in, which is the wrong first
 * impression for a page you are meant to browse.
 *
 * This version shows the four things people touch constantly (search, rent,
 * size, sort) and folds the rest into one button carrying a count. That's the
 * pattern every listing site converges on, for the good reason that a filter
 * used twice a month shouldn't cost the same screen space as one used every
 * session.
 *
 * The view switch sits at the far right because it changes what you're looking
 * at rather than what's in it.
 */

export interface Filters {
  query: string;
  priceMax: string;
  beds: string;
  baths: string;
  sources: Source[];
  sort: string;
  changedOnly: boolean;
  starredOnly: boolean;
  noFeeOnly: boolean;
  followUpOnly: boolean;
  readyOnly: boolean;
  goodOnly: boolean;
}

const TOGGLES: { key: keyof Filters; label: string; hint: string }[] = [
  { key: "goodOnly", label: "Good deals only", hint: "Only places the rating says are worth a tour" },
  { key: "noFeeOnly", label: "No broker fee", hint: "Skip listings that charge a fee" },
  { key: "readyOnly", label: "Ready by my date", hint: "Available in time for your move-in" },
  { key: "changedOnly", label: "Price changed", hint: "Only listings whose price moved" },
  { key: "starredOnly", label: "Saved", hint: "Only ones you saved" },
  { key: "followUpOnly", label: "Needs follow-up", hint: "Contacted, no reply in 2+ days" },
];

function sinceText(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function FilterBar({
  filters,
  onChange,
  total,
  onReset,
  lastCheckedAt,
  sourceCount,
}: {
  filters: Filters;
  onChange: (next: Partial<Filters>) => void;
  total: number;
  onReset: () => void;
  lastCheckedAt?: string | null;
  sourceCount?: number;
}) {
  const [openPanel, setOpenPanel] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Click-away and Escape, so the panel never strands the page in a state the
  // user can't obviously leave.
  useEffect(() => {
    if (!openPanel) return;
    function onDown(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpenPanel(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenPanel(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openPanel]);

  function toggleSource(source: Source) {
    const on = filters.sources.includes(source);
    onChange({
      sources: on
        ? filters.sources.filter((s) => s !== source)
        : [...filters.sources, source],
    });
  }

  const tuckedCount =
    (filters.baths !== "any" ? 1 : 0) +
    filters.sources.length +
    TOGGLES.filter((t) => filters[t.key]).length;

  const activeCount =
    tuckedCount +
    (filters.query ? 1 : 0) +
    (filters.priceMax ? 1 : 0) +
    (filters.beds !== "any" ? 1 : 0);

  return (
    <div className="filterbar">
      <div className="filterbar-row">
        <div className="searchfield">
          <span aria-hidden="true">⌕</span>
          <input
            value={filters.query}
            placeholder="Search address, neighborhood or your notes"
            onChange={(e) => onChange({ query: e.target.value })}
            aria-label="Search listings"
          />
          {filters.query && (
            <button onClick={() => onChange({ query: "" })} aria-label="Clear search">
              ✕
            </button>
          )}
        </div>

        {/* Everything but the search box, grouped so phones can scroll it as
            one strip instead of stacking it into three rows. */}
        <div className="filterbar-controls">
        <input
          className="control control-sm"
          inputMode="numeric"
          value={filters.priceMax}
          placeholder="Max rent"
          onChange={(e) => onChange({ priceMax: e.target.value.replace(/[^\d]/g, "") })}
          aria-label="Maximum rent"
        />

        <select
          className="control control-sm"
          value={filters.beds}
          onChange={(e) => onChange({ beds: e.target.value })}
          aria-label="Bedrooms"
        >
          <option value="any">Any size</option>
          <option value="0">Studio</option>
          <option value="1">1 bed</option>
          <option value="2">2 bed</option>
          <option value="3">3 bed</option>
        </select>

        <div className="filterbar-more" ref={panelRef}>
          <button
            className={tuckedCount ? "control is-on" : "control"}
            onClick={() => setOpenPanel((v) => !v)}
            aria-expanded={openPanel}
            aria-haspopup="dialog"
          >
            More filters
            {tuckedCount > 0 && <b className="control-count">{tuckedCount}</b>}
          </button>

          {openPanel && (
            <div className="panel" role="dialog" aria-label="More filters">
              <div className="panel-group">
                <span className="panel-label">Show me</span>
                <div className="panel-pills">
                  {TOGGLES.map((toggle) => (
                    <button
                      key={toggle.key}
                      className={filters[toggle.key] ? "pill is-on" : "pill"}
                      onClick={() =>
                        onChange({ [toggle.key]: !filters[toggle.key] } as Partial<Filters>)
                      }
                      title={toggle.hint}
                      aria-pressed={Boolean(filters[toggle.key])}
                    >
                      {toggle.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="panel-group">
                <label className="panel-label" htmlFor="baths-filter">
                  Bathrooms
                </label>
                <select
                  id="baths-filter"
                  className="control control-sm"
                  value={filters.baths}
                  onChange={(e) => onChange({ baths: e.target.value })}
                >
                  <option value="any">Any</option>
                  <option value="1">1 or more</option>
                  <option value="1.5">1.5 or more</option>
                  <option value="2">2 or more</option>
                </select>
              </div>

              <div className="panel-group">
                <span className="panel-label">Listing sites</span>
                <div className="sourcefilter" role="group" aria-label="Filter by listing site">
                  {ALL_SOURCES.map((source) => {
                    const on = filters.sources.includes(source);
                    return (
                      <button
                        key={source}
                        className={on ? "sourcetoggle is-on" : "sourcetoggle"}
                        onClick={() => toggleSource(source)}
                        title={
                          on
                            ? `Showing only ${SOURCE_LABEL[source]}`
                            : `Show only ${SOURCE_LABEL[source]}`
                        }
                        aria-pressed={on}
                      >
                        <SourceMark source={source} size={17} />
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="panel-foot">
                <button className="linkish" onClick={onReset}>
                  Reset everything
                </button>
                <button className="btn btn-primary" onClick={() => setOpenPanel(false)}>
                  Show {total.toLocaleString()}
                </button>
              </div>
            </div>
          )}
        </div>

        <select
          className="control control-sm control-sort"
          value={filters.sort}
          onChange={(e) => onChange({ sort: e.target.value })}
          aria-label="Sort listings"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        </div>

      </div>

      <div className="filterbar-count">
        <span>
          <strong>{total.toLocaleString()}</strong> {total === 1 ? "place" : "places"}
          {activeCount > 0 && (
            <>
              {" "}
              <button className="linkish" onClick={onReset}>
                clear {activeCount} filter{activeCount === 1 ? "" : "s"}
              </button>
            </>
          )}
        </span>
        {/* Where it came from and how stale it is, on the results themselves.
            Freshness is the thing a renter is implicitly trusting on every
            card, so it shouldn't take a trip to the settings page to find. */}
        <span className="filterbar-trust">
          Pulled from {sourceCount ?? 5} listing sites
          {lastCheckedAt ? ` · checked ${sinceText(lastCheckedAt)}` : " · not checked yet"}
        </span>
      </div>
    </div>
  );
}
