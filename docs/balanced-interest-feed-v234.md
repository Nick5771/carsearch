# Balanced-interest and product-diversity repair v234

The v233 screenshot review contains 43 cards: 22 LEGO Star Wars builds, one
lighting kit, one non-LEGO action-figure listing, six Pokemon, seven shoes,
five handbags and one costume accessory. 21 of 22 LEGO builds were AT-ST
products or sets containing one. This is a concentration failure, not success
because the broad theme matches.

Changes:
- One canonical LEGO set number per Home session, across sellers, conditions,
  wording and prices. Saved set numbers are excluded from repeated offers.
  Extract five-digit numbers first, then four-digit set numbers excluding years.
  Non-LEGO products use existing product-family identity.
- Maximum three items sharing a depth-three subject in a rolling ten-card window,
  enforced across batches. Defers more rather than forcing irrelevant fillers.
- At most one narrowly supported subtopic retrieval lane. A broad supported LEGO
  theme with walker/Hoth evidence also retrieves spacecraft and collector builds.
  Less-advanced relevant lanes take turns during paging/refill.
- A bounded interest plan combines current saved products and distinct journal
  products (clicks, shares, compares, photo inspection, qualified viewing, comments,
  reading comments, revisits and explicit relevance). Correlated topics supported
  by the same products do not occupy several root-interest slots.
- Positive strength per distinct product is capped at 1.4. Strongest action plus
  small corroboration; 14-day implicit half-life. Saved state remains explicit.
  Negative evidence reduces scores. No fabricated events or purchase claims.
- Searches are separate temporary retrieval interests: last two within 30 minutes,
  10-minute half-life. A fresh search remains a lane alongside older saved taste
  and gets warm-up priority. Search does not write durable product evidence.
- Multiple established interests reserve space; unrelated fallback remains capped.
- Lighting kits / Light My Bricks / LMB wording and glasses cases are accessories.
  Plural laptop/phone/camera/watch query forms now classify consistently.
- Comments reading is a separate weak event (0.2), emitted after four seconds
  only for the same product in a visible, populated comments sheet. Close, hidden
  page and account change prevent stale events. Client/Worker event and sync
  validation agree; no new buttons or remote debug collection.
- Cache signature v234; diagnostics remain a bounded in-memory trace.

Validation:
- New balanced-interest test: 60 cards from walker-heavy inventory, rolling subject
  cap, canonical model uniqueness, accessory exclusion, new search plus saved taste,
  implicit clicks/gallery and viewing retrieval, qualified comments reading,
  account isolation.
- Saved-interest retrieval test: actual Home opening/paging to 60 unique products
  with delayed relevant requests and empty live-provider results.
- Sustained and responsive fixtures now contain varied builds, since 60 spacecraft
  alone violate the same subject-diversity requirement as 60 walkers.
- Continuous-discovery fixture waits for progressive card rendering to finish
  before installing synthetic scroll geometry; fixed arbitrary timing caused
  intermittent paging assertion failures. No native Search reel implementation
  was changed for that fixture adjustment.

These remain rule-based, controlled tests. Real satisfaction, inventory coverage
and interest balance must be measured. No active learned ranker or StockX image
fix. Subject taxonomy and title-based model extraction remain incomplete.
