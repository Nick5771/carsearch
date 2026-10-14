# Shared fresh-inventory opening for Home and Search

Phone reports continued to show a Home spinner and one-product Search grids after
v245. Live calls returned sixteen offers for each of three supported targets.
End-to-end tool timing was 12–13 seconds, while API metadata reported source work
of 258–2029ms. This does not establish the phone's exact latency, but demonstrated
that healthy responses can exceed the client's former 4.5-second passive budget.
The US catalogue reported 1,856 fresh rows. Search also reused a partially painted
grid on re-entry without replenishing it.

The new GET /recommendations/starter?country=US reads existing public catalogue
inventory in one request. It selects only fresh, available US rows, matches the
31 supported pilot targets, excludes unsuitable currencies/sources/URLs and
applies target/category spacing. It never calls providers, activates sourcing,
uses dated audit fixtures in production or invents stock. Empty inventory remains
empty. The read is rate-limited and scans at most 4096 rows.

Home and Search share a 60-second in-memory starter cache and one in-flight public
request. Home verifies four photos at a time, publishes a usable first set and
appends the rest as they are verified. Failed images stay excluded; decoded probe
images release their src. Pagination can use not-yet-delivered starter products
before retrieving per-target pages. Exact offer keys are checked before appending
completed starter work. Existing cards retain their nodes.

Passive requests now allow 15 seconds. If transport fails and owned inventory is
also empty, propagate the failure rather than reporting a false exhausted page.
Sparse Search grids resume loading on re-entry. The opening fallback has a bounded
wait and renders a retry state rather than an indefinite spinner. Guest-liked
content has bottom padding to clear the existing navigation bar. No action-icon,
navbar, header-fade or other mockup design changes are included.

Validation: SQLite inventory guards and spacing, full client shared bootstrap,
Home/Search population, duplicate-free append and a 4.8-second passive response
survival pass. Existing treasure-scroll, starter-buffer, fresh-opening, Search
stability and authentication checks pass. The Search stability assertion now
permits legitimate sparse-grid replenishment while still requiring the same
visible first tile. Deploy through the existing main GitHub builds; verify live
starter counts after deployment. Actual phone latency still needs retesting.
