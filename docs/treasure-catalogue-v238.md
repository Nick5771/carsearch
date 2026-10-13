# Treasure catalogue integration — first batch

The original v238 editorial selection below has been superseded by
`docs/treasure-catalogue-v239.md`. The shared pilot and current supply snapshot now
use the revised v239 targets; this document records the earlier implementation.

The 500-item v3 list is now represented as machine-readable editorial sourcing
targets in `data/treasure-hunt-catalogue-v3.json`. No record has an invented
price, offer URL, image or inventory count. Original FF identifiers are retained.
The other 488 targets have not received a live supply audit in this task.

The first twelve targets were queried against the existing US public search API
on 13 October 2026. Nine returned candidate offers after title/form filters:
FF007, FF009, FF098, FF157, FF188, FF359, FF399, FF405 and FF164. FF005, FF092
and FF464 returned no accepted candidate. This does not establish market-wide
absence. `data/treasure-pilot-supply-audit.json` retains provider observations,
timestamps and links. Provider prices are observations, not checkout guarantees.
Seller authenticity, exact condition/completeness and shipping still need review.

Cold passive requests frequently missed the 1.7-second eBay deadline; the
existing provider requests continue into the shared cache. The audit retries
incomplete checks and distinguishes timeouts from a completed empty search.
The evidence also exposed wrong Garfield phone models, different Panapet colours,
partial Polly Pocket sets and LEGO lighting kits. The shared pilot filter rejects
these obvious mismatches. It cannot authenticate vintage objects from titles.

## Client test mode

After the frontend deploys, open:

`https://findai.ai/findai-app.html?catalogue-test=1&treasure-test=1&country=US`

The nine supported sourcing targets replace cold-start seed queries in this
opt-in mode. Existing live search and catalogue retrieval supply offers; no saved
audit prices/images are inserted into the feed. Target matching runs before
recommendation admission. Other markets and ordinary sessions keep their current
baseline. Account preferences are not cleared. The feed cache signature separates
the pilot from ordinary cached recommendations. `catalogue-test=1` uses the
existing isolated test experiment, rather than a new production measurement arm.

This first batch is not a representative 500-item editorial mix. Several LEGO
targets are intentionally useful for testing exact-model and accessory filtering.
It is not a retention experiment or a claim that the final feed mix is optimal.

## Background inventory ingestion

The Worker reuses the current eBay quota gateway and `catalogueIngest` pipeline.
Warmup defaults to zero calls. To enable it after the Worker has deployed and the
desired target listings have been reviewed, configure `TREASURE_HUNT_ENABLED=true`
and a comma-separated `TREASURE_HUNT_ACTIVE_IDS` allowlist. Only the twelve defined
pilot target IDs are supported. Each 15-minute cron queries at most two targets,
in the background traffic class. Only matched, priced, imaged provider offers
enter the existing US recommendation index. Availability/staleness and semantic
retrieval retain their existing checks. This is not a public arbitrary-ingestion API.

GET `/recommendations/treasure-targets?country=US` reports configured active queries,
not stock. POST `/admin/recommendations/treasure-audit` requires the existing
`X-Admin-Key` and accepts one to four pilot IDs. The admin audit returns candidates
without writing inventory. Do not place credentials in URLs or committed files.

## Reproduce and validate

Run `python scripts/build-treasure-catalogue.py PATH_TO_V3_MD` to regenerate the
manifest. Existing audit results supply the twelve refined pilot queries and
observed status; the remaining entries stay pending. Run
`node scripts/audit-treasure-supply.cjs` for a new dated snapshot using public
provider queries. This consumes the existing search budgets; it is not free.

Target-policy tests cover wrong model/colour, incomplete toys, multi-set lots,
packaging and LEGO lighting kits, sold/stale/foreign-currency offers, disabled
cron, allowlist bounds and admin authorization. Client tests cover actual boot,
US-only opt-in, cache separation and unchanged ordinary sessions. Existing
curated-baseline and catalogue-retrieval regressions also pass.

GitHub's latest main commit reports a Vercel frontend deployment. Worker hosting
uses Cloudflare configuration in this repository; a successful frontend deploy
does not establish that the changed Worker is deployed. Check the live
`/recommendations/treasure-targets` endpoint separately before enabling warmup.
