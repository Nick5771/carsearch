# Curated iPhone starter feed and progressive buffers

The iPhone host now opens the US catalogue/treasure selection with
`country=US&catalogue-test=1&treasure-test=1`. The source catalogue has 500 sourcing
targets; the enabled selection currently has 31 supported targets in 14 categories.
This does not manufacture availability or activate additional Worker ingestion.
Ordinary website sessions and typed searches retain their existing routing.

Home uses the available initial inventory instead of capping single-category
first paint at two cards. It gives other categories a bounded opening grace,
then appends each completed lane without waiting for the slowest lane. Opening
requests own their lane pool until completion, including shallow Home snapshots.
Low opening inventory triggers prefetch; automatic and scroll pagination share a
promise. Base admission retains deferred target inventory for later spacing.

Search For You uses the supported target queue in curated sessions and separates
its cache from older generic grids. A cross-category reservoir publishes the
first product promptly, holds same-category followers while other lanes are
pending, and prefers a different, underrepresented category for each appended
tile. Existing visible tiles retain their nodes/order. Typed search keeps its
response ordering and relevance. Sparse supply cannot create unavailable categories.

Empty Apple sign-in feedback has no display or reserved height. Nonempty feedback
has a transparent background. The top reel/header gradient is unchanged.

Checks cover actual delayed Home/Search request pipelines, stable visible nodes,
opening-lane pagination ownership, target-query routing, cache separation,
93-reel catalogue admission, target spacing, 60-card personalised pagination,
tab/gallery/keyboard gestures and feedback CSS. Native compilation uses the
existing unsigned iOS simulator workflow. Device latency and repeated fast swipes
still require testing on the physical phone after rebuilding the host.
