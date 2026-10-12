# Shopping recommendation upgrade

Home and Search browse now share a model-aware product identity policy. Explicit Search continues to show relevant offers without recommendation suppression or variety quotas.

## Implemented

- Structured brand/model/MPN/style/GTIN attributes take precedence over title fallback. Colours and sizes are variants of a model; unrelated models from one brand remain distinct. Seller SKU is not a universal identity. Unknown products keep a conservative title identity; there is no claim of complete semantic or visual understanding.
- Product attribute affinities learn independently for models, brands, explicit sizes, colours, condition and selected descriptive traits, with decay. Existing currency-specific price preferences remain in place. Searches retain fast session intent; persistent taste and discovery use one final lane allocation, allowing at most two lanes per category.
- Local recommendation taste, session signals, exposure history, price/source preferences, searches and caches are archived per account. Guests stay separate. Account changes clear memory caches and abort stale feed work. Late taste, saved-item, remote-profile and followed-inventory responses are guarded. Existing server taste sync remains; the new attribute and rejection maps are device-local per account, not yet synced across devices.
- Hold a Home product or use its options button for Not interested: this product, similar products, brand or category. Rejections expire and have Undo. The current card stays stable, rejected future cards are removed, and explicit typed Search remains unaffected. Controls are also available from native listing options.
- Rolling sequencing considers the previous 24 qualified exposures and existing feed, with model, category and brand penalties across page boundaries. A bounded candidate backlog prevents more than three consecutive same-category Home cards when inventory is thin. Missing categories are requested before admitting the reserve. Empty/failing sources retain a retry action rather than silently recycling page one. These are practical diversity constraints, not a guarantee of relevant inventory.
- `/recommendations/measure` stores daily deduplicated qualified impressions and useful actions per listing, hashed viewer, surface and policy. First-exposure ranking features are retained for training. Opt-out disables reporting. Client `purchase` events are rejected. Raw account identities are not stored; authenticated viewer identity is verified. Guest network deduplication can undercount households.
- `scripts/train-recommendation-ranker.py` consumes a SQLite export of the measurement table and fits a small logistic ranker to matured qualified Home impressions. It requires 500 examples and outcome coverage, evaluates chronologically against the current score, and writes a **shadow-only** model. It does not activate a model or claim conversion lift. Output is an engineering artifact; use a controlled real-user experiment before activation.

## Validation

New checks cover structured/model identity, variants, reordered titles, sparse inventory and page boundaries, preference decay, suppression and Undo, two-account isolation/restoration, stale taste responses, opt-out, SQLite event deduplication and first-exposure features, and offline training safeguards. Existing recommendation, shared-score, continuous-discovery, Search pagination, motion, sharing and design suites are also run.

## Remaining data and integrations

No trained model is active: production observations are needed. Confirmed native order/refund attribution and supported affiliate conversion callbacks remain unconnected. An outbound click is never a purchase. A production A/B assignment and outcome dashboard must accompany model activation; offline AUC alone is insufficient. Product attribute coverage depends on marketplace metadata, and the fallback is lexical. Cross-device sync of attribute preferences/rejection controls and a deliberate guest-history import control remain future work.
