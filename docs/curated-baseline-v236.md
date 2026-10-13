# Curated baseline and spiral prevention v236

Reported real session: relevant Star Wars opening followed by mostly Dell
computers and several dog sweaters, including consecutive runs. Browser state
was not supplied; the following are reproduced policy/classification failures,
not a claim to identify every source in that exact session.

Causes addressed:
- Generic gaming-laptop, rare-collectibles, luxury handbag and broad fashion
  accessory seeds were present in the cold-start universe.
- Pet clothing was unknown or interpreted through human-apparel metadata.
- Passive viewing across products alone could produce a supported preferred
  interest, which bypassed the exploration caps.
- Sparse pool sequencing relaxed category runs; preferred interests could run
  consecutively. Dell was not consistently recognized from titles as a brand.

New-user baseline (specific queries, one seed per category, rotated):
1. Sneakers: Nike Air Max, Adidas Samba, Asics Gel.
2. Audio: Sony / Bose headphones.
3. Gaming: PlayStation 5 / Nintendo Switch consoles.
4. LEGO: Star Wars builds, Technic cars, Icons builds.
5. Diecast: Hot Wheels / Matchbox cars.
6. Watches: Casio / Seiko.
7. Human apparel: Patagonia fleece, Nike hoodie, Adidas jacket.
8. Cameras: Fujifilm Instax / Canon mirrorless.

Generic laptops, computer parts, pets, broad accessories, rare-collectible
queries and luxury handbags are no longer default seeds. Real explicit interest
can still retrieve those products; this is not a blanket shopping blacklist.
When the current plan has no usable evidence, do not reinstate legacy session
lanes as the baseline.

Shared form/brand changes: distinguish pet products before human clothing,
recognize complete headphone products, and infer Dell/HP/Lenovo/Asus/Acer/MSI
plus baseline brands from titles consistently in client and Worker. Pet products
are eligible only with explicit positive pet evidence or a recent pet search.

Implicit evidence: passive-only strength is capped at six and never classifies
as a supported preferred interest. Passive computer/pet topics cannot become
retrieval lanes. Supported preferences require saved evidence or direct actions
on distinct products; recent searches remain independent temporary intent.
Passive baseline-category interest still supplies bounded candidate retrieval.

Hard diversity guards across batches and backlog draining:
- No more than two consecutive non-building-set product types.
- No more than two consecutive non-LEGO brands, and three per rolling ten.
- Cold feed non-building types capped at three per rolling ten.
- Existing narrow-build and canonical-set guards retained.
- Sparse pools defer candidates rather than relaxing the limits.

Validation: curated-baseline test checks eight categories, pet/human distinction,
six passively viewed Dell products not producing computer retrieval, direct
computer engagement still working, 60-card preferred-Dell mix and cross-page
brand cap, sparse Dell/pet pools never producing a run. Balanced-interest fixture
now expects passive camera interest to remain bounded rather than dominant.
Existing catalogue, shared core, sync, responsive, fresh-opening and continuous
paging checks pass; scripts compile and Worker bundle imports.

These are rule-based defaults, not popularity forecasts or measured retention
improvements. Real user satisfaction, inventory depth and distribution still
require observation. Cache signature v236 invalidates the prior bad mixes.
