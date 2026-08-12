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
  const cleaned = address
    // The city's files carry no apostrophes: a listing's "Saint Mark's
    // Place" is "ST MARKS PLACE" in every HPD row, and matching on the
    // punctuated version found nothing at all.
    .replace(/['’]/g, "")
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

/**
 * Every spelling the city might have filed this street under.
 *
 * HPD's own data is not self-consistent: "ST MARKS PLACE" and "SAINT MARKS
 * PLACE" both exist as street names in the same dataset, and a building
 * filed under one is invisible to a query for the other. Asking for both
 * costs nothing and is the difference between a record and a blank page.
 */
export function streetVariants(street: string): string[] {
  const out = new Set([street]);
  if (street.startsWith("SAINT ")) out.add(`ST ${street.slice(6)}`);
  else if (street.startsWith("ST ")) out.add(`SAINT ${street.slice(3)}`);
  return [...out];
}

/** `streetname in('ST MARKS PLACE','SAINT MARKS PLACE')`, escaped. */
function streetClause(column: string, street: string): string {
  const list = streetVariants(street)
    .map((s) => `'${soql(s)}'`)
    .join(",");
  return `${column} in(${list})`;
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
 * One line of the building's record, whatever dataset it came from.
 *
 * The summary above answers "is this building a problem"; this answers "show
 * me". Three very different city feeds are flattened into one shape so the
 * reader gets a single reverse-chronological history instead of three tables
 * they have to correlate by date themselves.
 */
export interface RecordEntry {
  kind: "violation" | "complaint" | "bedbug";
  /** yyyy-mm-dd. Empty when the city left the date off, which happens. */
  date: string;
  /** The headline: "Class C violation", "Noise - Residential". */
  title: string;
  /** The city's own words, trimmed. */
  detail: string;
  /** "Open" / "Closed" / "" when the dataset has no such notion. */
  status: string;
  /** How loudly to draw it. */
  tone: "bad" | "warn" | "info";
  /** Apartment or incident address, when the row names one. */
  where: string;
  /**
   * This building, or the street around it.
   *
   * 311 is queried by radius, so a block's worth of parking gripes and taxi
   * complaints arrive alongside the building's own no-heat calls. They are
   * different questions — "what is this building like" versus "what is this
   * corner like" — and mixing them buries the first under the second, which
   * is exactly what the raw feed does.
   */
  scope: "building" | "block";
}

export interface BuildingRecords {
  /** The city's spelling of the address these rows were matched on. */
  matched: string;
  entries: RecordEntry[];
  /** Reports about the building itself, by dataset. */
  counts: { violation: number; complaint: number; bedbug: number };
  /** 311 calls near the building but not at it. Context, counted separately. */
  block: number;
  /** True when a feed hit its row cap, so the UI can say so rather than lie. */
  truncated: boolean;
  /**
   * A city endpoint refused or timed out, so this record is missing a whole
   * dataset rather than merely being short.
   *
   * It exists because the alternative is worse than an error: an empty
   * result looks exactly like a clean building, and caching one for a week
   * would quietly tell a renter that a building with 250 reports has none.
   * The caller checks this before writing anything down.
   */
  partial: boolean;
}

/** How far back the 311 history reaches, and how many rows each feed returns. */
const RECORD_DAYS = 730;
const RECORD_LIMIT = 250;
/**
 * Longer than the summary's ceiling. These are 250-row queries carrying the
 * city's full resolution prose, so they are a hundred kilobytes rather than
 * a handful, and nobody is waiting on them to open a listing.
 */
const RECORD_TIMEOUT_MS = 14_000;

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

/**
 * A value, safe to drop inside a SoQL string literal.
 *
 * Saint Mark's Place. Hell's Kitchen. Every address with an apostrophe in it
 * closed the quote early and made the whole query unparseable, so the city
 * answered 400 and the building came back with no violations and no bedbug
 * filings — indistinguishable, on screen, from a clean building. Doubling
 * the quote is SoQL's own escape, and it also shuts the door on a listing
 * source injecting query syntax through an address field.
 */
export function soql(value: string): string {
  return value.replace(/'/g, "''");
}

async function soda<T>(url: string, timeoutMs = TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The same query, with one second chance.
 *
 * These endpoints take no key, and unauthenticated callers share a throttle
 * with everyone else doing the same — so a failure here is usually a busy
 * moment rather than a broken query, and it clears in well under a second.
 * One retry turns most of those into an answer; without it a transient 429
 * costs the reader a whole dataset and shows them a building with no record.
 */
async function sodaTwice<T>(url: string, timeoutMs = TIMEOUT_MS): Promise<T> {
  try {
    return await soda<T>(url, timeoutMs);
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 700));
    return soda<T>(url, timeoutMs);
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
            `housenumber='${soql(parsed.houseNumber)}' AND ${streetClause("streetname", parsed.street)} AND boroid='${boroId}'`
          )}&$order=inspectiondate DESC&$limit=200`
        )
      : Promise.reject(new Error("no address"));

  const bedbugsQ =
    parsed && borough
      ? soda<Record<string, string>[]>(
          `https://data.cityofnewyork.us/resource/wz6d-d3jb.json?$select=filing_date,infested_dwelling_unit_count&$where=${encodeURIComponent(
            `house_number='${soql(parsed.houseNumber)}' AND ${streetClause("street_name", parsed.street)} AND borough='${soql(borough.toUpperCase())}'`
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
            `${streetClause("address", `${parsed.houseNumber} ${parsed.street}`)} AND borough='${plutoBoro}'`
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

/** HPD grades its violations; the letter is the whole severity story. */
const VIOLATION_CLASS: Record<string, { label: string; tone: RecordEntry["tone"] }> = {
  A: { label: "Class A (non-hazardous)", tone: "info" },
  B: { label: "Class B (hazardous)", tone: "warn" },
  C: { label: "Class C (immediately hazardous)", tone: "bad" },
  I: { label: "Class I (informational)", tone: "info" },
};

/** Trims the city's shouty all-caps prose to something readable in a row. */
function tidy(text: string, cap = 300): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > cap ? `${clean.slice(0, cap - 1)}…` : clean;
}

/**
 * Sentences 311 adds for the person who called, which mean nothing to
 * someone reading the building's history two years later.
 *
 * A resolution like "Police responded and determined no violation occurred"
 * is the finding. "Thank you for attention to this matter. We count on New
 * Yorkers like yourself to maintain a safe and clean city" is a form letter,
 * and at four lines a row it buries every actual finding on the page.
 */
const CIVIC_FILLER = [
  /^thank you for/i,
  /^we count on new yorkers/i,
  /^if the (problem|condition) persists/i,
  /^if possible,? provide contact/i,
  /^to help you,/i,
  /^you (may|must|can) (also )?(call|contact|send)/i,
  /^please (call|contact|note)/i,
  /^(the )?complain(ant|t) (may|should|can)/i,
  /^for more information/i,
  /^contact information is on/i,
];

/** The finding, with the form letter taken off the end. */
function resolution(text: string): string {
  if (!text) return "";
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=\.)\s+/)
    .map((s) => s.trim())
    .filter((s) => s && !CIVIC_FILLER.some((re) => re.test(s)))
    // The agency naming itself in full, every time, in every row.
    .map((s) =>
      s
        .replace(/^The New York City Police Department\b/i, "Police")
        .replace(/^The Department of ([A-Za-z ]+?) \(([A-Z]+)\)/, "$2")
    );
  return sentences.join(" ");
}

/**
 * Whether a 311 row is about this building or merely near it.
 *
 * The feed's incident address is the city's own spelling, the same
 * normalization HPD uses, so the comparison is against the parsed form
 * rather than the listing's prettier version of itself.
 */
function sameBuilding(incident: string, houseNumber: string, street: string): boolean {
  const norm = (s: string) => s.replace(/[.,]/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
  return norm(incident) === norm(`${houseNumber} ${street}`);
}

/**
 * Every report on the building, one row each.
 *
 * Deliberately a separate call from fetchBuildingIntel: the summary is on the
 * critical path of opening a listing and has to stay small and fast, while
 * this is hundreds of rows nobody sees unless they ask. Four datasets, each
 * capped, each allowed to fail on its own — a 311 outage should cost you the
 * complaints, not the violations.
 */
export async function fetchBuildingRecords(
  address: string,
  borough: string,
  lat: number | null,
  lon: number | null
): Promise<BuildingRecords> {
  const parsed = hpdAddress(address);
  const boroId = BORO_ID[borough.toLowerCase()] ?? "";
  const since = new Date(Date.now() - RECORD_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const violationsQ =
    parsed && boroId
      ? sodaTwice<Record<string, string>[]>(
          `https://data.cityofnewyork.us/resource/wvxf-dwi5.json?$select=violationstatus,class,inspectiondate,approveddate,novdescription,apartment,story&$where=${encodeURIComponent(
            `housenumber='${soql(parsed.houseNumber)}' AND ${streetClause("streetname", parsed.street)} AND boroid='${boroId}'`
          )}&$order=inspectiondate DESC&$limit=${RECORD_LIMIT}`,
          RECORD_TIMEOUT_MS
        )
      : Promise.reject(new Error("no address"));

  /*
   * Every complaint type, not just noise. The summary cares about noise
   * because that's what predicts your evenings; the full record is where
   * someone reads "no heat, four winters running" and walks away.
   */
  const complaintsQ =
    lat != null && lon != null
      ? sodaTwice<Record<string, string>[]>(
          `https://data.cityofnewyork.us/resource/erm2-nwe9.json?$select=created_date,complaint_type,descriptor,status,resolution_description,incident_address&$where=${encodeURIComponent(
            `within_circle(location,${lat},${lon},120) AND created_date>'${since}'`
          )}&$order=created_date DESC&$limit=${RECORD_LIMIT}`,
          RECORD_TIMEOUT_MS
        )
      : Promise.reject(new Error("no coordinates"));

  const bedbugsQ =
    parsed && borough
      ? sodaTwice<Record<string, string>[]>(
          // The registry's column names are its own: `eradicated_unit_count`
          // (no "dwelling") and `re_infested_dwelling_unit` (no "count").
          // Guessing the symmetrical spellings 400s the whole query.
          `https://data.cityofnewyork.us/resource/wz6d-d3jb.json?$select=filing_date,infested_dwelling_unit_count,eradicated_unit_count,re_infested_dwelling_unit&$where=${encodeURIComponent(
            `house_number='${soql(parsed.houseNumber)}' AND ${streetClause("street_name", parsed.street)} AND borough='${soql(borough.toUpperCase())}'`
          )}&$order=filing_date DESC&$limit=40`,
          RECORD_TIMEOUT_MS
        )
      : Promise.reject(new Error("no address"));

  const [v, c, b] = await Promise.allSettled([violationsQ, complaintsQ, bedbugsQ]);

  const entries: RecordEntry[] = [];
  const counts = { violation: 0, complaint: 0, bedbug: 0 };
  let truncated = false;
  let block = 0;

  if (v.status === "fulfilled") {
    if (v.value.length >= RECORD_LIMIT) truncated = true;
    for (const row of v.value) {
      const open = row.violationstatus === "Open";
      const grade = VIOLATION_CLASS[row.class ?? ""] ?? {
        label: "HPD violation",
        tone: "info" as const,
      };
      entries.push({
        kind: "violation",
        date: (row.inspectiondate ?? row.approveddate ?? "").slice(0, 10),
        title: grade.label,
        detail: tidy(row.novdescription ?? ""),
        status: open ? "Open" : "Closed",
        // A closed class C is history, not a warning: the landlord fixed it.
        tone: open ? grade.tone : "info",
        where: row.apartment ? `Apt ${row.apartment}` : row.story ? `${row.story}` : "",
        scope: "building",
      });
      counts.violation++;
    }
  }

  if (c.status === "fulfilled") {
    if (c.value.length >= RECORD_LIMIT) truncated = true;
    for (const row of c.value) {
      const open = (row.status ?? "").toLowerCase() !== "closed";
      const here =
        parsed != null &&
        sameBuilding(row.incident_address ?? "", parsed.houseNumber, parsed.street);
      entries.push({
        kind: "complaint",
        date: (row.created_date ?? "").slice(0, 10),
        title: row.complaint_type ?? "311 complaint",
        detail: tidy(
          [row.descriptor, resolution(row.resolution_description ?? "")]
            .filter(Boolean)
            .join(". ")
        ),
        status: row.status ?? "",
        // A call about the next building over is context, never a warning
        // about this one.
        tone: here && open ? "warn" : "info",
        where: row.incident_address ?? "",
        scope: here ? "building" : "block",
      });
      if (here) counts.complaint++;
      else block++;
    }
  }

  if (b.status === "fulfilled") {
    for (const row of b.value) {
      const infested = Number(row.infested_dwelling_unit_count) || 0;
      const eradicated = Number(row.eradicated_unit_count) || 0;
      const reinfested = Number(row.re_infested_dwelling_unit) || 0;
      entries.push({
        kind: "bedbug",
        date: (row.filing_date ?? "").slice(0, 10),
        title: infested > 0 ? "Bedbug filing" : "Bedbug filing, none reported",
        detail: infested
          ? `${infested} unit${infested === 1 ? "" : "s"} infested${
              eradicated ? `, ${eradicated} eradicated` : ""
            }${reinfested ? `, ${reinfested} re-infested` : ""}.`
          : "The landlord's annual filing reported no infestations.",
        status: "",
        tone: infested > 0 ? "warn" : "info",
        where: "",
        scope: "building",
      });
      counts.bedbug++;
    }
  }

  // One history, newest first. Undated rows sink rather than leading with a
  // blank, which is where they would land sorting an empty string.
  entries.sort((x, y) => (y.date || "").localeCompare(x.date || ""));

  return {
    matched: parsed ? `${parsed.houseNumber} ${parsed.street}` : address,
    entries,
    counts,
    block,
    truncated,
    partial: [v, c, b].some((r) => r.status === "rejected"),
  };
}
