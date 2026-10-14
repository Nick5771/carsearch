# Phone account fit and discovery buffers

Remove the old auth card's flexible social-method spacer, top/bottom method
padding and reserved empty error row. Keep fields and actions at touch-friendly
sizes and use tighter branding/footer spacing, with additional compaction for
short viewports. Account forms may still scroll with an open keyboard or large
accessibility text; normal phone login shows Create account without scrolling.

Curated Home image checks previously tried up to eight seller images sequentially,
each with a 4.5-second timeout. Check four alternatives concurrently and admit the
first successfully decoded image. Keep the four-request provider cap, reject
failed images and preserve the distinct-target/category admission rules. Opening
readiness now counts admitted cards, and a bounded 3.5-second curated opening
grace helps assemble a usable buffer. Replenish short cached feeds immediately
and start ordinary next-page requests with twelve cards remaining.

Curated Search opens twelve supported target requests rather than four, then
loads eight per subsequent batch. Automatic topups aim for twenty-four cards and
also replenish when fewer than roughly 2.4 viewports remain. Topups have a bounded
attempt cap and stop after three empty batches. Typed searches retain their
existing relevance/order. Visible products remain in place as later results append.

Validation: actual delayed-image test proves a working alternative is admitted
within 500ms while the first image stalls. Treasure scroll validates 90+ cards,
20 distinct opening targets, repeat spacing, USD and bounded provider concurrency.
Existing starter buffer, auth client, fresh opening and search stability checks
cover opening/paging, retained visible nodes and category spacing. Actual phone
latency depends on live supply and network; these changes cannot invent inventory.
