# Fresh product openings and interaction-count mock-up

The previous feed rotated offer IDs, so another seller of the same product could
still lead each visit. Device-local, account-scoped history now records product
targets shown in the first twenty cards and products actually viewed. A new
document ranks products absent from recent openings ahead of recently seen
products, then varies their order. Different seller IDs do not reset that history.
The history expires after fourteen days and is bounded to 1,800 product keys.
It is not sent to analytics as an interaction or view. Existing real tracking
continues separately. When stock is narrow, the app cannot promise twenty unseen
products; available products remain behind genuinely new finds.

Home/Search ownership remains product-level within a document visit. New
documents use new reservations rather than inheriting the six-hour product split.
Tab switches preserve the current visit and visible card. A deliberate refresh
starts a new ranking snapshot without releasing the other tab's reservations.

LEGO variants now share one normalized category across the pilot, collector and
display-set lists. Curated client sequencing limits LEGO to two offers in every
twenty cards, including sparse-stock fallback. The opening prefers six different
categories when matching stock exists. Rejected LEGO offers remain deferred and
the regular retrieval queue can supply other categories; typed searches remain
exempt from passive discovery caps.

The interaction mock-up displays stable per-offer sample numbers from 1–10,000
beside likes, comments, comparison, sends and bookmarks. Comment/send/save values
are proportional to the like baseline. Each rail says “Preview counts”. No item
fields, API payloads, account counters, comments or analytics are fabricated.
The mock-up is enabled for the existing treasure-test beta session or explicit
interaction-preview=1, and disabled with interaction-preview=0. Ordinary sessions
without either preview flag display real counts. Dark/light text contrast is
handled without changing the saved reel-image layout.

Checks cover changed-seller product repetition, account isolation, session
reservations, the combined LEGO cap, category breadth, correlated count bounds,
preview-only rendering, preservation of real count text and the integrated
Home/Search starter pipeline with both new modules loaded.
