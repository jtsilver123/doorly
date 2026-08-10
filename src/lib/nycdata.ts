/**
 * The building's public record, from NYC Open Data.
 *
 * Three datasets answer the questions a listing never will: HPD housing
 * violations (is the landlord fixing things?), the bedbug registry (has the
 * building filed infestations?), and 311 noise complaints for the block
 * (what do the neighbors call the city about at 2am?). All free Socrata
 * endpoints, no key — the courtesy owed in return is caching and small
 * queries, which the intel route handles.
 *
 * HPD and the bedbug registry key on the city's own address spelling —
 * "EAST 35 STREET", ordinals stripped, suffix spelled out — so the
 * converter here is load-bearing and pinned by tests. 311 has a real point
 * column, so the block query is a radius instead.
 */

const DIRECTIONS: Record<string, string> = {
  e: "EAST",
  w: "WEST",
  n: "NORTH",
  s: "SOUTH",
  east: "EAST",
  west: "WEST",
  north: "NORTH",
  south: "SOUTH",
};

const SUFFIXES: Record<string, string> = {
  st: "STREET",
  street: "STREET",
  ave: "AVENUE",
  av: "AVENUE",
  avenue: "AVENUE",
  pl: "PLACE",
  place: "PLACE",
  blvd: "BOULEVARD",
  boulevard: "BOULEVARD",
  rd: "ROAD",
  road: "ROAD",
  dr: "DRIVE",
  drive: "DRIVE",
  ln: "LANE",
  lane: "LANE",
  ter: "TERRACE",
  terrace: "TERRACE",
  pkwy: "PARKWAY",
  parkway: "PARKWAY",
  sq: "SQUARE",
  square: "SQUARE",
  ct: "COURT",
  court: "COURT",
};

export const BORO_ID: Record<string, string> = {
  manhattan: "1",
  bronx: "2",
  brooklyn: "3",
  queens: "4",
  "staten island": "5",
};

/** "330 East 35th Street" → { houseNumber: "330", street: "EAST 35 STREET" } */
export function hpdAddress(address: string): { houseNumber: string; street: string } | null {
  const cleaned = address.replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
  const match = cleaned.match(/^(\d+[a-zA-Z]?(?:-\d+)?)\s+(.+)$/);
  if (!match) return null;
  const houseNumber = match[1];

  const words = match[2].split(" ").map((word, i, all) => {
    const lower = word.toLowerCase();
    // Ordinals lose their tails: 35th → 35, 2nd → 2.
    if (/^\d+(st|nd|rd|th)$/.test(lower)) return lower.replace(/\D+$/, "");
    if (DIRECTIONS[lower] && i === 0) return DIRECTIONS[lower];
    // The suffix is only a suffix at the end — "St Marks Place" keeps its St.
    if (i === all.length - 1 && SUFFIXES[lower]) return SUFFIXES[lower];
    return word.toUpperCase();
  });

  return { houseNumber, street: words.join(" ") };
}

export interface BuildingIntel {
  violations: {
    open: number;
    openC: number;
    total: number;
    recent: { date: string; class: string; text: string; open: boolean }[];
  } | null;
  bedbugs: {
    lastFilingYear: number;
    infested: number;
  } | null;
  noise: {
    count: number;
    top: string[];
  } | null;
  /** The tax lot's own facts, and what they imply about stabilization. */
  lot: {
    yearBuilt: number;
    unitsRes: number;
    stabilizedLikely: boolean;
  } | null;
}

/**
 * The classic rent stabilization presumption: built before 1974 with six or
 * more units. Not a per-unit verdict — the only definitive answer is the
 * unit's own DHCR rent history, which anyone can request for free — but the
 * rule covers the great majority of stabilized stock, and a place that fits
 * it deserves the question asked out loud.
 */
export function stabilizedLikely(yearBuilt: number, unitsRes: number): boolean {
  return yearBuilt > 0 && yearBuilt < 1974 && unitsRes >= 6;
}

/** PLUTO spells boroughs its own way. */
const PLUTO_BORO: Record<string, string> = {
  manhattan: "MN",
  bronx: "BX",
  brooklyn: "BK",
  queens: "QN",
  "staten island": "SI",
};

const TIMEOUT_MS = 9_000;

async function soda<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchBuildingIntel(
  address: string,
  borough: string,
  lat: number | null,
  lon: number | null
): Promise<BuildingIntel> {
  const parsed = hpdAddress(address);
  const boroId = BORO_ID[borough.toLowerCase()] ?? "";

  const violationsQ =
    parsed && boroId
      ? soda<Record<string, string>[]>(
          `https://data.cityofnewyork.us/resource/wvxf-dwi5.json?$select=violationstatus,class,inspectiondate,novdescription&$where=${encodeURIComponent(
            `housenumber='${parsed.houseNumber}' AND streetname='${parsed.street}' AND boroid='${boroId}'`
          )}&$order=inspectiondate DESC&$limit=200`
        )
      : Promise.reject(new Error("no address"));

  const bedbugsQ =
    parsed && borough
      ? soda<Record<string, string>[]>(
          `https://data.cityofnewyork.us/resource/wz6d-d3jb.json?$select=filing_date,infested_dwelling_unit_count&$where=${encodeURIComponent(
            `house_number='${parsed.houseNumber}' AND street_name='${parsed.street}' AND borough='${borough.toUpperCase()}'`
          )}&$order=filing_date DESC&$limit=20`
        )
      : Promise.reject(new Error("no address"));

  const since = new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10);
  const noiseQ =
    lat != null && lon != null
      ? soda<Record<string, string>[]>(
          `https://data.cityofnewyork.us/resource/erm2-nwe9.json?$select=descriptor&$where=${encodeURIComponent(
            `within_circle(location,${lat},${lon},120) AND starts_with(complaint_type,'Noise') AND created_date>'${since}'`
          )}&$limit=400`
        )
      : Promise.reject(new Error("no coordinates"));

  // PLUTO keys on the same city spelling as HPD, so the parser is shared.
  const plutoBoro = PLUTO_BORO[borough.toLowerCase()] ?? "";
  const lotQ =
    parsed && plutoBoro
      ? soda<Record<string, string>[]>(
          `https://data.cityofnewyork.us/resource/64uk-42ks.json?$select=yearbuilt,unitsres&$where=${encodeURIComponent(
            `address='${parsed.houseNumber} ${parsed.street}' AND borough='${plutoBoro}'`
          )}&$limit=1`
        )
      : Promise.reject(new Error("no address"));

  const [v, b, n, lotR] = await Promise.allSettled([violationsQ, bedbugsQ, noiseQ, lotQ]);

  let violations: BuildingIntel["violations"] = null;
  if (v.status === "fulfilled") {
    const rows = v.value;
    const isOpen = (r: Record<string, string>) => r.violationstatus === "Open";
    violations = {
      open: rows.filter(isOpen).length,
      openC: rows.filter((r) => isOpen(r) && r.class === "C").length,
      total: rows.length,
      recent: [...rows]
        .sort((a, b2) => Number(isOpen(b2)) - Number(isOpen(a)))
        .slice(0, 3)
        .map((r) => ({
          date: (r.inspectiondate ?? "").slice(0, 10),
          class: r.class ?? "",
          text: (r.novdescription ?? "").slice(0, 160),
          open: isOpen(r),
        })),
    };
  }

  let bedbugs: BuildingIntel["bedbugs"] = null;
  if (b.status === "fulfilled" && b.value.length) {
    const latest = b.value[0];
    const infested = Math.max(
      ...b.value.map((r) => Number(r.infested_dwelling_unit_count) || 0)
    );
    bedbugs = {
      lastFilingYear: new Date(latest.filing_date).getFullYear(),
      infested,
    };
  }

  let noise: BuildingIntel["noise"] = null;
  if (n.status === "fulfilled") {
    const counts = new Map<string, number>();
    for (const row of n.value) {
      const key = (row.descriptor ?? "Noise").replace(/\s*\(.*\)$/, "");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    noise = {
      count: n.value.length,
      top: [...counts.entries()]
        .sort((x, y) => y[1] - x[1])
        .slice(0, 2)
        .map(([key]) => key),
    };
  }

  let lot: BuildingIntel["lot"] = null;
  if (lotR.status === "fulfilled" && lotR.value.length) {
    const row = lotR.value[0];
    const yearBuilt = Number(row.yearbuilt) || 0;
    const unitsRes = Number(row.unitsres) || 0;
    if (yearBuilt > 0 || unitsRes > 0) {
      lot = { yearBuilt, unitsRes, stabilizedLikely: stabilizedLikely(yearBuilt, unitsRes) };
    }
  }

  return { violations, bedbugs, noise, lot };
}
