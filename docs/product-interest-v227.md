# Product interest detection

The feed connects qualified interactions to hierarchical product attributes. This is evidence-based inference using metadata and conservative title rules; it is not an image model, a trained semantic classifier or a purchase-probability model.

## Behaviour

- LEGO is labelled by brand, product form, theme and subject. Technic vehicles, Star Wars spacecraft, Harry Potter castles and minifigures can build separate preferences.
- Die-cast vehicles retain represented make and explicit scale. Hot Wheels, Matchbox, RC/playset vehicles, full-size vehicles and packaging are separated. Unknown forms remain unknown.
- Search changes short-lived session intent. It does not add lasting positive topic evidence. Likes/saves, useful clicks, comparison, inspection, revisits and foreground attention are linked to the actual product.
- Qualified exposures supply an opportunity denominator. Passive attention is weak; repeated deliberate responses across distinct product families increase confidence. Multiple offers or callbacks for the same product do not inflate that confidence. Per-family daily evidence takes the strongest positive signal instead of summing correlated actions.
- Skips reduce affinity, but subsequent strong engagement can supersede the weak skip. Unlike withdraws saved/liked evidence. Rejection and Undo affect topic evidence as well as existing suppression controls.
- Topic scoring includes decay and a prior. Score and confidence are separate and are not claimed to be calibrated purchase probabilities. A single pause does not establish a retrievable lasting topic. Two or more distinct positively engaged products and adequate confidence are required for new topic retrieval lanes.
- Specific matches have greater ranking influence than general parent topics; correlated ancestors are not summed. Broad LEGO interest cannot flatten Technic-versus-Star-Wars differences.
- Learned topic queries supply Home and Search browse retrieval. Product attributes are checked on returned candidates, avoiding errors caused by titles lacking generic query words like "cars". Typed Search preserves its existing relevance behaviour.
- Sequencing recognises LEGO themes and explicit die-cast scale as distinct interest groups while retaining model repetition controls. Existing account isolation includes topic and session state. Personalisation opt-out disables learning and reporting.
- Historical saves seed capped evidence once per product family per account; reads/reloads do not repeatedly fabricate new engagement.
- `/recommendations/interest-events` retains event-level evidence for 30 days, with hashed account/guest identity, idempotent event IDs, topic labels, surface and qualified foreground attention. Client purchases are rejected. Historical save seeding is not emitted as new live events.

## Verification and limits

Tests cover class/theme/form separation, metadata, accessories, unknown products, one-pause and one-product safeguards, duplicate signals, negative refinement, ranking, real Search-save attribution, retrieval matching, account isolation, privacy, and the SQLite event ledger. No new UI button is added.

Topics are currently recognised through structured fields and title patterns. Ambiguous image-only listings, multilingual synonyms, exhaustive taxonomy and cross-device topic-profile synchronisation remain further work. Server event history is collected, but live topic estimates are account-isolated on the device. Production satisfaction improvement requires measurement; passing fixtures does not establish Instagram-level performance.
