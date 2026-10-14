# WishWave account screens and password authentication

Login accepts username/email plus password, with Apple and Google underneath.
Create account collects only email and password; it verifies email before issuing
a session and uses the existing mandatory unique-username step. Existing social
accounts can still sign in normally, or set a password using email recovery.
Passwords are never saved to browser storage. Closing/changing screens ignores
stale responses. Password fields support system password-manager autocomplete.

The additive Worker endpoints are `/auth/password/{config,login,signup,verify,
reset,reset-verify,resend}`. D1 creates credentials, challenges and atomic throttle
tables automatically. Five code attempts, short expiry, single-use transactional
consumption and per-account/IP throttles protect verification. Signup cannot
replace an existing account. Reset revokes earlier sessions via authoritative D1
credential timestamps as well as the existing KV revocation mechanism. Account
deletion removes credentials and challenges. Expired challenges/limits are pruned.

Passwords use random salts and Worker-compatible PBKDF2-SHA256 (100,000 iterations)
with a server-only HMAC pepper. Verification codes also use server-keyed hashes.
The existing SESSION_SECRET is the default pepper, domain-separated from session
and code signatures. Optionally provision AUTH_PASSWORD_PEPPER **before** creating
password accounts; changing either effective pepper requires password recovery for
those accounts. No new secret is required to use the existing configuration.
The Workers iteration cap is a platform limitation; this is not a claim of the
OWASP 600,000-iteration work factor. SESSION_SECRET and RESEND_API_KEY are required.

Validation: Worker syntax, full-app auth client flow and SQLite-backed Worker
checks pass. Tests cover verification/replay, wrong/expired/attempt-exhausted
codes, username login, duplicate-account protection, password reset, old-session
revocation, throttling, resend and no session before verification. Existing gallery
lifecycle check passes. The old keyboard-isolation check has the same background
colour assertion failure on unchanged main and this branch; this change does not
alter its backdrop. Actual iPhone layout and email delivery need deployment testing.

## Deployment

Deploy `findai-worker.js` to the existing `api.carsearchapi.workers.dev` Worker,
retaining its existing DB, CACHE, RESEND_API_KEY and SESSION_SECRET bindings.
Then deploy the frontend. Confirm `/auth/password/config` reports version 244
and enabled true before enabling the new website screens. The existing `wrangler.jsonc` points to this Worker and preserves its DB, CACHE,
AI and media bindings. The Cloudflare dashboard confirms automatic production
builds from Nick5771/carsearch main. Check both deployments after merging;
password requests require the new API version. This session has no direct
Cloudflare connector.
No native Swift changes are needed for this authentication change.

Existing `/privacy` and `/terms` website links return 404. The new signup screen
therefore avoids adding broken agreement links. Publish actual policies before
public release; this change does not invent legal terms.
