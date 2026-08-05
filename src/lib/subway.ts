import raw from "./subway.json";

/**
 * How far is the train.
 *
 * The single question every New Yorker asks about an apartment that no
 * listing site answers usefully — StreetEasy will say "close to the L" in
 * marketing prose, which is not a number you can compare across five places.
 *
 * The data is the MTA's own station list (NY State open data, 496 GTFS
 * stops), collapsed to 445 station complexes: one physical place you walk to,
 * carrying every route that stops there, so a transfer hub counts once and
 * reports all its lines. 17KB, shipped with the bundle — no request, no key,
 * and it works offline.
 *
 * Distances are straight-line with the same grid factor the tour planner
 * uses. A router would be better and needs an API key we don't have; at
 * five-to-fifteen-minute walks the error is a block or two, and the label
 * says "~" for exactly that reason.
 */

export interface Station {
  name: string;
  /** Routes at this complex, e.g. "456" or "NQRW". */
  routes: string;
  lat: number;
  lon: number;
}

export interface NearestStation extends Station {
  meters: number;
  /** Walking minutes at city pace, rounded up. */
  minutes: number;
}

const STATIONS: Station[] = (raw as [string, string, number, number][]).map(
  ([name, routes, lat, lon]) => ({ name, routes, lat, lon })
);

export const STATION_COUNT = STATIONS.length;

const EARTH_RADIUS_M = 6_371_000;

function haversine(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLon = rad(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Straight-line metres to street minutes: 1.3 grid detour over 80 m/min. */
export function walkMinutes(meters: number): number {
  return Math.max(1, Math.ceil((meters * 1.3) / 80));
}

/**
 * The closest station complex, or null without coordinates.
 *
 * A bounding-box prefilter first: comparing 445 haversines per listing across
 * a 250-card grid is 111k trig calls per render, and a degree of latitude is
 * ~111km so a cheap ±0.02° box discards almost everything before the
 * expensive part.
 */
export function nearestStation(lat: number | null, lon: number | null): NearestStation | null {
  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  let best: Station | null = null;
  let bestMeters = Infinity;
  // ~2.2km north-south; wide enough that no NYC address misses its station.
  const box = 0.02;

  for (const station of STATIONS) {
    if (Math.abs(station.lat - lat) > box || Math.abs(station.lon - lon) > box) continue;
    const meters = haversine(lat, lon, station.lat, station.lon);
    if (meters < bestMeters) {
      bestMeters = meters;
      best = station;
    }
  }

  // Outside the box entirely — a listing far from any train, or bad
  // coordinates. Fall back to the full sweep rather than reporting nothing.
  if (!best) {
    for (const station of STATIONS) {
      const meters = haversine(lat, lon, station.lat, station.lon);
      if (meters < bestMeters) {
        bestMeters = meters;
        best = station;
      }
    }
  }
  if (!best) return null;

  return { ...best, meters: Math.round(bestMeters), minutes: walkMinutes(bestMeters) };
}

/** Every station within a walk, nearest first — what "well connected" means. */
export function stationsWithin(
  lat: number | null,
  lon: number | null,
  maxMinutes = 12
): NearestStation[] {
  if (lat == null || lon == null) return [];
  const out: NearestStation[] = [];
  for (const station of STATIONS) {
    if (Math.abs(station.lat - lat) > 0.02 || Math.abs(station.lon - lon) > 0.02) continue;
    const meters = haversine(lat, lon, station.lat, station.lon);
    const minutes = walkMinutes(meters);
    if (minutes <= maxMinutes) out.push({ ...station, meters: Math.round(meters), minutes });
  }
  return out.sort((a, b) => a.meters - b.meters);
}

/** Distinct routes reachable on foot — "6, N, Q, R, W" as a sorted list. */
export function routesWithin(lat: number | null, lon: number | null, maxMinutes = 12): string[] {
  const seen = new Set<string>();
  for (const station of stationsWithin(lat, lon, maxMinutes)) {
    for (const route of station.routes.split("")) seen.add(route);
  }
  return [...seen].sort();
}

/** "4 min to 6 at 33 St" — the whole answer in one line. */
export function subwayLabel(nearest: NearestStation | null): string {
  if (!nearest) return "";
  const lines = nearest.routes.split("").join("/");
  return `${nearest.minutes} min to ${lines} at ${nearest.name}`;
}
