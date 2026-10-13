# Search and Home stability v241

Typed product searches no longer use the discovery feed's three-offer family cap or personal ranking. Listing-key deduplication remains; provider order is preserved. A short initial page starts the next available page when pagination is advertised, and empty searches replace unrelated old tiles. Quiet refreshes append new offers instead of replacing existing tiles.

Search request ownership is invalidated on input changes and tab departure. Direct search results reject stale completions even when a transport ignores abort. Browse lane requests are cancellable and discard stale responses before classification/ranking. Browse initialization only shares a promise belonging to the current generation/filter/taste; an older promise cannot clear the newer one. Sparse browse grids make up to three additional fill attempts. Preview caches are market-partitioned.

Returning Home retains a healthy personalised feed controller and state rather than unnecessarily aborting and cloning a live batch. The responsive updater preserves the active and next reel, suppresses the older parallel reranking routine on that arm, and takes a stable snapshot of prepared recommendations. View tracking may synchronously invalidate that snapshot: in that case it resumes tracking and waits for freshly prepared recommendations instead of reading a null pool or applying stale data.

Caption measurements do not rewrite an identical height, and Search reel/comment class observers do not rewrite their own observed class when its value already matches.

Validation: same-family search retention (36 offers), short-page/cursor recovery with deduplication, empty-state replacement, abandoned and superseded response rejection, synchronous tracking invalidation during Home refresh, active-node preservation, Search listing gestures, image fallback stability, legacy search-interest insertion and the opt-in treasure client. Live navigation is checked after Vercel deployment. No Worker deployment is required for these frontend changes.
