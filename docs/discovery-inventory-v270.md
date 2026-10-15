# Discovery inventory and source links

Home stopped after roughly ten cards because inventory was filtered for spacing
before Home/Search ownership partitioning, and both surfaces applied further
spacing. Raising the starter limit did not restore offers already excluded.
The public starter now round-robins distinct provider offers by target without
discarding their depth. Per-surface ordering keeps the normal gap whenever
possible, then prefers the least recently shown available target when stock is
sparse. It still avoids adjacent offers for the same target. Duplicate offer
keys are removed before opening and append. Deferred decoded offers survive in
a bounded buffer. Concurrent initial lanes retain the strict opening policy.

The source workbook is WishWave_700_Catalogue_and_Supply_Check.xlsx, version 2.
Its 700 candidate rows are exported to data/discovery-catalogue-v270.json.
610 rows with prepared queries are configured for scheduled retrieval; 90
unresolved identity/format rows are excluded from this expansion. Existing
hand-written pilot variant rules take precedence (including the already-enabled
FF421 unscented lip-treatment variant). Query preparation is not identity,
authentication, scarcity or supply verification. Generated rules require every
non-editorial query token, and unsuitable/sold/wrong-market offers remain blocked.
The index uses mandatory-term anchors rather than scanning every target for
every inventory row. Do not claim that 700 listings are available.

Cron refreshes up to 32 configured targets every 15 minutes, with four concurrent
requests, existing provider-budget enforcement, and up to 16 matched offers per
target. A complete 610-target sweep takes about five hours, within the six-hour
inventory freshness window. Targets with no matching supply remain empty. The
new configuration is deployed through the existing main-branch GitHub build.
The browser's cold fallback starts at most 32 lanes, not hundreds simultaneously.

A new curated document visit does not restore the previous 24-hour Home snapshot
or 30-minute Search snapshot. Fresh starter offers rank unseen listings ahead
of viewed listings and use a per-visit ordering seed. Switching tabs retains the
visible card; returning after five minutes in the background refreshes Home.

External retailer taps use same-frame navigation inside the iPhone host. Its
existing WKNavigationDelegate intercepts the URL and presents SFSafariViewController.
Browsers retain new-tab behavior. Tracking failures cannot block navigation.
The native build does not need to change for this web fix.

Checks exercise uneven supply, catalogue/hold configuration, exact variant and
source guards, source links in both environments, actual rendered-card clicks,
duplicate-free append, progressive buffers, twenty-target opening diversity,
Search continuation through untried queries, and tab/navigation stability.
Physical-device behavior and current provider stock require production checks.
