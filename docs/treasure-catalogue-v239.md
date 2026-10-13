# Broader treasure reels selection v239

The original nine-target opening overrepresented LEGO, radios and novelty
household objects. The user rejected that selection. The pilot now uses 23
targets across ten real editorial categories: vintage jackets, bags, sunglasses,
jerseys, retro gaming, Pokémon cards, character collectibles, sneakers, beauty and
fragrance. All LEGO, Nickelodeon and Panasonic queries were removed from this
pilot. The 500-item sourcing catalogue remains available for separate interests;
this revision changes opening discovery selection, not a search blacklist.

The current dated US supply audit found provider candidates for 22 targets.
Coach Ergo 9033 (FF156) returned no accepted match and stays outside the preview.
Only targets with candidate evidence become pilot seeds. Provider observations
are not seller authentication, exact condition checks, proof of vintage status,
or checkout-stock guarantees. Archived/other-market price comparisons are not
used to manufacture offers. Wrong jersey home/away variants, graded/played cards,
used beauty items, fragrance flankers/gift sets and hardware accessories are
filtered when those differences appear in provider metadata or titles.

Cold-start selection picks one target from each real category, then rotates the
category order. It no longer treats several LEGO subtopics as separate categories.
Target admission collapses different sellers, sizes and colours of the same
editorial item within a rolling twenty-card window. No category may exceed two
items in a rolling ten-card window, and a different category is selected next
when eligible alternatives exist. Existing brand/form relevance and diversity
rules still run. Deferred inventory is retained rather than relaxing limits.
Original target filtering persists when a retrieval lane tries query variations.

Use the same opt-in US test link:

`https://findai.ai/findai-app.html?catalogue-test=1&treasure-test=1&country=US`

The pilot script URL and feed signature are versioned to v239. Old pilot feed and
lane caches are cleared once in test mode; saved items and personal preferences
are preserved. A signed-in user's interests still affect their personalised
feed. A signed-out incognito session shows the cold-start selection. Other
markets and ordinary sessions retain the established baseline.

The existing Worker warmup integration remains gated by its deployment and
configuration. Updating the frontend through GitHub/Vercel does not deploy or
activate Cloudflare ingestion. The preview retrieves real offers through the
already deployed shopping API. Typed search continues to work as before.

Checks cover category grouping, wrong product/variant/condition rejection,
same-target spacing across page boundaries, actual client boot, US routing,
cache separation and the ordinary-feed baseline. Fixtures verify policy
behaviour; the saved API audit is separate observational evidence.

Run `node scripts/audit-treasure-supply.cjs --retry` to revisit incomplete or
unmatched targets while preserving successful observations. Regenerate the
machine-readable 500-target manifest with the existing build script after an
audit update. Further catalogue batches and engagement testing remain necessary.
