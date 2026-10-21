# Profile layout regression fixes — v351

- Remove the empty Listings panel’s negative top margin, which overlapped the tab captions and selected underline. Provide Listings/Sold captions in the initial markup and Saved in its tab creator; keep the restored-tab repair and refresh its script version.
- Restore the same equal-width two-column grid for blocked and ordinary public profile actions.
- Put toast feedback above profiles opened from Messages. Intercept blocked Follow clicks before legacy handlers, including restored profile DOM whose backing model is temporarily absent. Tapping shows “Unblock user to follow them”.
- Finish the one-way chat notice with “until you unblock them.”

Validation: the 53 account/discovery checks pass. A full Chromium check loads the actual HTML, styles and external scripts at a 390×844 mobile viewport with mocked services. It verifies first-render captions, a visible 2px underline, no overlap from the empty panel, equal button widths (173.5px each), and real Follow clicks with visible feedback above the Messages-owned profile (toast z-index 31000, profile 20020). Screenshots were visually inspected.

The browser regression can be run with Playwright available to Node: `node tests/profile-layout-browser-check.cjs`. Set `CHROMIUM_EXECUTABLE_PATH` to use a system browser and `WISHWAVE_SCREENSHOT_DIR` to export screenshots. No backend or native Xcode change is needed.
