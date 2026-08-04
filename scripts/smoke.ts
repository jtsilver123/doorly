/**
 * Hits every configured source once and prints what came back.
 * Run with: npm run smoke
 */
import { runSearch } from "@/lib/sources";
import { DEFAULT_CRITERIA } from "@/lib/criteria";
import type { SearchCriteria } from "@/types";

const criteria: SearchCriteria = { ...DEFAULT_CRITERIA };

async function main() {
  const { listings, reports } = await runSearch(criteria);

  console.log("\n--- source reports ---");
  for (const r of reports) {
    const status = r.ok ? "ok " : "FAIL";
    console.log(
      `  ${status} ${r.source.padEnd(12)} fetched=${String(r.fetched).padStart(4)} ` +
        `in-bounds=${String(r.kept).padStart(4)} ${r.message}`
    );
  }

  console.log(`\n--- ${listings.length} listings after filtering ---`);
  for (const l of listings.slice(0, 8)) {
    const sqft = l.sqft ? `${l.sqft}sqft` : "—";
    console.log(
      `  [${l.source}] $${l.price} ${l.bedrooms}BR/${l.bathrooms}BA ${sqft} | ` +
        `${l.address}${l.unit ? ` #${l.unit}` : ""} | ${l.neighborhood || "?"} (${l.borough || "?"})`
    );
  }

  const withAddress = listings.filter((l) => /\d/.test(l.address)).length;
  const withImage = listings.filter((l) => l.imageUrl).length;
  const withUnit = listings.filter((l) => l.unit).length;
  console.log(
    `\ncoverage: ${withAddress}/${listings.length} have a street number, ` +
      `${withUnit} have a unit, ${withImage} have a photo`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
