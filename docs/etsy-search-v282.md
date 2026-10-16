# Etsy search restored

The Worker had calls to `searchEtsy` and `etsyFetchRaw` but neither implementation.
The public route swallowed the resulting ReferenceError and returned empty items.
The shared shopping engine also skipped explicit Etsy searches, and the server
intent parser did not recognise Etsy as a source filter.

This change restores Etsy v3 active-listing search plus one bulk listing lookup
for real photos. Requests use the shopper's currency and shipping destination.
Prices retain the currency actually returned by Etsy and use Etsy's amount/divisor.
Shipping remains unknown until Etsy checkout; it is never assumed free.
No commission/tracking arrangement is implied by API access.

Etsy runs for explicit source requests and relevant handmade, vintage, jewellery,
art and ceramics searches. The same adapter serves the shared shopping engine
(including Compare and passive recommendation retrieval), legacy search and Scan.
Unrelated queries do not make an Etsy call. Successful searches cache for 15 minutes;
configuration, auth and upstream failures are reported rather than cached as empty.

## Configuration

Keep credentials in Cloudflare Worker secrets. Supported names:

- Keystring: `ETSY_KEY` (also `ETSY_API_KEY` or `ETSY_KEYSTRING`).
- Shared secret: `ETSY_SHARED_SECRET` (also `ETSY_SECRET` or `ETSY_API_SECRET`).
- Alternatively `ETSY_KEY` can hold the complete `keystring:shared_secret` value.

Etsy's current documentation requires both values in the `x-api-key` header:
https://developers.etsy.com/documentation/essentials/authentication/
https://developers.etsy.com/documentation/reference/#operation/findAllListingsActive
https://developers.etsy.com/documentation/reference/#operation/getListingsByListingIds

## Verify after GitHub-connected deployment

- `/shopping/engine/status?country=AU` reports Etsy configuration status only;
  configured does not itself prove Etsy accepts the credentials.
- `/etsy/search?q=vintage%20vase&country=AU&debug=1` reports the upstream status
  and result count without disclosing headers, keys, secrets or raw error bodies.
- `/etsy/search?q=vintage%20vase&country=AU` should return priced cards with photos.
- `/shopping/search?q=vintage%20vase%20on%20Etsy&country=AU` verifies integrated
  source routing, ranking and source health.
- Missing key or shared-secret states require adding the corresponding existing
  Etsy app credential in Cloudflare Settings, then deploying the configuration.
- HTTP 401/403 means Etsy rejected authentication/access; 429 means rate limiting.
  These are separate from a successful response containing zero listings.

## Validation

`node tests/etsy-search-check.cjs` exercises credentials, provider failures,
country/currency handling, amount/divisor, photos, cache, explicit-source intent,
passive recommendations, legacy specialists, StockX coexistence and public routes
using mocked Etsy responses. Live acceptance must be checked after deployment.

Compare regression checks: `node tests/compare-identity-check.cjs` and
`node tests/compare-check.cjs`.
