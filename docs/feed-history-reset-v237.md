# Feed-history reset v237

User requested resetting the recommendation baseline after continued computer
and camera recommendations. Baseline changes alone do not clear historical
explicit browsing/inspection signals. Cameras were also deliberately in v236's
starter universe; resetting history alone would not remove that seed.

Changes:
- Cameras removed from starter queries. Seven concrete categories remain:
  sneakers, headphones, consoles, LEGO builds, diecast cars, Casio/Seiko watches,
  human clothing. Computers and pets were already excluded as generic starters.
- Passive camera evidence cannot reinstate the removed starter category. New
  explicit camera searches and direct engagement remain supported.
- reset-feed=1 performs a device/current-account reset before saved-like seeding:
  remove old browsing/inspection/search affinity and feed/lane/exposure caches;
  reconstruct product evidence from current saved products and negative choices.
  Preserve saved likes, explicit rejections/unlikes, gifts, auth and other account
  archives. The reset flag is removed from the current URL so reload does not
  repeatedly reset learning.
- An account-isolated cutoff prevents pre-reset implicit rows returned by profile
  sync from resurrecting the old taste. Recent post-reset events still learn.
  No remote profile deletion or cross-account reset is performed.
- Cache signature v237 invalidates the prior feed. No Worker change is needed.

Tests: new reset fixture preloads Dell/camera clicks, a laptop topic, old caches,
current LEGO likes, negative choices and another account archive. Checks one-shot
URL consumption, preserved likes/rejections/account archive, cleaned derived
history, old server sync response filtering, new camera search and account-scoped
cutoff. Existing baseline, balanced interests, fresh opening, client, sync and
account isolation checks cover unaffected paths.

This is an explicit reset link, not an automatic wipe on every app load. It does
not claim that all computer appearances were historically learned in the real
session, whose internal state was not available.
