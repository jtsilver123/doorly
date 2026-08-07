/**
 * NYC geography, and how each site refers to it.
 *
 * Every source names places differently: Craigslist has 5 borough subareas and
 * nothing finer, StreetEasy uses its own slugs, Zillow wants a free-text region.
 * One table here keeps that mess out of the adapters.
 */

export type Borough =
  | "Manhattan"
  | "Brooklyn"
  | "Queens"
  | "Bronx"
  | "Staten Island";

export interface Area {
  slug: string;
  label: string;
  borough: Borough;
  /** Craigslist subarea code; boroughs only, neighborhoods inherit theirs. */
  craigslist: string;
  /** StreetEasy area slug. */
  streeteasy: string;
  /** What Zillow's search calls this region. */
  zillow: string;
  /** HotPads rejects the borough form and wants the city: "SoHo, New York, NY". */
  hotpads: string;
  /** True for whole-borough entries (as opposed to neighborhoods). */
  isBorough?: boolean;
}

/**
 * StreetEasy's location forms, which changed under us once already.
 *
 * When this adapter was written, only borough-level locations matched —
 * every neighborhood form (slug, underscore, numeric id) returned zero rows,
 * so neighborhoods queried their borough and narrowed locally. Verified
 * 2026-08-07: display names ("East Village") now return full neighborhood
 * inventories, while the old slug form gets "404: Location not matched" with
 * the display names offered back as close matches. Neighborhoods now carry
 * their label; boroughs keep these slugs, which still work.
 *
 * The practical difference is depth, not correctness: page one of a single
 * neighborhood reaches days back, while borough-wide newest-first paging
 * skims hours — a 2-day-old East Village listing was reachable one way and
 * not the other.
 */
const SE_BY_BOROUGH: Record<Borough, string> = {
  Manhattan: "manhattan",
  Brooklyn: "brooklyn",
  Queens: "queens",
  Bronx: "bronx",
  "Staten Island": "staten-island",
};

const CL_BY_BOROUGH: Record<Borough, string> = {
  Manhattan: "mnh",
  Brooklyn: "brk",
  Queens: "que",
  Bronx: "brx",
  "Staten Island": "stn",
};

function hood(slug: string, label: string, borough: Borough): Area {
  return {
    slug,
    label,
    borough,
    craigslist: CL_BY_BOROUGH[borough],
    streeteasy: label,
    zillow: `${label}, ${borough}, NY`,
    hotpads: `${label}, New York, NY`,
  };
}

function boroughArea(slug: string, label: Borough): Area {
  return {
    slug,
    label,
    borough: label,
    craigslist: CL_BY_BOROUGH[label],
    streeteasy: SE_BY_BOROUGH[label],
    zillow: `${label}, NY`,
    hotpads: `${label}, New York, NY`,
    isBorough: true,
  };
}

export const AREAS: Area[] = [
  boroughArea("manhattan", "Manhattan"),
  boroughArea("brooklyn", "Brooklyn"),
  boroughArea("queens", "Queens"),
  boroughArea("bronx", "Bronx"),
  boroughArea("staten-island", "Staten Island"),

  // Manhattan
  hood("upper-east-side", "Upper East Side", "Manhattan"),
  hood("upper-west-side", "Upper West Side", "Manhattan"),
  hood("east-village", "East Village", "Manhattan"),
  hood("west-village", "West Village", "Manhattan"),
  hood("lower-east-side", "Lower East Side", "Manhattan"),
  hood("chelsea", "Chelsea", "Manhattan"),
  hood("harlem", "Harlem", "Manhattan"),
  hood("washington-heights", "Washington Heights", "Manhattan"),
  hood("financial-district", "Financial District", "Manhattan"),
  hood("murray-hill", "Murray Hill", "Manhattan"),
  hood("hells-kitchen", "Hell's Kitchen", "Manhattan"),
  hood("tribeca", "Tribeca", "Manhattan"),
  hood("soho", "SoHo", "Manhattan"),
  hood("gramercy", "Gramercy", "Manhattan"),
  hood("morningside-heights", "Morningside Heights", "Manhattan"),
  hood("flatiron", "Flatiron", "Manhattan"),
  hood("noho", "NoHo", "Manhattan"),
  hood("nolita", "Nolita", "Manhattan"),
  hood("greenwich-village", "Greenwich Village", "Manhattan"),
  hood("union-square", "Union Square", "Manhattan"),
  hood("kips-bay", "Kips Bay", "Manhattan"),
  hood("turtle-bay", "Turtle Bay", "Manhattan"),
  hood("carnegie-hill", "Carnegie Hill", "Manhattan"),
  hood("west-chelsea", "West Chelsea", "Manhattan"),
  hood("midtown", "Midtown", "Manhattan"),
  hood("midtown-east", "Midtown East", "Manhattan"),
  hood("midtown-west", "Midtown West", "Manhattan"),
  hood("yorkville", "Yorkville", "Manhattan"),
  hood("lenox-hill", "Lenox Hill", "Manhattan"),
  hood("east-harlem", "East Harlem", "Manhattan"),
  hood("battery-park-city", "Battery Park City", "Manhattan"),
  hood("chinatown", "Chinatown", "Manhattan"),
  hood("two-bridges", "Two Bridges", "Manhattan"),
  hood("roosevelt-island", "Roosevelt Island", "Manhattan"),
  hood("stuyvesant-town", "Stuyvesant Town", "Manhattan"),
  hood("alphabet-city", "Alphabet City", "Manhattan"),
  hood("inwood", "Inwood", "Manhattan"),
  hood("hamilton-heights", "Hamilton Heights", "Manhattan"),

  // Brooklyn
  hood("williamsburg", "Williamsburg", "Brooklyn"),
  hood("east-williamsburg", "East Williamsburg", "Brooklyn"),
  hood("greenpoint", "Greenpoint", "Brooklyn"),
  hood("bushwick", "Bushwick", "Brooklyn"),
  hood("bed-stuy", "Bed-Stuy", "Brooklyn"),
  hood("crown-heights", "Crown Heights", "Brooklyn"),
  hood("prospect-heights", "Prospect Heights", "Brooklyn"),
  hood("park-slope", "Park Slope", "Brooklyn"),
  hood("gowanus", "Gowanus", "Brooklyn"),
  hood("carroll-gardens", "Carroll Gardens", "Brooklyn"),
  hood("cobble-hill", "Cobble Hill", "Brooklyn"),
  hood("boerum-hill", "Boerum Hill", "Brooklyn"),
  hood("brooklyn-heights", "Brooklyn Heights", "Brooklyn"),
  hood("fort-greene", "Fort Greene", "Brooklyn"),
  hood("clinton-hill", "Clinton Hill", "Brooklyn"),
  hood("dumbo", "DUMBO", "Brooklyn"),
  hood("downtown-brooklyn", "Downtown Brooklyn", "Brooklyn"),
  hood("sunset-park", "Sunset Park", "Brooklyn"),
  hood("bay-ridge", "Bay Ridge", "Brooklyn"),
  hood("flatbush", "Flatbush", "Brooklyn"),
  hood("ditmas-park", "Ditmas Park", "Brooklyn"),
  hood("windsor-terrace", "Windsor Terrace", "Brooklyn"),
  hood("red-hook", "Red Hook", "Brooklyn"),
  hood("prospect-lefferts-gardens", "Prospect Lefferts Gardens", "Brooklyn"),

  // Queens
  hood("astoria", "Astoria", "Queens"),
  hood("long-island-city", "Long Island City", "Queens"),
  hood("sunnyside", "Sunnyside", "Queens"),
  hood("woodside", "Woodside", "Queens"),
  hood("jackson-heights", "Jackson Heights", "Queens"),
  hood("ridgewood", "Ridgewood", "Queens"),
  hood("forest-hills", "Forest Hills", "Queens"),
  hood("flushing", "Flushing", "Queens"),
  hood("rego-park", "Rego Park", "Queens"),

  // Bronx
  hood("mott-haven", "Mott Haven", "Bronx"),
  hood("riverdale", "Riverdale", "Bronx"),
  hood("fordham", "Fordham", "Bronx"),
  hood("concourse", "Concourse", "Bronx"),
];

const BY_SLUG = new Map(AREAS.map((a) => [a.slug, a]));

export function getArea(slug: string): Area | undefined {
  return BY_SLUG.get(slug.toLowerCase());
}

/** Resolve criteria slugs to areas, defaulting to all of Manhattan. */
export function getAreas(slugs: string[]): Area[] {
  const areas = slugs.map(getArea).filter(Boolean) as Area[];
  return areas.length ? areas : [BY_SLUG.get("manhattan")!];
}

export function areaLabel(slug: string): string {
  return getArea(slug)?.label ?? slug;
}

/**
 * What to actually query.
 *
 * Wide mode collapses several neighborhoods to the one borough containing them,
 * turning four upstream requests into one. Safe only because coordinates let us
 * re-narrow locally afterwards (see geo.withinAreas) — without that, the extra
 * results would simply be noise.
 */
export function queryScopes(slugs: string[], wide: boolean): Area[] {
  const areas = getAreas(slugs);
  if (!wide) return areas;

  const boroughs = new Set(areas.map((a) => a.borough));
  const scopes = AREAS.filter((a) => a.isBorough && boroughs.has(a.borough));
  return scopes.length ? scopes : areas;
}

/** Distinct Craigslist subareas covering the given areas. */
export function craigslistSubareas(slugs: string[]): string[] {
  const set = new Set<string>();
  for (const slug of slugs) {
    const area = getArea(slug);
    if (area) set.add(area.craigslist);
  }
  return [...set];
}

/**
 * Neighborhood names to keep, for sources that can only search borough-wide.
 * Empty means "no neighborhood filter" — i.e. the search includes a whole
 * borough, so everything in it qualifies.
 */
export function neighborhoodFilter(slugs: string[]): Set<string> {
  const names = new Set<string>();
  for (const slug of slugs) {
    const area = getArea(slug);
    if (!area) continue;
    if (area.isBorough) return new Set(); // whole borough wins
    names.add(area.label.toLowerCase());
  }
  return names;
}

const NEIGHBORHOOD_TO_BOROUGH = new Map<string, Borough>(
  AREAS.filter((a) => !a.isBorough).map((a) => [a.label.toLowerCase(), a.borough])
);

/** Best-effort borough for a free-text neighborhood string. */
export function boroughFor(text: string): string {
  const lower = text.toLowerCase();
  for (const [name, borough] of NEIGHBORHOOD_TO_BOROUGH) {
    if (lower.includes(name)) return borough;
  }
  for (const borough of ["Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island"]) {
    if (lower.includes(borough.toLowerCase())) return borough;
  }
  return "";
}

/** Normalize a free-text neighborhood to a known label where possible. */
export function canonicalNeighborhood(text: string): string {
  const lower = text.toLowerCase();
  for (const area of AREAS) {
    if (area.isBorough) continue;
    if (lower.includes(area.label.toLowerCase())) return area.label;
  }
  // Craigslist writes things like "bed stuy" / "bedford stuyvesant"
  const aliases: Record<string, string> = {
    "bed stuy": "Bed-Stuy",
    "bedford stuyvesant": "Bed-Stuy",
    "bedford-stuyvesant": "Bed-Stuy",
    "e williamsburg": "East Williamsburg",
    "e. williamsburg": "East Williamsburg",
    lic: "Long Island City",
    "prospect lefferts": "Prospect Lefferts Gardens",
  };
  for (const [alias, label] of Object.entries(aliases)) {
    if (lower.includes(alias)) return label;
  }
  return "";
}
