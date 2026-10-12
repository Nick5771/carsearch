# WishWave recommendation audit — 12 October 2026

## Assessment

WishWave is a rule-based, personalised recommender with useful interaction signals and a working shared engagement service. It is not yet an Instagram-level ranking system. Signals, ranking weights and diversity constraints are largely hand-written; there is no demonstrated learned prediction model, controlled ranking experiment or production outcome benchmark in the audited paths.

This audit covers Home For You, Search discovery, typed Search, contextual Reels, local/shared learning, caches, candidate retrieval and pagination. Following is checked for isolation, rather than treated as a discovery algorithm. Findings come from source review, regression tests, synthetic inventory and one live read-only shared-score request. The user's exact personalised session and aggregate production performance were not available. Synthetic results do not establish real-world recommendation quality.

## Pipeline inspected

| Stage | Current implementation | Assessment |
|---|---|---|
| Candidate retrieval | Personal interest lanes, fixed discovery seeds, saved interests, followed inventory, recent-search candidates, marketplace preview cache | Broad coverage, but quality depends on source inventory and query matching. |
| Local learning | Searches, likes/unlikes, qualified dwell/skip, revisits, gallery inspection, compare, outbound clicks, shares, comments, seller follows | Useful signals; hand-tuned boosts and decay, rather than learned predictions. |
| Long-term interests | Stored clusters, capped weights, approximately 45-day half-life | Strong interests persist; weak negative feedback may take time to overcome accumulated positives. |
| Session interests | Faster decay and stronger recent signals | Responsive, but can override broad lane allocation. |
| Ranking | Query relevance, seen penalty, seeded jitter, saved-topic similarity, source/category/price/seller preferences, shared engagement | Several overlapping scores; needs measured calibration. |
| Diversity | Category/family spacing, family caps, discovery lanes | Works with adequate alternatives. Thin pools still relax the constraints. |
| Delivery | Fast first useful lane, short grace for another category, quiet completion, preserved current/next cards | Fast loading; now protected against several race conditions. |
| Repeat exposure | Local item-key counts with recency penalty | Now records qualified Reels and Search browse exposure. No full persistent model/brand exposure history. |
| Shared learning | Batched listing score lookup, daily hashed-viewer deduplication, confidence-weighted aggregate engagement | Live endpoint responded with version 208. No inference about traffic volume or lift follows from that check. |
| Typed Search | Server relevance/source/price ordering, cursor pagination | Deliberate search stays separate from recommendation diversity rules. |
| Caching | Home cache up to 60 items; fresh threshold 10 minutes, stale allowance 24 hours; browse snapshots | Fast, but cached marketplace availability still needs stronger revalidation. |
| Pagination | Lane pages/cursors, query variants, fresh discovery seeds, duplicate-batch recovery | Exhausted-lane selection and concurrent lane requests were corrected. |

## Confirmed defects corrected in this audit

| Finding | Previous behaviour | Change and verification |
|---|---|---|
| Premature Reels impressions | Starting tracking could penalise an item before a qualified view | Impression follows at least 500 ms of qualified foreground attention. Test verifies zero before qualification and one after it. |
| Wrong photo used for attention qualification | Visibility qualification inspected photo zero even after a swipe | Checks the selected gallery image. Alternate decoded-photo test passes. |
| Search browse exposure missing | Previously shown browse tiles did not enter the repeat-exposure penalty | At least 65% visibility for 750 ms, a decoded image, foreground Search and no blocking overlay are required. Quick passes do not count. This adds local exposure, not an artificial positive dwell signal. |
| Fetched versus delivered conflated | Candidates discarded before rendering could already enter session dedup | Only admitted feed items enter delivered-key tracking; qualified views remain separate. |
| Cross-lane duplicates | A shared item could enter multiple recommendation lanes | Sequence deduplicates candidates and existing feed keys without mutating the input. |
| Exhausted lanes occupied pagination slots | `hasMore` could keep a duplicate-exhausted final variant eligible | Eligibility accounts for duplicate exhaustion and available variants. |
| Concurrent requests for one lane | Early background completion and near-end loading could overlap | Requests for the same lane share an in-flight promise. Test confirms one fetch. |
| Stale lane responses | An old response could prepare candidates against a replacement feed state | Response checks its originating state before mutating pagination or candidate state. |
| Accessory contamination | Featured lanes could present empty watch boxes, remotes, pads or cases as primary products | Conservative recommendation-only intent guard; explicit accessory queries remain allowed. Not a complete semantic classifier. |
| Inactive native listings | Cached sold/reserved WishWave listings could remain recommendation candidates | Non-active native listings are rejected from recommendations. |
| Apparel categorisation | Nike/adidas apparel could be categorised as sneakers because of brand | Explicit apparel nouns take precedence, with collectible exceptions. |
| Early completion changed next Reel | Quiet results could reorder the immediately upcoming card | Cold-start completion protects current and next items and their DOM nodes. Test verifies exact next-node preservation. |
| Reranking during overlays/motion | Adaptive tail ranking did not consistently pause during page motion or zoom | Defers while motion, zoom or attention-blocking overlays are active. |
| Opt-out emptied interest lanes | Learning stopped, but the scorer returned no discovery lanes | Opt-out supplies non-personal discovery seeds while learning remains disabled. |
| Currency mixing | Equal nominal prices in USD/AUD trained one price bucket | Buckets are now separated by currency. This avoids mixing units; it is not FX-normalised affordability. |

The preceding New Balance fix is also retained: colourways share a browse family; a cap applies across the combined browse batch instead of separately per lane, and old browse-cache signatures are invalidated.

## Validation

- New audit suite: quality/intent separation; native listing status; apparel taxonomy; candidate/delivery/view separation; key deduplication; exhausted variants; concurrent fetches; stale-state isolation; selected-photo attention; privacy; price currency separation; Search exposure; current/next card preservation.
- Synthetic inventory: 96 unique candidates across 12 product categories. First 48 recommendations contained 48 unique listing IDs and zero adjacent category repeats.
- Deliberately thin inventory: 20 Ferrari candidates and no alternative category still produce a 20-car sequence. This is a reproduced, unresolved limitation.
- Existing suites passed: recommendation variety, continuous discovery, selected design/Following isolation, shared client ranking, shared Worker ranking with real SQLite, Search cursor pagination, marketplace/source/avatar checks and inline-script compilation.
- Worker cursor test traversed 318 unique offers and retained source-window boundaries.
- Live `POST /recommendations/scores` with an empty key list returned `{"version":208,"scores":{}}`. No engagement events were submitted by this check. Worker source was reviewed and tested, but this audit does not deploy Worker changes.

## Remaining work, in priority order

| Priority | Gap | What should change | Completion evidence |
|---|---|---|---|
| P1 | Thin candidate pools can produce long category runs | Keep a candidate backlog; replenish missing categories before showing a long exhausted tail. Do not silently recreate page-one results. | Sparse/failed/uneven-source simulations preserve feed continuity and a bounded run length. |
| P1 | Product family identity remains title-based | Consolidate the multiple family classifiers. Use marketplace model/SKU/category data, normalised brands and variants; retain distinct offers for explicit Search. | Held-out fixtures across brands, title reordering, colour/size variants and accessories. |
| P1 | Device-local learning is not fully account-scoped | Archive and restore interests, session learning, exposure and behavior per account; define guest-to-account migration. Existing logout clears account and saved-item state but leaves several recommendation keys. | Two accounts on one browser cannot inherit each other's learning or cached feed. |
| P1 | No reliable purchase outcome loop found | Wire confirmed native order events and supported affiliate conversion callbacks. An outbound click must not be treated as a purchase. The local `buy` weight exists, but no confirmed purchase ingestion was found in the audited recommendation path. | Idempotent order/refund outcomes and attribution tests, with actual ingestion monitoring. |
| P1 | No production benchmark or experiment framework found | Version ranking policies and log assignment, qualified impressions, saves, useful clicks, conversions and category satisfaction. Compare to a baseline before claiming quality gains. | Controlled test with exposure denominators, confidence intervals and retention/outcome measures. |
| P2 | Negative feedback is mainly unlike/skip | Add deliberate product/category suppression such as Not interested, distinguish temporary fast scrolling from dislike, and support recovery. | Repeated skips and explicit rejection reduce the unwanted topic without erasing other interests. |
| P2 | Per-batch caps are not global quotas | Apply rolling category/family/seller/source exposure constraints across page boundaries, with relevance-aware relaxation. | 100+ item sessions and repeated pagination do not reset repetition budgets. |
| P2 | Stale caches can outlive availability | Revalidate native status and market availability/price when appropriate; preserve position while removing unusable inventory. | Sold/expired/price-changed cache fixtures, both offline and after refresh. |
| P2 | Saved/owned injection bypasses parts of ranking | Treat reminders and newly published own listings as explicit policies with frequency and spacing limits. | They cannot repeatedly dominate the opening screen or undo diversity. |
| P2 | Session taste can narrow lane selection | Use one shared allocation policy for persistent taste, session taste and recent-search intent; measure the personal/discovery ratio. | Multiple strong same-category interests still retain several other categories. |
| P2 | Shared score uses sparse listing-level aggregates | Preserve confidence priors, add model/category transfer and validate abuse/household effects. Current guest deduplication by network can undercount separate shoppers. | Cohort coverage and score stability measured on actual traffic. |
| P2 | Price preferences are separated, not converted | Use a consistent reporting currency when reliable FX is available, while retaining source currency. | Cross-currency affordability fixtures rank consistently. |
| P2 | No verified exposure ledger for every surface | Instrument all relevant surfaces with qualified, surface-specific exposure and consistent attribution. | Search, Reels, saved, notifications and shared-item entry paths have documented semantics and deduplication. |

## Recommended next implementation

Prioritise the candidate backlog and rolling exposure budget together, followed by account isolation and one canonical product identity layer. Then establish the measurement loop and confirmed conversion feedback. These steps address the recurring product problem; continuing to add brand-specific exceptions will not provide consistent quality.

Do not interpret the passing synthetic matrix as an Instagram-equivalence result. The current system is suitable for controlled beta evaluation after these fixes, with the above gaps tracked. Large-scale launch readiness and ranking quality require real traffic, inventory coverage and outcome evidence.
