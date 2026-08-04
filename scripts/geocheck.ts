import { neighborhoodAt } from "@/lib/geo";
import { createClient } from "@supabase/supabase-js";

async function main() {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  // StreetEasy's areaName is authoritative; test our boxes against it.
  const { data } = await db
    .from("listings")
    .select("address, neighborhood, lat, lon")
    .not("lat", "is", null)
    .neq("neighborhood", "")
    .limit(2000);

  const rows = (data ?? []).filter((r) => r.lat && r.lon);
  let hit = 0, miss = 0, unknown = 0;
  const wrong: Record<string, number> = {};

  for (const r of rows) {
    const got = neighborhoodAt(r.lat as number, r.lon as number);
    if (!got) { unknown++; continue; }
    if (got === r.neighborhood) hit++;
    else { miss++; wrong[`${r.neighborhood} -> ${got}`] = (wrong[`${r.neighborhood} -> ${got}`] ?? 0) + 1; }
  }
  console.log(`checked ${rows.length} listings with coordinates`);
  console.log(`  exact match : ${hit}`);
  console.log(`  mismatch    : ${miss}`);
  console.log(`  no box      : ${unknown}`);
  const acc = rows.length ? ((hit / (hit + miss)) * 100).toFixed(1) : "0";
  console.log(`  accuracy where a box matched: ${acc}%`);
  console.log("\ntop disagreements:");
  for (const [k, v] of Object.entries(wrong).sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`  ${v.toString().padStart(3)}  ${k}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
