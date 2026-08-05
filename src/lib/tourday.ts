import type { FeedListing } from "@/types";
import { tourWhen } from "@/lib/nextAction";

/**
 * The tour day, as a plan.
 *
 * Book three viewings on a Saturday and the schedule exists only as three
 * separate cards — nothing tells you the 2pm and the 3pm are a forty-minute
 * walk apart, or that you booked them in geographic zigzag. This turns the
 * booked tours into an itinerary: grouped by day, ordered by time, with the
 * walk between consecutive stops estimated and the gaps that don't fit
 * flagged before you're standing in the wrong neighborhood.
 *
 * Walking estimates are straight-line distance at Manhattan pace with a
 * grid factor — not a routing engine, and deliberately so: the app has no
 * key for one, the error against real blocks is small at these distances,
 * and "about 25 min" is the fidelity the decision needs. The label says
 * "walk ~" to keep the estimate honest.
 */

export interface TourStop {
  listing: FeedListing;
  at: Date;
  /** Minutes of walking from the previous stop; null for the first. */
  walkMinutes: number | null;
  /** Minutes between this booking and the previous one. */
  gapMinutes: number | null;
  /** The walk doesn't fit in the gap — you'll be late without transit. */
  tight: boolean;
}

export interface TourDay {
  /** Local date key, YYYY-MM-DD, for grouping. */
  key: string;
  /** "Sat, Sep 12" — how the tab reads. */
  label: string;
  stops: TourStop[];
  totalWalkMinutes: number;
}

const EARTH_RADIUS_M = 6_371_000;

/** Straight-line metres between two points. */
export function haversineMeters(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number
): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLon = rad(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/**
 * Straight-line to street-time. 1.3 is the standard grid detour factor —
 * Manhattan's blocks make every walk longer than the crow's — over a brisk
 * 80 m/min. Rounded up: arriving early is free, arriving late costs the
 * apartment.
 */
export function walkMinutes(meters: number): number {
  return Math.ceil((meters * 1.3) / 80);
}

/** Local YYYY-MM-DD, so grouping follows the user's wall clock, not UTC. */
function dayKey(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** Booked tours with a time, grouped into ordered days. */
export function tourDays(listings: FeedListing[]): TourDay[] {
  const booked = listings
    .filter((l) => l.stage === "tour" && l.tourAt)
    .map((l) => ({ listing: l, at: new Date(l.tourAt!) }))
    .filter((s) => !Number.isNaN(s.at.getTime()))
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  const byDay = new Map<string, typeof booked>();
  for (const stop of booked) {
    const key = dayKey(stop.at);
    byDay.set(key, [...(byDay.get(key) ?? []), stop]);
  }

  const days: TourDay[] = [];
  for (const [key, stops] of byDay) {
    const built: TourStop[] = [];
    let total = 0;
    for (let i = 0; i < stops.length; i++) {
      const { listing, at } = stops[i];
      const prev = i > 0 ? stops[i - 1] : null;
      let walk: number | null = null;
      let gap: number | null = null;
      if (prev) {
        gap = Math.round((at.getTime() - prev.at.getTime()) / 60_000);
        if (
          listing.lat != null &&
          listing.lon != null &&
          prev.listing.lat != null &&
          prev.listing.lon != null
        ) {
          walk = walkMinutes(
            haversineMeters(prev.listing.lat, prev.listing.lon, listing.lat, listing.lon)
          );
          total += walk;
        }
      }
      built.push({
        listing,
        at,
        walkMinutes: walk,
        gapMinutes: gap,
        // A 15-minute viewing plus the walk has to fit in the gap.
        tight: walk != null && gap != null && walk + 15 > gap,
      });
    }
    days.push({
      key,
      label: stops[0].at.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      }),
      stops: built,
      totalWalkMinutes: total,
    });
  }
  return days;
}

/** One stop's line in the written plan: "2:00 PM — 330 E 35th St #3". */
export function stopLabel(stop: TourStop): string {
  const unit = stop.listing.unit ? ` #${stop.listing.unit}` : "";
  return `${tourWhen(stop.listing.tourAt!)} — ${stop.listing.address}${unit}`;
}
