# Recommendation intelligence v229

## Delivered behaviour

The v229 treatment adds cached text embeddings, constrained metadata inference,
one image-assisted fallback for an unfamiliar public catalogue product per
batch, aggregate topic discovery, temporary shopping purpose and optional
relevance feedback. A 90% treatment / 10% control trial compares this bundle
against the v228 preference policy. Existing v228 preference scoring and session
intent operate in both assigned arms. Failed assignment falls back to the older
baseline and is not labelled as a trial exposure.

Background enrichment never blocks initial card loading or replaces the card
under the finger. Subsequent candidate preparation consumes cached metadata and
bounded semantic similarity. It uses Cloudflare's existing AI binding, BGE Small
384-dimensional embeddings with cls pooling, the configured text assistant and
Llama 3.2 Vision. Pooling/model/version are part of the cache namespace. Known
product forms, packaging and compatible-kit classifications cannot be overridden
into a conflicting product form or official LEGO. Metadata confidence gates are
model-reported thresholds, not measured/calibrated accuracy.

Enrichment accepts at most eight public eBay/StockX/Amazon catalogue records.
Native FindAI listings and chat/private images are excluded. Image fetching is
HTTPS-only on a short trusted CDN host list, refuses redirects and credentials,
and caps streamed image bytes at 1 MB. Request size, rate, timeouts, bounded
outputs and an atomic D1 daily reservation limit cap inference. The default
recommendation-only budget reserves three calls per new batch, up to 300 calls
per UTC day; `RECOMMENDATION_AI_DAILY_CALLS` can adjust it within bounded limits.
Seven-day content/query caches avoid repeat calls. Exhausted budgets, provider
failures or unsupported images leave the existing rule-based feed usable.

This is semantic enrichment and reranking within retrieved candidates. It is
not a catalogue-wide vector index, an independently trained image embedding
model, or proof of product authenticity. Catalogue-wide vector retrieval remains
a scaling upgrade, requiring trusted catalogue ingestion and a vector index.

## Similar shoppers

Authenticated profile sync publishes only a small allowlist of canonical topic
signals with sufficient distinct-product evidence. The D1 query finds up to 100
accounts sharing at least two anchor topics, then surfaces an unseen candidate
topic only when at least five distinct peer accounts support it. Responses contain
canonical queries, bounded scores and coarse support bands; no shopper identity,
raw personal search or individual history is returned. One community lane can
replace a personal lane while preserving the exploration lane. A small or sparse
community returns no suggestion. This is collaborative topic retrieval, not a
large-scale item/user embedding model. It still needs relevance and abuse testing
on representative real users.

## Shopping context and relevance

Purpose is session-only and expires. Gift wording supplies a temporary gift
signal; explicit Buy/Gift/Collect/Browse selection in the existing hold menu is
stronger evidence. Two distinct comparisons plus a product visit are only a
low-confidence buying hypothesis. No recipient identity, purchase, affordability
or personal circumstance is inferred.

Gift-session product actions supply short-lived session interest and telemetry,
without adding durable topic/preferences or historical-save seeds. Saved gift
families stay excluded from later seeding until the person deliberately engages
with that product in a personal shopping session. Ordinary saves still remain
available in the user's collection.

Relevant/Not relevant feedback appears inside the existing hold menu. No card
three-dot button or unsolicited popup is added. Feedback has its own outcome
labels; it is never counted as a save or purchase. Account changes clear cached
semantic/community/model/context state; personalisation opt-out suppresses new
learning and uploads. Account deletion removes the new hashed personal tables.

## Verified outcomes and measurement

Native Stripe order hooks run only after webhook signature validation. Learning
accepts live-mode paid sessions matching the stored checkout, amount and currency.
It rejects pending/test payments and client purchase claims. Refunds and disputes
map through the stored payment intent. Paid retries do not erase a refund; full
refund state does not regress to partial refund. Native money ledger entries are
idempotent per order/type/payment intent when the webhook is retried.

Attribution requires a real signed-in, matching FindAI-listing impression in the
preceding seven days. Unattributed paid orders remain unattributed. Affiliate
purchases on eBay, Amazon and StockX cannot be inferred from outbound clicks;
provider-confirmed callbacks would be needed for those outcomes.

`recommendation_visits` records a qualified visible page visit after ten seconds,
once per account/browser/UTC day and policy. The retention evaluator reports
matured exact-day D1/D7 cohorts. Guest storage resets or sign-in can split identity.
The trial evaluator accepts a policy argument and resamples viewers for outcome
intervals. Results remain descriptive until assignment, delivery, position,
supply and sample adequacy are checked; repeated peeking is not conclusive proof.

## Learned ranking pipeline

Impression-time features include topic/preference/repetition/shared/semantic/
community/context evidence. Uploaded shadow models can predict Save, Product
Visit, Relevance and Purchase Kept independently. Public model reads contain
weights and evaluation metadata, never training rows. Admin-only model admission
validates exact features, finite bounded coefficients, allowed targets and
`mode=shadow`. Active models are rejected. Shadow predictions are logged with the
model version and never added to live ranking.

Run `scripts/train-shopping-intelligence.py export.sqlite model.json` on a real
D1 export. It uses chronological training and future evaluation on held-out
viewers. It requires sufficient labelled exposures, independent viewers and both
positive and negative outcomes for each head. Missing relevance answers are
missing labels, not negative feedback. Purchase Kept uses verified native orders,
a seven-day attribution window and fourteen days without an observed refund or
dispute; it is not lifetime satisfaction. Sparse targets are declined. No model
is produced if all heads lack adequate real evidence.

No real usage export was available during this implementation, so no production
ranker was fitted or activated. Synthetic fixtures are used only to test the
trainer. Actual model training, controlled promotion and measured recommendation
quality/retention gains require live beta data. Shipping these mechanisms does
not justify an automatic score increase or a billion-dollar valuation.

## Validation

Tests cover inference/cache/budget and image guards, known-form/compatible-kit
protection, peer threshold/privacy, model admission, visible-client enrichment,
gift isolation, feedback, account races, shadow predictions without activation,
actual Worker webhook signature/payment/refund/retry paths, training/missing
labels, retention cohorts and previous recommendation/checkout/motion/share
regressions. Live deployment, D1 routes and AI inference are checked separately
from mocked inference. Image-provider accuracy and a real trained model are not
established by those checks.

Provider references:
- https://developers.cloudflare.com/workers-ai/models/bge-small-en-v1.5/
- https://developers.cloudflare.com/workers-ai/models/llama-3.2-11b-vision-instruct/
- https://docs.stripe.com/api/checkout/sessions/object
- https://docs.stripe.com/api/events/types
