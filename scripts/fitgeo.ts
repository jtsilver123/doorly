/**
 * Derives neighborhood centroids from StreetEasy's own labelled coordinates,
 * and reports held-out accuracy so the number isn't self-graded.
 */
import { createClient } from "@supabase/supabase-js";
import { PLACES } from "@/lib/geo";

interface Row { neighborhood: string; lat: number; lon: number }

function centroidsFrom(rows: Row[]) {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const list = groups.get(r.neighborhood) ?? [];
    list.push(r);
    groups.set(r.neighborhood, list);
  }
  const out = new Map<string, { lat: number; lon: number; n: number }>();
  for (const [name, list] of groups) {
    // Median beats mean here: one mislabelled outlier shouldn't drag the centre.
    const lats = list.map((r) => r.lat).sort((a, b) => a - b);
    const lons = list.map((r) => r.lon).sort((a, b) => a - b);
    const mid = (a: number[]) => a[Math.floor(a.length / 2)];
    out.set(name, { lat: mid(lats), lon: mid(lons), n: list.length });
  }
  return out;
}

function classify(lat: number, lon: number, places: { name: string; lat: number; lon: number }[]) {
  let best = "", bestD = Infinity;
  for (const p of places) {
    const dLat = lat - p.lat, dLon = (lon - p.lon) * 0.758;
    const d = dLat * dLat + dLon * dLon;
    if (d < bestD) { bestD = d; best = p.name; }
  }
  return best;
}

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data } = await db.from("listings")
    .select("neighborhood, lat, lon").not("lat", "is", null).neq("neighborhood", "").limit(3000);
  const rows = (data ?? []).filter(r => r.lat && r.lon) as Row[];

  // Deterministic split so the number is reproducible.
  const train = rows.filter((_, i) => i % 2 === 0);
  const test  = rows.filter((_, i) => i % 2 === 1);

  const fitted = centroidsFrom(train);
  // Fitted centroids for observed neighborhoods; hand-written ones elsewhere.
  const merged = new Map(PLACES.map(p => [p.name, { name: p.name, lat: p.lat, lon: p.lon }]));
  for (const [name, c] of fitted) {
    if (c.n >= 3) merged.set(name, { name, lat: c.lat, lon: c.lon });
  }
  const places = [...merged.values()];

  let hit = 0;
  for (const r of test) if (classify(r.lat, r.lon, places) === r.neighborhood) hit++;
  console.log(`held-out accuracy: ${((hit / test.length) * 100).toFixed(1)}%  (${hit}/${test.length})`);

  console.log("\nfitted centroids (n>=3), paste into geo.ts:");
  for (const [name, c] of [...fitted].sort((a, b) => b[1].n - a[1].n)) {
    if (c.n < 3) continue;
    const borough = PLACES.find(p => p.name === name)?.borough ?? "Manhattan";
    console.log(`  { name: ${JSON.stringify(name)}, borough: ${JSON.stringify(borough)}, lat: ${c.lat.toFixed(4)}, lon: ${c.lon.toFixed(4)} },  // n=${c.n}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
