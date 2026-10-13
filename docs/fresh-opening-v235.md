# Fresh Home opening v235

Reproduced with seven saved Star Wars likes and the explicit catalogue test link:
1. Store completed prior-session lane state (page 6, hasMore false).
2. Start a fresh Home feed with forceNetwork, without a valid feed cache.
3. v234 restores exhausted offsets before opening. No Star Wars query is issued;
   the only available lane supplies a generic laptop opening in the fixture.

A separate reproduction makes the experiment endpoint fail. v234 leaves the arm
unassigned, disabling the updated path even with catalogue-test=1.

Fixes:
- Fresh feeds and cache warmers start new retrieval lanes at page one. An existing,
  valid feed cache restores its own lane snapshot and preserves continuation.
  Persistent offsets no longer override a new feed opening.
- Explicit catalogue test selects the local test arm immediately, remains test on
  account reset, and cannot be switched to control by a stale assignment response.
  Normal visitors still use server assignment. Test policy excludes production
  experiment/training evidence as before.
- v235 Home cache signature invalidates bad opening caches.

Validation: new fresh-opening full-app test simulates failed assignment and
exhausted stored lanes, checks relevant page-one opening, and advances actual
Home retrieval through 60 unique cards. Existing catalogue-client and responsive
checks cover test isolation, cached hits, account/abort guards and active-card
preservation. These reproduce code failures; no browser trace from the reported
session was available to prove which occurred in that exact session.

Generic computer exploration remains possible in bounded later slots or with
real computer interest. No computer-specific blanket blacklist is added.
