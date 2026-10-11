# Shared eBay inventory and quota operations

WishWave's eBay Browse requests now pass through `ebayBrowseFetch`. This includes keyword search, photo search, suggestions, listing checks, demand enrichment and Trust Score. OAuth has its own eBay allowance and is still cached separately.

The Worker defaults to 5,000 approved calls per UTC calendar day. Change `EBAY_DAILY_CALL_LIMIT` in the Cloudflare Worker **api → Settings → Variables and Secrets** only after eBay approves the corresponding allowance. For a million approved calls, set it to `1000000`. No code change or new binding is needed; the existing CACHE and DB bindings are used. The configured allowance is not an eBay approval or a reading of eBay's actual remaining quota.

## Default controls

| Setting | Default | Purpose |
| --- | --- | --- |
| `EBAY_DAILY_CALL_LIMIT` | `5000` | Application-controlled Browse ceiling; `0` stops new Browse calls but permits valid cached results. |
| `EBAY_BUDGET_HEADROOM_PERCENT` | `10` | Leave 10% below the approved ceiling; default usable total is 4,500 reservations. |
| `EBAY_BACKGROUND_PERCENT` | `15` | Background and passive discovery may use at most 15% of usable total: 675/day at launch. |
| `EBAY_ENRICHMENT_PERCENT` | `5` | Optional demand/suggestion enrichment may use at most 225/day at launch. |
| `EBAY_BUDGET_BURST_PERCENT` | `25` | Release 25% immediately and the remainder progressively through the UTC day. `100` disables pacing. |
| `EBAY_RESERVATION_BLOCK_SIZE` | `1`, or `16` for allowances ≥100,000 | Conservatively reserve groups of calls to reduce budget writes at larger allowances; permitted range 1–64. |
| `EBAY_SEARCH_FRESH_SECONDS` | `14400` | Reuse public search responses; configurable between 300 and 18,000 seconds. |

Foreground work may consume unused capacity from the other lanes. Background and enrichment cannot consume their way through the full daily allowance. All lanes share the same total ceiling; their quotas are not extra allowances. Scheduled jobs and passive searches are explicitly tagged as background. Optional enrichment is tagged separately. Existing real-time verification remains foreground work.

The pacing ceiling is `usable × (burst fraction + remaining fraction × UTC day progress)`. With the launch defaults it releases 1,125 reservations at midnight, 2,812 by noon and up to 4,500 over the day. Exhaustion temporarily defers uncached eBay requests. Other shopping adapters and native WishWave inventory continue independently; cached eBay results can still be used while valid.

## Shared reads and refreshes

- Browse searches request up to 200 listing summaries in a source window. That window is reused across shoppers and pagination; a swipe is not inherently an eBay call.
- Keys separate URL, query/filter/sort/source offset, marketplace, affiliate context and image request body. Only hashes are stored as gateway keys; credentials and raw uploaded photos are excluded from keys and leases.
- A bounded 8 MiB isolate cache and shared KV hold public responses. OAuth token rotation does not invalidate listing caches.
- SQLite conditional UPSERTs reserve calls atomically across regions. Failures and timeouts still count. Unused blocks are never refunded, so worker eviction cannot cause overspending.
- Per-query D1 leases coordinate refreshes across isolates. Local in-flight work is coalesced. A competing cold request briefly waits for the shared result rather than making another eBay call.
- Complete public shopping windows are cached for up to 90 seconds, then sliced into pages. Failed/partial batches are kept locally for only five seconds, so a slow StockX response does not freeze an incomplete batch for a long period. The cache contains no per-user ranking, account, likes or private listing data.
- A provider 429 triggers a shared cooldown using Retry-After when supplied. Cooldown also survives the UTC day boundary. Already-issued call blocks and in-flight requests can still complete; they are included in reserved totals.
- New Browse calls fail closed if budget coordination is unavailable. Valid snapshots may still be served.

The direct Browse cache preserves the original fetch time. Its fallback expires after 5 hours 55 minutes, leaving five minutes for downstream caching. It does not renew old listings for another six hours. Empty responses are cached briefly. Public response cache TTLs are capped by the remaining freshness of timestamped eBay listings; expired timestamped listings are filtered. Old legacy indexed offers without a fetch timestamp are not retroactively certified by this change.

[eBay's API License Agreement](https://developer.ebay.com/join/api-license-agreement) requires displayed item listing information to be no more than six hours older than the eBay site. A larger long-lived stale product pool is not a substitute for refresh capacity.

## Monitoring

`GET /admin/ebay/quota` with the existing `X-Admin-Key` header returns configured allowance, usable allowance, conservative reservations, lane usage, current paced capacity, remaining daily capacity and provider cooldown. It is admin protected and never exposes credentials. Use headers, not a key in a URL.

Reservations do not include other applications using the same eBay key or calls made before this deployment. The headroom is a buffer, not proof of eBay's actual remaining allowance. Compare this meter with eBay Developer Analytics before launch; align the configured window with the actual granted allowance/reset window. The existing provider 429 handling remains a backstop.

## Capacity and launch

Upstream demand is approximately:

`shared query windows × refreshes/day + uncached unique searches + image/detail checks + background work`

Count every actual request, including alternate-query and marketplace requests. Listing summaries can overlap or fail product-quality filters; 200 returned summaries are not 200 unique useful products.

This makes demand depend on the active inventory/query set and cache miss rate, rather than directly on product views. At launch, monitor common-query reuse, missed searches, lane utilization and deferred requests. Focus warming on markets and categories with actual users; increase optional background allocation only with evidence of spare capacity.

A million-call allowance can be configured without redesigning this gateway. Supporting 10–20 million users is still a separate capacity goal. Registered users, daily active users, views per session and unique searches produce very different loads. For example, 10 million daily users viewing 50 products create 500 million views/day (~5,800/second on average before peaks); this is not 500 million eBay calls when the inventory is shared. It still requires paid infrastructure, measured cache hit rates, peak load testing, broader database scaling and provider access. No test in this change establishes 10–20 million-user throughput.

## Validation

Run `node tests/ebay-quota-gateway-check.cjs` and `node tests/search-pagination-check.cjs`. The quota test uses real SQLite and separate VM contexts to check races across isolates, daily reset, pacing, protected foreground capacity, million-call blocks, cross-isolate refresh coordination, region/window isolation, original freshness, budget exhaustion, missing storage, 429 cooldown, shared compiled pages and the admin gate. Existing StockX, source filtering and feed regression tests should also pass.
