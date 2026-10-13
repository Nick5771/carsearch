# Saved-interest feed repair v233

The real 60-card v232 test contained 10 Star Wars LEGO products, 19 laptops,
8 sunglasses-related offers, 8 Harry Potter LEGO, 8 Pokemon and 7 handbags.
Seven visible saved likes were Star Wars LEGO builds. These screenshots establish
bad relevance, but do not reveal the browser's internal event state.

Reproduced defects and changes:
- Focus previously required membership in the event-derived topic profile even
  though saved likes were separately readable. Focus now uses distinct deliberate
  product evidence directly, including current saved products. Neutral daily rows
  cannot overwrite a still-saved like. Rejection/gift/account isolation remains.
- Choose the supported common theme before narrower siblings. Retrieve its core
  query, up to two supported subtopics, other supported interests and at most one
  generic exploration lane. No fixed LEGO/laptop preference is hardcoded.
- Fast unrelated responses previously could paint the opening after a 600ms grace.
  A strong-interest opening now waits for its already-running relevant requests.
- Focused indexed results now merge live provider results. An empty live response
  cannot overwrite catalogue hasMore=true and prematurely finish that lane.
- Strong-interest admission limits unrelated offers to three in a rolling ten,
  with one per unrelated product type/category. If relevant supply is unavailable,
  defer fillers and use the existing retry UI instead of emitting endless junk.
- Classify individually bagged LEGO characters as minifigures in both client and
  Worker. Learned building-set form is required for preferred recommendations.
- v233 invalidates the old Home cache signature.
- wishwaveFeedDiagnostics() exposes the latest 40 in-memory retrieval/admission
  decisions, focus and evidence for diagnosis; no extra remote telemetry or UI.

Validation:
- Saved-interest retrieval test preloads seven likes before app boot, clears the
  event profile, simulates 850ms relevant requests and immediate generic replies,
  and exercises actual Home load/paging through 60 unique cards. Tests catalogue
  hasMore preservation with an empty live response.
- Sustained-feed test starts from saved likes without a new search/like event;
  verifies stale unrelated search, 60 neutral exposures, negative feedback,
  scarcity limits, minifigure form, guest Profile and account isolation.
- Existing catalogue, shopping, responsive-feed and continuous-discovery checks.

Limitations: these are controlled fixtures, not proof of real user satisfaction.
No learned production ranker is activated. Inventory can genuinely exhaust, and
provider/StockX image delivery is not changed. The screenshots do not prove which
of the reproduced defects dominated that specific browser session.
