import RAW from "./nta.json";
import { AREAS as AREAS_LIST } from "@/lib/areas";

/**
 * Real neighborhood boundaries.
 *
 * Location used to be a guess. Two of the five sources publish no neighborhood
 * field at all, so listings were labelled by nearest fitted centroid — 62%
 * correct on held-out data. That error did not stay cosmetic: market
 * comparables are grouped by this label, so a median presented as "45 Flatiron
 * studios" contained listings that were not in Flatiron, and the price verdict
 * on every card was built on it.
 *
 * These are the city's own Neighborhood Tabulation Areas, simplified to about
 * 44 metres — far finer than the question needs, since a listing within 44m of
 * a boundary is genuinely ambiguous anyway. Parks, airports, cemeteries and
 * rail yards are dropped: they hold no apartments and would only produce
 * confident wrong answers.
 */

interface Area {
  /** NTA name, e.g. "West Village". */
  n: string;
  b: string;
  /** Outer rings, [lon, lat] pairs. Holes are not modelled — NTAs have none. */
  r: [number, number][][];
}

const AREAS = RAW as unknown as Area[];

/** Precomputed bounds, so most rings are rejected with four comparisons. */
const BOUNDS = AREAS.map((a) => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of a.r) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY };
});

/** Standard ray casting. Rings are closed, so the wrap-around is implicit. */
function inRing(x: number, y: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export interface Located {
  neighborhood: string;
  borough: string;
}

/**
 * NTA names are administrative, not conversational: the city calls Flatiron
 * "Midtown South-Flatiron-Union Square" and Chelsea "Chelsea-Hudson Yards".
 * Labelling a card that way would be accurate and useless.
 *
 * Rather than hand-maintain a translation table that silently rots as the app
 * adds neighborhoods, each hyphenated NTA name is split and matched against the
 * vocabulary the app already searches in. The first segment the user could have
 * picked in the neighborhood picker wins; failing that, the first segment does.
 * So "Chelsea-Hudson Yards" becomes "Chelsea" because Chelsea is searchable,
 * and an NTA nobody can search for keeps a sensible short name anyway.
 */
const APP_LABELS = new Set(AREAS_LIST.map((a) => a.label));

function friendly(ntaName: string): string {
  const parts = ntaName.split("-").map((p) => p.trim());
  return parts.find((p) => APP_LABELS.has(p)) ?? parts[0];
}

/**
 * Which neighborhood a coordinate falls in, or null when it falls in none —
 * water, a park, or outside the city. Null is a real answer here: inventing a
 * label for a point that is in the Hudson is how the old centroid approach
 * produced its wrong answers.
 */
export function neighborhoodAt(lat: number, lon: number): Located | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  for (let i = 0; i < AREAS.length; i++) {
    const b = BOUNDS[i];
    if (lon < b.minX || lon > b.maxX || lat < b.minY || lat > b.maxY) continue;
    for (const ring of AREAS[i].r) {
      if (inRing(lon, lat, ring)) {
        return { neighborhood: friendly(AREAS[i].n), borough: AREAS[i].b };
      }
    }
  }
  return null;
}

/** The polygons themselves, for drawing the map. */
export function areasIn(borough?: string): Area[] {
  return borough ? AREAS.filter((a) => a.b === borough) : AREAS;
}

export type { Area };
