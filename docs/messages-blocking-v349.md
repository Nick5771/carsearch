# Messages, directional blocking and discovery — v349

## Changes

- Remove the redundant symmetric block check in the full public username profile route. The existing directional access guard still returns an empty restricted profile to the blocked viewer, including reciprocal blocks. The blocker can reopen the complete profile; private-account visibility still applies. Follow/message restrictions and automatic unfollow remain enforced.
- Report successful block and unblock using the account handle (`@username blocked` / `@username unblocked`). Profile menus read the directional relationship field as well as the legacy field.
- Replace rotating text ellipses with a fixed vertical SVG and 44px hit targets. Capture menu clicks before legacy page handlers; keep the existing conversation/profile action sheets.
- Shared listing reels show Back, WishWave and Messages. Both buttons return to the originating conversation with its message draft and scroll position intact. Shared reels do not select the Search tab.
- Match the dark reel canvas, image letterbox, caption gradient and topbar to charcoal so blank regions have no black/charcoal seam. Light-mode styles remain separate.
- Immediately incorporate current-session product impressions into discovery rotation, rather than waiting for the next visit. Existing product/category diversity and per-account storage remain in place.

## Validation

All 52 checks from the account/discovery workflow passed locally, plus the expanded chat and shared-reel checks. The blocked-profile test now runs the full username route so a second access guard cannot silently undo the directional helper. Chat tests exercise legacy event interception, real menu clicks, named block confirmation and directional Unblock state. The dated supply-fixture feed test rendered 93 cards with twenty distinct opening targets; this verifies client behavior, not current live marketplace supply.

Existing Search race cancellation, short-page recovery, listing ownership, bookmark counts, nested navigation, reversible gallery/back gestures, profile tab labels and selling draft/preview checks pass. Device animation smoothness and live authenticated two-account behavior still need iPhone verification. Browser visual verification could not run because the browser download failed.

## Deployment

Frontend assets are versioned with query 349 to avoid cached menu/rotation code. The API fix is in `findai-worker.js` and requires the connected Cloudflare Worker deployment separately from the frontend deployment. No Xcode native source changed.
