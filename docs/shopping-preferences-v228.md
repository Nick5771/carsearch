# Shopping preferences and measurement v228

This release builds on v227. The live policy remains explainable heuristics;
there is no newly activated trained ranker, image model or purchase prediction.

## Product matching and preferences

- Canonical form aliases (trainers/sneakers, mobile phones, construction kits),
  additional laptop/building-set forms and brand-specific retrieval topics.
- Structured brand/theme/type metadata can admit a matching product even when
  its short title lacks the search words. Specific topics must match; LEGO
  minifigures do not satisfy a Technic car lane. This is taxonomy/facet matching,
  not general embedding-based semantic understanding.
- The daily family journal now retains minimal product attributes. Preference
  estimates use distinct families, decay and a minimum of three positive
  products. Price distributions are per product type and currency. No FX is
  invented. Unknown condition, size or currency remains unknown; title numbers
  are never guessed as shoe sizes.
- Log-price proximity, condition, brand, explicit size, colour, scale and model
  contribute a bounded [-10,14] preference adjustment. They are soft affinities,
  not declared budgets or calibrated buying probabilities.
- Treatment filters explicit sold/unavailable flags and admits one offer per
  family in each retrieval batch. Existing cross-batch repetition/variety rules
  remain. Availability without a flag cannot be verified by this change.
- Treatment searches/scans have a session query lane (20-minute half-life,
  40-minute expiry), instead of writing through older durable taste wrappers.
  Legacy search-only lanes are excluded from treatment's durable candidates.
- Established topic profiles retain one exploration lane; profiles without
  sufficient specific evidence use the existing broader allocation. A lane
  fraction is not a guaranteed card percentage because supply varies.

## Account sync

Authenticated `GET/POST/DELETE /recommendations/shopping-profile` uses verified
session identity, hashed before storage. Clients send minimal classified product
metadata and actions, not an authoritative profile snapshot. D1 stores latest
family/day/action records idempotently; the Worker reconstructs a union using the
same pure interest engine as the frontend. Data is retained for 45 days, with a
bounded replay of 1200 action rows and the existing 160-topic/300-journal limits.

Pending actions are account-archived, survive reloads, and retry on failures.
Late responses are checked against session and account epoch. Actions recorded
while a sync is in flight are replayed over its result. Ordinary sync preserves
the card currently under the finger and rebalances later retrieval lanes.

Historical journal rows with product metadata, or matching saved products, can
be imported. Old topic-only evidence has no reconstructable product metadata:
it is retained locally until new product evidence is available, rather than
fabricating a server history. Other old attribute/rejection maps are still local;
this endpoint synchronises the hierarchical interest/preference evidence.

## Controlled ranking trial

`GET /recommendations/experiment` assigns a stable 10% control / 90% treatment
using verified-account identity or a persistent pseudonymous guest identifier.
Assignment is server-derived and trials cannot override their arm. Failed
assignment uses the baseline policy and records no labelled trial exposure.

Control uses v227-style weighting and broad allocation. Both arms share upgraded
classification and account sync. Treatment adds v228 preference scoring,
session-only retrieval, metadata admission, availability filtering, per-batch
family consolidation and the revised exploration allocation. The trial therefore
tests the policy bundle, not each infrastructure improvement independently.

`POST /recommendations/trials` retains event IDs, exposure IDs, feed position,
surface, arm, bounded dwell, policy and impression-time features. Outcomes must
refer to an actual recorded exposure; unrelated actions never invent an
impression. No client purchases are accepted. Idempotent telemetry batches retry
on non-2xx and missing acknowledgements; bounded account-isolated outboxes persist
across reloads. `wishwaveRecommendationDelivery()` exposes evidence upload
acknowledgements, failures and pending events for diagnostics.

`scripts/evaluate-shopping-trials.py` accepts a local SQLite export. It evaluates
matured (24-hour) Home exposures and matching subsequent saves, product visits and
rejections, with viewer-cluster bootstrap intervals. It does not claim a small
sample is conclusive, activate a model, infer purchases or automate rollout.
Inspect position/cohort balance, supply and event delivery before drawing a
conclusion. Server-side verified purchase/refund callbacks and retention
measurement remain future work.

## Validation and limits

Pure preference/classification checks, SQLite multi-device/profile/trial checks,
full-app JSDOM account/in-flight/retry checks, trial evaluator checks and existing
recommendation/motion/share regressions cover the change. Production deployment
and event ingestion are distinct checks; a successful Worker build alone does
not prove D1 accepts real user events.

The new model features are available for later outcome training. The existing
v226 trainer stays shadow-only. No real usage dataset was available in this
workspace, so no trained model was fitted or promoted and no performance score
increase is claimed. Image embeddings, collaborative retrieval, actual purchase
attribution and measured business retention require further work.
