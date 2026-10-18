# Create v308

Create now opens a Sell / Auction choice page with links to the existing promotion selector and listing manager. The listing composer uses the existing profile collectible illustration as its photo-upload empty state, subdued charcoal forms, compact category and condition selectors, and a Preview listing / Publish listing sequence. The existing image compressor, delivery choices, free-shipping toggle, validation, full reel preview and fixed-price publisher remain in use. Category now reaches the supported listing API field.

Save draft stores separate sell and auction drafts (including photos) on this device, scoped to the signed-in account. Storage failures show an error rather than claiming a save. Back retains in-memory work; closing and reopening in the current session retains it. Explicit Save draft persists across reloads. Successful publishing removes the fixed-price saved draft.

Auction is explicitly labeled draft-only on both the choice page and form. Its submit action only saves a draft. It never calls the fixed-price listing/image publish endpoints. This release does not implement bids, winning-bid settlement, auction closing, notifications or auction payment collection.

Validation: tests/create-redesign-check.cjs exercises the actual scripts for selection, artwork, photo restoration, separate drafts, duration persistence, preview-before-publish, back hierarchy, auction publication guard, and fixed-price endpoint payload. Navigation, back-gesture and Search/chat regression suites also pass locally. No physical iPhone visual verification was performed.
