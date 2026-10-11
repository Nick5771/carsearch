# WishWave audit — 11 October 2026

Scope: listing layout, Search interaction, feed variety/loading, product information, buying/orders, seller and creator dashboards. Review includes repository checks and a signed-out live browser at a 520px app width. It is not an iPhone safe-area or authenticated payment certification.

## Findings

| Area | Evidence | Remaining limitation |
| --- | --- | --- |
| Listing layout | Live dark Home and Search details and action buttons above navigation; translucent caption and full-width contained image verified. Light/dark styling regression passes. | Light captions remain opaque over full-canvas photos. Short phone screens, physical keyboard behaviour and authenticated owner Promote controls need device verification. |
| Search | Exact StockX item opens; duplicate touch/click, deduplication, swipe suppression and animation cleanup tests pass. | Confirmed Search nav reset query/results when returning from a reel. Fixed by closing the reel before invoking Search reset. |
| Feed | Live scrolling expanded Home from 25 to 42 cards. Diversity, saved-grid identity, cursor boundaries and duplicate-batch recovery tests pass. | Some live broad discovery queries return accessories rather than desirable main products (camera remotes, golf grip tape). Variety works; relevance needs further tuning. |
| Product information | Live Nike Dunk search starts with StockX and interleaves colourways/eBay. Asking-price caches, single StockX gallery image, image fallback, source filtering, avatars and unknown-shipping tests pass. | Live asking prices and inventory cannot be guaranteed beyond their refresh windows; no purchase was made to check final marketplace totals. |
| Buying/orders | Checkout, reservations, Stripe webhook, purchase display, tracking, completion and disputes inspected in source. | Protection/refund and delivery-based seller fund release are incomplete; see below. Runtime configuration and real seller/buyer accounts were not verified. |
| Dashboards | Seller-only completed totals, separate currencies, errors, stale responses and creator sharing tools tested. | Orders endpoint returns latest 100 combined buyer/seller orders; totals are not all-time. Label corrected. Creator attribution, commission and payouts are explicitly unavailable. Promotions save drafts; they do not run ads. |

## Payment/protection gaps requiring backend work

1. The dispute resolution route records `buyer_refund` / `partial_refund` but returns `stripeRefundCreated: false`; it does not execute a refund.
2. Checkout uses Stripe destination transfers to the seller's connected account, with no order-delivery release mechanism here. Connected-account bank payout settings were not inspected.
3. `checkout.session.completed` marks orders paid without checking `payment_status`; delayed payment completion needs separate handling.
4. Repeated successful webhook deliveries can insert duplicate ledger entries and reset shipped/completed orders to `paid`; no event deduplication or conditional success-state guard is present in this route.
5. `completed` orders are excluded from the dispute-opening statuses; no implemented 30-day delivery-based claim deadline was found.
6. Marketplace checkout and disputes default to disabled. Actual production environment flags were not read. Protection is advertised in native listing/checkout text, so that promise needs alignment with a functioning policy and process.

## Verification and fixes

Initial full run: 18 of 28 checks passed. Older tests needed a temporary runner to resolve legacy test paths. Two additional failures were fixture problems: the comments account lacked a username and triggered onboarding; search intent used a non-eBay URL rejected by the current source allowlist. Corrected fixtures pass. No production comments change was needed.

Search return and dashboard labels were corrected and their regression checks pass. Search intent, comments, light appearance, continuous discovery, source/avatar, StockX, image stability, cursor pagination, shared ranking and quota checks pass.

Eight legacy checks remain failing/unresolved: create-photo-canvas-v225, create-preview-v223, create-return-v221, create-v219, keyboard-isolation-v222, motion-v215, page-reliability-v209 and taste-liked-v218. Some expectations refer to replaced preview structures, earlier theme colours or the previous one-discovery-lane recommendation policy. These failures are not treated as a clean suite or as proof of live failure. Keyboard, Create transitions and legacy expectations need further reconciliation.

No production payment, refund, advertising campaign, affiliate payout or account setting was enabled by this audit.
