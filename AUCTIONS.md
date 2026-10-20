# WishWave timed auctions

Implemented model: private-maximum (proxy) bidding, fixed closing time, 3/5/7 days, single quantity. Starting price is the seller's minimum; no hidden reserve, Buy Now, offers or automatic relisting. Fixed or free shipping only, so bidders know the shipping price before bidding. Supported currencies are USD, AUD, CAD, NZD, EUR and GBP, all stored as integer hundredths.

## Rules and evidence

- eBay automatic bidding: https://www.ebay.com/help/buying/bidding/automatic-bidding?id=4014
- Equal maxima favour the earlier maximum: https://pages.motors.ebay.com/help/buy/contextual/bidding.html
- Timed closing and durations: https://developer.ebay.com/api-docs/user-guides/static/trading-user-guide/duration.html
- Starting price can replace a hidden reserve: https://www.ebay.com/help/selling/reserve-prices/listings/selling-auctions?id=4143
- Payment policy: https://www.ebay.com/help/policies/payment-policies/unpaid-item-policy?id=4271

Checked 20 October 2026. WishWave uses eBay's US increment brackets expressed in each listing's currency units as its own published schedule; this does not claim parity with eBay's other countries. In currency units: below 1: .05; below 5: .25; below 25: .50; below 100: 1; below 250: 2.50; below 500: 5; below 1000: 10; below 2500: 25; below 5000: 50; otherwise 100. No automatic extensions: server acceptance before the deadline determines eligibility, not the phone clock or request send time.

## Atomicity and privacy

`wishwave-auctions-engine.js` installs additive D1 tables/columns and SQLite triggers through the existing marketplace schema initialization. An accepted immutable bid, bidder maximum, ranked winner, current price and outbid event change in one SQLite statement transaction. The bidder with the largest maximum leads; ties use the sequence at which that maximum was accepted. Raising your own maximum never bids against yourself. Invalid and late bids abort the whole statement. Bid request IDs are scoped to listing and account; retries reuse the ID and reject changed payloads.

Public listings contain current price, bid count and end time. Authenticated auction responses expose only that viewer's maximum and leading status. Other bidders' maxima and email addresses are never serialized. Own bidding and blocked counterparties are rejected server-side. Published terms are immutable, including seller, images, currency, shipping and starting/current price.

## Closing and payment

State machine: active -> awaiting_payment -> paid, or active -> unsold; awaiting_payment -> unpaid after the payment deadline. A winning auction is reserved, not recorded as a completed sale. Only the authenticated winner can check out at the final server price. Checkout reservation and order insertion are atomic. Payment notifications verify the signed Stripe event, session, currency and exact total; order, auction and inventory updates are atomic. Stale expiration events cannot undo paid orders.

A winner has four days from the scheduled end to pay through the existing Stripe checkout. This implementation does NOT save cards or automatically charge the winner. Current app payment controls deliberately remain Stripe-test-only. An expired checkout leaves the auction reserved for its winner, who can retry before the deadline. Ambiguous network failures retain the reservation and recover the exact Stripe request with an idempotency key. Test auctions cannot be paid with live keys or vice versa. An open Stripe session must be expired/verified before unpaid cleanup; ambiguous payment state fails closed for review. Unpaid auctions end rather than automatically passing the item to another bidder or relisting it.

Auction notifications use a persistent event outbox and stable inbox identifiers. Closing runs every minute via the existing cron binding; other catalogue maintenance retains its 15-minute frequency. Auction detail, bid and checkout paths also close due auctions lazily, so cron delays cannot admit late bids.

## Availability and validation

Publishing requires existing marketplace checkout enabled, an approved seller, and a connected Stripe account verified for charges AND payouts. Bidding also checks checkout availability and seller charge capability. No payment gates have been enabled by this change. The public API reported checkout disabled, live false and no Stripe test configuration during implementation. There is no new binding or secret for the engine itself.

Tests:

- `node tests/auction-engine-check.cjs` — real SQLite trigger behavior and concurrent writers (requires Python 3).
- `node tests/auction-api-check.cjs` — actual Worker creation, checkout and webhook handlers plus engine routes against Node SQLite; Stripe responses simulated, not a real Stripe integration test. Requires Node 24.
- `node tests/auction-client-check.cjs` — bid review, confirmation, money validation, ownership and logout in jsdom 26.1.0.
- `node tests/create-redesign-check.cjs` and `node tests/checkout-test-mode-check.cjs` — existing creation and payment gate regressions.

Before accepting real money: configure/verify seller onboarding and Stripe test keys/webhooks, complete a genuine two-account test auction through Stripe test payment, verify cron/outbox operation in deployed D1, and finish the existing live-payment launch work. Bid retraction, reserve prices, buy-now hybrids, saved-card charging, second-chance offers and automatic relisting are outside this first engine. Published auction cancellation currently requires an operator review; do not promise self-service cancellation.
