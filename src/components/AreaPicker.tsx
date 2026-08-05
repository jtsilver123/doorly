"use client";

import { useMemo, useRef, useState } from "react";
import { AREAS } from "@/lib/areas";

/**
 * Choosing neighborhoods.
 *
 * Seventy-five chips in a scrolling box is a wall, not a choice — you can't
 * find Bushwick without reading everything. Typing is how people actually
 * think about this ("bushwick", Enter, "ridgewood", Enter), so search comes
 * first and browsing is the fallback rather than the only option.
 *
 * Selected areas lift out into their own row so the answer to "what did I
 * pick?" never requires hunting for highlighted chips in a grid.
 */

const BOROUGH_ORDER = ["Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island"];

export default function AreaPicker({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [browsing, setBrowsing] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const hoods = useMemo(() => AREAS.filter((a) => !a.isBorough), []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return hoods
      .filter((a) => !selected.includes(a.slug))
      .filter(
        (a) => a.label.toLowerCase().includes(q) || a.borough.toLowerCase().includes(q)
      )
      // Prefix matches first: typing "east" should surface East Village before
      // Lower East Side.
      .sort((a, b) => {
        const aStarts = a.label.toLowerCase().startsWith(q) ? 0 : 1;
        const bStarts = b.label.toLowerCase().startsWith(q) ? 0 : 1;
        return aStarts - bStarts || a.label.localeCompare(b.label);
      })
      .slice(0, 8);
  }, [query, hoods, selected]);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof AREAS>();
    for (const area of hoods) {
      const list = map.get(area.borough) ?? [];
      list.push(area);
      map.set(area.borough, list);
    }
    return BOROUGH_ORDER.filter((b) => map.has(b)).map((b) => [b, map.get(b)!] as const);
  }, [hoods]);

  function add(slug: string) {
    if (!selected.includes(slug)) onChange([...selected, slug]);
    setQuery("");
    setCursor(0);
    inputRef.current?.focus();
  }

  function remove(slug: string) {
    onChange(selected.filter((s) => s !== slug));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (matches[cursor]) add(matches[cursor].slug);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, matches.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
      return;
    }
    // Backspace on an empty box removes the last pick, like every tag input.
    if (e.key === "Backspace" && !query && selected.length) {
      remove(selected[selected.length - 1]);
    }
  }

  const labelFor = (slug: string) =>
    hoods.find((a) => a.slug === slug)?.label ?? slug;

  return (
    <div className="picker">
      <div className="picker-box">
        {selected.map((slug) => (
          <span key={slug} className="token">
            {labelFor(slug)}
            <button
              type="button"
              onClick={() => remove(slug)}
              aria-label={`Remove ${labelFor(slug)}`}
            >
              ✕
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="picker-input"
          value={query}
          placeholder={selected.length ? "Add another…" : "Type a neighborhood…"}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={onKeyDown}
        />
      </div>

      {matches.length > 0 && (
        <ul className="picker-results">
          {matches.map((area, i) => (
            <li key={area.slug}>
              <button
                type="button"
                className={i === cursor ? "is-cursor" : ""}
                onMouseEnter={() => setCursor(i)}
                onClick={() => add(area.slug)}
              >
                <span>{area.label}</span>
                <span className="muted">{area.borough}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="picker-actions">
        <button type="button" className="linkish" onClick={() => setBrowsing((v) => !v)}>
          {browsing ? "Hide the full list" : "Browse all neighborhoods"}
        </button>
        {selected.length > 0 && (
          <button type="button" className="linkish" onClick={() => onChange([])}>
            Clear all
          </button>
        )}
      </div>

      {browsing && (
        <div className="picker-browse">
          {grouped.map(([borough, list]) => (
            <div key={borough}>
              <div className="picker-borough">
                {borough}
                <button
                  type="button"
                  className="linkish"
                  onClick={() => {
                    const slugs = list.map((a) => a.slug);
                    const allOn = slugs.every((s) => selected.includes(s));
                    onChange(
                      allOn
                        ? selected.filter((s) => !slugs.includes(s))
                        : [...new Set([...selected, ...slugs])]
                    );
                  }}
                >
                  {list.every((a) => selected.includes(a.slug)) ? "none" : "all"}
                </button>
              </div>
              <div className="picker-chips">
                {list.map((area) => {
                  const on = selected.includes(area.slug);
                  return (
                    <button
                      key={area.slug}
                      type="button"
                      className={on ? "pill is-on" : "pill"}
                      onClick={() => (on ? remove(area.slug) : add(area.slug))}
                    >
                      {area.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
