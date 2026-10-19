# iPhone Google and Apple sign-in — build 315

## Problem and resulting behavior

The original iOS host opened the Apple OAuth start URL in a generic SFSafariViewController. Its redirect landed on the hosted app in that browser, whose cookies and local storage are separate from WKWebView. There was no callback or session handoff into the installed app. Google used a browser popup token flow from WKWebView, an unsupported embedded sign-in environment.

Build 315 routes both providers through ASWebAuthenticationSession. The native controller generates a random verifier and sends its SHA-256 challenge to the server. The server returns only an opaque 90-second ticket through `com.nickfiani.wishwave://auth`. The controller redeems that ticket over HTTPS with its verifier, then returns the user/session to the original app page. Provider tokens and WishWave sessions are never callback URL parameters. D1 atomically consumes tickets only when the challenge matches; wrong proofs do not consume legitimate tickets. Google authorization also uses a separate server-held PKCE verifier and single-use 10-minute state.

The existing browser Google flow and Apple app/web return routes remain available. Native builds without the new bridge explain that an updated iPhone build is needed and offer email as the fallback. Browser Google popup failure/cancellation now displays feedback.

## Google setup required before native Google sign-in works

For the existing **Web application** OAuth client `258387139240-a60g5n1hortfo0tnpm03dj8ht7jemqt0.apps.googleusercontent.com`, add this exact **Authorized redirect URI** in Google Cloud:

`https://api.carsearchapi.workers.dev/auth/native/google/callback`

Store that same client's secret as the Worker secret **GOOGLE_CLIENT_SECRET** using Cloudflare's dashboard. Do not put it in frontend code, GitHub, or chat. The current implementation adds no new Google client ID and changes no JavaScript origin settings.

Read `/auth/native/config` for booleans only. `google:true` confirms a secret is present, not that the secret or Google Console URI has been validated through a real sign-in. `apple:true` checks the existing Apple server bindings. Apple reuses its current HTTPS return URL and credentials; no Apple portal redirect change is required for this web-auth-session approach.

## Install build 315

Update/download the repository, open `ios/WishWave/WishWave.xcodeproj`, retain the existing signing team and bundle ID, select the iPhone, and press Command-R. Both Debug and Release build numbers are 315. Refreshing the website alone cannot add AuthenticationServices handling to an installed older build. If distributing through TestFlight, archive/upload build 315 first.

## Verification

- `node tests/native-auth-check.cjs`: Google code/PKCE, native Apple routing, proof-bound redemption, wrong verifier, replay rejection, expiry, cancellation and failure.
- `NODE_PATH=<jsdom runtime> node tests/native-auth-client-check.cjs`: native versus browser paths, old-build guidance, tap lock, successful session application, provider mismatch, cancellation and button reset.
- Existing password server/client and native sharing checks.
- GitHub iOS workflow compiles an unsigned simulator build.

Real device acceptance still required: Google and Apple each return to the installed app signed in, cancellation stays on login, repeat sign-in works, relaunch retains login, Safari website login still works, and Google config is tested with a real account. This environment cannot sign/install an app on the user's iPhone or configure the Google/Cloudflare consoles.
