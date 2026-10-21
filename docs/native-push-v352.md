# Native iPhone push notifications — build 352

Build 352 adds real Apple Push Notification service (APNs) delivery to the existing notification events. It does not use a local scheduled notification to simulate remote delivery.

## One-time Apple setup

1. In Apple Developer → Certificates, Identifiers & Profiles → Identifiers, select **com.nickfiani.wishwave** and enable **Push Notifications**. If your existing project uses a different bundle identifier, align the app and the server's `topic` constant in `wishwave-native-push.js` before testing.
2. In Keys, create an **Apple Push Notification service** authentication key. Configure it for the environment and topic being tested. A development app installed with Xcode uses Sandbox; TestFlight/App Store uses Production. Record its **Key ID** and your developer **Team ID**, and download its `.p8` private key. If the key only allows one environment, use matching credentials when switching environments.
3. Cloudflare dashboard → Workers & Pages → **api** → Settings → Variables and Secrets: add **APNS_TEAM_ID**, **APNS_KEY_ID**, and **APNS_PRIVATE_KEY** as secrets. The private-key value is the complete `.p8` text including BEGIN/END lines. Save/deploy the Worker through the dashboard. Never commit or paste the private key into app source, GitHub, or chat.
4. Update the local checkout from GitHub. Open `ios/WishWave/WishWave.xcodeproj`, select your Apple signing team, and let automatic signing refresh the provisioning profile with push enabled. Build **352** and run on your iPhone. The project includes the Push Notifications entitlement; a notification-only app does not need the background remote-notification mode.

Apple reference: https://developer.apple.com/documentation/usernotifications/registering-your-app-with-apns
Key setup: https://developer.apple.com/help/account/keys/create-a-private-key/
APNs requests: https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns

## Real device test

1. Sign in to WishWave. Open **Settings → Notifications → Enable device notifications**, then allow the iPhone prompt. The app does not prompt automatically at first launch.
2. Choose **Send test notification**. A real authenticated Worker request is sent to APNs for this signed-in account's device. Success means **Apple accepted** the request, not proof the banner was displayed. Missing credentials, unregistered devices and Apple rejections return errors.
3. Confirm the WishWave banner while the app is open. Repeat with another account on a second device or the website: lock the receiving phone, then send it a message, follow it, or comment on its listing. Check the lock-screen alert and sound. Check iOS Focus/notification settings if Apple accepted a request but no banner appears.
4. Tap an alert with WishWave running, in the background, and terminated. It should open the conversation, profile or listing named in the alert. App authentication and normal access checks still apply.
5. Turn off a notification category, mute the sender/conversation, and block the sender. Confirm the corresponding events do not generate remote alerts. Unblock/re-enable and repeat.
6. Sign out and use the second account to send activity to the former account. This installation must stop receiving it. Sign in as another account on the same phone and confirm alerts go to the new account. Repeat with network available during logout; failed offline logout/unregistration requires a reconnect/account sync before remote delivery can be verified as stopped.
7. Deny permission and confirm the app explains how to enable it in iPhone Settings. Re-enable and return to the app. Token registration should resume.

## Implemented safeguards

- Existing event generation, push preferences, blocked-user checks and mute checks run before both push transports. In-app inbox entries retain their existing behavior.
- Authenticated registration, removal and tests; a test can target only a device registered to that account. Rate-limited API. Device tokens and account bindings are stored in D1, not exposed in status responses.
- Device-token rotation and account changes replace the previous registration for the installation. Unregistered/bad tokens are disabled; network/configuration errors do not pretend delivery succeeded.
- App reads its signing profile's actual APNs environment. Provider tokens are ES256 signed and reused for up to 50 minutes. Apple credentials stay on the Worker.
- Notification URLs are restricted to WishWave's hosted app. Cold-start tap targets wait for the web view to load; app market parameters are retained.
- Native messages include the existing text preview; the user's iOS notification preview settings control lock-screen visibility. No inaccurate icon badge count is set.

## Verification boundaries

Automated checks use generated signing keys, an in-memory database and stubbed Apple responses to verify JWT signatures, environment routing, ownership, preference/block gates, rotation and failures. GitHub's macOS workflow compiles an unsigned simulator app. Neither proves a real Apple device received an alert. Signed device delivery remains unverified until the above Apple setup and phone tests are completed.
