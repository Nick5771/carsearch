# Create v308

Create now opens a Sell / Auction choice page with links to the existing promotion selector and listing manager. The listing composer uses the existing profile collectible illustration as its photo-upload empty state, subdued charcoal forms, compact category and condition selectors, and a Preview listing / Publish listing sequence. The existing image compressor, delivery choices, free-shipping toggle, validation, full reel preview and fixed-price publisher remain in use. Category now reaches the supported listing API field.

Save draft stores separate sell and auction drafts (including photos) on this device, scoped to the signed-in account. Storage failures show an error rather than claiming a save. Back retains in-memory work; closing and reopening in the current session retains it. Explicit Save draft persists across reloads. Successful publishing removes the fixed-price saved draft.

Auction is explicitly labeled draft-only on both the choice page and form. Its submit action only saves a draft. It never calls the fixed-price listing/image publish endpoints. This release does not implement bids, winning-bid settlement, auction closing, notifications or auction payment collection.

Validation: tests/create-redesign-check.cjs exercises the actual scripts for selection, artwork, photo restoration, separate drafts, duration persistence, preview-before-publish, back hierarchy, auction publication guard, and fixed-price endpoint payload. Navigation, back-gesture and Search/chat regression suites also pass locally. No physical iPhone visual verification was performed.

## v309 layout correction

The first device screenshots exposed two legacy CSS conflicts: grid rows still forced labels beside inputs, and the Edit-only header selector hid the title (moving Save draft into the centre column). The final stylesheet now explicitly owns the header grid, field display, intrinsic minimum widths and phone-safe input typography. Create choices use bounded 112px cards (94px on short screens), with all four actions visible. The upload plus is a child of the artwork wrapper and is anchored to its bottom-right corner. Delivery uses a compact selector beside Price, preserving the existing shipping/pickup fields and validation. The artwork resizes with the available editor height.

Checked in a real headless Chromium browser with local application assets and stubbed account/network data: 393x852, 375x812 and 320x640 viewports, each with a simulated 54px top safe area. The Create choices and initial Sell/Auction forms fit without vertical or horizontal scrolling at all three sizes. Screenshots were inspected; this is browser validation, not a physical iPhone/Safari test. Expanded delivery details, uploaded photo thumbnails, accessibility text scaling and an open keyboard can still require normal scrolling. The DOM regression test now checks the new stylesheet against all legacy inline CSS for the header, stacked fields, card height and artwork-relative plus positioning.

## v310 balanced height

Create choices now use the available height for two equal flexible cards, with Promote and Manage anchored above the navigation area. The form allocates its available height between the upload artwork and detail rows, rather than leaving fixed compact content above a large empty footer gap. Auction and short-screen layouts have their own minimum row sizes. The photo artwork and its upload badge scale together using the actual available upload height.

`tests/create-layout-browser-check.cjs` is a real Chromium layout regression. It asserts zero initial vertical/horizontal overflow AND a bottom content gap between 0 and 40px, across 393x852, 375x812 and 320x640 viewports with a 54px simulated safe top. It also checks that the artwork stays below the header and its badge remains attached. All nine cases passed: choices ended 22px above the navigation capsule; forms ended 12px above the footer. This supplements the DOM/action tests already in CI. Run it in an environment with Playwright and a Chromium installation; optionally set WISHWAVE_CHROMIUM_PATH for a custom executable and WISHWAVE_SCREENSHOT_DIR for screenshot capture.

## v311 match the approved form

The supplied mockup is now the form's layout reference: a larger empty upload area, fixed compact title/category/condition/description/price rows, lighter input text, single down chevrons, joined currency/price, and a More details row. Additional space is assigned to the artwork area rather than stretching individual field rows. The choice page is unchanged.

More details opens actual supported options (quantity and accepting offers). Both persist in the device draft, restore on return, and reach the existing listing API. Invalid optional fields open their details container before validation focus. The native select remains 16px and receives taps; an aria-hidden value/chevron at the reference's smaller visual size avoids native double arrows and iPhone focus zoom. The native controls retain their labels and picker behavior.

DOM tests cover optional-details disclosure, separate drafts, restored quantity/offer values and their publish payload. Browser checks continue to pass for all initial screens at 393x852, 375x812 and 320x640, including overflow, bottom gap and artwork/badge bounds. Browser screenshots were inspected against the supplied reference; physical iPhone validation remains separate.
