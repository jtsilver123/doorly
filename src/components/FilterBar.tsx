"use client";

import { useEffect, useRef, useState } from "react";
import { ALL_SOURCES, SOURCE_LABEL, type Source } from "@/types";
import { AMENITIES, AMENITY_ORDER, type AmenityKey } from "@/lib/amenities";
import SourceMark from "@/components/SourceMark";
import { SORT_OPTIONS } from "@/lib/filters";
import type { SiteJump } from "@/lib/siteLinks";
import Icon from "@/components/Icon";

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
  priceMin: string;
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
  /** Minutes to the first commute anchor, "any" when off. */
  commuteMax: string;
  /** Must-have amenities, canonical keys. */
  perks: AmenityKey[];
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
  anchorLabel,
  jumps,
  trailing,
}: {
  filters: Filters;
  onChange: (next: Partial<Filters>) => void;
  total: number;
  onReset: () => void;
  lastCheckedAt?: string | null;
  sourceCount?: number;
  /** First commute anchor's name — the control only exists when one does. */
  anchorLabel?: string | null;
  /** The saved search, opened on the big sites. The trust escape hatch. */
  jumps?: SiteJump[];
  /** Extra control rendered at the row's end (the Activity toggle). */
  trailing?: React.ReactNode;
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

  /**
   * What the Filters badge counts: things behind that button, and nothing
   * else. Search lives outside it, so counting the query here would put a
   * number on a button that has no control for the thing being counted.
   */
  const filterCount =
    (filters.priceMin ? 1 : 0) +
    (filters.priceMax ? 1 : 0) +
    (filters.beds !== "any" ? 1 : 0) +
    (filters.baths !== "any" ? 1 : 0) +
    (anchorLabel && filters.commuteMax !== "any" ? 1 : 0) +
    filters.perks.length +
    filters.sources.length +
    TOGGLES.filter((t) => filters[t.key]).length;

  /** The count under the bar, which does include the search term. */
  const activeCount = filterCount + (filters.query ? 1 : 0);

  return (
    <div className="filterbar">
      <div className="filterbar-row">
        <div className="searchfield">
          <Icon name="search" size={16} />
          <input
            value={filters.query}
            placeholder="Search address, neighborhood or your notes"
            onChange={(e) => onChange({ query: e.target.value })}
            aria-label="Search listings"
          />
          {filters.query && (
            <button onClick={() => onChange({ query: "" })} aria-label="Clear search">
              <Icon name="close" size={14} />
            </button>
          )}
        </div>

        {/*
          Two controls, not four.
          
          This row used to carry a rent box, a size dropdown, a "More filters"
          popover and a sort menu — so "narrow this down" was spread across
          three places and you had to learn which lived where. Everything that
          narrows the list is now behind Filters; the one thing that reorders
          it is Sort. Search stays separate because finding a specific address
          isn't filtering.
        */}
        <div className="filterbar-controls">
        <div className="filterbar-more" ref={panelRef}>
          <button
            className={filterCount ? "control is-on" : "control"}
            onClick={() => setOpenPanel((v) => !v)}
            aria-expanded={openPanel}
            aria-haspopup="dialog"
          >
            <Icon name="filter" size={16} /> Filters
            {filterCount > 0 && <b className="control-count">{filterCount}</b>}
          </button>

          {openPanel && (
            <div className="panel" role="dialog" aria-label="Filters">
              <div className="panel-group">
                <span className="panel-label">Rent and size</span>
                <div className="panel-row">
                  <input
                    className="control control-sm"
                    inputMode="numeric"
                    value={filters.priceMin}
                    placeholder="Min rent"
                    onChange={(e) =>
                      onChange({ priceMin: e.target.value.replace(/[^\d]/g, "") })
                    }
                    aria-label="Minimum rent"
                  />
                  <input
                    className="control control-sm"
                    inputMode="numeric"
                    value={filters.priceMax}
                    placeholder="Max rent"
                    onChange={(e) =>
                      onChange({ priceMax: e.target.value.replace(/[^\d]/g, "") })
                    }
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
                  <select
                    className="control control-sm"
                    value={filters.baths}
                    onChange={(e) => onChange({ baths: e.target.value })}
                    aria-label="Bathrooms"
                  >
                    <option value="any">Any baths</option>
                    <option value="1">1+ bath</option>
                    <option value="1.5">1.5+ bath</option>
                    <option value="2">2+ bath</option>
                  </select>
                </div>
              </div>

              {anchorLabel && (
                <div className="panel-group">
                  <span className="panel-label">Commute</span>
                  <select
                    className="control control-sm"
                    value={filters.commuteMax}
                    onChange={(e) => onChange({ commuteMax: e.target.value })}
                    aria-label={`Maximum commute to ${anchorLabel}`}
                  >
                    <option value="any">Any commute to {anchorLabel}</option>
                    <option value="20">≤ 20 min to {anchorLabel}</option>
                    <option value="30">≤ 30 min to {anchorLabel}</option>
                    <option value="45">≤ 45 min to {anchorLabel}</option>
                  </select>
                </div>
              )}

              <div className="panel-group">
                <span className="panel-label">Must have</span>
                <div className="panel-pills">
                  {AMENITY_ORDER.filter((k) => k !== "light").map((key) => {
                    const on = filters.perks.includes(key);
                    return (
                      <button
                        key={key}
                        className={on ? "pill is-on" : "pill"}
                        aria-pressed={on}
                        onClick={() =>
                          onChange({
                            perks: on
                              ? filters.perks.filter((p) => p !== key)
                              : [...filters.perks, key],
                          })
                        }
                      >
                        {AMENITIES[key].label}
                      </button>
                    );
                  })}
                </div>
              </div>

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
                {/* "Show 0" is a dead end with the exit hidden in a corner —
                    at zero, the one big button becomes the way back. */}
                {total === 0 ? (
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      onReset();
                    }}
                  >
                    Nothing matches. Clear filters
                  </button>
                ) : (
                  <button className="btn btn-primary" onClick={() => setOpenPanel(false)}>
                    Show {total.toLocaleString()}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <select
          className="control control-sm control-sort"
          title="Sort"
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
        {/* The escape hatch. A tailored feed earns trust by making the
            double-check effortless: the same search, one click, on the sites
            everyone already knows. */}
        {jumps && jumps.length > 0 && (
          <span className="sitejumps">
            <span className="muted">This search on</span>
            {jumps.map((jump) => (
              <a
                key={jump.source}
                className="sitejump"
                href={jump.url}
                target="_blank"
                rel="noreferrer"
                title={`Open this search on ${jump.label}`}
              >
                <SourceMark source={jump.source} size={14} />
                {jump.label}
                <Icon name="external" size={11} />
              </a>
            ))}
          </span>
        )}
        {/* Where it came from and how stale it is, on the results themselves.
            Freshness is the thing a renter is implicitly trusting on every
            card, so it shouldn't take a trip to the settings page to find. */}
        <span className="filterbar-trust">
          Pulled from {sourceCount ?? 5} listing sites
          {lastCheckedAt ? ` · checked ${sinceText(lastCheckedAt)}` : " · not checked yet"}
        </span>
        {trailing}
      </div>
    </div>
  );
}
