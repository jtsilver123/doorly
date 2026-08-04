/**
 * One polling pass: scrape every active saved search, diff, store.
 * Run with: npm run poll
 */
import { ingest } from "@/lib/ingest";
import { ensureDefaultSearch } from "@/lib/feed";

async function main() {
  const searches = await ensureDefaultSearch();
  console.log(`polling ${searches.length} search(es)…`);
  for (const s of searches) console.log(`  · ${s.label}  [${s.searchKey}]`);

  const started = Date.now();
  const result = await ingest(searches);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`\ndone in ${seconds}s`);
  for (const r of result.reports) {
    console.log(
      `  ${r.ok ? "ok  " : "FAIL"} ${r.source.padEnd(12)} ` +
        `fetched=${String(r.fetched).padStart(4)} kept=${String(r.kept).padStart(4)} ${r.message}`
    );
  }
  console.log(
    `\n  ${result.fetched} listings · ${result.newListings} new · ${result.events} events`
  );
  if (result.errors.length) {
    console.log("\nerrors:");
    for (const e of result.errors) console.log(`  ! ${e}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
