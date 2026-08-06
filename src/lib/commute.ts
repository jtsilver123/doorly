import { nearestStation, walkMinutes } from "@/lib/subway";
import { distanceKm } from "@/lib/geo";

/**
 * Door-to-door subway estimate, honestly rough.
 *
 * walk to the nearest station + a wait + ride at average NYC subway pace +
 * walk from the anchor's nearest station. No routing graph, no transfers —
 * this exists to answer "is this a 20-minute or a 50-minute life", which the
 * straight-line model gets right to within the headway of the train you'll
 * be standing on. Transfers are approximated by a pace penalty rather than
 * pretended away.
 */

/** Average effective subway pace door-of-train to door-of-train, km/h. */
const SUBWAY_KMH = 25;
const WAIT_MIN = 5;

export interface CommuteEstimate {
  minutes: number;
  /** "walk 4 + ride 16 + walk 6" — the estimate showing its work. */
  breakdown: string;
}

export function commuteMinutes(
  from: { lat: number | null; lon: number | null },
  to: { lat: number; lon: number }
): CommuteEstimate | null {
  if (from.lat == null || from.lon == null) return null;

  const a = nearestStation(from.lat, from.lon);
  const b = nearestStation(to.lat, to.lon);
  if (!a || !b) return null;

  // Close enough to walk the whole way: say that instead of routing a train.
  const direct = distanceKm(from.lat, from.lon, to.lat, to.lon);
  const walkAll = walkMinutes(direct * 1000 * 1.3); // street grid detour factor
  if (walkAll <= 18) {
    return { minutes: walkAll, breakdown: `${walkAll} min walk` };
  }

  const ride = Math.max(
    3,
    Math.round((distanceKm(a.lat, a.lon, b.lat, b.lon) / SUBWAY_KMH) * 60)
  );
  const total = a.minutes + WAIT_MIN + ride + b.minutes;
  return {
    minutes: total,
    breakdown: `walk ${a.minutes} + train ~${ride + WAIT_MIN} + walk ${b.minutes}`,
  };
}
