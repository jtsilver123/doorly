import { neighborhoodAt as neighborhoodByPolygon } from "@/lib/nta";
/**
 * Where a listing actually is.
 *
 * Zillow, HotPads and Apartments.com all return coordinates but no
 * neighborhood, so each result used to be stamped with whichever area we
 * happened to query — a guess that's wrong whenever a search spills over a
 * boundary, and useless if you query a whole borough at once.
 *
 * Resolving the neighborhood from coordinates fixes both: labels stop being
 * assumptions, and one borough-wide request can replace four per-neighborhood
 * ones because the narrowing happens locally. That's the difference between
 * ~14 and ~5 API requests per poll.
 *
 * Centroids, not boxes. Bounding boxes were tried first and scored 39% against
 * StreetEasy's own labels: neighborhoods overlap at every seam, and a
 * "smallest box wins" tiebreak makes sub-areas swallow their parents — 62
 * listings StreetEasy calls East Village landed in Alphabet City. Nearest
 * centroid instead gives a Voronoi partition: no overlaps, no gaps, and
 * boundaries that fall halfway between centres, which is roughly where real
 * ones are. Sub-areas StreetEasy folds into a parent (Alphabet City into East
 * Village, Union Square into Greenwich Village) are deliberately absent, so the
 * vocabulary matches the source we check against.
 */

export interface Place {
  name: string;
  borough: string;
  lat: number;
  lon: number;
}

const PLACES: Place[] = [
  // --- Manhattan ---
  { name: "Financial District", borough: "Manhattan", lat: 40.7075, lon: -74.0113 },
  { name: "Battery Park City", borough: "Manhattan", lat: 40.7115, lon: -74.0165 },
  { name: "Tribeca", borough: "Manhattan", lat: 40.7163, lon: -74.0086 },
  { name: "Chinatown", borough: "Manhattan", lat: 40.7158, lon: -73.997 },
  { name: "Two Bridges", borough: "Manhattan", lat: 40.711, lon: -73.993 },
  { name: "Lower East Side", borough: "Manhattan", lat: 40.7175, lon: -73.9845 },
  { name: "SoHo", borough: "Manhattan", lat: 40.7233, lon: -74.003 },
  { name: "Nolita", borough: "Manhattan", lat: 40.7223, lon: -73.9955 },
  { name: "NoHo", borough: "Manhattan", lat: 40.7283, lon: -73.9928 },
  { name: "East Village", borough: "Manhattan", lat: 40.7256, lon: -73.9848 },  // fitted from labelled data
  { name: "Greenwich Village", borough: "Manhattan", lat: 40.7323, lon: -73.9997 },
  { name: "West Village", borough: "Manhattan", lat: 40.7329, lon: -74.0025 },  // fitted from labelled data
  { name: "Stuyvesant Town", borough: "Manhattan", lat: 40.7318, lon: -73.978 },
  { name: "Gramercy", borough: "Manhattan", lat: 40.7368, lon: -73.9845 },
  { name: "Flatiron", borough: "Manhattan", lat: 40.7411, lon: -73.9836 },  // fitted from labelled data
  { name: "Chelsea", borough: "Manhattan", lat: 40.7456, lon: -73.9973 },  // fitted from labelled data
  { name: "West Chelsea", borough: "Manhattan", lat: 40.7495, lon: -74.0058 },
  { name: "Kips Bay", borough: "Manhattan", lat: 40.7424, lon: -73.9785 },
  { name: "Murray Hill", borough: "Manhattan", lat: 40.7486, lon: -73.9754 },
  { name: "Hell's Kitchen", borough: "Manhattan", lat: 40.7638, lon: -73.9918 },
  { name: "Midtown", borough: "Manhattan", lat: 40.7538, lon: -73.9843 },
  { name: "Midtown East", borough: "Manhattan", lat: 40.7548, lon: -73.9718 },
  { name: "Turtle Bay", borough: "Manhattan", lat: 40.7535, lon: -73.9672 },
  { name: "Lenox Hill", borough: "Manhattan", lat: 40.7664, lon: -73.9619 },
  { name: "Roosevelt Island", borough: "Manhattan", lat: 40.762, lon: -73.9497 },
  { name: "Upper East Side", borough: "Manhattan", lat: 40.7736, lon: -73.9598 },
  { name: "Yorkville", borough: "Manhattan", lat: 40.7762, lon: -73.9482 },
  { name: "Carnegie Hill", borough: "Manhattan", lat: 40.7846, lon: -73.9542 },
  { name: "Upper West Side", borough: "Manhattan", lat: 40.787, lon: -73.9754 },
  { name: "Morningside Heights", borough: "Manhattan", lat: 40.809, lon: -73.962 },
  { name: "East Harlem", borough: "Manhattan", lat: 40.7957, lon: -73.9389 },
  { name: "Harlem", borough: "Manhattan", lat: 40.8116, lon: -73.9465 },
  { name: "Hamilton Heights", borough: "Manhattan", lat: 40.825, lon: -73.949 },
  { name: "Washington Heights", borough: "Manhattan", lat: 40.8417, lon: -73.9393 },
  { name: "Inwood", borough: "Manhattan", lat: 40.8677, lon: -73.9212 },

  // --- Brooklyn ---
  { name: "Greenpoint", borough: "Brooklyn", lat: 40.7304, lon: -73.9515 },
  { name: "Williamsburg", borough: "Brooklyn", lat: 40.7143, lon: -73.9566 },
  { name: "East Williamsburg", borough: "Brooklyn", lat: 40.7126, lon: -73.9318 },
  { name: "Bushwick", borough: "Brooklyn", lat: 40.6944, lon: -73.9213 },
  { name: "DUMBO", borough: "Brooklyn", lat: 40.7033, lon: -73.9881 },
  { name: "Brooklyn Heights", borough: "Brooklyn", lat: 40.6959, lon: -73.9937 },
  { name: "Downtown Brooklyn", borough: "Brooklyn", lat: 40.6928, lon: -73.9846 },
  { name: "Fort Greene", borough: "Brooklyn", lat: 40.6892, lon: -73.9743 },
  { name: "Clinton Hill", borough: "Brooklyn", lat: 40.6873, lon: -73.9654 },
  { name: "Bed-Stuy", borough: "Brooklyn", lat: 40.6872, lon: -73.9418 },
  { name: "Boerum Hill", borough: "Brooklyn", lat: 40.6858, lon: -73.9846 },
  { name: "Cobble Hill", borough: "Brooklyn", lat: 40.6864, lon: -73.9967 },
  { name: "Carroll Gardens", borough: "Brooklyn", lat: 40.6795, lon: -73.9998 },
  { name: "Gowanus", borough: "Brooklyn", lat: 40.6739, lon: -73.9885 },
  { name: "Park Slope", borough: "Brooklyn", lat: 40.6702, lon: -73.9812 },
  { name: "Prospect Heights", borough: "Brooklyn", lat: 40.6774, lon: -73.9668 },
  { name: "Crown Heights", borough: "Brooklyn", lat: 40.6694, lon: -73.9442 },
  { name: "Red Hook", borough: "Brooklyn", lat: 40.6751, lon: -74.0088 },
  { name: "Windsor Terrace", borough: "Brooklyn", lat: 40.6553, lon: -73.9772 },
  { name: "Ditmas Park", borough: "Brooklyn", lat: 40.6403, lon: -73.9639 },
  { name: "Flatbush", borough: "Brooklyn", lat: 40.6409, lon: -73.9569 },
  { name: "Sunset Park", borough: "Brooklyn", lat: 40.6455, lon: -74.0122 },
  { name: "Bay Ridge", borough: "Brooklyn", lat: 40.6264, lon: -74.0299 },

  // --- Queens ---
  { name: "Long Island City", borough: "Queens", lat: 40.7447, lon: -73.9485 },
  { name: "Astoria", borough: "Queens", lat: 40.7644, lon: -73.9235 },
  { name: "Sunnyside", borough: "Queens", lat: 40.7433, lon: -73.9196 },
  { name: "Woodside", borough: "Queens", lat: 40.7454, lon: -73.9062 },
  { name: "Jackson Heights", borough: "Queens", lat: 40.7557, lon: -73.8831 },
  { name: "Ridgewood", borough: "Queens", lat: 40.7043, lon: -73.9018 },
  { name: "Forest Hills", borough: "Queens", lat: 40.7196, lon: -73.8448 },
  { name: "Rego Park", borough: "Queens", lat: 40.7256, lon: -73.8624 },
  { name: "Flushing", borough: "Queens", lat: 40.7654, lon: -73.8318 },

  // --- Bronx ---
  { name: "Mott Haven", borough: "Bronx", lat: 40.8091, lon: -73.9229 },
  { name: "Concourse", borough: "Bronx", lat: 40.8324, lon: -73.9218 },
  { name: "Fordham", borough: "Bronx", lat: 40.8618, lon: -73.8935 },
  { name: "Riverdale", borough: "Bronx", lat: 40.8901, lon: -73.9126 },
];

/**
 * Beyond this, the nearest centroid is meaningless — a listing in New Jersey
 * shouldn't be labelled Battery Park City just because that's the closest
 * point we know about. Roughly 2.5km.
 */
const MAX_DEGREES = 0.03;

/** Squared degree distance, latitude-corrected. Good enough at NYC's latitude. */
function distance2(lat: number, lon: number, place: Place): number {
  // A degree of longitude is ~0.758 of a degree of latitude at 40.7°N.
  const dLat = lat - place.lat;
  const dLon = (lon - place.lon) * 0.758;
  return dLat * dLat + dLon * dLon;
}

export interface Located {
  neighborhood: string;
  borough: string;
}

/**
 * Which neighborhood a coordinate is in.
 *
 * Answered against the city's real boundaries first. The nearest-centroid
 * search below it is a fallback for the handful of points that land in water,
 * a park or outside the five boroughs — it was the primary method until the
 * polygons arrived, and it was right about 62% of the time, which was quietly
 * corrupting every market comparison built on the label.
 */
export function locate(
  lat: number | null | undefined,
  lon: number | null | undefined
): Located {
  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { neighborhood: "", borough: "" };
  }

  const exact = neighborhoodByPolygon(lat, lon);
  if (exact) return exact;

  let best: Place | null = null;
  let bestDistance = Infinity;
  for (const place of PLACES) {
    const d = distance2(lat, lon, place);
    if (d < bestDistance) {
      bestDistance = d;
      best = place;
    }
  }

  if (!best || bestDistance > MAX_DEGREES * MAX_DEGREES) {
    return { neighborhood: "", borough: "" };
  }
  return { neighborhood: best.name, borough: best.borough };
}

export function neighborhoodAt(
  lat: number | null | undefined,
  lon: number | null | undefined
): string {
  return locate(lat, lon).neighborhood;
}

export function boroughAt(
  lat: number | null | undefined,
  lon: number | null | undefined
): string {
  return locate(lat, lon).borough;
}

/**
 * Radius that reliably contains a neighborhood.
 *
 * Measured, not guessed: across every listing StreetEasy labelled as one of the
 * searched neighborhoods, the furthest sat 1.09km from that neighborhood's
 * fitted centre, with the 90th percentile at 0.76km. 1.2km captures all of
 * them.
 *
 * Note the asymmetry this is tuned for. Including a borderline listing from the
 * next neighborhood over costs you one card to skim; excluding a real West
 * Village listing means never seeing it at all. So the radius is set for full
 * recall and the precision cost is accepted — and it can't be measured
 * honestly anyway, since every listing we hold was already filtered to these
 * areas, leaving no negative examples to test against.
 */
export const AREA_RADIUS_KM = 1.2;

const KM_PER_DEGREE = 111.0;

/** Great-circle-ish distance in km. Flat-earth is fine over a few kilometres. */
export function distanceKm(
  lat: number,
  lon: number,
  toLat: number,
  toLon: number
): number {
  const dLat = lat - toLat;
  const dLon = (lon - toLon) * 0.758; // longitude compression at 40.7°N
  return Math.sqrt(dLat * dLat + dLon * dLon) * KM_PER_DEGREE;
}

const BY_NAME = new Map(PLACES.map((p) => [p.name.toLowerCase(), p]));

export function placeByName(name: string): Place | undefined {
  return BY_NAME.get(name.toLowerCase());
}

/**
 * Is this coordinate inside any of the named neighborhoods?
 *
 * This is what makes one borough-wide request able to replace four
 * neighborhood ones: the narrowing happens here instead of upstream.
 */
export function withinAreas(
  lat: number | null | undefined,
  lon: number | null | undefined,
  areaNames: string[],
  radiusKm = AREA_RADIUS_KM
): boolean {
  if (lat == null || lon == null || !areaNames.length) return false;
  for (const name of areaNames) {
    const place = placeByName(name);
    if (!place) continue;
    if (distanceKm(lat, lon, place.lat, place.lon) <= radiusKm) return true;
  }
  return false;
}

export { PLACES };
