# Discovery trial v240

The US opt-in trial (`catalogue-test=1&treasure-test=1&country=US`) now uses the full queue of 31 provider-observed product targets across 14 categories, rather than choosing one target per category. This includes LEGO UCS Venator and Rivendell; novelty clocks/radios remain excluded. Unobserved McLaren P1 and MiniDisc targets remain staged, disabled.

Unknown previews, saved offers that do not satisfy a supported target, mismatched query hints, non-USD offers and wrong product forms cannot pass admission. The same policy applies to render, append, background sequencing and cached-feed admission. A target cannot repeat within the previous 20 products, including different sellers/sizes. Category density remains at most two per ten.

Trial discovery keeps its complete target queue even after passive dwell; explicit search and the normal personalised feed retain their existing behaviour. Provider concurrency is bounded at four; each lane verifies browser image decoding and tries seller alternatives before committing a card. Empty curated supply does not fall back to the broad legacy preview pool.

All standard non-tracker search requests now forward the selected shopping country, including their owned-listing fallback. This fixes the omitted-country path; prices are not relabelled or converted.

Provider candidates are dated observations, not seller authentication or checkout-stock guarantees. The trial remains opt-in. Cloudflare Worker source changes from earlier revisions still require deployment; v240 frontend enforcement does not depend on those new Worker routes.

Validation includes the existing baseline/catalogue checks, strict target tests and a client pipeline test using recorded provider observations, contaminated append inputs, failed image decoding and more than 40 rendered cards. Live deployment is checked separately.
