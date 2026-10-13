# Catalogue retrieval v230

The personalised Home/Explore lanes now retrieve from a shared catalogue of public retail products returned by the existing trusted search providers. Typed Search keeps its live search behaviour. When at least four matching indexed products exist, the lane returns those promptly and refreshes provider inventory in the background. Cold or sparse retrieval merges with the existing live search fallback.

Catalogue records persist in D1, partitioned by market. Product text embeddings use BGE Small, 384 dimensions, CLS pooling. Content changes invalidate embeddings; price-only refreshes retain them. Cached inference can classify unfamiliar product forms. Explicit query form/theme, condition and price/currency constraints apply together. Learned brand, condition, size, scale and observed price range remain soft preferences, supported by distinct positive products; observed prices do not imply affordability. Gift context excludes enduring personal preferences.

Retrieval excludes sold inventory, observations older than six hours and obvious accessory/packaging mismatches. Identified model/set variants consolidate duplicate offers. Unknown products remain offer-specific to avoid merging unrelated goods. Public creator listings are fetched separately and remain in the mixed result feed; private/native content is never placed in the shared retail index or AI enrichment. Account changes and cancellation discard late responses.

## Experiment and testing

The stable 90/10 `shopping-v230` treatment/control experiment compares the catalogue bundle against v229. Both arms retain v229 features. The shadow trainer accepts the new 13-feature schema; existing models require retraining. No learned model is activated.

Open `https://findai.ai/findai-app.html?catalogue-test=1` to force the catalogue treatment for testing. Test assignment, impressions and qualified visits use the separate `shopping-v230-test` policy and `test` arm, excluded from production trial/retention evaluation and v230 training. Real account preferences still update from genuine actions. `?catalogue-test=0` ends the forced session mode.

For a practical check, search and save several distinct LEGO Star Wars, LEGO Technic or diecast products, then return to Home. Look for the right product form/theme and useful variety across different products. A single save is deliberately weaker evidence than repeated interest in distinct products. Compare gift browsing with personal browsing. Developer-console `wishwaveCatalogueStatus()` reports activation, request/hit counts and last retrieval mode; the public catalogue-status endpoint reports market coverage.

## Limits and validation

This is a bounded beta index: SQL scans at most 256 fresh candidates per country/product form, then compares vectors. It is not an ANN index over every merchant's inventory. Coverage grows from genuine existing search/warmup results; the system cannot retrieve products it has never indexed. Inventory observations and provider caches do not guarantee checkout stock or a current seller price. Metadata confidence is model-reported, not independently calibrated accuracy.

AI enrichment has shared atomic daily budget caps and timeout/fallback paths. Catalogue queries may fall back to facets when embeddings or inference are unavailable. Broader inventory ingestion, ANN retrieval, labelled relevance data and real-user retention/conversion experiments remain necessary before claiming Meta-level quality.

Checks exercise semantic retrieval, hard/soft conjunctions, variants and seller-SKU isolation, embedding reuse, inventory/country/staleness filters, creator-content preservation, client fallback, late-account/cancellation protection, test-cohort isolation, shadow feature logging and recommendation regressions. Artificial fixtures demonstrate implementation behaviour; they are not production accuracy evidence.
