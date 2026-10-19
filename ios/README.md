# WishWave iPhone beta

Open `WishWave/WishWave.xcodeproj` in a current Xcode on your Mac. No dependency installation is needed. This first iPhone test host runs the live WishWave interface in WKWebView, adds native share/haptics, retains website login storage, and recovers from initial connection failures. It uses the US shopping region. Minimum iOS: 16.0. The existing app logo is included as the initial app icon.

## Run on your iPhone first

1. Install/update Xcode from the Mac App Store and let it install its iOS components.
2. Download or clone https://github.com/Nick5771/carsearch and open the project above.
3. In Xcode Settings > Apple Accounts, add your Apple Developer account.
4. Select the WishWave target > Signing & Capabilities. Select your paid developer team with Automatically manage signing checked.
5. The initial bundle identifier is `com.nickfiani.wishwave`. Use your existing registered identifier if you already created one, or change it if unavailable. Keep it identical in App Store Connect.
6. Connect and unlock your iPhone. Trust the Mac and enable Developer Mode on the phone when required. Select the phone as the run destination and press Run (Command-R).
7. Check Search initial loading/focus, fast query edits, Search/Home switching, login persistence after relaunch, keyboard dismissal, listing photo selection/camera, product scanning, native sharing and opening seller links. Test on Wi-Fi and mobile data.

## Move the verified build to TestFlight

Create WishWave under My Apps in App Store Connect using the same bundle identifier. Choose a device/archive run destination in Xcode (not a simulator), then Product > Archive. In Organizer choose Distribute App > App Store Connect, and follow the upload flow offered by your Xcode version. After processing, add the build to an internal TestFlight group and install it through TestFlight. Provide real beta contact/details and a review login if needed before requesting external beta review. Increment Build for each upload.

## What still needs verification

This is an initial device-test project, not an Apple-approved release. The hosted service must remain reachable; it is not an offline catalogue. Build/sign/upload require Apple's SDK and your developer team. A macOS CI workflow performs an unsigned simulator build. Camera and photo picker use WebKit's native input handling; validate them on a phone. OAuth redirects, payment redirects, downloads and background/resume behavior need device checks. External shopping pages open in Safari's in-app browser and do not share the WKWebView session. Build 315 adds Google/Apple authentication through ASWebAuthenticationSession with proof-bound return tickets. Push notifications and universal links are not implemented here. Store privacy declarations must describe the actual hosted service; moderation, account deletion and review requirements must be audited before external distribution. Do not enable live buying until checkout and shipping are independently verified.

## Camera fix: build 259

This version enables inline camera playback and disables picture-in-picture and AirPlay for the preview. The installed iPhone app must be rebuilt; refreshing the hosted page cannot change WKWebViewConfiguration. Open this updated Xcode project, select your existing signing team and iPhone, then press Command-R. Confirm the target build number is 259. After installation, opening Search’s camera should keep the WishWave capture frame, white shutter, Upload and Rotate controls. Validate actual capture on your iPhone.

## Google and Apple sign-in: build 315

Install the updated iPhone host to enable the native authentication callback. Apple reuses its existing server configuration. Google additionally requires the existing web OAuth client’s secret in the Worker as `GOOGLE_CLIENT_SECRET` and the exact callback `https://api.carsearchapi.workers.dev/auth/native/google/callback` registered as an authorized redirect URI in Google Cloud. See [native sign-in setup and verification](../docs/native-auth-v315.md). No secret belongs in the app or repository.
