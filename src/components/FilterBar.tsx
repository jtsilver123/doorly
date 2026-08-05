"use client";

import { ALL_SOURCES, SOURCE_LABEL, type Source } from "@/types";
import SourceMark from "@/components/SourceMark";
import { SORT_OPTIONS } from "@/lib/filters";

/**
 * Filters, where the listings are.
 *
 * These lived in the sidebar, which put them nowhere near the thing they act
 * on and turned the left rail into a wall of form controls — the single
 * biggest reason the app read as assembled rather than designed. Sitting above
 * the grid they're both discoverable and obviously connected to the results.
 *
 * Sources filter by logo because that's how the cards already identify them:
 * you tap the purple square to see only StreetEasy, matching what you just
 * looked at rather than translating through a dropdown.
 *
 * Everything is one row of quiet controls until you touch it, so the default
 * state reads as "324 listings" rather than as a form to fill in.
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
  // Rating first: it's the one filter that answers "just show me the good ones",
  // which is what most sessions are actually trying to do.
  { key: "goodOnly", label: "Good deals only", hint: "Only places rated 70 or above for your search" },
  { key: "changedOnly", label: "Price changed", hint: "Only listings whose price moved" },
  { key: "starredOnly", label: "Starred", hint: "Only ones you starred" },
  { key: "noFeeOnly", label: "No fee", hint: "Skip broker-fee listings" },
  { key: "readyOnly", label: "Ready by my date", hint: "Available in time for your move-in" },
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
  function toggleSource(source: Source) {
    const on = filters.sources.includes(source);
    onChange({
      sources: on
        ? filters.sources.filter((s) => s !== source)
        : [...filters.sources, source],
    });
  }

  const activeCount =
    (filters.query ? 1 : 0) +
    (filters.priceMax ? 1 : 0) +
    (filters.beds !== "any" ? 1 : 0) +
    (filters.baths !== "any" ? 1 : 0) +
    filters.sources.length +
    TOGGLES.filter((t) => filters[t.key]).length;

  return (
    <div className="filterbar">
      <div className="filterbar-main">
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

        <select
          className="control"
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

      <div className="filterbar-row">
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
          <option value="any">Any beds</option>
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
          <option value="any">Any bath</option>
          <option value="1">1+ bath</option>
          <option value="1.5">1.5+ bath</option>
          <option value="2">2+ bath</option>
        </select>

        <span className="filterbar-divider" aria-hidden="true" />

        <span className="sourcefilter" role="group" aria-label="Filter by listing site">
          {ALL_SOURCES.map((source) => {
            const on = filters.sources.includes(source);
            return (
              <button
                key={source}
                className={on ? "sourcetoggle is-on" : "sourcetoggle"}
                onClick={() => toggleSource(source)}
                title={
                  on ? `Showing only ${SOURCE_LABEL[source]}` : `Show only ${SOURCE_LABEL[source]}`
                }
                aria-pressed={on}
              >
                <SourceMark source={source} size={17} />
              </button>
            );
          })}
        </span>

        <span className="filterbar-divider" aria-hidden="true" />

        {TOGGLES.map((toggle) => (
          <button
            key={toggle.key}
            className={filters[toggle.key] ? "pill is-on" : "pill"}
            onClick={() => onChange({ [toggle.key]: !filters[toggle.key] } as Partial<Filters>)}
            title={toggle.hint}
            aria-pressed={Boolean(filters[toggle.key])}
          >
            {toggle.label}
          </button>
        ))}
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
