// FindAI Cloudflare Worker — api.carsearchapi.workers.dev
// eBay Browse API + AliExpress Affiliates API (Advanced, real signed calls)
//
// SECRETS now come from environment variables (set in Cloudflare → Settings →
// Variables and Secrets):  ALI_APP_KEY, ALI_APP_SECRET, EBAY_CLIENT_SECRET
// (EBAY_CLIENT_ID is a public identifier, so it stays inline.)

// ── eBay ──────────────────────────────────────────────────────────────────
const EBAY_CLIENT_ID = 'Nicholas-CarSearc-PRD-918432bc3-1cbacdc4'; // public, not secret

// ── AliExpress ────────────────────────────────────────────────────────────
const ALI_GATEWAY     = 'https://api-sg.aliexpress.com/sync';
const ALI_TRACKING_ID = 'default'; // your Portals tracking ID (not secret)

// ── EPN Affiliate ─────────────────────────────────────────────────────────
const EPN_CAMPAIGN_ID = '5339155260';
// Bump this on every search-logic change. It is part of the edge-cache key, so a
// deploy automatically invalidates old cached responses instead of serving stale
// results for 5 minutes. It is also returned in meta, so you can confirm which
// engine is actually live from DevTools rather than guessing.
const ENGINE_VERSION = 'v25-hybrid-ebay-variant-search';
// EPN rotation IDs (mkrid) per marketplace. Only markets where eBay Partner
// Network actually runs a program are listed; countries not here fall back to
// the US rotation so links still work (they just may not attribute commission).
const EPN_MKRID = {
  US: '711-53200-19255-0',
  AU: '705-53470-19255-0',
  UK: '710-53481-19255-0',
  DE: '707-53477-19255-0',
  CA: '706-53473-19255-0',
  FR: '709-53476-19255-0',
  IT: '724-53478-19255-0',
  ES: '1185-53479-19255-0',
  AT: '5221-53469-19255-0',
  BE: '1553-53471-19255-0',
  NL: '1346-53482-19255-0',
  IE: '5282-53468-19255-0',
  CH: '5222-53480-19255-0',
};

function addEpnTracking(itemWebUrl, country = 'US') {
  if (!itemWebUrl) return itemWebUrl;
  try {
    const u = new URL(itemWebUrl);
    u.searchParams.set('mkevt', '1');
    u.searchParams.set('mkcid', '1');
    u.searchParams.set('mkrid', EPN_MKRID[country] || EPN_MKRID.US);
    u.searchParams.set('campid', EPN_CAMPAIGN_ID);
    u.searchParams.set('toolid', '10001');
    u.searchParams.set('customid', `findai_${country.toLowerCase()}`);
    return u.toString();
  } catch (_) {
    return itemWebUrl;
  }
}

// ── CORS ────────────────────────────────────────────────────────────────────
// Locked to our own origins. A wildcard here means any hostile page on the web
// can make credentialed-looking calls to this API from a victim's browser.
const ALLOWED_ORIGINS = new Set([
  'https://findai.ai',
  'https://www.findai.ai',
  'https://api.carsearchapi.workers.dev',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]);

// Base headers used by responses that carry no request context.
const CORS = {
  'Access-Control-Allow-Origin': 'https://findai.ai',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Idempotency-Key, X-Admin-Key',
  'Vary': 'Origin',
  'Content-Type': 'application/json',
};

// Echo back the caller's origin only when it is on the allowlist.
function corsFor(request) {
  let origin = '';
  try { origin = (request && request.headers && request.headers.get('Origin')) || ''; } catch (_) {}
  if (origin && ALLOWED_ORIGINS.has(origin)) return { ...CORS, 'Access-Control-Allow-Origin': origin };
  return CORS;
}

function jsonResp(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, ...extraHeaders } });
}

// Admin/test/debug endpoints (/db-setup, /tracker/debug, /cron-test, /run-emails,
// /send-test, /db-check, /auth/stockx/start) are gated behind a secret key.
// FAIL-CLOSED: if ADMIN_KEY is not set in the Worker's secrets, these routes are
// refused outright. The previous fail-open behaviour meant a missing secret left
// database setup, user-email dumps and manual mail sends open to the internet.
// Prefer the X-Admin-Key header over ?key= — query strings end up in logs,
// browser history and Referer headers.
function adminOK(url, env, request) {
  if (!env || !env.ADMIN_KEY) return false;           // not configured -> locked
  let hdr = '';
  try { hdr = (request && request.headers && request.headers.get('X-Admin-Key')) || ''; } catch (_) {}
  const supplied = hdr || url.searchParams.get('key') || '';
  return timingSafeEqual(supplied, env.ADMIN_KEY);
}

// Constant-time string compare, so an attacker can't discover a secret one
// character at a time by measuring response latency.
function timingSafeEqual(a, b) {
  a = String(a || ''); b = String(b || '');
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ── Sessions ────────────────────────────────────────────────────────────────
// Every user-scoped endpoint used to take the email straight out of the request
// body and trust it, which meant anyone with curl could read or write any
// account's data — and, because the daily cron mails a user their tracked items,
// could inject an attacker-controlled title/image/link into mail sent from our
// own verified domain. Auth now issues a signed token; the email is derived from
// that token server-side and body.email is ignored everywhere.
//
// Token format: base64url(payload).base64url(HMAC-SHA256(payload, SESSION_SECRET))
// Payload: {"e":"<email>","x":<expiry ms>,"v":1}
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;      // 30 days

function b64urlEncode(bytes) {
  let bin = '';
  const arr = bytes instanceof Uint8Array ? bytes : new TextEncoder().encode(String(bytes));
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecodeToString(s) {
  let t = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4) t += '=';
  const bin = atob(t);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(arr);
}

async function sessionHmacKey(env) {
  const secret = (env && env.SESSION_SECRET) || '';
  if (!secret) throw new Error('SESSION_SECRET not set');
  return crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']
  );
}

async function issueSession(env, email) {
  const payload = JSON.stringify({ e: String(email).trim().toLowerCase(), x: Date.now() + SESSION_TTL_MS, v: 1 });
  const p64 = b64urlEncode(new TextEncoder().encode(payload));
  const key = await sessionHmacKey(env);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(p64)));
  return p64 + '.' + b64urlEncode(sig);
}

// Returns the verified lowercase email, or '' if the token is missing, malformed,
// tampered with, or expired. Never throws.
async function emailFromSession(request, env) {
  let token = '';
  try {
    const h = (request.headers.get('Authorization') || '').trim();
    if (/^Bearer\s+/i.test(h)) token = h.replace(/^Bearer\s+/i, '').trim();
  } catch (_) {}
  if (!token || token.indexOf('.') < 0) return '';
  const [p64, s64] = token.split('.');
  if (!p64 || !s64) return '';
  try {
    const key = await sessionHmacKey(env);
    let sigBytes;
    try {
      const raw = b64urlDecodeToString(s64);
      sigBytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) sigBytes[i] = raw.charCodeAt(i) & 0xff;
    } catch (_) { return ''; }
    // Re-sign and compare, rather than trusting a decode round-trip.
    const expect = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(p64)));
    if (b64urlEncode(expect) !== s64) return '';
    const data = JSON.parse(b64urlDecodeToString(p64));
    if (!data || !data.e || !data.x) return '';
    if (Number(data.x) < Date.now()) return '';
    return String(data.e).trim().toLowerCase();
  } catch (e) { logErr('session verify', e); return ''; }
}

// Helper for routes that require a logged-in user.
async function requireUser(request, env) {
  const email = await emailFromSession(request, env);
  if (!email) return { email: '', fail: jsonResp({ error: 'Not signed in' }, 401, { 'Cache-Control': 'no-store' }) };
  return { email, fail: null };
}

// ── Unsubscribe links ───────────────────────────────────────────────────────
// Signed so the one-click opt-out can't be used to unsubscribe other people, or
// to probe whether a given address is on the list.
async function unsubSig(env, email) {
  const key = await sessionHmacKey(env);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('unsub:' + String(email).trim().toLowerCase())));
  return b64urlEncode(sig).slice(0, 32);
}

async function verifyUnsubSig(env, email, sig) {
  try { return timingSafeEqual(await unsubSig(env, email), String(sig || '')); }
  catch (e) { logErr('verifyUnsubSig', e); return false; }
}

async function unsubUrlFor(env, email) {
  const e = String(email).trim().toLowerCase();
  try {
    return 'https://api.carsearchapi.workers.dev/unsubscribe?e=' + encodeURIComponent(e) + '&s=' + encodeURIComponent(await unsubSig(env, e));
  } catch (_) {
    return 'https://api.carsearchapi.workers.dev/unsubscribe?e=' + encodeURIComponent(e);
  }
}

// ── Rate limiting ───────────────────────────────────────────────────────────
// Fixed-window counter in KV, keyed by bucket + client IP. Cheap and good enough
// to stop the things that actually cost money: email bombing through Resend,
// brute-forcing the 6-digit login code, and free-riding on our Workers AI quota.
// Cloudflare's dashboard Rate Limiting rules are a good second layer on top.
function clientIp(request) {
  try {
    return request.headers.get('CF-Connecting-IP')
      || request.headers.get('X-Forwarded-For')
      || 'unknown';
  } catch (_) { return 'unknown'; }
}

// Returns true when the caller is OVER the limit and should be refused.
async function rateLimited(env, request, bucket, limit, windowSec) {
  if (!env || !env.CACHE) return false;               // no KV bound -> don't block
  try {
    const ip = clientIp(request);
    const win = Math.floor(Date.now() / (windowSec * 1000));
    const key = `rl:${bucket}:${ip}:${win}`;
    const cur = parseInt((await env.CACHE.get(key)) || '0', 10) || 0;
    if (cur >= limit) return true;
    await env.CACHE.put(key, String(cur + 1), { expirationTtl: Math.max(60, windowSec + 60) });
    return false;
  } catch (e) { logErr('rateLimited ' + bucket, e); return false; }
}

function tooManyResp(retryAfterSec) {
  return jsonResp({ error: 'Too many requests. Please slow down and try again shortly.' }, 429, {
    'Retry-After': String(retryAfterSec || 60), 'Cache-Control': 'no-store'
  });
}

// Structured error logging so DB/API failures show up in Cloudflare logs instead
// of being swallowed (the exact reason the missing-migration bug was invisible).
function logErr(where, e) {
  try { console.error('[FindAI] ' + where + ':', (e && (e.message || e.toString())) || e); } catch (_) {}
}

// Bound optional network work so one slow marketplace or catalogue never holds
// the entire page hostage. The original promise is caught, so a late rejection
// cannot become an unhandled error after the timeout wins the race.
function promiseWithin(promise, ms, fallback) {
  return Promise.race([
    Promise.resolve(promise).catch(() => fallback),
    new Promise(resolve => setTimeout(() => resolve(fallback), Math.max(1, ms || 1)))
  ]);
}

function currencyFor(country) {
  const MAP = {
    UK: 'GBP', AU: 'AUD', CA: 'CAD', CH: 'CHF', PL: 'PLN',
    SG: 'SGD', HK: 'HKD', MY: 'MYR', PH: 'PHP', TH: 'THB', TW: 'TWD', VN: 'VND',
    DE: 'EUR', FR: 'EUR', IT: 'EUR', ES: 'EUR', AT: 'EUR', BE: 'EUR', NL: 'EUR', IE: 'EUR',
  };
  return MAP[country] || 'USD';
}
function shipCountry(country) {
  return country === 'UK' ? 'GB' : country; // AU, US, DE pass through
}

// Visitor's marketplace from Cloudflare geo: AU→AU, US→US, GB→UK, DE→DE, anything else→US.
function detectCountry(request) {
  const SUPPORTED = {
    US: 'US', AU: 'AU', GB: 'UK', UK: 'UK', DE: 'DE',
    CA: 'CA', FR: 'FR', IT: 'IT', ES: 'ES', AT: 'AT', BE: 'BE',
    NL: 'NL', IE: 'IE', CH: 'CH', PL: 'PL', SG: 'SG', HK: 'HK',
    MY: 'MY', PH: 'PH', TH: 'TH', TW: 'TW', VN: 'VN',
  };
  const geo = (request && request.cf && request.cf.country) ? String(request.cf.country).toUpperCase() : '';
  return SUPPORTED[geo] || 'US';
}

// Homepage pools are pre-warmed for the four biggest markets only (warming all
// 21 every 15 min would blow the eBay daily API quota). Searches always use the
// user's REAL country; only the decorative homepage/preview pools map to the
// nearest warmed region so every visitor still gets an instant homepage.
function homePoolCountry(country) {
  const EUR = { FR: 1, IT: 1, ES: 1, AT: 1, BE: 1, NL: 1, CH: 1, PL: 1 };
  if (country === 'IE') return 'UK';
  if (EUR[country]) return 'DE';
  if (country === 'CA') return 'US';
  if (['SG', 'HK', 'MY', 'PH', 'TH', 'TW', 'VN'].includes(country)) return 'AU';
  return ['US', 'AU', 'UK', 'DE'].includes(country) ? country : 'US';
}

// ── eBay OAuth token ──────────────────────────────────────────────────────
let ebayToken = null;
let ebayTokenExpiry = 0;

async function getEbayToken(env) {
  if (ebayToken && Date.now() < ebayTokenExpiry) return ebayToken;

  const secret = env.EBAY_CLIENT_SECRET;
  const credentials = btoa(`${EBAY_CLIENT_ID}:${secret}`);
  const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`,
    },
    body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
  });

  const data = await res.json();
  if (!data.access_token) throw new Error(`eBay OAuth failed: ${JSON.stringify(data)}`);

  ebayToken = data.access_token;
  ebayTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return ebayToken;
}

// ── eBay Browse API ───────────────────────────────────────────────────────
// Every marketplace the eBay Browse API supports. Search works on ALL of these
// with the same credentials; affiliate commission only exists where EPN_MKRID
// above has an entry (the Asian markets are search-only, no EPN program).
const EBAY_MARKETPLACES = {
  US: 'EBAY_US',
  AU: 'EBAY_AU',
  UK: 'EBAY_GB',
  DE: 'EBAY_DE',
  CA: 'EBAY_CA',
  FR: 'EBAY_FR',
  IT: 'EBAY_IT',
  ES: 'EBAY_ES',
  AT: 'EBAY_AT',
  BE: 'EBAY_BE',
  NL: 'EBAY_NL',
  IE: 'EBAY_IE',
  CH: 'EBAY_CH',
  PL: 'EBAY_PL',
  SG: 'EBAY_SG',
  HK: 'EBAY_HK',
  MY: 'EBAY_MY',
  PH: 'EBAY_PH',
  TH: 'EBAY_TH',
  TW: 'EBAY_TW',
  VN: 'EBAY_VN',
};

const CAR_MAKES = ['toyota','honda','ford','bmw','mercedes','audi','porsche','ferrari',
  'lamborghini','mclaren','volkswagen','vw','mazda','hyundai','kia','subaru','nissan',
  'holden','jeep','chevrolet','dodge','lexus','volvo','tesla','mitsubishi','bentley',
  'rolls-royce','aston martin','maserati','jaguar','land rover','mini','fiat'];
const WATCH_TERMS = ['watch','rolex','omega','cartier','patek','audemars','breitling','tag heuer','iwc','seiko','tudor','hublot'];
const MOTO_TERMS  = ['motorcycle','motorbike','harley','ducati','kawasaki','yamaha bike','suzuki bike','triumph','dirt bike'];
const BOAT_TERMS  = ['boat','yacht','sailboat','catamaran','dinghy','speedboat','pontoon','vessel','jetski'];

// Explicit clothing/accessory words. If the shopper names one of these, do NOT lock the
// search to the shoes category just because a brand like Nike/Jordan/Adidas appears —
// otherwise "Nike Federer shirt" comes back as only shoes. Let the keywords decide.
const APPAREL_RE = /\b(t-?shirts?|tees?|shirts?|polos?|hoodies?|hoody|sweat(?:er|shirt)s?|jumpers?|cardigans?|jerseys?|tracksuits?|windbreakers?|jackets?|coats?|shorts|pants|trousers|leggings|jeans|skirts?|dress(?:es)?|gowns?|vests?|beanies?|caps?|hats?|socks?|scarf|scarves|gloves?|ties?|belts?)\b/i;

function getSortAndCategory(keywords) {
  const l = keywords.toLowerCase();
  if (APPAREL_RE.test(l)) return { sort: 'relevance', category: '', extraKw: '' };
  if (CAR_MAKES.some(m => l.includes(m)))  return { sort: 'relevance', category: '&category_ids=6001',  extraKw: '' };
  if (WATCH_TERMS.some(m => l.includes(m))) return { sort: 'relevance', category: '&category_ids=14324', extraKw: '' };
  if (MOTO_TERMS.some(m => l.includes(m)))  return { sort: 'relevance', category: '&category_ids=6000',  extraKw: '' };
  if (BOAT_TERMS.some(m => l.includes(m)))  return { sort: 'relevance', category: '&category_ids=26429', extraKw: '' };
  if (l.includes('fashion') || l.includes('clothing')) return { sort: 'relevance', category: '&category_ids=11450', extraKw: '' };
  if (l.includes('sneaker') || l.includes('nike') || l.includes('jordan') || l.includes('adidas') || l.includes('yeezy')) return { sort: 'relevance', category: '&category_ids=15709', extraKw: '' };
  if (l.includes('electronic') || l.includes('apple') || l.includes('samsung')) return { sort: 'relevance', category: '&category_ids=58058', extraKw: '' };
  if (l.includes('sport') || l.includes('fitness') || l.includes('gym')) return { sort: 'relevance', category: '&category_ids=888', extraKw: '' };
  if (l.includes('collectible') || l.includes('vintage') || l.includes('antique')) return { sort: 'relevance', category: '&category_ids=1', extraKw: '' };
  return { sort: 'relevance', category: '', extraKw: '' };
}

// Sneaker/streetwear query detector for the Price Tracker — mirrors the
// frontend STOCKX_QUERY_RE. Used to strip AliExpress (replica-ridden for these)
// from tracker results and snapshots.
const TRACKER_SNEAKER_RE = /\b(yeezy|yeezys|jordan|jordans|nike|adidas|dunk|dunks|sneakers?|air\s*force|af1|air\s*max|airmax|new\s*balance|asics|converse|vans|foam\s*runner|slides?|sb\s*dunk|kicks|trainers?|reebok|puma|salomon|hoka|crocs)\b/i;

// A listing whose TITLE says pre-owned/used is used no matter what the eBay
// condition field claims — sellers routinely mis-tag or leave condition blank.
const USED_TITLE_RE = /\b(pre[-\s]?owned|preowned|used|worn|second[-\s]?hand|2nd\s*hand|refurb(?:ished)?)\b/i;
// Multi-item listings ("Hogwarts + Diagon Alley bundle", "job lot of 3 sets")
// are not a price point for ONE set — they distort the median, so keep them out
// of the tracker's price basis.
const BUNDLE_RE = /\b(bundle|joblot|job\s*lot|lot\s+of|bulk|wholesale|multiple\s+sets|\d+\s*sets\b|x\s*[2-9]\b)\b/i;

// LEGO-specific condition fraud. Sellers routinely tag a built or opened set as
// "New" because eBay's condition field is self-reported and nobody checks. The
// eBay condition value alone is therefore not trustworthy for LEGO — the title
// usually gives it away even when the dropdown says New.
const LEGO_OPENED_RE = /\b(built|assembled|constructed|displayed|display\s*model|open(?:ed)?\s*box|box\s*opened|no\s*box|without\s*box|missing\s*box|bags?\s*opened|opened\s*bags?|incomplete|missing\s*(?:pieces?|parts?|bricks?)|part[-\s]?out)\b/i;

// Listings that are NOT the set at all. These are the worst offenders because
// they price far below the real set and so land straight in the Best Price slot:
// a £56 "listing" for a £220 set is an instruction booklet, an empty box, or a
// single minifigure — not the product the user came for.
const LEGO_NOT_THE_SET_RE = /\b(instructions?\s*only|manual\s*only|booklet\s*only|box\s*only|empty\s*box|sticker\s*(?:sheet|only)|parts?\s*only|spare\s*parts?|replacement\s*parts?|minifig(?:ure)?s?\s*only|figure\s*only|no\s*(?:bricks?|parts?|pieces?|set)|poster|print|prints|wall\s*art|canvas|artwork|art\s*print|framed\s*(?:print|picture|art)|picture\s*frame|decal|vinyl|sticker|t[-\s]?shirt|mug|keyring|keychain|catalog(?:ue)?|magazine)\b/i;

// Accessories FOR a set, not the set. These match the same search terms, are
// genuinely new, and sit in a plausible price band, so nothing above catches
// them — a "Premium Wall Mount Display for LEGO 42171" is a real new product at
// a real price that simply isn't the thing the user came to buy.
const LEGO_ACCESSORY_RE = /\b(display\s*(?:case|stand|frame|box|shelf|mount|plaque)|wall\s*mount(?:ed)?|acrylic\s*(?:case|display|box|stand)|perspex|vitrine|led\s*(?:light(?:ing)?)?\s*kit|light(?:ing)?\s*kit|lighting\s*set|stand\s*for|holder\s*for|case\s*for|mount\s*for|compatible\s*with|fits\s+lego|for\s+lego\s+\d{4,7}|dust\s*cover|storage\s*(?:box|case)|baseplate|背景)\b/i;

// Counterfeit LEGO. eBay is full of Chinese knock-offs listed against the real
// set's name and number, priced far below it. These are the worst possible thing
// to put in the Best Price slot: the user gets a box of generic bricks and it is
// our recommendation that sent them there.
//
// The seller's own copy usually gives it away — they cannot say "LEGO" without
// inviting a takedown, so they say "compatible", "generic bricks", or
// "building blocks set".
const LEGO_FAKE_RE = /\b(compatible\s*(?:with|bricks?|blocks?)?|generic\s*(?:bricks?|blocks?|parts?)|non[-\s]?lego|not\s*lego|unbranded|off[-\s]?brand|replica|knock[-\s]?off|building\s*blocks?\s*(?:set|toy|kit)|moc\s*(?:kit|set)?|custom\s*build)\b/i;

// Explicit non-LEGO brand on the listing. Missing is fine — eBay's summary
// often omits it — but "Unbranded" is a declaration, not an omission.
function legoBrandLooksWrong(item){
  const b = String((item && item.brand) || '').trim().toLowerCase();
  if (!b) return false;                 // missing brand -> unknown, allow
  if (/lego/.test(b)) return false;     // contains "lego" anywhere -> fine
  // Reject only brands we KNOW are clones or explicit non-LEGO declarations.
  // eBay populates the brand field inconsistently (sometimes a category, a
  // seller string, or blank), so a blanket "not LEGO -> reject" wrongly nuked
  // genuine listings and emptied whole grids. The title patterns catch the rest.
  const CLONES = ['unbranded','generic','no brand','nobrand','non-lego','not lego','lepin','lele','bela','sluban','decool','sembo','panlos','mould king','mouldking','cada','xingbao','wange','qman','kazi','gudi','pantasy','reobrix','loz','forange','funwhole','molink','built brick','building blocks','compatible'];
  return CLONES.some(c => b.indexOf(c) >= 0);
}

// "<part> only" listings: the dragon out of Gringotts, the minifig out of a
// castle. Brand-new, genuine LEGO, correct set number in the title — and not the
// product the user is trying to buy. The generic "X only" catch is what the
// earlier fixed list of parts missed.
const LEGO_PART_ONLY_RE = /\b(?:[a-z'\u2019\-]+\s+){0,3}only\b(?!\s*(?:one|a\s|few)\b)|\bonly\s+(?:the|from)\b|\bno\s+(?:box|minifig|figures?)\b|\bwithout\s+(?:the\s+)?(?:box|minifigs?|figures?)\b/i;

// A standalone character/creature listing often omits the word "only" — e.g.
// "LEGO Flying Dutchman Minifigure". Keep full-set titles that explicitly say
// they include minifigures, but reject listings whose subject is the figure.
function legoLooksLikeStandalonePart(item) {
  const title = String((item && item.title) || '').toLowerCase();
  const hasPartWord = /\b(minifig(?:ure)?s?|mini[\s-]?figure|figurine|character|doll)\b/.test(title)
    || /\bfigure\b.{0,24}\b(?:only|from|replacement|single)\b/.test(title);
  if (!hasPartWord) return false;
  const fullSetSignal = /\b(complete(?:d)?\s+(?:lego\s+)?set|full\s+set|boxed\s+set|sealed(?:\s+set)?|factory\s+sealed|misb|nisb|new\s+in\s+(?:sealed\s+)?box|unopened|all\s+(?:pieces|parts)\s+included|with\s+(?:all\s+|\d+\s+)?minifig(?:ure)?s?|includes?\s+(?:all\s+|\d+\s+)?minifig(?:ure)?s?)\b/.test(title);
  if (fullSetSignal) return false;
  return true;
}

// A complete, currently-produced set does not sell new for a small fraction of
// its RRP. When we know the RRP and the set is still in production, anything far
// below it is a mis-listed accessory, a parts lot, or the wrong item — regardless
// of what the title or condition field says. Retired sets legitimately trade both
// well above and (occasionally) below RRP, so the floor only applies in-production.
function legoPriceLooksWrong(priceUsd, product){
  if (!product || !priceUsd) return false;
  const retired = String(product.retired || '').toLowerCase();
  if (retired === 'yes' || retired === 'true') return false;   // retired: no floor
  const rrp = Number(String(product.rrp || product.retailPrice || '').replace(/[^0-9.]/g, ''));
  if (!isFinite(rrp) || rrp <= 0) return false;                // no RRP known
  return priceUsd < rrp * 0.4;
}

// Single gate for "is this listing actually a new, complete copy of this set?"
function isCleanNewLegoListing(item, product, marketFloor){
  const title = (item && item.title) || '';
  if (LEGO_NOT_THE_SET_RE.test(title)) return false;
  if (LEGO_ACCESSORY_RE.test(title)) return false;
  if (LEGO_OPENED_RE.test(title)) return false;
  if (LEGO_FAKE_RE.test(title)) return false;
  if (LEGO_PART_ONLY_RE.test(title)) return false;
  if (legoLooksLikeStandalonePart(item)) return false;
  if (legoBrandLooksWrong(item)) return false;
  // eBay conditionId 1000 is "New"; 1500 is "New other (see details)", which for
  // LEGO overwhelmingly means the box was opened.
  const cid = String((item && item.conditionId) || '');
  if (cid && cid !== '1000') return false;
  // Market-value floor — the strongest counterfeit signal we can compute without
  // fetching each listing's full description. A genuine sealed set does not sell
  // for well under half what the set actually trades at. This catches the fakes
  // the title can't (the £146 "Collectors' Edition" whose description, hidden
  // from the search API, admits "NOT an official LEGO product") and, unlike the
  // RRP floor, it works for RETIRED sets because it's measured against real
  // recent sales rather than a list price LEGO no longer charges.
  if (marketFloor && Number(item && item.price) > 0 && Number(item.price) < marketFloor) return false;
  if (legoPriceLooksWrong(Number(item && item.price) || 0, product)) return false;
  return true;
}

async function searchEbay(keywords, country, maxPrice, env, agOnly = false) {
  // Cache eBay responses. Without this, every product-page view and every search
  // hit eBay live, which exhausted the Browse API daily quota (5,000 calls) and
  // returned 429 "Too many requests" — emptying every grid regardless of our
  // filtering. Results are cached 6h per query; on a 429 we serve the last good
  // cached response (kept 48h) rather than showing nothing.
  const ck = 'ebaysearch:' + country + ':' + (maxPrice || '') + ':' + (agOnly ? 'ag' : '') + ':' + String(keywords).toLowerCase().trim();
  const staleKey = ck + ':stale';
  if (env && env.CACHE) {
    try { const hit = await env.CACHE.get(ck, 'json'); if (hit && Array.isArray(hit.items)) return hit; } catch (_) {}
  }
  const result = await searchEbayUncached(keywords, country, maxPrice, env, agOnly);
  if (env && env.CACHE) {
    try {
      if (!result.error && result.items && result.items.length) {
        await env.CACHE.put(ck, JSON.stringify(result), { expirationTtl: 21600 });        // 6h fresh
        await env.CACHE.put(staleKey, JSON.stringify(result), { expirationTtl: 172800 }); // 48h fallback
      } else if (result.error) {
        // eBay failed (likely 429). Serve the last good response if we have one.
        const stale = await env.CACHE.get(staleKey, 'json');
        if (stale && Array.isArray(stale.items) && stale.items.length) {
          return { items: stale.items, total: stale.items.length, error: null, stale: true };
        }
      }
    } catch (_) {}
  }
  return result;
}

async function searchEbayUncached(keywords, country, maxPrice, env, agOnly = false) {
  try {
    const token = await getEbayToken(env);
    const marketplace = EBAY_MARKETPLACES[country] || 'EBAY_US';

    const { sort, category, extraKw } = getSortAndCategory(keywords);
    const fullQuery = extraKw ? `${keywords} ${extraKw}` : keywords;
    // eBay Browse API supports the qualifiedPrograms filter. When agOnly is on, restrict
    // results to listings eligible for the eBay Authenticity Guarantee (verified before
    // delivery) - used by the "spot a fake" SEO pages so no fake shoes/watches/bags appear.
    const filters = [];
    if (maxPrice) filters.push(`price:[..${maxPrice}]`);
    if (agOnly)   filters.push('qualifiedPrograms:{AUTHENTICITY_GUARANTEE}');
    const filterParam = filters.length ? `&filter=${encodeURIComponent(filters.join(','))}` : '';

    const url = `https://api.ebay.com/buy/browse/v1/item_summary/search` +
      `?q=${encodeURIComponent(fullQuery)}` +
      `&limit=200` +
      `&sort=${sort}` +
      category +
      filterParam;

    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': marketplace,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      const err = await res.text();
      return { error: `eBay Browse API ${res.status}: ${err.substring(0, 200)}` };
    }

    const data = await res.json();
    const items = data?.itemSummaries || [];
    const totalResults = data?.total || items.length;

    return {
      items: items.map(item => {
        // Seller markdown ("Was $X, now $Y"). Only count a genuine MARKDOWN treatment as a
        // discount — LIST_PRICE / MINIMUM_ADVERTISED_PRICE aren't real "on sale" signals.
        const mp = item.marketingPrice || {};
        const isMarkdown = mp.priceTreatment === 'MARKDOWN';
        const origPrice  = isMarkdown ? (parseFloat(mp.originalPrice?.value || 0) || 0) : 0;
        const discountPct = isMarkdown ? (parseFloat(mp.discountPercentage || 0) || 0) : 0;
        // AG eligibility comes straight from eBay's qualifiedPrograms array on the search result.
        // It means eBay's Authenticity Guarantee applies to this listing (a third-party
        // authenticator inspects the item before it ships to the buyer). For variation listings
        // it indicates at least one variation qualifies - so we word the badge as "eligible".
        const qPrograms = Array.isArray(item.qualifiedPrograms) ? item.qualifiedPrograms : [];
        const agEligible = qPrograms.includes('AUTHENTICITY_GUARANTEE');
        return {
          source: 'eBay',
          marketplaceId: marketplace,
          itemId:   item.itemId || '',
          title:    (item.title || '').replace(/[\u2014\u2013]/g, '-'),
          price:    parseFloat(item.price?.value || 0) || 0,
          currency: item.price?.currency || 'USD',
          url:      addEpnTracking(item.itemWebUrl || '', country),
          image:    item.image?.imageUrl || item.thumbnailImages?.[0]?.imageUrl || null,
          location: item.itemLocation?.country || '',
          condition: item.condition || '',
          conditionId: item.conditionId || '',
          // Brand and seller location are the two strongest counterfeit tells.
          // eBay's Browse summary exposes brand inconsistently, so we treat a
          // MISSING brand as unknown (allowed) and only reject an explicit
          // non-LEGO brand such as "Unbranded".
          brand: (item.brand || (item.additionalProductIdentities && item.additionalProductIdentities.brand) || ''),
          itemLocationCountry: (item.itemLocation && item.itemLocation.country) || '',
          listingType: item.buyingOptions?.[0] || '',
          buyingOptions: Array.isArray(item.buyingOptions) ? item.buyingOptions : [],
          agEligible,           // true if eBay Authenticity Guarantee applies to this listing
          origPrice,            // seller's "was" price (0 if not a markdown)
          discountPct,          // % off via genuine seller markdown (0 if none)
          // Exact shipping returned by eBay for this marketplace/destination context.
          // A value of 0 is genuine free shipping. Some listings do not expose a
          // fixed amount until checkout; those remain null rather than guessed.
          shipping: (() => {
            const opt = Array.isArray(item.shippingOptions) ? item.shippingOptions[0] : null;
            const sc = opt && opt.shippingCost;
            if (!sc || sc.value == null || !Number.isFinite(Number(sc.value))) return null;
            const cost = Number(sc.value);
            return { cost, free: cost === 0, currency: sc.currency || item.price?.currency || 'USD' };
          })(),
          shippingCost: (() => {
            const opt = Array.isArray(item.shippingOptions) ? item.shippingOptions[0] : null;
            const sc = opt && opt.shippingCost;
            return sc && sc.value != null && Number.isFinite(Number(sc.value)) ? Number(sc.value) : null;
          })(),
          freeShipping: (() => {
            const opt = Array.isArray(item.shippingOptions) ? item.shippingOptions[0] : null;
            const sc = opt && opt.shippingCost;
            return sc && sc.value != null && Number.isFinite(Number(sc.value)) ? Number(sc.value) === 0 : null;
          })()
        };
      }),
      total: totalResults,
    };
  } catch (e) {
    return { error: String(e.message || e) };
  }
}

// ── Hybrid visual product identification ────────────────────────────────────
// Uses eBay's first-party Browse searchByImage endpoint as the live visual
// catalogue, then combines those matches with structured Workers AI label/OCR
// evidence. The visual matches identify the likely product; the exact identity
// is then cross-searched through FindAI's existing marketplace pipeline.
const EBAY_IMAGE_SUPPORTED = new Set(['EBAY_US', 'EBAY_DE', 'EBAY_GB', 'EBAY_AU']);
const HYBRID_SCAN_LIMIT = 50;

function ebayImageSearchMarket(country) {
  const direct = EBAY_MARKETPLACES[country] || 'EBAY_US';
  if (EBAY_IMAGE_SUPPORTED.has(direct)) return { marketplace: direct, country };
  if (country === 'IE') return { marketplace: 'EBAY_GB', country: 'UK' };
  if (['FR','IT','ES','AT','BE','NL','CH','PL'].includes(country)) return { marketplace: 'EBAY_DE', country: 'DE' };
  return { marketplace: 'EBAY_US', country: 'US' };
}

function bytesToBase64(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < arr.length; i += CHUNK) {
    binary += String.fromCharCode(...arr.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function mapEbayImageSummary(item, marketplace, linkCountry) {
  const mp = item && item.marketingPrice || {};
  const isMarkdown = mp.priceTreatment === 'MARKDOWN';
  const origPrice = isMarkdown ? (parseFloat(mp.originalPrice && mp.originalPrice.value || 0) || 0) : 0;
  const discountPct = isMarkdown ? (parseFloat(mp.discountPercentage || 0) || 0) : 0;
  const qPrograms = Array.isArray(item && item.qualifiedPrograms) ? item.qualifiedPrograms : [];
  const shippingOption = Array.isArray(item && item.shippingOptions) ? item.shippingOptions[0] : null;
  const shippingPrice = shippingOption && shippingOption.shippingCost;
  const shippingCost = shippingPrice && shippingPrice.value != null && Number.isFinite(Number(shippingPrice.value))
    ? Number(shippingPrice.value) : null;
  const primaryImage = item && item.image && item.image.imageUrl || '';
  const extraImages = Array.isArray(item && item.additionalImages)
    ? item.additionalImages.map(x => x && x.imageUrl).filter(Boolean) : [];
  const thumbnails = Array.isArray(item && item.thumbnailImages)
    ? item.thumbnailImages.map(x => x && x.imageUrl).filter(Boolean) : [];
  return {
    source: 'eBay',
    marketplaceId: marketplace,
    itemId: item && item.itemId || '',
    title: String(item && item.title || '').replace(/[\u2014\u2013]/g, '-'),
    price: parseFloat(item && item.price && item.price.value || 0) || 0,
    currency: item && item.price && item.price.currency || 'USD',
    url: addEpnTracking(item && item.itemWebUrl || '', linkCountry),
    image: primaryImage || thumbnails[0] || null,
    images: [primaryImage, ...extraImages, ...thumbnails].filter(Boolean),
    location: item && item.itemLocation && item.itemLocation.country || '',
    itemLocationCountry: item && item.itemLocation && item.itemLocation.country || '',
    condition: item && item.condition || '',
    conditionId: item && item.conditionId || '',
    brand: item && (item.brand || item.additionalProductIdentities && item.additionalProductIdentities.brand) || '',
    listingType: item && item.buyingOptions && item.buyingOptions[0] || '',
    buyingOptions: Array.isArray(item && item.buyingOptions) ? item.buyingOptions : [],
    agEligible: qPrograms.includes('AUTHENTICITY_GUARANTEE'),
    origPrice,
    discountPct,
    shipping: shippingCost == null ? null : {
      cost: shippingCost,
      free: shippingCost === 0,
      currency: shippingPrice.currency || item && item.price && item.price.currency || 'USD'
    },
    shippingCost,
    freeShipping: shippingCost == null ? null : shippingCost === 0,
    sellerName: item && item.seller && item.seller.username || '',
    topRatedSeller: !!(item && (item.topRatedBuyingExperience || item.seller && item.seller.feedbackPercentage >= 99)),
    _visualMatch: true
  };
}

async function searchEbayByImage(imageBase64, country, env, limit = HYBRID_SCAN_LIMIT) {
  const clean = String(imageBase64 || '').replace(/^data:[^;]+;base64,/, '').trim();
  if (!clean) return { items: [], total: 0, error: 'No image supplied' };
  try {
    const token = await getEbayToken(env);
    const chosen = ebayImageSearchMarket(country);
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || HYBRID_SCAN_LIMIT));
    const endpoint = 'https://api.ebay.com/buy/browse/v1/item_summary/search_by_image' +
      '?limit=' + safeLimit + '&offset=0';
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': chosen.marketplace,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ image: clean })
    });
    if (!response.ok) {
      const text = await response.text();
      return {
        items: [], total: 0,
        error: `eBay image search ${response.status}: ${text.slice(0, 300)}`,
        marketplace: chosen.marketplace
      };
    }
    const data = await response.json();
    const raw = Array.isArray(data && data.itemSummaries) ? data.itemSummaries : [];
    return {
      items: raw.map((item, index) => ({
        ...mapEbayImageSummary(item, chosen.marketplace, chosen.country),
        _visualRank: index
      })),
      total: Number(data && data.total) || raw.length,
      next: data && data.next || null,
      marketplace: chosen.marketplace,
      error: null
    };
  } catch (error) {
    return { items: [], total: 0, error: String(error && error.message || error) };
  }
}

const STRUCTURED_PRODUCT_VISION_PROMPT = `You identify the exact sellable product AND its exact variant in a shopping photo.
Return ONE valid JSON object only, with no markdown and no prose outside JSON.
Schema:
{"kind":"product|not_product","brand":"","productLine":"","model":"","variant":"","edition":"","generation":"","category":"","concentration":"","size":"","primaryColor":"","secondaryColors":[],"finish":"","material":"","pattern":"","packaging":"","visibleText":[],"exactQuery":"","requiredTerms":[],"variantTerms":[],"confidence":0.0,"description":""}
Rules:
- Transcribe every visible brand, product-line, model, number, edition, generation, size, capacity, concentration and barcode term exactly.
- Never reduce a named product line to only a broad brand or category.
- Distinguish visually similar variants using the strongest available evidence: exact wording, model/style number, edition, generation, colourway, main body colour, material, finish, pattern, shape, packaging and size.
- primaryColor means the main product body's colour, not the background, glare, shadow or a tiny accent. Use secondaryColors only for meaningful product colours.
- For fragrance, distinguish the exact line/flanker, EDP vs EDT vs Parfum, bottle volume, bottle/plate finish and packaging. A line such as Ralph's Club New York must remain Ralph's Club New York, not Ralph Lauren perfume or ordinary Ralph's Club.
- For LEGO, preserve the set number and edition. For electronics, preserve the model, generation, capacity and colour. For sneakers, preserve model, collaboration, colourway and style code. For fashion, preserve material, pattern and named colourway.
- Use only evidence in the image. Do not invent a model, size or variant that cannot be seen. If colour or finish is uncertain because of lighting, leave it blank rather than guessing.
- exactQuery must lead with brand + exact product line/model + edition/generation/variant + concentration/size. Keep it marketplace-friendly and under 18 words.
- requiredTerms must contain exact distinctive words or phrases that an exact listing should preserve, such as "New York", a model number or a collaboration name. Do not use generic words such as product, item, authentic, sale or new.
- variantTerms may contain useful but optional title evidence such as silver, metallic, leather, floral, 256GB or a colourway.
- If this is not a product, set kind to not_product.`;

function rawAiResponse(out) {
  if (typeof out === 'string') return out;
  if (!out || typeof out !== 'object') return String(out == null ? '' : out);
  if (typeof out.response === 'string') return out.response;
  if (typeof out.result === 'string') return out.result;
  if (typeof out.description === 'string') return out.description;
  if (out.response && typeof out.response === 'object') return JSON.stringify(out.response);
  return JSON.stringify(out);
}

function parseLooseJsonObject(value) {
  if (value && typeof value === 'object') return value;
  let text = String(value || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) text = text.slice(start, end + 1);
  try { return JSON.parse(text); } catch (_) { return null; }
}

function cleanIdentityArray(value) {
  if (Array.isArray(value)) return value.map(x => String(x || '').trim()).filter(Boolean).slice(0, 24);
  if (typeof value === 'string') return value.split(/[\n,|]+/).map(x => x.trim()).filter(Boolean).slice(0, 24);
  return [];
}

async function readStructuredShoppingImage(bytes, env) {
  if (!env || !env.AI) return { identity: null, raw: '', error: 'Workers AI binding unavailable' };
  try {
    const out = await env.AI.run(VISION_MODEL, {
      image: bytes,
      prompt: STRUCTURED_PRODUCT_VISION_PROMPT,
      max_tokens: 520
    });
    const raw = rawAiResponse(out).trim();
    const parsed = parseLooseJsonObject(raw);
    if (!parsed) return { identity: null, raw, error: 'Structured vision JSON was not returned' };
    const confidenceRaw = Number(parsed.confidence);
    const confidence = Number.isFinite(confidenceRaw)
      ? Math.max(0, Math.min(1, confidenceRaw > 1 ? confidenceRaw / 100 : confidenceRaw)) : null;
    const identity = {
      kind: String(parsed.kind || 'product').toLowerCase(),
      brand: String(parsed.brand || parsed.manufacturer || '').trim(),
      productLine: String(parsed.productLine || parsed.exactProductName || parsed.modelName || '').trim(),
      model: String(parsed.model || parsed.modelNumber || parsed.sku || parsed.styleCode || parsed.setNumber || '').trim(),
      variant: String(parsed.variant || parsed.colourway || '').trim(),
      edition: String(parsed.edition || parsed.specialEdition || parsed.collaboration || '').trim(),
      generation: String(parsed.generation || parsed.version || '').trim(),
      category: String(parsed.category || parsed.productType || '').trim(),
      concentration: String(parsed.concentration || '').trim(),
      size: String(parsed.size || parsed.volume || parsed.capacity || '').trim(),
      primaryColor: String(parsed.primaryColor || parsed.primaryColour || parsed.color || parsed.colour || '').trim(),
      secondaryColors: cleanIdentityArray(parsed.secondaryColors || parsed.secondaryColours),
      finish: String(parsed.finish || parsed.surfaceFinish || '').trim(),
      material: String(parsed.material || '').trim(),
      pattern: String(parsed.pattern || '').trim(),
      packaging: String(parsed.packaging || parsed.packageType || '').trim(),
      visibleText: cleanIdentityArray(parsed.visibleText || parsed.ocrText || parsed.labelText),
      exactQuery: String(parsed.exactQuery || parsed.query || '').trim(),
      requiredTerms: cleanIdentityArray(parsed.requiredTerms),
      variantTerms: cleanIdentityArray(parsed.variantTerms),
      confidence,
      description: String(parsed.description || '').trim()
    };
    return { identity, raw, error: null };
  } catch (error) {
    return { identity: null, raw: '', error: String(error && error.message || error) };
  }
}

const HYBRID_TITLE_NOISE = new Set([
  'the','and','for','with','from','this','that','sale','selling','listing','item','product','genuine','authentic',
  'original','official','brand','sealed','boxed','box','free','shipping','delivery','fast','new','unused','rare',
  'mens','men','womens','women','unisex','spray','natural','available','stock','in','of','by','a','an','to'
]);
const HYBRID_CATEGORY_WORDS = new Set(['perfume','fragrance','cologne','toy','shoe','shoes','sneaker','sneakers','watch','phone','console']);
const HYBRID_WRONG_FORM_RE = /\b(sample|decant|empty\s*box|box\s*only|bottle\s*only|cap\s*only|miniature|travel\s*size|tester|refill|parts?\s*only|manual\s*only|instruction\s*only|case\s*only)\b/i;

const HYBRID_COLOR_FAMILIES = {
  black:['black','jet black','onyx','midnight'],
  white:['white','ivory','cream'],
  silver:['silver','chrome','metallic silver','silver tone','grey','gray'],
  grey:['grey','gray','charcoal','graphite'],
  gold:['gold','golden','gold tone','champagne'],
  blue:['blue','navy','cobalt','azure','teal'],
  green:['green','olive','lime','emerald','mint'],
  red:['red','burgundy','maroon','crimson'],
  pink:['pink','rose','magenta'],
  purple:['purple','violet','lilac','lavender'],
  brown:['brown','tan','beige','camel','chocolate'],
  orange:['orange','coral','peach'],
  yellow:['yellow','mustard'],
  clear:['clear','transparent','translucent'],
  natural:['natural','natural titanium','desert','desert titanium','sand'],
  starlight:['starlight'],
  midnight:['midnight'],
  rose:['rose gold','rose'],
  multicolor:['multicolor','multi color','multi-colour','rainbow']
};
const HYBRID_FINISH_WORDS = ['metallic','chrome','matte','matt','glossy','satin','frosted','clear','transparent','brushed','polished'];
const HYBRID_MATERIAL_WORDS = ['leather','suede','canvas','mesh','nylon','denim','cotton','wool','silk','metal','steel','aluminium','aluminum','plastic','wood','ceramic','glass','rubber'];
const HYBRID_PATTERN_WORDS = ['striped','stripe','checkered','checked','plaid','floral','camouflage','camo','leopard','zebra','cow print','tie dye','monogram','solid'];

function hybridNormalise(value) {
  return String(value || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function hybridTokens(value, keepNoise = false) {
  const tokens = hybridNormalise(value).split(' ').filter(Boolean);
  return tokens.filter((token, index) => {
    if (keepNoise) return token.length > 1;
    if (token.length <= 1) return false;
    // Keep NEW when it is part of the proper phrase NEW YORK.
    if (token === 'new' && tokens[index + 1] === 'york') return true;
    return !HYBRID_TITLE_NOISE.has(token);
  });
}

function hybridCleanTitle(value) {
  let text = String(value || '')
    .replace(/\b(brand\s*new|100%\s*authentic|genuine|authentic|sealed|free\s*(?:shipping|delivery)|fast\s*shipping|in\s*stock)\b/ig, ' ')
    .replace(/[|•]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.split(/\s+/).slice(0, 18).join(' ');
}

function titleTokenSet(title) {
  return new Set(hybridTokens(title));
}

function chooseConsensusVisualTitle(items) {
  const candidates = (Array.isArray(items) ? items : []).filter(x => x && x.title).slice(0, 12);
  if (!candidates.length) return '';
  let best = candidates[0];
  let bestScore = -Infinity;
  const sets = candidates.map(x => titleTokenSet(x.title));
  for (let i = 0; i < candidates.length; i++) {
    let score = Math.max(0, 18 - i * 1.4);
    for (let j = 0; j < candidates.length; j++) {
      if (i === j) continue;
      const a = sets[i], b = sets[j];
      let intersection = 0;
      for (const token of a) if (b.has(token)) intersection++;
      const union = new Set([...a, ...b]).size || 1;
      score += intersection / union;
    }
    if (score > bestScore) { bestScore = score; best = candidates[i]; }
  }
  return hybridCleanTitle(best.title);
}

function uniqueIdentityParts(parts) {
  const seen = new Set();
  const output = [];
  for (const raw of parts) {
    const text = String(raw || '').trim();
    if (!text) continue;
    const newWords = [];
    for (const word of text.split(/\s+/)) {
      const key = hybridNormalise(word);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      newWords.push(word);
    }
    if (newWords.length) output.push(newWords.join(' '));
  }
  return output.join(' ').replace(/\s+/g, ' ').trim().split(/\s+/).slice(0, 18).join(' ');
}

function buildHybridIdentity(structured, imageItems) {
  const identity = structured && structured.identity ? { ...structured.identity } : {
    kind: 'product', brand: '', productLine: '', model: '', variant: '', edition: '', generation: '',
    category: '', concentration: '', size: '', primaryColor: '', secondaryColors: [], finish: '',
    material: '', pattern: '', packaging: '', visibleText: [], exactQuery: '', requiredTerms: [],
    variantTerms: [], confidence: null, description: ''
  };
  identity.secondaryColors = cleanIdentityArray(identity.secondaryColors);
  identity.visibleText = cleanIdentityArray(identity.visibleText);
  identity.requiredTerms = cleanIdentityArray(identity.requiredTerms);
  identity.variantTerms = cleanIdentityArray(identity.variantTerms);

  const consensusTitle = chooseConsensusVisualTitle(imageItems);
  const structuredParts = [
    identity.brand, identity.productLine, identity.model, identity.edition, identity.generation,
    identity.variant, identity.concentration, identity.size
  ];
  let query = uniqueIdentityParts(structuredParts);
  const structuredSpecific = hybridTokens(query).filter(t => !HYBRID_CATEGORY_WORDS.has(t));
  if (structuredSpecific.length < 2 && identity.exactQuery) query = hybridCleanTitle(identity.exactQuery);

  // eBay's visual matches are supporting evidence, not the authority. Only add
  // consensus terms that are also visible/structured evidence or overwhelmingly
  // repeated across the visual candidates.
  const top = (Array.isArray(imageItems) ? imageItems : []).slice(0, 10);
  const counts = new Map();
  for (const item of top) {
    const seen = new Set(hybridTokens(item && item.title));
    for (const token of seen) counts.set(token, (counts.get(token) || 0) + 1);
  }
  const threshold = Math.max(2, Math.ceil(top.length * 0.4));
  const evidenceSet = new Set(hybridTokens([
    query, identity.exactQuery, identity.productLine, identity.model, identity.edition, identity.generation,
    identity.variant, identity.primaryColor, ...(identity.secondaryColors || []), identity.finish,
    identity.material, identity.pattern, ...(identity.visibleText || []), ...(identity.requiredTerms || []),
    ...(identity.variantTerms || [])
  ].join(' '), true));
  const consensusExtras = hybridTokens(consensusTitle, true).filter(token => {
    const count = counts.get(token) || 0;
    if (token === 'new' && !(counts.get('york') >= threshold)) return false;
    if (HYBRID_TITLE_NOISE.has(token) && token !== 'new') return false;
    return count >= threshold && (evidenceSet.has(token) || count >= Math.ceil(top.length * 0.7));
  });
  query = uniqueIdentityParts([query, consensusExtras.join(' ')]);

  if (hybridTokens(query).filter(t => !HYBRID_CATEGORY_WORDS.has(t)).length < 2) {
    query = consensusTitle || hybridCleanTitle(identity.exactQuery || identity.description || '');
  }
  if (identity.category && !hybridNormalise(query).includes(hybridNormalise(identity.category))) {
    query = uniqueIdentityParts([query, identity.category]);
  }

  identity.exactQuery = query;
  if (!identity.productLine && consensusTitle) identity.productLine = consensusTitle;
  if (!identity.requiredTerms.length) {
    identity.requiredTerms = [
      identity.productLine, identity.model, identity.edition, identity.generation
    ].filter(Boolean).slice(0, 6);
  }
  if (!identity.variantTerms.length) {
    identity.variantTerms = [
      identity.variant, identity.primaryColor, ...(identity.secondaryColors || []),
      identity.finish, identity.material, identity.pattern, identity.size, identity.concentration
    ].filter(Boolean).slice(0, 10);
  }
  return { identity, consensusTitle, query };
}

function extractConcentration(value) {
  const text = hybridNormalise(value);
  if (/\beau de parfum\b|\bedp\b/.test(text)) return 'edp';
  if (/\beau de toilette\b|\bedt\b/.test(text)) return 'edt';
  if (/\beau de cologne\b|\bedc\b/.test(text)) return 'edc';
  if (/\bparfum\b|\bextrait\b/.test(text)) return 'parfum';
  return '';
}

function extractVolumeMl(value) {
  const text = String(value || '').toLowerCase();
  const ml = text.match(/\b(\d{1,4}(?:\.\d+)?)\s*ml\b/i);
  if (ml) return Math.round(Number(ml[1]));
  const oz = text.match(/\b(\d(?:\.\d{1,2})?)\s*(?:fl\s*)?oz\b/i);
  if (oz) return Math.round(Number(oz[1]) * 29.5735);
  return 0;
}

function hybridListingKey(item) {
  const id = String(item && (item.itemId || item.id || item.listingId) || '').trim();
  if (id) return String(item && item.source || '') + ':' + id;
  const url = String(item && (item.url || item.itemWebUrl || '') || '').replace(/[?#].*$/, '');
  if (url) return url;
  return hybridNormalise(item && item.title) + '|' + String(item && item.price || '');
}

function hybridPhrasePresent(title, term) {
  const hay = hybridNormalise(title);
  const needle = hybridNormalise(term);
  if (!needle) return false;
  const hayTokens = hay.split(' ').filter(Boolean);
  const tokens = needle.split(' ').filter(Boolean);
  if (tokens.length === 1) return hayTokens.includes(tokens[0]);
  if (hay.includes(needle)) return true;
  const haySet = new Set(hayTokens);
  return tokens.every(token => haySet.has(token));
}

function requiredTermStats(title, identity) {
  const raw = cleanIdentityArray(identity && identity.requiredTerms);
  const terms = raw.filter(term => {
    const norm = hybridNormalise(term);
    return norm && !HYBRID_CATEGORY_WORDS.has(norm) && !HYBRID_TITLE_NOISE.has(norm);
  });
  if (!terms.length) return { total: 0, matched: 0, missing: [], coverage: 1 };
  const missing = terms.filter(term => !hybridPhrasePresent(title, term));
  return {
    total: terms.length,
    matched: terms.length - missing.length,
    missing,
    coverage: (terms.length - missing.length) / terms.length
  };
}

function canonicalColorFamilies(value) {
  const text = hybridNormalise(value);
  const found = new Set();
  for (const [family, aliases] of Object.entries(HYBRID_COLOR_FAMILIES)) {
    if (aliases.some(alias => hybridPhrasePresent(text, alias))) found.add(family);
  }
  // Silver and grey overlap visually; treat them as compatible, not conflicting.
  if (found.has('silver')) found.add('grey');
  if (found.has('grey') && /\bsilver|chrome|metallic\b/.test(text)) found.add('silver');
  return found;
}

function wordsPresent(value, words) {
  const text = hybridNormalise(value);
  return new Set(words.filter(word => hybridPhrasePresent(text, word)).map(hybridNormalise));
}

function variantComparison(title, identity) {
  const targetEvidence = [
    identity && identity.variant, identity && identity.primaryColor,
    ...(identity && identity.secondaryColors || []), identity && identity.finish,
    identity && identity.material, identity && identity.pattern,
    ...(identity && identity.variantTerms || [])
  ].join(' ');
  const primaryColors = canonicalColorFamilies(identity && identity.primaryColor || '');
  const targetColors = canonicalColorFamilies(targetEvidence);
  const listingColors = canonicalColorFamilies(title);
  let reward = 0;
  let penalty = 0;
  const conflicts = [];

  if (listingColors.size && (primaryColors.size || targetColors.size)) {
    const primaryOverlap = [...listingColors].filter(color => primaryColors.has(color));
    const anyOverlap = [...listingColors].filter(color => targetColors.has(color));
    if (primaryColors.size && !primaryOverlap.length) {
      penalty += 62;
      conflicts.push('colour');
    } else if (anyOverlap.length) {
      reward += 22;
    }
  }

  const compareWordGroup = (words, label, matchReward, conflictPenalty) => {
    const targets = wordsPresent(targetEvidence, words);
    const listings = wordsPresent(title, words);
    if (!targets.size || !listings.size) return;
    const overlap = [...listings].some(word => targets.has(word));
    if (overlap) reward += matchReward;
    else {
      penalty += conflictPenalty;
      conflicts.push(label);
    }
  };
  compareWordGroup(HYBRID_FINISH_WORDS, 'finish', 12, 34);
  compareWordGroup(HYBRID_MATERIAL_WORDS, 'material', 10, 28);
  compareWordGroup(HYBRID_PATTERN_WORDS, 'pattern', 14, 38);

  const optional = cleanIdentityArray(identity && identity.variantTerms);
  for (const term of optional) {
    if (hybridPhrasePresent(title, term)) reward += 9;
  }
  return { reward, penalty, conflicts };
}

function listingMatchDiagnostics(item, identity, query) {
  const title = String(item && item.title || '');
  const required = requiredTermStats(title, identity);
  const variant = variantComparison(title, identity);
  const targetConcentration = extractConcentration([query, identity && identity.concentration].join(' '));
  const listingConcentration = extractConcentration(title);
  const concentrationConflict = !!(targetConcentration && listingConcentration && targetConcentration !== listingConcentration);
  const targetVolume = extractVolumeMl([query, identity && identity.size].join(' '));
  const listingVolume = extractVolumeMl(title);
  const volumeConflict = !!(targetVolume && listingVolume && Math.abs(targetVolume - listingVolume) > 10);
  const wrongForm = HYBRID_WRONG_FORM_RE.test(title) &&
    !HYBRID_WRONG_FORM_RE.test(hybridNormalise([
      query, identity && identity.variant, identity && identity.packaging,
      identity && identity.visibleText && identity.visibleText.join(' ')
    ].join(' ')));
  const exactRequired = required.total === 0 || required.coverage === 1;
  const exact = exactRequired && !variant.conflicts.length && !concentrationConflict && !volumeConflict && !wrongForm;
  const possible = !exact && required.coverage >= 0.67 && variant.conflicts.length === 0 &&
    !concentrationConflict && !wrongForm;
  return { required, variant, concentrationConflict, volumeConflict, wrongForm, exact, possible };
}

function scoreHybridListing(item, identity, query) {
  const title = String(item && item.title || '');
  const titleSet = new Set(hybridTokens(title, true));
  const queryTokens = hybridTokens(query).filter(t => !HYBRID_CATEGORY_WORDS.has(t));
  const productLineTokens = hybridTokens(identity && identity.productLine || '').filter(t => !HYBRID_CATEGORY_WORDS.has(t));
  const modelTokens = hybridTokens(identity && identity.model || '', true);
  const brandTokens = hybridTokens(identity && identity.brand || '');
  let score = item && item._visualMatch ? Math.max(0, 55 - Number(item._visualRank || 0) * 2.3) : 0;
  const coverage = tokens => tokens.length ? tokens.filter(t => titleSet.has(t)).length / tokens.length : 0;
  score += coverage(queryTokens) * 82;
  score += coverage(productLineTokens) * 92;
  score += coverage(modelTokens) * 96;
  score += coverage(brandTokens) * 28;
  if (identity && identity.productLine && hybridNormalise(title).includes(hybridNormalise(identity.productLine))) score += 62;
  if (identity && identity.model && hybridNormalise(title).includes(hybridNormalise(identity.model))) score += 58;

  const diagnostics = listingMatchDiagnostics(item, identity, query);
  score += diagnostics.required.matched * 34;
  score -= diagnostics.required.missing.length * 62;
  score += diagnostics.variant.reward;
  score -= diagnostics.variant.penalty;

  const targetConcentration = extractConcentration([query, identity && identity.concentration].join(' '));
  const listingConcentration = extractConcentration(title);
  if (targetConcentration && listingConcentration) score += targetConcentration === listingConcentration ? 30 : -110;
  const targetVolume = extractVolumeMl([query, identity && identity.size].join(' '));
  const listingVolume = extractVolumeMl(title);
  if (targetVolume && listingVolume) {
    const diff = Math.abs(targetVolume - listingVolume);
    score += diff <= 3 ? 24 : diff <= 10 ? 4 : -52;
  }
  if (diagnostics.wrongForm) score -= 125;
  if (diagnostics.exact) score += 72;
  else if (diagnostics.possible) score += 24;
  return { score, diagnostics };
}

function mergeAndRankHybridListings(imageItems, crossItems, identity, query) {
  const merged = [];
  const seen = new Set();
  for (const item of [...(imageItems || []), ...(crossItems || [])]) {
    if (!item || !item.title || !(Number(item.price) > 0)) continue;
    const key = hybridListingKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  const scored = merged.map(item => {
    const result = scoreHybridListing(item, identity, query);
    const tier = result.diagnostics.exact ? 'exact' : result.diagnostics.possible ? 'possible' : 'related';
    return { item: { ...item, _matchTier: tier, _matchScore: Math.round(result.score) }, score: result.score, tier };
  }).sort((a, b) => b.score - a.score);

  const exact = scored.filter(entry => entry.tier === 'exact');
  const possible = scored.filter(entry => entry.tier === 'possible');
  const related = scored.filter(entry => entry.tier === 'related');
  return {
    items: [...exact, ...possible, ...related].map(entry => entry.item).slice(0, 100),
    exactCount: exact.length,
    possibleCount: possible.length,
    relatedCount: related.length
  };
}

async function runHybridVisionSearch({ imageBase64, bytes, country, userMsg, env }) {
  const [ebaySettled, visionSettled] = await Promise.allSettled([
    searchEbayByImage(imageBase64, country, env, HYBRID_SCAN_LIMIT),
    readStructuredShoppingImage(bytes, env)
  ]);
  const ebay = ebaySettled.status === 'fulfilled'
    ? ebaySettled.value : { items: [], total: 0, error: String(ebaySettled.reason || '') };
  const structured = visionSettled.status === 'fulfilled'
    ? visionSettled.value : { identity: null, raw: '', error: String(visionSettled.reason || '') };
  const built = buildHybridIdentity(structured, ebay.items || []);
  const identity = built.identity;
  const query = String(built.query || '').trim();

  if ((!query || identity.kind === 'not_product') && !(ebay.items && ebay.items.length)) {
    return {
      reply: 'I could not identify that exact product. Try the front label or barcode.',
      query: '', items: [], listings: [], kind: identity.kind || 'not_product',
      confidence: identity.confidence,
      meta: { imageSearchError: ebay.error || null, visionError: structured.error || null }
    };
  }

  let cross = { items: [], meta: {} };
  if (query) {
    try { cross = await searchListings(query, '', country, env); }
    catch (error) { cross = { items: [], meta: { error: String(error && error.message || error) } }; }
  }
  const ranking = mergeAndRankHybridListings(ebay.items || [], cross.items || [], identity, query);
  const ranked = ranking.items;
  const confidence = identity.confidence != null
    ? identity.confidence
    : (ebay.items && ebay.items.length >= 5 ? 0.82 : ebay.items && ebay.items.length ? 0.68 : null);

  return {
    reply: query ? `Matched ${query}` : 'Matched visually similar listings',
    query,
    exactQuery: query,
    product: query,
    productName: query,
    title: query,
    brand: identity.brand || '',
    productLine: identity.productLine || '',
    exactProductName: identity.productLine || '',
    model: identity.model || '',
    variant: identity.variant || '',
    edition: identity.edition || '',
    generation: identity.generation || '',
    primaryColor: identity.primaryColor || '',
    secondaryColors: identity.secondaryColors || [],
    finish: identity.finish || '',
    material: identity.material || '',
    pattern: identity.pattern || '',
    packaging: identity.packaging || '',
    variantTerms: identity.variantTerms || [],
    category: identity.category || '',
    concentration: identity.concentration || '',
    size: identity.size || '',
    volume: identity.size || '',
    visibleText: identity.visibleText || [],
    requiredTerms: identity.requiredTerms || [],
    confidence,
    items: ranked,
    listings: ranked,
    country,
    kind: 'product',
    meta: {
      ...(cross.meta || {}),
      scanner: 'hybrid-ebay-image-ocr-variant-v2',
      exactMatchCount: ranking.exactCount,
      possibleMatchCount: ranking.possibleCount,
      relatedMatchCount: ranking.relatedCount,
      ebayImageMarketplace: ebay.marketplace || null,
      ebayVisualMatches: (ebay.items || []).length,
      ebayVisualTotal: ebay.total || 0,
      imageSearchError: ebay.error || null,
      visionError: structured.error || null,
      consensusTitle: built.consensusTitle || '',
      exactQuery: query,
      userHint: String(userMsg || '').slice(0, 160)
    }
  };
}

// ── AliExpress signing (HMAC-SHA256, sign_method=sha256) ────────────────────
// crypto.subtle in Workers does NOT support MD5, so we use the sha256 method:
//   1. add system params (app_key, method, sign_method, timestamp(ms), v)
//   2. sort ALL params by ASCII key
//   3. build string = key1value1key2value2...  (no separators)
//   4. sign = HMAC-SHA256(string, APP_SECRET) as UPPERCASE hex
async function hmacSha256Hex(message, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sigBuf)].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

async function aliSignedCall(method, businessParams, env) {
  const params = {
    app_key: env.ALI_APP_KEY,
    method,
    sign_method: 'sha256',
    timestamp: String(Date.now()), // milliseconds
    v: '2.0',
    ...businessParams,
  };

  const sortedKeys = Object.keys(params).sort();
  const baseString = sortedKeys.map(k => `${k}${params[k]}`).join('');
  params.sign = await hmacSha256Hex(baseString, env.ALI_APP_SECRET);

  const body = new URLSearchParams(params).toString();
  const res = await fetch(ALI_GATEWAY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body,
  });
  return res.json();
}

// Dig the product array out of AliExpress's nested response (shape varies)
function extractAliProducts(data) {
  if (!data || typeof data !== 'object') return { products: [], error: 'empty response' };

  if (data.error_response) {
    const e = data.error_response;
    return { products: [], error: `Ali error ${e.code || ''} ${e.sub_msg || e.msg || JSON.stringify(e)}` };
  }

  const respKey = Object.keys(data).find(k => k.endsWith('_response'));
  const root   = respKey ? data[respKey] : data;
  const rr     = root?.resp_result || root;
  const result = rr?.result || rr;

  let products = result?.products?.product ?? result?.products ?? [];
  if (!Array.isArray(products)) products = products ? [products] : [];

  const respCode = rr?.resp_code;
  if (respCode && respCode !== 200 && products.length === 0) {
    return { products: [], error: `Ali resp_code ${respCode}: ${rr?.resp_msg || ''}` };
  }
  return { products, error: null };
}

function mapAliProduct(p, country) {
  const price = parseFloat(
    p.target_sale_price ?? p.sale_price ?? p.target_original_price ?? 0
  ) || 0;
  return {
    source: 'AliExpress',
    itemId: String(p.product_id || p.product_id_str || ''),
    title:  (p.product_title || '').replace(/[\u2014\u2013]/g, '-'),
    price,
    currency: p.target_sale_price_currency || currencyFor(country),
    url:    p.promotion_link || p.product_detail_url || '',
    image:  p.product_main_image_url || null,
    location: 'CN',
    condition: 'New',
    listingType: 'FIXED_PRICE',
  };
}

async function searchAliExpress(keywords, country, env, limit = 12) {
  try {
    const business = {
      keywords,
      page_no: '1',
      page_size: String(Math.min(limit, 50)),
      target_currency: currencyFor(country),
      target_language: 'EN',
      tracking_id: ALI_TRACKING_ID,
      ship_to_country: shipCountry(country),
      sort: 'LAST_VOLUME_DESC', // most-ordered first ≈ most popular
    };
    const data = await aliSignedCall('aliexpress.affiliate.product.query', business, env);
    const { products, error } = extractAliProducts(data);
    if (error) return { items: [], error, raw: data };
    const items = products.map(p => mapAliProduct(p, country)).filter(i => i.url && i.title);
    return { items, total: items.length, error: null };
  } catch (e) {
    return { items: [], error: String(e.message || e) };
  }
}

// Fisher–Yates shuffle (non-mutating)
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Build a deduped pool (image + tracked link only) from an array of search results
function poolFrom(results) {
  const pool = [], seen = new Set();
  for (const r of results) {
    for (const it of (r.items || [])) {
      if (it.image && it.url && !seen.has(it.itemId)) { seen.add(it.itemId); pool.push(it); }
    }
  }
  return pool;
}

// Homepage featured pools: a pool of Pop Mart / Labubu items + a pool from a
// second category. The front-end caches these and rotates through them so the
// two featured cards refresh independently and move around.
//   ↓↓↓ To change the second category, edit OTHER_TERMS below ↓↓↓
async function aliHomepagePools(env, country = 'AU') {
  const POPMART_TERMS = ['labubu doll', 'labubu the monsters figure']; // the actual Labubu figure, not keychains/accessories
  const OTHER_TERMS   = ['sneakers', 'running shoes']; // ← slot 2: very popular shoes (Ali sorts by most-ordered)

  const [popRes, otherRes] = await Promise.all([
    Promise.all(POPMART_TERMS.map(t => searchAliExpress(t, country, env, 20).catch(() => ({ items: [] })))),
    Promise.all(OTHER_TERMS.map(t   => searchAliExpress(t, country, env, 20).catch(() => ({ items: [] })))),
  ]);

  return {
    popmart: shuffle(poolFrom(popRes)).slice(0, 10),
    other:   shuffle(poolFrom(otherRes)).slice(0, 10),
  };
}

// Homepage preview searches. These run server-side and the combined pool is
// cached at the edge (see the ?previews=1 route) so the homepage loads from ONE
// fast call instead of 9–16 live searches per visit. The front-end shuffles the
// returned pool client-side, so each visitor still sees a fresh-looking grid.
//   ↓↓↓ Edit this list to change what the homepage features ↓↓↓
const PREVIEW_QUERIES = [
  // Sneakers — Yeezy 350 only, Dunks, Jordan 1 only
  'yeezy 350 v2', 'nike dunk low',
  'air jordan 1 high og', 'travis scott jordan 1', 'off white jordan 1',
  // Streetwear
  'supreme box logo hoodie', 'bape shark hoodie',
  // Bags
  'louis vuitton bag',
  // Watches (MoonSwatch = the Omega x Swatch; Royal Oak = "normal" AP)
  'rolex daytona', 'rolex submariner', 'omega swatch moonswatch', 'audemars piguet royal oak',
  // Tech
  'ps5 console', 'airpods max',
  // Jewellery + collectibles
  'cartier love bracelet', 'pokemon charizard psa 10',
];

// ── Query understanding (colour / price ceiling / core product words) ───────
const COLOR_WORDS = ['red','orange','yellow','green','blue','navy','teal','turquoise','cyan',
  'purple','violet','magenta','pink','rose','black','white','cream','beige','tan','khaki',
  'brown','grey','gray','gold','silver','bronze','maroon'];

// Some product nouns show up under different words in messy AliExpress titles.
const TOKEN_SYNONYMS = {
  shirt: ['shirt','tee','tshirt','t-shirt'],
  tee: ['tee','tshirt','t-shirt','shirt'],
  tshirt: ['tshirt','t-shirt','tee','shirt'],
  't-shirt': ['t-shirt','tshirt','tee','shirt'],
  shoe: ['shoe','sneaker','trainer','footwear'],
  shoes: ['shoe','sneaker','trainer','footwear'],
  sneaker: ['sneaker','shoe','trainer'],
  sneakers: ['sneaker','shoe','trainer'],
  phone: ['phone','smartphone','mobile'],
  hoodie: ['hoodie','sweatshirt','pullover'],
  sweater: ['sweater','jumper','pullover','knit'],
  jumper: ['jumper','sweater','pullover','knit'],
  jacket: ['jacket','coat'],
  bag: ['bag','handbag','backpack','tote','purse'],
  pants: ['pant','trouser'],
  trousers: ['trouser','pant'],
  dress: ['dress','gown'],
};

// Words that carry no product meaning, so they aren't required to appear in titles.
const FILLER_WORDS = new Set(['find','me','a','an','the','some','please','show','get','got',
  'want','wanted','looking','look','for','i','im',"i'm",'need','needed','any','of','with',
  'that','this','is','are','to','my','can','you','search','searching','list','listing',
  'listings','item','items','product','products','buy','cheap','cheapest','best','top','good',
  'great','nice','new','latest','cool','around','about','something','stuff','things','thing',
  'under','below','than','less','max','maximum','dollars','dollar','aud','usd','price','priced',
  'costing','cost','only','just']);

function parseQuery(q) {
  const lower = ' ' + q.toLowerCase().replace(/[^a-z0-9$.\s-]/g, ' ') + ' ';
  let parsedMax = 0;
  const m = lower.match(/(?:under|below|less\s+than|cheaper\s+than|max|maximum|up\s+to|<)\s*\$?\s*([\d,]+(?:\.\d+)?)/);
  if (m) parsedMax = parseFloat(m[1].replace(/,/g, '')) || 0;

  const colors = COLOR_WORDS.filter(c => new RegExp(`\\b${c}\\b`).test(lower));

  const coreTokens = lower.split(/\s+/)
    .map(w => w.trim())
    .filter(w => w.length >= 3 && !FILLER_WORDS.has(w) && !colors.includes(w) && !/^\$?[\d,.]+$/.test(w));

  return { colors, coreTokens, parsedMax };
}

// "labubu under 500" → "labubu" : strip price phrases so the marketplace query stays clean.
function stripPricePhrases(q) {
  return q
    .replace(/(?:under|below|less\s+than|cheaper\s+than|max|maximum|up\s+to|<)\s*\$?\s*[\d,]+(?:\.\d+)?(?:\s*(?:dollars?|aud|usd))?/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Map colloquial sneaker/product slang to the explicit product name a marketplace expects,
// so the search doesn't misfire. e.g. "air forces" colloquially means the Nike Air Force 1
// SNEAKER — without this it matches Royal Air Force militaria on eBay. Only rewrites when the
// shopper clearly isn't asking for the military item (no "royal"/"raf"/"rank"/"badge").
function normalizeKeywords(kw) {
  let s = ' ' + String(kw || '') + ' ';
  const meansMilitary = /\b(royal|raf|rank|rank\s*slide|slides?|badge|insignia|patch|crest|regiment|squadron|uniform)\b/i.test(s);
  if (!meansMilitary) {
    // "air force ones / air force 1s / af1 / air forces / air force" → Nike Air Force 1
    s = s.replace(/\bair\s?force\s?(ones|one|1s|1)\b/gi, ' nike air force 1 ')
         .replace(/\baf\s?1s?\b/gi, ' nike air force 1 ')
         .replace(/\bair\s?forces\b/gi, ' nike air force 1 ');
    if (/\bair\s?force\b/i.test(s) && !/nike air force 1/i.test(s)) {
      s = s.replace(/\bair\s?force\b/gi, ' nike air force 1 ');
    }
    s = s.replace(/\bnike\s+nike\b/gi, 'nike'); // collapse if the user already said "nike"
  }
  // A couple of other common shorthands that help eBay land the right item.
  s = s.replace(/\bjordan\s?(ones|one|1s|1)\b/gi, ' air jordan 1 ')
       .replace(/\bnike\s+air jordan\b/gi, 'air jordan');
  return s.replace(/\s+/g, ' ').trim();
}

// Popular brands/products people actually search — used to gently fix typos so a
// misspelling like "dior suavage" still finds the 900+ "sauvage" listings instead of 2.
const KNOWN_TERMS = ['sauvage','aventus','creed','dior','gucci','prada','versace','balenciaga',
  'givenchy','chanel','louis','vuitton','hermes','burberry','fendi','valentino','moncler',
  'nike','adidas','yeezy','jordan','puma','reebok','converse','asics','samba','gazelle',
  'rolex','omega','cartier','patek','audemars','breitling','tudor','seiko','tissot','hublot',
  'labubu','popmart','smiski','pokemon','charizard','funko',
  'apple','iphone','ipad','macbook','airpods','samsung','galaxy','playstation','nintendo',
  'supreme','bape','stussy','carhartt','patagonia','pandora','swarovski','tiffany'];

// Levenshtein edit distance (bails early when the words are clearly far apart).
function editDistance(a, b) {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 2) return 99;
  const dp = Array.from({ length: m + 1 }, (_, i) => { const row = new Array(n + 1).fill(0); row[0] = i; return row; });
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

// Fix obvious typos word-by-word. Conservative on purpose: only touches words 5+ chars long
// that aren't already a known term, and only swaps when there's a single clearly-closest
// known brand sharing the same first letter within ~2 edits. Exact/unknown words pass through.
function correctSpelling(kw) {
  const knownSet = new Set(KNOWN_TERMS);
  return String(kw || '').split(/\s+/).map(w => {
    const lw = w.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (lw.length < 5 || knownSet.has(lw)) return w;
    let best = null, bestD = 99, ties = 0;
    for (const term of KNOWN_TERMS) {
      if (term[0] !== lw[0] || Math.abs(term.length - lw.length) > 1) continue; // typos rarely change the first letter or length much
      const d = editDistance(lw, term);
      if (d < bestD) { bestD = d; best = term; ties = 1; }
      else if (d === bestD) ties++;
    }
    return (best && bestD > 0 && bestD <= 2 && ties === 1) ? best : w; // only swap on a single unambiguous near-miss
  }).join(' ');
}

function titleHasColor(t, color) {
  if (color === 'grey' || color === 'gray') return t.includes('grey') || t.includes('gray');
  return t.includes(color);
}
function titleHasToken(t, token) {
  return (TOKEN_SYNONYMS[token] || [token]).some(s => t.includes(s));
}
// True only if the title contains every colour AND every core word the user asked for.
function matchesQuery(item, parsed) {
  const t = (item.title || '').toLowerCase();
  if (!t) return false;
  for (const c of parsed.colors)       if (!titleHasColor(t, c)) return false;
  for (const tok of parsed.coreTokens) if (!titleHasToken(t, tok)) return false;
  return true;
}

// ── Shared search: eBay smart-fallback + AliExpress + filter + interleave ───
// Used by BOTH the /search path and the AI chat assistant so they behave identically.
// Builds progressively broader versions of a query: exact first, then with year +
// condition words stripped (e.g. "lego harry potter 2002 brand new sealed" → "lego harry potter"),
// then the core first words. Used to fill the page when an exact phrase is too narrow.
function broadenQueries(keywords){
  const words = String(keywords||'').trim().split(/\s+/).filter(Boolean);
  // Condition words + intent/quality adjectives ("cheap", "best"...) — these rarely appear
  // in real listing titles, so a query like "cheap yeezys" can come back empty. We keep the
  // exact phrase as tier 0, but ALSO build a cleaned tier ("yeezys") that runs in parallel
  // and fills the page when the literal phrase is too narrow.
  const QUALIFIERS = new Set(['new','sealed','brand','mint','boxed','used','unopened','nib','bnib','unused','open','opened','condition','genuine','authentic','cheap','cheapest','best','top','good','great','nice','quality','affordable','bargain']);
  const isYear = w => /^(19|20)\d{2}$/.test(w); // strip years like 2002, but NOT model numbers like 4722
  const core = words.filter(w => !isYear(w) && !QUALIFIERS.has(w.toLowerCase()));
  const out = [words.join(' ').trim()];
  const coreStr = core.join(' ').trim();
  if (coreStr && coreStr.toLowerCase() !== out[0].toLowerCase()) out.push(coreStr);
  if (core.length > 3) out.push(core.slice(0,3).join(' '));
  else if (core.length > 2) out.push(core.slice(0,2).join(' '));
  return [...new Set(out.map(s=>s.trim()).filter(Boolean))];
}

// SEARCH INTENT: pull country and marketplace mentions OUT of the query and turn
// them into filters. "lego harry potter australia" should search eBay AU, not
// keyword-match listings titled "AUSTRALIA" on eBay US. Patterns are deliberately
// conservative so product names survive: bare "america" (Captain America) and
// bare "amazon" (Amazon Basics, amazon parrot) are NOT treated as intent.
function parseSearchIntent(raw) {
  let q = ' ' + String(raw || '') + ' ';
  let country = null, source = null;
  const take = (re, val, kind) => {
    if (re.test(q)) {
      q = q.replace(re, ' ');
      if (kind === 'c' && !country) country = val;
      if (kind === 's' && !source) source = val;
    }
  };
  // Country: bare names are safe for Australia/Germany; UK allowed bare; US only with a preposition.
  take(/\b(?:in|from|to|for)?\s*(?:australia|australian)\b/gi, 'AU', 'c');
  take(/\b(?:in|from|to|for)\s+(?:the\s+)?(?:uk|united\s+kingdom|great\s+britain|britain|england)\b/gi, 'UK', 'c');
  take(/\b(?:uk|united\s+kingdom)\s*$/gi, 'UK', 'c');
  take(/\b(?:in|from|to|for)?\s*(?:germany|deutschland)\b/gi, 'DE', 'c');
  take(/\b(?:in|from|to|for)\s+(?:the\s+)?(?:usa|us|u\.s\.a?\.?|united\s+states|america)\b/gi, 'US', 'c');
  take(/\busa\s*$/gi, 'US', 'c');
  // Newer marketplaces: preposition required, and "made in X" is a product
  // attribute (made in italy leather), not a marketplace request - excluded.
  take(/(?<!made\s)\b(?:in|from|to|for)\s+(?:france)\b/gi, 'FR', 'c');
  take(/(?<!made\s)\b(?:in|from|to|for)\s+(?:italy)\b/gi, 'IT', 'c');
  take(/(?<!made\s)\b(?:in|from|to|for)\s+(?:spain)\b/gi, 'ES', 'c');
  take(/(?<!made\s)\b(?:in|from|to|for)\s+(?:canada)\b/gi, 'CA', 'c');
  take(/(?<!made\s)\b(?:in|from|to|for)\s+(?:the\s+)?(?:netherlands|holland)\b/gi, 'NL', 'c');
  take(/(?<!made\s)\b(?:in|from|to|for)\s+(?:ireland)\b/gi, 'IE', 'c');
  take(/(?<!made\s)\b(?:in|from|to|for)\s+(?:switzerland)\b/gi, 'CH', 'c');
  take(/(?<!made\s)\b(?:in|from|to|for)\s+(?:austria)\b/gi, 'AT', 'c');
  take(/(?<!made\s)\b(?:in|from|to|for)\s+(?:belgium)\b/gi, 'BE', 'c');
  take(/(?<!made\s)\b(?:in|from|to|for)\s+(?:poland)\b/gi, 'PL', 'c');
  take(/(?<!made\s)\b(?:in|from|to|for)\s+(?:singapore)\b/gi, 'SG', 'c');
  take(/(?<!made\s)\b(?:in|from|to|for)\s+(?:hong\s*kong)\b/gi, 'HK', 'c');
  take(/(?<!made\s)\b(?:in|from|to|for)\s+(?:malaysia)\b/gi, 'MY', 'c');
  take(/(?<!made\s)\b(?:in|from|to|for)\s+(?:the\s+)?(?:philippines)\b/gi, 'PH', 'c');
  take(/(?<!made\s)\b(?:in|from|to|for)\s+(?:thailand)\b/gi, 'TH', 'c');
  take(/(?<!made\s)\b(?:in|from|to|for)\s+(?:taiwan)\b/gi, 'TW', 'c');
  take(/(?<!made\s)\b(?:in|from|to|for)\s+(?:vietnam)\b/gi, 'VN', 'c');
  // Marketplace: "ebay" and "aliexpress" are never product words, safe bare.
  take(/\b(?:on|from|via|at|off)?\s*ebay(?:\s+only)?\b/gi, 'ebay', 's');
  take(/\b(?:on|from|via|at|off)?\s*ali\s*express(?:\s+only)?\b/gi, 'ali', 's');
  // Amazon only with a preposition (protects "Amazon Basics" etc). No Amazon API
  // source exists, so this just cleans the phrase out of the keywords.
  q = q.replace(/\b(?:on|from|via|at|off)\s+amazon(?:\s+only)?\b/gi, ' ');
  // Chat filler that never helps a marketplace keyword search.
  q = q.replace(/\blistings?\b/gi, ' ');
  q = q.replace(/^\s*(?:please\s+)?(?:can\s+you\s+)?(?:find|show|get|search)(?:\s+(?:me|for))?\s+/i, ' ');
  q = q.replace(/^\s*(?:i\s+(?:want|need)|i'?m\s+looking\s+for|looking\s+for)\s+/i, ' ');
  q = q.replace(/\s{2,}/g, ' ').trim();
  return { keywords: q, country, source };
}

// ---------------------------------------------------------------------------
// LEGO SET RESOLUTION (Rebrickable catalog, loaded into D1 as lego_sets)
//
// The problem this solves: eBay titles are written by sellers, so the same set
// appears as "LEGO 4702", "Harry Potter Final Challenge", "Philosopher's Stone
// 2001" and so on. Word-matching a seller's title can never reconcile those.
// The catalog gives us canonical identity: name -> set number. Once we know the
// shopper means set 4702, we can ALSO search "lego 4702", which is how a large
// share of sellers actually title it - so we surface listings we used to miss.
//
// Runs ONLY on LEGO queries. Every other search does zero extra work.
// ---------------------------------------------------------------------------
const LEGO_STOP = new Set([
  'lego','legos','set','sets','the','a','an','of','and','or','for','in','on','with','to','by','from',
  'new','used','sealed','boxed','box','vintage','retired','rare','complete','incomplete','mint','nib','misb',
  'brand','condition','genuine','official','original','authentic','building','block','blocks','brick','bricks'
]);

// Canonicalise common LEGO-name shorthand before catalogue matching. Marketplace
// sellers and shoppers often type "Ms Puff", while the catalogue stores
// "Mrs. Puff's Boating School". Without this alias the catalogue lookup fails,
// the set number is never added to the eBay search, and broad fallback queries
// such as "lego ms puff" can surface unrelated "monthly mini" listings.
function normalizeLegoQueryAliases(input) {
  let q = String(input || '').toLowerCase();
  q = q.replace(/[’']/g, ' ');
  q = q.replace(/\b(?:ms|miss|mrs)\.?\s+puffs?\b/g, 'mrs puff');
  q = q.replace(/\bmrs\.?\s+puff\s+s\b/g, 'mrs puff');
  q = q.replace(/\bsquare\s+pants\b/g, 'squarepants');
  return q.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function bareLegoSetId(id) {
  return String(id || '').trim().replace(/-\d+$/, '');
}

function legoTitleHasWord(title, word) {
  const t = ' ' + String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  const w = String(word || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return !!w && t.indexOf(' ' + w + ' ') !== -1;
}

// Every word that appears in any LEGO theme name ("harry", "potter", "star",
// "wars", "technic"...). These name a FRANCHISE, not a set. Cached 24h in KV -
// it is ~500 words and changes about never.
async function legoThemeWords(env) {
  try {
    if (env.CACHE) {
      const c = await env.CACHE.get('lego:themewords', 'json');
      if (c && Array.isArray(c)) return new Set(c);
    }
    const res = await env.DB.prepare('SELECT DISTINCT theme_norm FROM lego_sets').all();
    const words = new Set();
    for (const r of (res && res.results) || []) {
      for (const w of String(r.theme_norm || '').split(' ')) if (w) words.add(w);
    }
    if (env.CACHE) {
      try { await env.CACHE.put('lego:themewords', JSON.stringify([...words]), { expirationTtl: 86400 }); } catch (_) {}
    }
    return words;
  } catch (_) { return new Set(); }
}


// Fast, browse-friendly LEGO typeahead. Unlike resolveLegoSets (which is
// deliberately conservative because it can route a user to ONE product), this
// function is allowed to return several catalogue rows for broad input such as
// "lego star wars". It is D1-only: no StockX, Brickset, BrickLink or eBay calls
// sit in the keystroke path.

function legoEditDistance(a, b) {
  a = String(a || ''); b = String(b || '');
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const matrix = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + 1);
      }
    }
  }
  return matrix[a.length][b.length];
}

function legoWordSimilarity(a, b) {
  a = String(a || '').toLowerCase();
  b = String(b || '').toLowerCase();
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  const longest = Math.max(a.length, b.length);
  if (longest < 4) return 0;
  return Math.max(0, 1 - legoEditDistance(a, b) / longest);
}

// Fast, browse-friendly LEGO typeahead. This is intentionally more permissive
// than the router: it may suggest several products and it also recognises LEGO
// product names without requiring the shopper to type "LEGO" first. D1 remains
// the only dependency in the keystroke path.
async function fastLegoCatalogSuggest(keywords, env, limit = 10) {
  if (!env || !env.DB) return [];
  const raw = String(keywords || '');
  const explicitLego = /\blego\b/i.test(raw);
  const q = normalizeLegoQueryAliases(raw);
  if (!q) return [];
  const tokens = q.split(' ').filter(Boolean);
  const year = tokens.find(t => /^\d{4}$/.test(t) && +t >= 1949 && +t <= 2035) || '';
  const number = tokens.find(t => /^\d{3,7}$/.test(t) && t !== year) || '';
  try {
    if (number) {
      const exact = await env.DB.prepare(
        'SELECT set_id,name,year,theme,num_parts,img_url FROM lego_sets WHERE set_id = ? OR set_id = ? LIMIT 1'
      ).bind(number, number + '-1').first();
      if (exact) return [exact];
    }
    const terms = tokens.filter(t => !LEGO_STOP.has(t) && !/^\d+$/.test(t) && t.length >= 2).slice(0, 5);
    if (!terms.length) return [];

    const binds = [];
    let where = terms.map(() => '(name_norm LIKE ? OR theme_norm LIKE ?)').join(' AND ');
    for (const t of terms) { binds.push('%' + t + '%', '%' + t + '%'); }
    if (year) { where += ' AND year = ?'; binds.push(+year); }
    let result = await env.DB.prepare(
      `SELECT set_id,name,year,theme,num_parts,img_url FROM lego_sets WHERE ${where} ORDER BY year DESC, num_parts DESC LIMIT 40`
    ).bind(...binds).all();
    let rows = (result && result.results) || [];

    if (!rows.length && terms.length > 1) {
      const fb = [];
      let anyWhere = terms.map(() => '(name_norm LIKE ? OR theme_norm LIKE ?)').join(' OR ');
      for (const t of terms) { fb.push('%' + t + '%', '%' + t + '%'); }
      if (year) { anyWhere = '(' + anyWhere + ') AND year = ?'; fb.push(+year); }
      result = await env.DB.prepare(
        `SELECT set_id,name,year,theme,num_parts,img_url FROM lego_sets WHERE ${anyWhere} ORDER BY year DESC, num_parts DESC LIMIT 100`
      ).bind(...fb).all();
      rows = (result && result.results) || [];
    }

    if (!rows.length) {
      const stems = [...new Set(terms.filter(t => t.length >= 4).map(t => t.slice(0, 3)))].slice(0, 4);
      if (stems.length) {
        const sb = [];
        const stemWhere = stems.map(() => '(name_norm LIKE ? OR theme_norm LIKE ?)').join(' OR ');
        for (const s of stems) { sb.push('%' + s + '%', '%' + s + '%'); }
        result = await env.DB.prepare(
          `SELECT set_id,name,year,theme,num_parts,img_url FROM lego_sets WHERE ${stemWhere} ORDER BY year DESC, num_parts DESC LIMIT 120`
        ).bind(...sb).all();
        rows = (result && result.results) || [];
      }
    }

    const norm = v => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
    const phrase = terms.join(' ');
    rows.forEach(r => {
      const name = norm(r.name), theme = norm(r.theme), both = (name + ' ' + theme).trim();
      const words = [...new Set(both.split(' ').filter(Boolean))];
      let exactHits = 0, fuzzyHits = 0, fuzzyTotal = 0, nameHits = 0;
      for (const t of terms) {
        if (both.includes(t)) exactHits++;
        if (name.includes(t)) nameHits++;
        let best = 0;
        for (const word of words) best = Math.max(best, legoWordSimilarity(t, word));
        fuzzyTotal += best;
        if (best >= (t.length >= 7 ? 0.72 : 0.76)) fuzzyHits++;
      }
      const phraseHit = !!(phrase && (name.includes(phrase) || theme.includes(phrase)));
      r._exactHits = exactHits;
      r._fuzzyHits = fuzzyHits;
      r._suggestScore = exactHits * 24 + fuzzyHits * 12 + nameHits * 8
        + fuzzyTotal * 8
        + (phraseHit ? 42 : 0)
        + (number && bareLegoSetId(r.set_id) === number ? 100 : 0)
        + Math.min(8, Math.max(0, (Number(r.year) || 0) - 2018) * 0.35);
    });

    if (!explicitLego) {
      rows = rows.filter(r => {
        if (terms.length === 1) {
          return terms[0].length >= 5 && r._exactHits >= 1 && r._suggestScore >= 35;
        }
        const need = Math.max(1, Math.ceil(terms.length * 0.6));
        return r._fuzzyHits >= need && r._suggestScore >= 48;
      });
    }

    rows.sort((a, b) => (b._suggestScore || 0) - (a._suggestScore || 0)
      || (Number(b.year) || 0) - (Number(a.year) || 0)
      || (Number(b.num_parts) || 0) - (Number(a.num_parts) || 0));
    return rows.slice(0, Math.max(1, limit));
  } catch (e) {
    logErr('fastLegoCatalogSuggest', e);
    return [];
  }
}

async function resolveLegoSets(keywords, env) {
  const EMPTY = { sets: [], mode: null, year: null };
  if (!env || !env.DB) return EMPTY;
  if (!/\blego\b/i.test(String(keywords || ''))) return EMPTY;   // gate: LEGO queries only

  const q = normalizeLegoQueryAliases(keywords);
  if (!q) return EMPTY;
  const tokens = q.split(' ').filter(Boolean);

  const isYear = (t) => /^\d{4}$/.test(t) && +t >= 1949 && +t <= 2030;
  const nameTerms = tokens.filter(t => !LEGO_STOP.has(t) && !/^\d+$/.test(t) && t.length >= 2);
  const numTerms  = tokens.filter(t => /^\d{2,7}$/.test(t));
  const yearTerm  = nameTerms.length ? (tokens.find(isYear) || null) : null;

  try {
    // 1) Explicit set number in the query - the strongest possible signal.
    for (const n of numTerms) {
      if (yearTerm && n === yearTerm) continue;              // that number is the year, not the set
      const row = await env.DB.prepare(
        'SELECT set_id,name,year,theme,num_parts,img_url FROM lego_sets WHERE set_id = ? OR set_id = ? LIMIT 1'
      ).bind(n, n + '-1').first();
      if (row) return { sets: [row], mode: 'exact', year: null };
    }
    if (!nameTerms.length) return EMPTY;

    const themeWords = await legoThemeWords(env);
    const residual = nameTerms.filter(t => !themeWords.has(t));

    // 2) THEME + YEAR BROWSE. "lego harry potter 2002" names no specific set, but
    //    it is NOT a vague query - the catalog knows exactly which 11 sets LEGO
    //    released in that theme that year. Resolve to all of them, so the results
    //    can be restricted to real 2002 sets instead of drifting into whatever
    //    modern Hogwarts set happens to match the words "lego harry potter".
    if (!residual.length && yearTerm) {
      const themeTerms = nameTerms.slice(0, 4);
      const where = themeTerms.map(() => 'theme_norm LIKE ?').join(' AND ');
      const binds = themeTerms.map(t => '%' + t + '%');
      binds.push(+yearTerm);
      const res = await env.DB.prepare(
        `SELECT set_id,name,year,theme,num_parts,img_url FROM lego_sets
         WHERE ${where} AND year = ? ORDER BY num_parts DESC LIMIT 40`
      ).bind(...binds).all();
      const sets = (res && res.results) || [];
      if (sets.length) return { sets, mode: 'browse', year: +yearTerm };
    }

    if (!residual.length) return EMPTY;    // pure franchise browse, no year - normal search

    // 3) Specific set by name.
    const terms = nameTerms.slice(0, 5);
    const res   = residual.slice(0, 4);
    const binds = [];
    let where = terms.map(() => '(name_norm LIKE ? OR theme_norm LIKE ?)').join(' AND ');
    for (const t of terms) { binds.push('%' + t + '%', '%' + t + '%'); }
    where += ' AND ' + res.map(() => 'name_norm LIKE ?').join(' AND ');
    for (const t of res) binds.push('%' + t + '%');

    let sql = `SELECT set_id,name,year,theme,num_parts,img_url FROM lego_sets WHERE ${where}`;
    if (yearTerm) { sql += ' AND year = ?'; binds.push(+yearTerm); }
    sql += ' ORDER BY num_parts DESC LIMIT 3';
    const out = await env.DB.prepare(sql).bind(...binds).all();
    const sets = ((out && out.results) || []).slice(0, 3);
    if (sets.length) return { sets, mode: 'exact', year: null };

    // 3b) RELAXED FALLBACK. The strict match above requires EVERY word, so one
    //     typo ("chamber of scerets") returns nothing. Here we require the theme
    //     words to match and rank sets by how many of the remaining words appear
    //     in the name, keeping only those with at least one hit — so a single
    //     misspelled word no longer wipes out an otherwise-obvious match.
    const themeMatch = nameTerms.filter(t => themeWords.has(t));
    if (themeMatch.length && res.length) {
      const fb = [];
      const wh = themeMatch.map(() => 'theme_norm LIKE ?').join(' AND ');
      themeMatch.forEach(t => fb.push('%' + t + '%'));
      const scoreParts = res.map(() => '(CASE WHEN name_norm LIKE ? THEN 1 ELSE 0 END)');
      res.forEach(t => fb.push('%' + t + '%'));
      let fsql = `SELECT set_id,name,year,theme,num_parts,img_url, (${scoreParts.join(' + ')}) AS _s
                  FROM lego_sets WHERE ${wh}`;
      if (yearTerm) { fsql += ' AND year = ?'; fb.push(+yearTerm); }
      fsql += ' ORDER BY _s DESC, num_parts DESC LIMIT 6';
      const fo = await env.DB.prepare(fsql).bind(...fb).all();
      const fsets = ((fo && fo.results) || []).filter(r => r._s > 0).slice(0, 5);
      if (fsets.length) return { sets: fsets, mode: 'fuzzy', year: null };
    }
    return EMPTY;
  } catch (_) { return EMPTY; }
}

// PART-OUT DETECTION. A listing whose title contains "4757" is not necessarily
// the set 4757 - it may be one minifig, one brick, or the instruction booklet
// SOLD OUT OF that set ("Professor Trelawney from 4757"). Those are the listings
// that were burying the real sets. Two independent signals catch them:
//
//  1. Phrasing: "from 4757", "out of set 4757", "off 4757" - explicitly a part.
//  2. Price: a part-out costs a small fraction of the set. Compared against the
//     MEDIAN of the other set-matched listings, so it self-calibrates to whatever
//     the set is actually worth - no hard-coded number to get wrong per set.
//
// Deliberately NOT keyword-matching "minifig"/"pieces" alone: plenty of genuine
// full-set listings say "complete with minifigs" or "928 pieces".
const JUNK_RE_GLOBAL = /\b(minifig|minifigure|figurine|brick|tile|plate|slope|cone|arch|window|door|flag|wheel|axle|panel|stud|polybag|spare|ref\s*\d|replacement|repair|piece|pieces|part|parts|lace|laces|toit|roof|tete|head\s+ref|weapons?\s*pack|mystery\s*bag|blind\s*bag|grab\s*bag|shoe\s*tree|insole|shoelace|cleaner|cleaning\s*kit|protector|crease|dust\s*bag|strap\s*only|band\s*only|bezel|crown|clasp|screen\s*protector|charger|cable|adapter|sticker|decal|patch|manual|instruction|notice|booklet|catalog|poster|magnet|keychain|keyring|lanyard|display\s*case|display\s*stand|stand\s+only|light\s*kit|led\s*light|lighting\s*kit|joblot|job\s*lot|empty\s+box|box\s+only|receipt)\b/i;
const isJunkGlobal = (it) => JUNK_RE_GLOBAL.test(String(it.title || ''));

const LEGO_PARTOUT_RE = /\b(?:from|off|out\s+of|aus)\s+(?:the\s+)?(?:lego\s+)?(?:set\s+)?\d{3,7}\b/i;
// A title carrying THREE OR MORE set numbers is a loose part that happens to fit
// several sets ("Roof ref 33215 Set 4709 4730 4729 4842"), never a boxed set.
const LEGO_MULTISET_RE = /(?:\b\d{4,7}\b[^\d]{0,12}){3,}/;

function markLegoPartOuts(items, legoSets) {
  if (!legoSets.length) return;
  const matched = items.filter(it => it._setMatch);
  if (matched.length < 3) return;
  // Median must come from listings that are NOT already obvious junk. If the junk
  // is included, a page full of 5-euro roof tiles drags the median down until the
  // floor is meaningless and the filter stops catching anything.
  const cleanish = matched.filter(it => !it._junk);
  const basis = cleanish.length >= 3 ? cleanish : matched;
  const prices = basis.map(it => Number(it.price) || 0).filter(p => p > 0).sort((a, b) => a - b);
  if (prices.length < 3) return;
  const median = prices[Math.floor(prices.length / 2)];
  const floor = median * 0.25;                          // under a quarter of typical = a part, not the set
  for (const it of matched) {
    const t = String(it.title || '');
    const p = Number(it.price) || 0;
    if (LEGO_PARTOUT_RE.test(t))  { it._partOut = true; continue; }
    if (LEGO_MULTISET_RE.test(t)) { it._partOut = true; continue; }
    if (p > 0 && p < floor)       { it._partOut = true; }
  }
}

async function searchListings(rawKeywords, maxPriceParam, country, env, agOnly = false) {
  rawKeywords = correctSpelling(normalizeKeywords(rawKeywords)); // "air forces"→AF1, "suavage"→"sauvage"
  const intent = parseSearchIntent(rawKeywords);
  if (intent.keywords) rawKeywords = intent.keywords;
  if (intent.country) country = intent.country;
  const parsed = parseQuery(rawKeywords);
  // The shopper TYPED a country ("lego harry potter australia"), as opposed to
  // just being detected in one. That is an explicit request, not a preference,
  // so those listings get hard-locked to the top rather than merely bonused.
  const explicitCountry = !!intent.country;
  const wantLoc = (it) => {
    if (!country || !it.location) return false;
    if (it.location === country) return true;
    if (country === 'UK' && it.location === 'GB') return true;
    if (country === 'GB' && it.location === 'UK') return true;
    return false;
  };
  const keywords = stripPricePhrases(rawKeywords) || rawKeywords;
  const ceilings = [parseFloat(maxPriceParam) || 0, parsed.parsedMax].filter(n => n > 0);
  const maxPrice = ceilings.length ? String(Math.min(...ceilings)) : '';

  // TIERED FILL (PARALLEL): exact phrase + broader versions are searched at the SAME time,
  // so this is no slower than one search. Exact matches always lead; broader related items
  // only fill in AFTER, deduped, up to the target.
  let ebayData = { items: [], error: null };
  let usedKeywords = keywords;
  const EBAY_TARGET = 120;

  // Resolve the query to canonical LEGO sets (no-op for every non-LEGO search).
  //   exact  -> "lego harry potter final challenge" resolves to set 4702.
  //   browse -> "lego harry potter 2002" resolves to ALL 11 sets LEGO released in
  //             that theme that year, so results can be restricted to those sets
  //             instead of drifting into any modern set that shares the words.
  const legoRes  = await resolveLegoSets(keywords, env);
  const legoSets = legoRes.sets;
  const legoMode = legoRes.mode;
  const legoYear = legoRes.year;
  const uniqQueries = (arr) => {
    const seen = new Set();
    return arr.filter(Boolean).map(x => String(x).replace(/\s+/g, ' ').trim()).filter(x => {
      const k = x.toLowerCase();
      if (!x || seen.has(k)) return false;
      seen.add(k); return true;
    });
  };
  // Rebrickable-style catalogue IDs may be stored as 4982-1, while eBay sellers
  // almost always title the set as 4982. Always search the bare retail set number.
  const legoNumberQueries = legoSets
    .slice(0, legoMode === 'browse' ? 6 : 3)
    .map(set => 'lego ' + bareLegoSetId(set.set_id));
  // Also search the catalogue's canonical title. This bridges shopper shorthand
  // ("ms puff") to seller wording ("Mrs. Puff's Boating School").
  const legoTitleQueries = legoSets
    .slice(0, legoMode === 'browse' ? 4 : 2)
    .map(set => 'lego ' + String(set.name || '').trim() + ' ' + bareLegoSetId(set.set_id));
  const legoQueries = uniqQueries([...legoNumberQueries, ...legoTitleQueries]);

  const baseAttempts = intent.source === 'ali' ? [] : broadenQueries(keywords);
  let attempts;
  let preciseCount;
  if (legoMode === 'exact' && legoSets.length) {
    // A resolved product must never degrade to "lego ms puff" or "lego ms".
    // Those broad tiers caused the unrelated Monthly Mini results in the live UI.
    attempts = uniqQueries([keywords, ...legoQueries]);
    preciseCount = attempts.length;
  } else {
    attempts = baseAttempts.length
      ? uniqQueries([baseAttempts[0], ...legoQueries, ...baseAttempts.slice(1)])
      : legoQueries;
    preciseCount = baseAttempts.length ? Math.min(attempts.length, 1 + legoQueries.length) : legoQueries.length;
  }
  // Fire EVERYTHING at once: all eBay tiers + AliExpress run concurrently.
  // Total time = the single slowest call, not the sum → search stays fast.
  // On AG-only pages (spot-a-fake), AliExpress is SKIPPED entirely - it has no
  // Authenticity Guarantee, so every shown listing stays genuinely eBay-verified.
  // If the shopper asked for eBay only, AliExpress is skipped the same way.
  const aliPromise = (agOnly || intent.source === 'ebay')
    ? Promise.resolve({ items: [], error: null })
    : searchAliExpress(keywords, country, env, 50).catch(e => ({ items: [], error: String(e.message || e) }));
  const results = await Promise.allSettled(attempts.map(a => searchEbay(a, country, maxPrice, env, agOnly)));
  const seenIds = new Set();
  const collected = [];
  let ebayTotal = 0;        // eBay's REAL total matching-listings count (Google-style)
  let ebayTotalMax = 0;     // fallback: max across tiers
  results.forEach((res, qi) => {
    const data = res.status === 'fulfilled' ? res.value : { items: [], error: String(res.reason) };
    if (data.error) ebayData.error = data.error;
    const items = Array.isArray(data.items) ? data.items : [];
    if (typeof data.total === 'number') ebayTotalMax = Math.max(ebayTotalMax, data.total);
    if (qi === 0 && items.length && typeof data.total === 'number') ebayTotal = data.total; // exact-query total is the honest count
    if (qi === 0 && items.length) usedKeywords = attempts[0]; // header reflects the exact query when it hits
    for (const it of items) {                                  // precise tiers added first, broader tiers after
      // Exact query AND resolved set-number queries both count as tier 0: a set
      // number identifies the product at least as reliably as the typed phrase.
      const tier = (qi < preciseCount) ? 0 : (qi - preciseCount + 1);
      if (it.itemId && !seenIds.has(it.itemId)) { seenIds.add(it.itemId); it._tier = tier; collected.push(it); }
    }
  });
  // RELEVANCE + QUALITY: drop obvious spare-parts/accessory junk, then rank so
  // real, well-priced, complete items lead. eBay's API gives us no watch count
  // (pending access), so quality is inferred from title signals + price sanity.
  {
    // Common words like "the"/"a"/"of" shouldn't count as query terms a listing
    // must contain - they're noise, not product identity, and requiring them
    // literally in the title excludes otherwise-perfect matches for no reason.
    const STOPWORDS = new Set(['the','a','an','of','and','or','for','in','on','with','to','by','from']);
    const relevanceKeywords = (legoMode === 'exact' && legoSets.length) ? normalizeLegoQueryAliases(keywords) : String(keywords || '').toLowerCase();
    const qWords = relevanceKeywords.replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w.length >= 2 && !STOPWORDS.has(w));
    // Single-piece / accessory signals: a "LEGO Hogwarts" search should not show
    // a 2-euro brick, a flag, a window, or a lighting kit.
    const JUNK_RE = /\b(minifig|minifigure|figurine|brick|tile|plate|slope|cone|arch|window|door|flag|wheel|axle|panel|stud|polybag|spare|ref\s*\d|replacement|repair|piece|pieces|part|parts|lace|laces|helmet\s+sw|weapons?\s*pack|pack\s*d.armes|mystery\s*bag|blind\s*bag|grab\s*bag|random|shoe\s*tree|insole|shoelace|deodoriser|deodorizer|cleaner|cleaning\s*kit|protector|crease|shoe\s*box|dust\s*bag|strap\s*only|band\s*only|bezel|crown|link|clasp|screen\s*protector|case|cover|skin|charger|cable|adapter|sticker|decal|patch|sheet|manual|instruction|notice|booklet|catalog|poster|print|photo|magnet|keychain|keyring|pin\b|badge|lanyard|display\s*case|display\s*stand|stand\s+only|light\s*kit|led\s*light|lighting\s*kit|lot\s+of|joblot|job\s*lot|bundle|empty\s+box|box\s+only|card\s+only|tag\s+only|receipt)\b/i;
    const isJunk = (it) => JUNK_RE.test(String(it.title || ''));

    if (qWords.length) {
      const relOf = (it) => {
        const t = String(it.title || '').toLowerCase();
        return qWords.filter(w => (legoMode === 'exact' ? legoTitleHasWord(t, w) : t.indexOf(w) !== -1)).length;
      };
      // SET NUMBER BEATS WORD MATCHING. A listing titled "LEGO 4702 Philosopher's
      // Stone" shares only the word "lego" with the query "lego harry potter final
      // challenge" - the word gate would throw it out, even though the set number
      // proves it is EXACTLY the product asked for. So a set-number hit gets full
      // relevance credit and is exempt from the threshold below. This is the whole
      // reason the catalog is worth having.
      collected.forEach(it => {
        it._rel = relOf(it);
        it._junk = isJunk(it);
        const t = String(it.title || '').toLowerCase();
        const hit = legoSets.find(set => new RegExp('\\b' + bareLegoSetId(set.set_id) + '\\b').test(t));
        if (hit) {
          it._setMatch = bareLegoSetId(hit.set_id);
          it._setName  = hit.name;
          it._setParts = hit.num_parts;
          it._setYear  = hit.year;
          if (!it.image && hit.img_url) it.image = hit.img_url;   // only fill a MISSING photo
        }
      });
      // Decide which set-number hits are actually PART-OUTS (one minifig from the
      // set, not the set) before handing out any relevance credit.
      markLegoPartOuts(collected, legoSets);
      // Exact product identity beats broad word overlap. As soon as at least one
      // listing carries the resolved set number, discard unrelated filler even if
      // that leaves only one or two honest listings. Thin-but-correct is better
      // than a full grid of the wrong product.
      if (legoMode === 'exact' && legoSets.length === 1) {
        const targetId = bareLegoSetId(legoSets[0].set_id);
        const target = collected.filter(it => it._setMatch === targetId && !it._partOut);
        if (target.length) {
          collected.length = 0;
          Array.prototype.push.apply(collected, target);
        }
      }
      collected.forEach(it => {
        // Full relevance credit for a proven set match - but NOT for a part-out.
        // Without this guard, "Professor Trelawney from 4757" scores as a perfect
        // match for "lego harry potter 4757" and buries the real castles.
        if (it._setMatch && !it._partOut) it._rel = qWords.length;
        if (it._partOut) it._junk = true;
      });
      // On a resolved LEGO search we KNOW what the product is, so part-outs are
      // removed outright rather than merely penalised - as long as real sets remain.
      if (legoSets.length) {
        const realSets = collected.filter(it => !it._partOut);
        if (realSets.length >= 6) {
          collected.length = 0;
          Array.prototype.push.apply(collected, realSets);
        }
      }

      // BROWSE MODE HARD FILTER. "lego harry potter 2002" means the 11 sets LEGO
      // actually released that year - nothing else. A 2018 Hogwarts Great Hall
      // matches the words "lego harry potter" and would otherwise fill the page
      // once the genuine 2002 listings run out. So a listing must either carry one
      // of that year's set numbers, or state the year itself. This is only possible
      // because the catalog knows the real answer; word matching never could.
      if (legoMode === 'browse' && legoYear) {
        const yearRe = new RegExp('\\b' + legoYear + '\\b');
        const onTarget = collected.filter(it =>
          it._setMatch || yearRe.test(String(it.title || ''))
        );
        if (onTarget.length >= 4) {
          collected.length = 0;
          Array.prototype.push.apply(collected, onTarget);
        }
      }

      // RELEVANCE THRESHOLD: a listing must match at least ~75% of the query's
      // meaningful words. This is deliberately NOT 100%: eBay sellers do not put
      // every word in the title, and demanding a literal match on every token
      // (a year, a set number) collapses a 2000-result search down to a handful.
      // 75% is the level that keeps the page deep while still excluding items
      // that are only loosely related:
      //   "lego harry potter 2001"           -> needs 3 of 4. Generic 2001-era HP
      //                                         sets pass, so the page fills out.
      //   "lego harry potter final challenge"-> needs 4 of 5. A Hogwarts Express
      //                                         (lego+harry+potter = 3) is dropped.
      //   "nike rf"                          -> needs 2 of 2. A random Air Max
      //                                         (nike only) is dropped.
      const minWords = Math.max(1, Math.ceil(qWords.length * 0.75));
      let pool = collected.filter(it => it._rel >= minWords);
      if (!pool.length) pool = collected.filter(it => it._rel > 0);
      if (!pool.length) pool = collected.slice();

      // NEVER PAD WITH JUNK. This used to keep the accessories whenever fewer than
      // 8 clean listings remained - which is exactly backwards. A thin local market
      // (only 6 real 2001 sets exist in France) is a reason to go LOOK IN OTHER
      // COUNTRIES, not a reason to fill the page with 5-euro roof tiles. Junk goes
      // as soon as anything real survives; the global sweep below then refills the
      // page with real sets from wherever they actually exist.
      {
        const clean = pool.filter(it => !it._junk && !it._partOut);
        if (clean.length >= 3) pool = clean;
      }

      // Drop junk if enough real listings remain.
      const clean = pool.filter(it => !it._junk);
      if (clean.length >= 3) pool = clean;

      // PRICE SANITY: cut the cheap accessory/part tier. Reference off the UPPER
      // half of prices (the 75th percentile) - a plain median gets dragged down
      // by junk itself, so junk survives its own filter.
      const prices = pool.map(it => Number(it.price) || 0).filter(p => p > 0).sort((a, b) => a - b);
      if (prices.length >= 6) {
        const p75 = prices[Math.floor(prices.length * 0.75)];
        const floor = p75 * 0.15;   // under ~15% of a typical GOOD listing = accessory
        const priced = pool.filter(it => !(Number(it.price) > 0 && Number(it.price) < floor));
        if (priced.length >= 8) pool = priced;
      }

      // RANK: a blended score, NOT a strict price sort. Keeps the order feeling
      // natural (eBay's own relevance is respected) while lifting the expensive,
      // complete, trustworthy items that shoppers actually want - and that earn
      // real commission - above cheap accessories.
      const pxs = pool.map(it => Number(it.price) || 0).filter(p => p > 0).sort((a, b) => a - b);
      const pHi = pxs.length ? pxs[Math.floor(pxs.length * 0.9)] : 0;   // top-decile price
      const origIndex = new Map();
      pool.forEach((it, i) => origIndex.set(it, i));
      pool.forEach(it => {
        const p = Number(it.price) || 0;
        // Value weight: log-scaled so a 400-euro item clearly outranks a 5-euro
        // one, but a 900-euro outlier doesn't dominate everything below it.
        const valueScore = (p > 0 && pHi > 0) ? Math.min(1, Math.log10(1 + p) / Math.log10(1 + pHi)) : 0;
        // Natural position from the marketplace's own relevance (earlier = better).
        const naturalScore = 1 - Math.min(1, (origIndex.get(it) || 0) / Math.max(1, pool.length));
        let s = 0;
        s += (it._rel || 0) * 3;          // query relevance dominates
        // TIER BONUS: items returned by the EXACT query the shopper typed lead
        // over items pulled in by the broadened fallback queries. Without this,
        // an expensive local generic item can outscore the precise match the
        // shopper actually asked for - which is what made a specific search
        // return the wrong sets first.
        s += (it._tier === 0 ? 4 : (it._tier === 1 ? 1.5 : 0));
        s += valueScore * 2.2;            // expensive/interesting items rise
        s += naturalScore * 1.4;          // keeps the order feeling natural
        // HOME COUNTRY FIRST: listings from the shopper's own marketplace lead
        // (cheaper shipping, familiar currency). Foreign listings still appear,
        // just after the local ones.
        if (it.location && wantLoc(it)) s += 2.5;
        if (it.agEligible) s += 0.8;      // authenticated items are better bets
        if (it._junk) s -= 3;             // accessories/parts sink
        if (it.image) s += 0.3;           // has a photo
        it._score = s;
      });
      pool.sort((a, b) => (b._score || 0) - (a._score || 0));

      // EXPLICIT COUNTRY = HARD PARTITION. If the shopper actually typed
      // "australia", every AU listing comes before every foreign one - a score
      // bonus is not enough, because an expensive US listing can always outweigh
      // it and end up on row two. Foreign listings still follow underneath (so a
      // rare item is never hidden), just never above a local one. Sort is stable,
      // so the scoring order above is preserved WITHIN each group.
      if (explicitCountry) {
        const local = pool.filter(it => wantLoc(it));
        const foreign = pool.filter(it => !wantLoc(it));
        pool = local.concat(foreign);
      }

      collected.length = 0;
      Array.prototype.push.apply(collected, pool);
    }
  }
  ebayData.items = collected.slice(0, EBAY_TARGET);
  // than eBay US/UK. Always top up from US (and UK) unless the local market has
  // already returned a deep result set - so niche items (a specific LEGO set, a
  // rare colorway) surface no matter where the user is.
  //
  // TIERED GLOBAL SWEEP:
  //   Tier 1: US + UK (the two deepest inventories) - fires whenever local is thin.
  //   Tier 2: every other EPN market - fires only when the item is genuinely rare
  //           and Tier 1 still did not turn up much. A discontinued set sitting in
  //           a German or Italian seller's cupboard should still be findable.
  // Only EPN markets are swept: they are the ones where an affiliate click actually
  // earns commission, so a wide sweep never costs latency for zero revenue.
  const EPN_MARKETS = ['US','UK','DE','AU','CA','IT','ES','NL','AT','BE','IE','CH','FR'];
  // COUNT WHAT IS ACTUALLY GOOD, NOT WHAT IS MERELY PRESENT. The sweep used to
  // trigger on total result count - so a local market returning 60 accessories
  // looked "full" and the sweep never ran, leaving the shopper with a page of junk
  // while real sets sat unfetched in the US, UK and Germany. A thin local market
  // must PULL IN OTHER COUNTRIES. Foreign real listings beat local rubbish.
  const goodCount = () => collected.filter(it => !it._junk && !it._partOut).length;
  if (!agOnly && goodCount() < 60 && intent.source !== 'ali') {
    // Sweep with EVERY resolved set number, not just the first: on a browse
    // ("lego harry potter 2001") the shopper wants all 11 sets of that year, and
    // each one has to be searched for by number to be found abroad.
    const sweepQueries = legoNumberQueries.length ? legoNumberQueries.slice(0, 4) : [attempts[0]];
    const sweep = async (markets) => {
      const jobs = [];
      for (const m of markets) for (const q of sweepQueries) jobs.push(searchEbay(q, m, maxPrice, env, agOnly));
      const res = await Promise.allSettled(jobs);
      let added = 0;
      res.forEach(r => {
        const data = r.status === 'fulfilled' ? r.value : { items: [] };
        const items = Array.isArray(data.items) ? data.items : [];
        if (typeof data.total === 'number' && data.total > ebayTotal) ebayTotal = data.total;
        for (const it of items) {
          if (it.itemId && !seenIds.has(it.itemId)) { seenIds.add(it.itemId); it._tier = 0; collected.push(it); added++; }
        }
      });
      return added;
    };

    // Tier 1 - the big two (skip whichever one is already the shopper's market).
    const tier1 = ['US', 'UK'].filter(m => m !== country);
    if (tier1.length) await sweep(tier1);

    // Tier 2 - go wide. Judged on GOOD listings, not raw count: a pool stuffed with
    // local accessories must not stop us finding the real sets abroad.
    collected.forEach(it => { if (it._junk === undefined) it._junk = isJunkGlobal(it); });
    if (goodCount() < 40) {
      const tier2 = EPN_MARKETS.filter(m => m !== country && m !== 'US' && m !== 'UK');
      if (tier2.length) await sweep(tier2);
    }
    // Re-apply relevance + quality now that the global listings joined the pool.
    {
      const STOPWORDS = new Set(['the','a','an','of','and','or','for','in','on','with','to','by','from']);
      const relevanceKeywords = (legoMode === 'exact' && legoSets.length) ? normalizeLegoQueryAliases(keywords) : String(keywords || '').toLowerCase();
      const qWords = relevanceKeywords.replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w.length >= 2 && !STOPWORDS.has(w));
      const JUNK_RE = /\b(minifig|minifigure|figurine|brick|tile|plate|slope|cone|arch|window|door|flag|wheel|axle|panel|stud|polybag|spare|ref\s*\d|replacement|repair|piece|pieces|part|parts|lace|laces|helmet\s+sw|weapons?\s*pack|pack\s*d.armes|mystery\s*bag|blind\s*bag|grab\s*bag|random|shoe\s*tree|insole|shoelace|deodoriser|deodorizer|cleaner|cleaning\s*kit|protector|crease|shoe\s*box|dust\s*bag|strap\s*only|band\s*only|bezel|crown|link|clasp|screen\s*protector|case|cover|skin|charger|cable|adapter|sticker|decal|patch|sheet|manual|instruction|notice|booklet|catalog|poster|print|photo|magnet|keychain|keyring|pin\b|badge|lanyard|display\s*case|display\s*stand|stand\s+only|light\s*kit|led\s*light|lighting\s*kit|lot\s+of|joblot|job\s*lot|bundle|empty\s+box|box\s+only|card\s+only|tag\s+only|receipt)\b/i;
      if (qWords.length) {
        collected.forEach(it => {
          const t = String(it.title || '').toLowerCase();
          it._rel = qWords.filter(w => (legoMode === 'exact' ? legoTitleHasWord(t, w) : t.indexOf(w) !== -1)).length;
          it._junk = JUNK_RE.test(String(it.title || ''));
          const hit = legoSets.find(set => new RegExp('\\b' + bareLegoSetId(set.set_id) + '\\b').test(t));
          if (hit) {
            it._setMatch = bareLegoSetId(hit.set_id);
            it._setName  = hit.name;
            it._setParts = hit.num_parts;
            it._setYear  = hit.year;
            if (!it.image && hit.img_url) it.image = hit.img_url;
          }
        });
        markLegoPartOuts(collected, legoSets);
        if (legoMode === 'exact' && legoSets.length === 1) {
          const targetId = bareLegoSetId(legoSets[0].set_id);
          const target = collected.filter(it => it._setMatch === targetId && !it._partOut);
          if (target.length) {
            collected.length = 0;
            Array.prototype.push.apply(collected, target);
          }
        }
        collected.forEach(it => {
          if (it._setMatch && !it._partOut) it._rel = qWords.length;   // set number proves identity
          if (it._partOut) it._junk = true;
        });
        if (legoSets.length) {
          const realSets = collected.filter(it => !it._partOut);
          if (realSets.length >= 6) {
            collected.length = 0;
            Array.prototype.push.apply(collected, realSets);
          }
        }
        if (legoMode === 'browse' && legoYear) {
          const yearRe = new RegExp('\\b' + legoYear + '\\b');
          const onTarget = collected.filter(it => it._setMatch || yearRe.test(String(it.title || '')));
          if (onTarget.length >= 4) {
            collected.length = 0;
            Array.prototype.push.apply(collected, onTarget);
          }
        }
        const minWords = Math.max(1, Math.ceil(qWords.length * 0.75));
        let pool = collected.filter(it => it._rel >= minWords);
        if (!pool.length) pool = collected.filter(it => it._rel > 0);
        if (!pool.length) pool = collected.slice();
        const clean = pool.filter(it => !it._junk && !it._partOut);
        if (clean.length >= 3) pool = clean;
        const prices = pool.map(it => Number(it.price) || 0).filter(p => p > 0).sort((a, b) => a - b);
        if (prices.length >= 6) {
          const p75 = prices[Math.floor(prices.length * 0.75)];
          const floor = p75 * 0.15;
          const priced = pool.filter(it => !(Number(it.price) > 0 && Number(it.price) < floor));
          if (priced.length >= 8) pool = priced;
        }
        const pxs = pool.map(it => Number(it.price) || 0).filter(p => p > 0).sort((a, b) => a - b);
        const pHi = pxs.length ? pxs[Math.floor(pxs.length * 0.9)] : 0;
        const origIndex = new Map();
        pool.forEach((it, i) => origIndex.set(it, i));
        pool.forEach(it => {
          const p = Number(it.price) || 0;
          const valueScore = (p > 0 && pHi > 0) ? Math.min(1, Math.log10(1 + p) / Math.log10(1 + pHi)) : 0;
          const naturalScore = 1 - Math.min(1, (origIndex.get(it) || 0) / Math.max(1, pool.length));
          let s = 0;
          s += (it._rel || 0) * 3;
          s += (it._tier === 0 ? 4 : (it._tier === 1 ? 1.5 : 0));   // exact-query matches lead
          s += valueScore * 2.2;
          s += naturalScore * 1.4;
          if (it.location && wantLoc(it)) s += 2.5;   // home country first
          if (it.agEligible) s += 0.8;
          if (it._junk) s -= 3;
          if (it.image) s += 0.3;
          it._score = s;
        });
        pool.sort((a, b) => (b._score || 0) - (a._score || 0));

        // Explicit country request: local listings hard-locked above foreign ones.
        if (explicitCountry) {
          const local = pool.filter(it => wantLoc(it));
          const foreign = pool.filter(it => !wantLoc(it));
          pool = local.concat(foreign);
        }
        collected.length = 0;
        Array.prototype.push.apply(collected, pool);
      }
    }
    ebayData.items = collected.slice(0, EBAY_TARGET);
  }

  const aliData = await aliPromise;

  let ebayItems = Array.isArray(ebayData.items) ? ebayData.items : [];
  let aliItems  = Array.isArray(aliData.items)  ? aliData.items  : [];
  const aliBefore = aliItems.length;
  if (parsed.colors.length || parsed.coreTokens.length) {
    aliItems = aliItems.filter(i => matchesQuery(i, parsed));
  }
  if (maxPrice) {
    const maxP = parseFloat(maxPrice);
    ebayItems = ebayItems.filter(i => !i.price || i.price <= maxP);
    aliItems  = aliItems.filter(i => !i.price || i.price <= maxP);
  }

  // PRICE INTENT: if the shopper said "cheap"/"cheapest"/"budget"/"lowest" etc., lead with the
  // LEAST-EXPENSIVE items — but do NOT dump $2 junk on top. The category filter is already
  // applied upstream (real shoes only, etc.), and here we additionally drop obvious
  // accessory/box-only/replica outliers priced far below the typical item, then sort ascending.
  // The floor is RELATIVE to the median real price, so it self-calibrates: ~$45 for Yeezys,
  // ~$3 for a cheap-gadget search — no hard-coded number to get wrong per category.
  const PRICE_INTENT_RE = /\b(cheap|cheapest|budget|affordable|bargain|lowest|inexpensive|least\s*expensive|low\s*(?:price|cost)|best\s*price)\b/i;
  if (PRICE_INTENT_RE.test(rawKeywords)) {
    const floorFrom = (arr) => {
      const priced = arr.map(i => Number(i.price)).filter(p => p > 0).sort((a, b) => a - b);
      if (priced.length < 4) return 0;                       // too few to judge a sensible floor
      const median = priced[Math.floor(priced.length / 2)];
      return median * 0.15;                                  // drop items priced <15% of the typical one
    };
    const byPrice = (a, b) => (Number(a.price) || Infinity) - (Number(b.price) || Infinity);
    const eFloor = floorFrom(ebayItems);
    ebayItems = ebayItems.filter(i => !(Number(i.price) > 0) || Number(i.price) >= eFloor).sort(byPrice);
    const aFloor = floorFrom(aliItems);
    aliItems  = aliItems.filter(i => !(Number(i.price) > 0) || Number(i.price) >= aFloor).sort(byPrice);
  }

  // FINAL COUNTRY LOCK. The scoring blocks above already partition, but this is
  // the last point at which eBay ordering is decided, so enforcing it here means
  // no upstream path (global sweep, price-intent sort, tier merge) can ever leak
  // a foreign listing above a local one when the shopper explicitly asked for a
  // country. Cheap, and it makes the guarantee unconditional rather than relying
  // on every earlier branch being correct.
  if (explicitCountry) {
    const local   = ebayItems.filter(i => wantLoc(i));
    const foreign = ebayItems.filter(i => !wantLoc(i));
    ebayItems = local.concat(foreign);
  }

  // Interleave AliExpress into the eBay results with a VARYING gap. A fixed gap
  // (e.g. every 3rd) makes every Ali card land in the same grid column, which
  // looks like a stripe. Randomising the gap breaks that pattern up.
  const aliCapped = aliItems.slice(0, 10);
  const merged = [];
  let ei = 0, ai = 0;
  while (ei < ebayItems.length || ai < aliCapped.length) {
    const gap = 2 + Math.floor(Math.random() * 4);   // 2-5 eBay items between Ali items
    for (let i = 0; i < gap && ei < ebayItems.length; i++, ei++) merged.push(ebayItems[ei]);
    if (ai < aliCapped.length) merged.push(aliCapped[ai++]);
  }

  return {
    items: merged,
    meta: {
      engine: ENGINE_VERSION,
      resolvedCountry: country,
      explicitCountry: explicitCountry,
      // Canonical LEGO set(s) the query resolved to. The official image is safe to
      // show HERE (it describes the set, not any one seller's item). It is NOT
      // used to replace a seller's photo, because that would hide the condition of
      // the actual thing being sold - which is exactly what Verify exists to expose.
      legoMode: legoMode,
      legoYear: legoYear,
      legoSets: legoSets.map(s => ({
        setId: s.set_id, name: s.name, year: s.year,
        theme: s.theme, numParts: s.num_parts, image: s.img_url
      })),
      localCount: ebayItems.filter(i => wantLoc(i)).length,
      ebayCount: (ebayTotal || ebayTotalMax || ebayItems.length),
      aliCount: aliCapped.length,
      total: merged.length,
      keywords: usedKeywords,
      originalKeywords: rawKeywords,
      searchKeywords: keywords,
      matched: { colors: parsed.colors, coreTokens: parsed.coreTokens, maxPrice: maxPrice || null },
      aliFilteredFrom: aliBefore,
      ebayError: ebayData.error || null,
      aliError:  aliData.error  || null,
      aliRaw: aliData.error ? JSON.stringify(aliData.raw || null).slice(0, 600) : undefined,
    },
  };
}

// ── AI shopping assistant (Cloudflare Workers AI) ───────────────────────────
// Swap CHAT_MODEL back to '@cf/meta/llama-3.1-8b-instruct' if you ever want cheaper/faster over sharper.
const CHAT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

const ASSISTANT_SYSTEM = `You are FindAI's assistant — a helpful, friendly AI that can answer questions on ANY topic, like a general-purpose assistant. FindAI can also search real listings on eBay and AliExpress for hyped, hard-to-find items (Labubu and other collectibles, sneakers, fashion, watches, electronics and more), so you can find products too.

Answer whatever the user asks — general knowledge, maths, explanations, advice, casual chat, anything — clearly and helpfully.

When the user wants to find or buy a product, also set "search" so FindAI can fetch real listings. Build "query" as short keywords a marketplace understands, INCLUDING any colour and product type mentioned (e.g. "green labubu", "travis scott jordan 1", "bape shark hoodie"). Set "maxPrice" to a number only if the user gave a budget, otherwise null. For anything that is NOT a product search, use "search": null.

CRITICAL — search first, don't chat: if the user's message is a product, brand, or item name, even a single word like "lamborghini", "porsche", "labubu", "rolex" or "nike dunk", treat it as a shopping request and set "search" with those keywords RIGHT AWAY. Do NOT describe the brand, its history, or its models, and do NOT ask which model or budget they want first — just search, and let them refine afterwards. When you search, keep "reply" to ONE short line (e.g. "Here are some Lamborghini listings:"). Only use "search": null when the message clearly is NOT something to shop for — a genuine question, a greeting, or casual chat.

Reply with ONE JSON object and nothing else — no markdown, no text outside it — in exactly this shape:
{"reply": "your message to the user", "search": {"query": "keywords", "maxPrice": number_or_null}}
If no product search is needed this turn, use "search": null.
Never invent specific prices or listings in "reply"; real product results come from the search.`;

function normalizeAssistant(obj) {
  if (!obj || typeof obj !== 'object') return { reply: typeof obj === 'string' ? obj.trim() : '', search: null };
  let reply = obj.reply;
  if (typeof reply === 'number' || typeof reply === 'boolean') reply = String(reply);
  if (typeof reply !== 'string') reply = '';
  reply = reply.trim();
  let search = null;
  if (obj.search && typeof obj.search === 'object' && typeof obj.search.query === 'string' && obj.search.query.trim()) {
    const mp = Number(obj.search.maxPrice);
    search = { query: obj.search.query.trim(), maxPrice: Number.isFinite(mp) && mp > 0 ? mp : null };
  }
  return { reply: reply || (search ? `Here's what I found for "${search.query}":` : ''), search };
}

function parseAssistant(text) {
  // Workers AI sometimes hands back already-parsed JSON — use it directly.
  if (text && typeof text === 'object') return normalizeAssistant(text);
  let t = String(text == null ? '' : text).trim();
  t = t.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a !== -1 && b !== -1 && b > a) t = t.slice(a, b + 1);
  try {
    return normalizeAssistant(JSON.parse(t));
  } catch (_) {
    let fallback = String(text == null ? '' : text).trim();
    if (!fallback || fallback === '[object Object]') fallback = 'Sorry, could you rephrase that?';
    return { reply: fallback.slice(0, 800), search: null };
  }
}

async function askAssistant(history, env) {
  const messages = [{ role: 'system', content: ASSISTANT_SYSTEM }, ...history];
  const out = await env.AI.run(CHAT_MODEL, { messages, max_tokens: 384, temperature: 0.4 });
  let raw = out;
  if (out && typeof out === 'object') {
    if (typeof out.response === 'string') raw = out.response;
    else if (out.response && typeof out.response === 'object') raw = out.response;
    else if (typeof out.result === 'string') raw = out.result;
    else if (out.reply !== undefined || out.search !== undefined) raw = out;
    else raw = out.response != null ? out.response : out;
  }
  return parseAssistant(raw);
}

// ── Image understanding (Cloudflare Workers AI vision) ──────────────────────
// Reads an image into text — a detailed product description OR a transcription
// of any question/document in it. The chat assistant then decides shop vs answer.
const VISION_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';
const VISION_PROMPT = 'Look at this image carefully and describe its contents for another assistant.\n- If it shows a PRODUCT someone might shop for, identify it as SPECIFICALLY as possible: exact brand, model, and the SPECIAL EDITION or COLLABORATION name if there is one. Transcribe EVERY visible word, logo, number and brand name EXACTLY as written. Describe any DISTINCTIVE patterns, prints, graphics, textures or co-branding (for example: cow print, tie-dye, ice-cream graphics, a specific cartoon, a sponsor logo) — these identify the exact release, not just the general product type.\n- DESIGNER / BLIND-BOX COLLECTIBLE FIGURES usually have NO visible text or logo, so identify them by FACE and EARS and NAME them — never call them a generic "stuffed animal", "plush toy", "doll" or "baby figure". Use this decision order:\n  1. EARS ARE THE DECIDER. If the figure has tall pointed / rabbit-like ears — EVEN IF it is wearing a hood, onesie, animal suit or costume — it is a LABUBU (Pop Mart "The Monsters"). Say "Labubu" explicitly. Labubu also has a wide mischievous grin showing a row of small jagged/serrated teeth. A green, pink, brown or costumed fuzzy figure with pointed ears is STILL a Labubu — identify it by the EARS and FACE, never by the outfit or colour.\n  2. A SONNY ANGEL has NO ears: a smooth bald baby head, closed/sleepy eyes and a tiny calm closed mouth (no teeth), usually wearing a small removable hat shaped like a fruit or animal. ONLY choose Sonny Angel when there are clearly NO pointed ears and NO toothy grin.\n  3. A small smooth white figure with a tiny minimal face, often peeking or hiding in a shy pose, is a SMISKI.\n  4. If you are unsure but the figure has pointed ears OR a toothy grin, choose LABUBU. Otherwise, if it is a cute blind-box character, say "Pop Mart" and describe it.\n  Lead your description with the NAME and main colour (for example "green Labubu plush figure, ...") so it can be searched correctly.\n- Mention any other main colours last.\n- If it shows a QUESTION, problem, document, screenshot or any text, transcribe the text and the question EXACTLY as written.\nBe accurate and specific. Do not add commentary.';

async function readImage(bytes, env) {
  const out = await env.AI.run(VISION_MODEL, { image: bytes, prompt: VISION_PROMPT, max_tokens: 260 });
  let text = '';
  if (out && typeof out === 'object') text = out.response || out.description || out.result || '';
  else text = String(out == null ? '' : out);
  return String(text).trim().slice(0, 1400);
}

// ── Homepage pool builders (shared by the live routes AND the cron pre-warmer) ──
async function buildPreviewsPool(country, env){
  const batches = await Promise.allSettled(
    PREVIEW_QUERIES.map(qy =>
      searchEbay(qy, country, '', env)
        .then(r => (r.items || [])
          .filter(i => i.image && Number(i.price) >= 100)
          .slice(0, 5)
          .map(i => ({ ...i, searchQ: qy, country })))
        .catch(() => [])
    )
  );
  const pool = [];
  for (const b of batches) if (b.status === 'fulfilled') pool.push(...b.value);
  return pool;
}
async function buildHomePayload(country, env){
  let pools = { popmart: [], other: [] }, aliError = null;
  try { pools = await aliHomepagePools(env, country); } catch (e) { aliError = String(e.message || e); }
  const items = [];
  if (pools.popmart[0]) items.push(pools.popmart[0]);
  if (pools.other[0])   items.push(pools.other[0]);
  return { items, popmart: pools.popmart, other: pools.other, total: items.length, source: 'aliexpress-featured', aliError };
}

// ════════════════════════════════════════════════════════════════════════
// SEO landing pages - server-rendered (grid of real listings + unique copy)
// Serves only slugs that have hand-written content below, so a thin/empty
// page can never go live. Uses your existing searchListings() + detectCountry().
// ════════════════════════════════════════════════════════════════════════
const SEO_PAGES = {

  "cheap-yeezys": {
    query: "cheap yeezys",
    title: "Cheap Yeezys - Find the Cheapest Yeezys for Sale | FindAI",
    meta: "Browse the cheapest Yeezys for sale right now, sorted lowest-price first across eBay & AliExpress. Real listings, updated live.",
    h1: "Cheap Yeezys",
    sub: "The cheapest Yeezys for sale right now - sorted lowest price first, across eBay & AliExpress.",
    body: `<h2>Where to find cheap Yeezys</h2>
<p>The lowest Yeezy prices live on the resale market, not retail. Older 350 V2 colourways, Slides, and used pairs regularly sell below their original price - the trick is sorting by price and screening out fakes. If you're after a good pair rather than a specific hyped drop, used 350s and Slides in common sizes are where the real bargains sit; limited collaborations stay well above retail wherever you look.</p>
<h2>What to watch for</h2>
<p>The cheapest listings are also where replicas appear. Check the seller's feedback, insist on real photos (not stock images), and compare the box tag and stitching against an official pair. A listing priced far below every comparable pair is usually a warning, not a deal.</p>`,
    faqs: [
      ["Are cheap Yeezys real?", "Many are - older colourways and used pairs often sell below retail. But the cheapest listings are also where fakes appear, so check seller feedback and photos before buying."],
      ["Where are Yeezys cheapest?", "Resale marketplaces like eBay and AliExpress have the widest price spread. FindAI searches both and sorts cheapest-first."]
    ]
  },

  "cheap-jordans": {
    query: "cheap jordans",
    title: "Cheap Jordans - Find the Cheapest Air Jordans for Sale | FindAI",
    meta: "The cheapest Air Jordans for sale, sorted lowest-price first across eBay & AliExpress. Real listings, updated live with FindAI.",
    h1: "Cheap Jordans",
    sub: "The cheapest Air Jordans for sale right now - sorted lowest price first.",
    body: `<h2>Where Jordans are actually cheapest</h2>
<p>Retail rarely discounts Jordans and the hyped pairs sell out instantly, so the price spread lives on resale. Older general-release retros, less-hyped silhouettes (mids and lows), and lightly-worn used pairs are consistently the cheapest. Common sizes outside the 9-11 hype range also tend to go for less.</p>
<h2>Spotting fakes</h2>
<p>Check the stitching for neat, even work, compare the box label and SKU against the official release, and look at the shape of the silhouette and Jumpman logo - fakes often get the proportions subtly wrong. Limited collaborations like Travis Scott pairs stay well above retail, so a "cheap" one is a red flag.</p>`,
    faqs: [
      ["Are cheap Jordans real?", "Many are - older retros and used pairs sell below retail. The cheapest listings are also where fakes appear, so check feedback and photos and compare against the official pair."],
      ["What's a fair price for used Jordans?", "It depends on model and condition; general-release retros often sell second-hand below original retail, while limited pairs stay above it."]
    ]
  },

  "cheap-nike-dunks": {
    query: "cheap nike dunks",
    title: "Cheap Nike Dunks - Cheapest Dunks for Sale | FindAI",
    meta: "Find the cheapest Nike Dunks for sale, sorted lowest-price first across eBay & AliExpress. Real listings, updated live.",
    h1: "Cheap Nike Dunks",
    sub: "The cheapest Nike Dunks for sale right now - sorted lowest price first.",
    body: `<h2>Finding cheap Dunks</h2>
<p>Dunk prices swing hard by colourway. General-release Lows and the more widely-produced neutral colourways are where the cheap end sits; SB Dunks and limited collabs run far higher. Used pairs in good condition are often a fraction of deadstock price, so if you're flexible on colour and condition you can do well.</p>
<h2>What to check</h2>
<p>Dunks are heavily replicated, so verify the seller's feedback and photos, and compare the shape, panel stitching, and box label against the official release. A suspiciously cheap "SB" Dunk is the classic fake giveaway.</p>`,
    faqs: [
      ["Why are some Dunks so cheap?", "General-release Lows and common colourways are widely produced, so resale prices stay low - especially for used pairs."],
      ["Are cheap Nike Dunks fake?", "Not necessarily, but the cheapest listings are where replicas cluster. Check seller feedback, real photos, and details against the official pair."]
    ]
  },

  "cheap-air-force-1": {
    query: "cheap air force 1",
    title: "Cheap Air Force 1 - Cheapest AF1s for Sale | FindAI",
    meta: "Find the cheapest Nike Air Force 1 for sale, sorted lowest-price first across eBay & AliExpress. Real listings, updated live.",
    h1: "Cheap Air Force 1",
    sub: "The cheapest Nike Air Force 1 for sale right now - sorted lowest price first.",
    body: `<h2>Where AF1s are cheapest</h2>
<p>The classic white-on-white Air Force 1 Low is one of the most-produced sneakers ever, which keeps resale prices low and supply huge. Standard colourways and used pairs are where the cheapest listings sit; special editions and collabs cost more. Because they're so common, sticking to standard pairs in your size gets you the best price easily.</p>
<h2>What to watch for</h2>
<p>The flip side of popularity is heavy faking. Check seller feedback and real photos, and compare the stitching, the AF1 logo on the tongue, and the box label against an official pair before buying the cheapest listing.</p>`,
    faqs: [
      ["Why are Air Force 1s cheap?", "The standard white AF1 Low is mass-produced, so supply is high and resale prices stay low."],
      ["Are cheap AF1s real?", "Standard pairs often genuinely are, but the cheapest listings are where replicas appear - check feedback and photos."]
    ]
  },

  "labubu-for-sale": {
    query: "labubu",
    title: "Labubu For Sale - Find Labubu Figures & Blind Boxes | FindAI",
    meta: "Find Labubu figures and Pop Mart blind boxes for sale, with prices compared across eBay & AliExpress. Real listings, updated live.",
    h1: "Labubu For Sale",
    sub: "Labubu figures and blind boxes for sale - prices compared across marketplaces.",
    body: `<h2>Buying Labubu</h2>
<p>Labubu (from Pop Mart's The Monsters line) sells out fast at retail, so most buying happens on the resale market where prices vary widely by series and rarity. Sealed blind boxes, full sets, and the rarer "secret" figures command the biggest premiums; common figures and opened pieces are far cheaper. Decide whether you want a specific character or just any figure - it changes the price a lot.</p>
<h2>Spotting fakes</h2>
<p>Labubu is heavily counterfeited. Check the Pop Mart branding, the authenticity/QR sticker, the tooth count and face paint, and the seller's feedback. Genuine sealed boxes have consistent printing and a Pop Mart logo; blurry boxes or odd face details point to a fake.</p>`,
    faqs: [
      ["Why is Labubu so hard to find?", "Pop Mart releases sell out quickly, pushing most sales to the resale market where prices run above retail."],
      ["How do I spot a fake Labubu?", "Check Pop Mart branding, the authenticity sticker, face paint and tooth detail, and the seller's reviews - fakes often get the face and printing wrong."]
    ]
  },

  "cheap-pokemon-cards": {
    query: "cheap pokemon cards",
    title: "Cheap Pokemon Cards - Cheapest Cards & Packs for Sale | FindAI",
    meta: "Find cheap Pokemon cards, packs and bundles for sale, sorted lowest-price first across eBay & AliExpress. Real listings, updated live.",
    h1: "Cheap Pokemon Cards",
    sub: "The cheapest Pokemon cards, packs and bundles for sale right now.",
    body: `<h2>Finding cheap Pokemon cards</h2>
<p>"Cheap" covers a lot here - bulk commons, sealed packs, or affordable singles. Bulk lots and modern commons cost very little; sealed product and graded vintage cards run far higher. If you're building a collection or after specific cards, buying singles is usually cheaper than ripping packs and hoping. Decide between singles, sealed packs, or bulk before you shop.</p>
<h2>What to watch for</h2>
<p>Counterfeit cards and resealed packs are common at the cheap end. For singles, check the texture, font, and energy symbol; for sealed product, buy from sellers with strong feedback and clear photos. If a "sealed booster box" is priced well under market, treat it as suspect.</p>`,
    faqs: [
      ["Where can I buy cheap Pokemon cards?", "Resale marketplaces have the widest range - bulk lots and singles are cheapest, while sealed and graded cards cost more."],
      ["Are cheap Pokemon cards fake?", "Some are. Check card texture and print quality for singles, and buy sealed product only from sellers with strong feedback."]
    ]
  },

  "cheap-airpods": {
    query: "cheap airpods",
    title: "Cheap AirPods - Find the Cheapest AirPods for Sale | FindAI",
    meta: "Find the cheapest AirPods for sale, sorted lowest-price first across eBay & AliExpress. Real listings, updated live with FindAI.",
    h1: "Cheap AirPods",
    sub: "The cheapest AirPods for sale right now - sorted lowest price first.",
    body: `<h2>Where AirPods are cheapest</h2>
<p>Older generations and refurbished or open-box units are where the genuine savings are. A refurbished pair from a reputable seller can be a large discount on a new pair with little practical downside. Decide whether you need the latest generation - if not, a prior-gen or refurbished pair saves the most.</p>
<h2>What to watch for</h2>
<p>AirPods are among the most-counterfeited products online, and fakes can look convincing. Check the serial number on Apple's site if possible, buy from sellers with strong feedback, and be wary of a "new sealed" pair priced far below everyone else - that's the classic clone giveaway.</p>`,
    faqs: [
      ["Are cheap AirPods real?", "Prior-gen and refurbished pairs are genuinely cheaper, but the cheapest 'new' listings are often clones. Verify the serial and buy from reputable sellers."],
      ["What's the cheapest way to buy AirPods?", "A refurbished or open-box prior-generation pair from a seller with strong feedback usually gives the biggest genuine discount."]
    ]
  },

  "cheap-supreme": {
    query: "cheap supreme",
    title: "Cheap Supreme - Cheapest Supreme Items for Sale | FindAI",
    meta: "Find cheap Supreme for sale - tees, hoodies and accessories, sorted lowest-price first across eBay & AliExpress. Real listings, updated live.",
    h1: "Cheap Supreme",
    sub: "The cheapest Supreme items for sale right now - sorted lowest price first.",
    body: `<h2>Finding cheap Supreme</h2>
<p>Supreme resale spans a huge range - past-season tees and accessories are far cheaper than current-season or box-logo pieces. If you want the brand without the hype tax, older-season items and accessories (beanies, bags, small goods) are where the cheap end lives. Box-logo hoodies and collab pieces hold strong premiums.</p>
<h2>What to watch for</h2>
<p>Supreme is one of the most-faked streetwear brands. Check the stitching, the box-logo font and proportions, and the wash/care tags against a known-authentic reference, and favour sellers with strong feedback. A current box-logo at a bargain price is almost always fake.</p>`,
    faqs: [
      ["Why is some Supreme cheap?", "Past-season tees and accessories sell well below box-logo and collab pieces, so the brand is accessible if you skip the hyped items."],
      ["How do I avoid fake Supreme?", "Check stitching, logo font, and tags against authentic references, and buy from sellers with strong feedback. Cheap current box-logos are usually fake."]
    ]
  },

  // ════════════════════════════════════════════════════════════════════
  // "How to spot a fake" pages (batch 1 of 2). Paste these entries INSIDE
  // the SEO_PAGES object, right after the "cheap-supreme" entry's closing
  // brace and comma. agOnly:true restricts listings to eBay Authenticity
  // Guarantee items (sneakers/watches/bags) so no fakes show on the page.
  // ════════════════════════════════════════════════════════════════════

  "spot-fake-labubu": {
    query: "labubu",
    title: "How to Spot a Fake Labubu | FindAI",
    meta: "How to tell a real Pop Mart Labubu from a fake (a 'Lafufu'): tooth count, the QR sticker, foot stamp and face paint. Real vs fake, with live listings.",
    h1: "How to spot a fake Labubu",
    sub: "Tell a real Pop Mart Labubu from a fake - then compare live listings.",
    body: `<h2>How to tell a real Labubu from a fake</h2>
<p>Labubu (from Pop Mart's The Monsters line) is one of the most counterfeited collectibles online, and fakes are nicknamed "Lafufu". The good news is that genuine figures follow strict, checkable details. No single check is proof on its own, but a real Labubu passes all of them, while a fake usually slips up on at least one.</p>
<h2>Count the teeth</h2>
<p>The fastest check: a genuine Labubu has exactly nine small teeth, evenly spaced. If you count eight, ten, or see uneven, oddly shaped teeth, it is almost certainly fake. This is the single most reliable tell collectors use.</p>
<h2>Scan the QR and check the foot</h2>
<p>Authentic figures from late 2022 onward carry a QR code on a holographic sticker on the box (newer releases add a second code on the tag). Scanned with the Pop Mart app, a real code leads only to Pop Mart's official site. A code that redirects elsewhere, will not scan, or shows the figure was already verified months ago points to a fake or a copied code. Flip the figure over too: the foot should carry a clean embossed "POP MART" logo and the creator's name, and post-2023 figures hide a UV-reactive silhouette on the right foot that is invisible without a blacklight - if you can see it in normal light, it is fake.</p>
<h2>Face paint and box</h2>
<p>Real Labubu faces use a pale, peachy skin tone with soft airbrushed blush. Faces that look too pink, orange, yellow, or have thick, bold eyeliner are a fake giveaway. Genuine boxes have a matte finish, muted pastel colours, and crisp printing with a correctly spelled, red "POP MART" logo - blurry print, over-bright colours, or black/grey logo ink point to a counterfeit.</p>`,
    related: ["spot-fake-yeezys", "labubu-for-sale", "cheap-airpods"],
    faqs: [
      ["How many teeth does a real Labubu have?", "Exactly nine, evenly spaced. Eight, ten, or uneven teeth means it is almost certainly a fake."],
      ["Does a real Labubu have a QR code?", "Genuine figures from late 2022 on have a QR code on a holographic sticker that, scanned in the Pop Mart app, leads only to Pop Mart's official site. A missing, broken, or redirecting code is a red flag."],
      ["What is a Lafufu?", "It is the collector nickname for a fake Labubu. They often get the tooth count, face paint, or foot stamp wrong."]
    ]
  },

  "spot-fake-yeezys": {
    query: "yeezy",
    title: "How to Spot Fake Yeezys | FindAI",
    meta: "How to tell real Yeezys from replicas: the size tag, Boost midsole, insole print and box label. Real vs fake, with Authenticity Guaranteed listings.",
    h1: "How to spot fake Yeezys",
    sub: "Tell real Yeezys from replicas - listings below are eBay Authenticity Guaranteed.",
    body: `<h2>How to tell a real Yeezy from a fake</h2>
<p>Yeezys are among the most replicated sneakers in the world. The listings on this page are filtered to eBay's Authenticity Guarantee where available, meaning eBay has a third-party authenticator inspect the shoe before it reaches you. Even so, it helps to know the tells, because most fakes give themselves away in a few specific places.</p>
<h2>The size tag is the number one tell</h2>
<p>On a genuine pair the size-tag text is clean and evenly spaced. The biggest giveaway: the registered-trademark symbol should never touch the word "adidas" - if it touches, the pair is fake. Washed-out, too-thin, or too-thick printing, uneven letter spacing, and a missing factory code line are all replica signs.</p>
<h2>Boost midsole and insole</h2>
<p>Real Boost foam has a soft, bubbly, random "honeycomb" texture and a translucent midsole that lets light through like frosted glass. Fakes use denser rubber that blocks light and a more orderly, structured pellet pattern. Pull the insole: genuine ones feel smooth with sharp, thin printing and a clean adidas trefoil; fakes feel grainy with thicker, blurrier text.</p>
<h2>Stitching, box and serial</h2>
<p>The centre stitching down a real pair is thick and narrow with an even X-and-square pattern; fakes run thin, boxy, or loose. On the box label, US pairs end in serial suffix V02 or V03 and show three sizes, while international pairs end in V10 and show six sizes - a US label paired with a V10, or vice versa, is an instant fake.</p>`,
    agOnly: true,
    related: ["spot-fake-yeezy-350", "spot-fake-jordan-1", "spot-fake-nike-dunks", "cheap-yeezys"],
    faqs: [
      ["What is the fastest way to spot fake Yeezys?", "Check the size tag. If the registered-trademark symbol touches the word 'adidas', or the text is washed-out or unevenly spaced, the pair is fake."],
      ["Are all cheap Yeezys fake?", "No - older colourways and used pairs sell below retail. But the cheapest 'new' listings are where replicas cluster, so check the tells or buy Authenticity Guaranteed."],
      ["What serial should a real Yeezy box have?", "US pairs end in V02 or V03 with three sizes listed; international pairs end in V10 with six sizes. A mismatch is a fake."]
    ]
  },

  "spot-fake-yeezy-350": {
    query: "yeezy 350 v2",
    title: "How to Spot Fake Yeezy 350 V2 | FindAI",
    meta: "How to tell a real Yeezy Boost 350 V2 from a fake: size tag, SPLY-350 stripe, translucent Boost and middle stitching. Authenticity Guaranteed listings.",
    h1: "How to spot fake Yeezy 350 V2",
    sub: "Tell a real 350 V2 from a replica - listings below are eBay Authenticity Guaranteed.",
    body: `<h2>How to tell a real Yeezy 350 V2 from a fake</h2>
<p>The Boost 350 V2 is the single most faked Yeezy, so it is worth knowing its specific tells. The listings here are filtered to eBay's Authenticity Guarantee where available, so a third-party authenticator checks the shoe before delivery - but these checks let you judge any pair.</p>
<h2>Size tag and serial</h2>
<p>As with all Yeezys, the size tag is the number one check, and the registered-trademark symbol touching "adidas" is a guaranteed fake. On the V2 specifically, the box label's serial suffix must match the region: V02 or V03 for US pairs (three sizes shown), V10 for international (six sizes). A US box with a V10 is an instant fake.</p>
<h2>Translucent Boost and middle stitching</h2>
<p>Hold the shoe to the light - a genuine V2's semi-clear midsole lets you see the Boost pellets like frosted glass, while fakes use denser rubber that looks opaque and matte. The thick middle stitching down the centre stripe is narrow and dense on a real pair and UV-reactive under a blacklight; fakes run thin, boxy, and loose.</p>
<h2>Insole and laces</h2>
<p>Pull the insole: real ones are smooth with a thin, sharp adidas trefoil and crisp text, while fakes feel grainy with thicker, less-defined printing. The reflective pairs use a tight, evenly aligned 3M weave in the laces that lights up uniformly under flash - fakes scatter the reflective yarn so it sparkles unevenly.</p>`,
    agOnly: true,
    related: ["spot-fake-yeezys", "spot-fake-nike-dunks", "cheap-yeezys"],
    faqs: [
      ["How do I spot a fake Yeezy 350 V2?", "Start with the size tag (the trademark symbol must not touch 'adidas'), then check the translucent Boost midsole and the dense, narrow middle stitching."],
      ["Is the Boost midsole see-through on a real pair?", "Yes - a genuine 350 V2 midsole is translucent and lets light through to reveal the Boost pellets. An opaque, matte midsole is a fake sign."],
      ["What does SPLY-350 look like on a fake?", "Fakes often print the SPLY-350 side stripe text too thin or reversed incorrectly. Compare it against an official image of your exact colourway."]
    ]
  },

  "spot-fake-jordan-1": {
    query: "air jordan 1",
    title: "How to Spot Fake Jordan 1 | FindAI",
    meta: "How to tell real Air Jordan 1s from fakes: the wings logo, hourglass shape, heel stitching and Swoosh. Real vs replica, with Authenticity Guaranteed listings.",
    h1: "How to spot fake Jordan 1",
    sub: "Tell a real Air Jordan 1 from a replica - listings below are eBay Authenticity Guaranteed.",
    body: `<h2>How to tell a real Jordan 1 from a fake</h2>
<p>The Air Jordan 1 is one of the most replicated sneakers ever made. The listings on this page are filtered to eBay's Authenticity Guarantee where available, so a third-party authenticator inspects the shoe before delivery. These checks help you judge any pair you come across.</p>
<h2>The wings logo and the silhouette</h2>
<p>On a real Jordan 1 the wings logo has clean, even spacing and the letters are crisp - on the word "JORDAN" the R and D always touch, and if they do not, it is an instant fake. The shoe should also have a distinct "hourglass" silhouette: wider at the top collar and bottom, tapering in at the middle. Fakes often look bulky and inflated at the heel and miss that curve.</p>
<h2>Heel stitching and Swoosh</h2>
<p>Turn the shoe around: a genuine Jordan 1 High has double-stacked stitching across the rear panel where the upper meets the lower, while fakes commonly use a single stitch line. The Swoosh should be smooth with a sharp, pointed tip; replica Swooshes are often too thick, bulky, or end in a rounded tip.</p>
<h2>Toe box, tongue tag and smell</h2>
<p>The toe-box perforations should be uniform and punched all the way through to the inside - shallow or uneven holes are a fake sign. The tongue label text should be straight and cleanly printed, not wavy. And a strong chemical or glue smell is a classic counterfeit giveaway; a genuine pair has little odour.</p>`,
    agOnly: true,
    related: ["spot-fake-jordan-4", "spot-fake-yeezys", "spot-fake-nike-dunks", "spot-fake-air-force-1", "cheap-jordans"],
    faqs: [
      ["What is the quickest Jordan 1 fake check?", "Look at the word 'JORDAN' on the wings logo - the R and D must touch. If they do not, the pair is fake."],
      ["What is the hourglass shape?", "A real Jordan 1 is wider at the collar and base and tapers in at the middle, forming an hourglass. Fakes often look bulky and straight through the middle."],
      ["Do real Jordan 1s have double heel stitching?", "On the High, yes - the rear panel uses double-stacked stitching. A single stitch line there is a common fake sign."]
    ]
  },

  "spot-fake-jordan-4": {
    query: "air jordan 4",
    title: "How to Spot Fake Jordan 4 | FindAI",
    meta: "How to tell real Air Jordan 4s from fakes: the suede brush test, heel bump, plastic cage and AIR midsole print. Authenticity Guaranteed listings.",
    h1: "How to spot fake Jordan 4",
    sub: "Tell a real Air Jordan 4 from a replica - listings below are eBay Authenticity Guaranteed.",
    body: `<h2>How to tell a real Jordan 4 from a fake</h2>
<p>The Air Jordan 4 has a few tells that are specific to its design. The listings here are filtered to eBay's Authenticity Guarantee where available, so a third-party authenticator checks the shoe before it ships. The checks below help you assess any pair.</p>
<h2>The suede brush test</h2>
<p>On suede colourways, this is the standout check: brush your finger across genuine Jordan 4 suede and it leaves a visible darker streak that changes with direction. Fake suede stays flat and light with no colour shift - a sign of cheaper material. Real leather and nubuck also have a natural grain, while fakes feel stiff or plastic-like.</p>
<h2>Plastic cage and AIR print</h2>
<p>Look at the lace cage (the plastic wings): on a real pair it is straight and well-defined, while fakes are often too transparent and rounded. The "AIR" printed on the midsole should be thin, tall, and sit low near the edge of the midsole; fakes print it smaller, thicker, and too high up.</p>
<h2>Heel bump, footbed and Air window</h2>
<p>From the side, a genuine Jordan 4 shows a slight curved bump at the heel - fakes are flat or too straight. Pull the insole and the footbed stitching should be dense and circular; fakes skip rows or stitch messily. The Air unit window in the sole should be clear and precisely positioned, not cloudy or misaligned.</p>`,
    agOnly: true,
    related: ["spot-fake-jordan-1", "spot-fake-nike-dunks", "spot-fake-air-force-1", "cheap-jordans"],
    faqs: [
      ["What is the suede test on a Jordan 4?", "Brush the suede - genuine Jordan 4 suede leaves a darker streak that shifts with direction. Fake suede stays flat and light with no colour change."],
      ["How is the AIR midsole print different on fakes?", "Real pairs print 'AIR' thin, tall, and low near the midsole edge. Fakes print it smaller, thicker, and positioned too high."],
      ["Does a real Jordan 4 have a heel bump?", "Yes - from the side there is a slight curved bump at the heel. Fakes tend to look flat or too straight there."]
    ]
  },

  "spot-fake-nike-dunks": {
    query: "nike dunk",
    title: "How to Spot Fake Nike Dunks | FindAI",
    meta: "How to tell real Nike Dunks from fakes: Swoosh shape and placement, toe-box, heel embroidery and the SKU. Real vs replica, with Authenticity Guaranteed listings.",
    h1: "How to spot fake Nike Dunks",
    sub: "Tell real Nike Dunks from replicas - listings below are eBay Authenticity Guaranteed.",
    body: `<h2>How to tell a real Nike Dunk from a fake</h2>
<p>Nike Dunks are heavily replicated, especially the hyped SB and panda colourways. The listings on this page are filtered to eBay's Authenticity Guarantee where available, so a third-party authenticator inspects the shoe before delivery. These tells help you judge any pair.</p>
<h2>The Swoosh shape and placement</h2>
<p>The Swoosh is the fastest check. On a real Dunk it has a smooth, natural curve, is thicker at the bottom and tapers toward the top, and sits high on the shoe - it never droops down to touch the midsole. Fakes often make the Swoosh too straight, chunky, or place it too low so it sags onto the midsole.</p>
<h2>Toe box and heel embroidery</h2>
<p>A genuine Dunk has a firm, puffed-up toe box with a defined curve that holds its shape; fakes look flat and flimsy there. On the heel, the "NIKE" embroidery should have each letter standing apart with dense, even stitching - on fakes the letters touch, lean, or sit on loose threads.</p>
<h2>The size tag and SKU</h2>
<p>Inside the tongue, the size-tag font should be one consistent, medium weight. Fakes mix font weights or print the style code in thick, boxy letters. Crucially, the nine-digit SKU on that tag must exactly match the SKU printed on the box - a mismatch, or a missing code, is a strong fake sign.</p>`,
    agOnly: true,
    related: ["spot-fake-jordan-1", "spot-fake-air-force-1", "spot-fake-yeezys", "cheap-nike-dunks"],
    faqs: [
      ["What is the easiest Nike Dunk fake check?", "The Swoosh - it should curve smoothly and sit high, never touching the midsole. A chunky or low-sagging Swoosh is a fake sign."],
      ["Should the SKU match the box?", "Yes - the nine-digit style code on the inner tongue tag must match the SKU on the box exactly. A mismatch is a strong fake signal."],
      ["How can I tell a fake Panda Dunk?", "Check the Swoosh shape and placement, the firm toe box, and that the heel 'NIKE' letters stand apart - then confirm the SKU matches the box."]
    ]
  },

  "spot-fake-air-force-1": {
    query: "nike air force 1",
    title: "How to Spot Fake Air Force 1s | FindAI",
    meta: "How to tell real Nike Air Force 1s from fakes: the 8 eyelets, perforation pattern, heel Swoosh and AF1 insole. Real vs replica, with Authenticity Guaranteed listings.",
    h1: "How to spot fake Air Force 1s",
    sub: "Tell real Air Force 1s from replicas - listings below are eBay Authenticity Guaranteed.",
    body: `<h2>How to tell a real Air Force 1 from a fake</h2>
<p>The Air Force 1 is so popular it is one of the most faked sneakers in the world. The listings here are filtered to eBay's Authenticity Guarantee where available, so a third-party authenticator checks the shoe before it ships. These checks help you judge any pair.</p>
<h2>Eyelets and toe perforations</h2>
<p>Count the lace holes: a real Air Force 1 Low has exactly eight eyelets. On the toe box, the perforation holes follow a clean, even pattern and are punched all the way through - fakes often have uneven holes, the wrong count, or sometimes a small alignment mark on the toe that a genuine pair never has.</p>
<h2>The heel and the rear Swoosh</h2>
<p>At the back, the "AIR" text and the small Swoosh should be cleanly spaced, with the Swoosh short enough that it stops at the right point and does not wrap too far around the heel. Fakes stretch the rear Swoosh too long, mis-space the "AIR" letters, or print them too high so they nearly touch the Swoosh.</p>
<h2>Insole logo, stitching and SKU</h2>
<p>A genuine AF1 has its own model-specific insole logo, not the generic Nike Swoosh, and the Nike Air logo on the tongue is stitched, not printed. The side stitching is tight and compact, and the nine-digit SKU on the inner label must match the box. A pair with a printed tongue logo, loose stitching, or a mismatched SKU is suspect.</p>`,
    agOnly: true,
    related: ["spot-fake-jordan-1", "spot-fake-nike-dunks", "spot-fake-yeezys", "cheap-air-force-1"],
    faqs: [
      ["How many eyelets does a real Air Force 1 have?", "The Air Force 1 Low has exactly eight eyelets. A different count is a quick fake sign."],
      ["Is the tongue logo stitched or printed on a real AF1?", "Stitched. Fakes often print the Nike Air tongue logo instead of embroidering it."],
      ["Should the insole have the Swoosh logo?", "No - a genuine Air Force 1 has its own model-specific insole logo, not the generic Nike Swoosh."]
    ]
  },

  "spot-fake-rolex": {
    query: "rolex",
    title: "How to Spot a Fake Rolex | FindAI",
    meta: "How to tell a real Rolex from a fake: the Cyclops magnification, laser-etched crown, rehaut engraving and solid caseback. Authenticity Guaranteed listings.",
    h1: "How to spot a fake Rolex",
    sub: "Tell a real Rolex from a replica - listings below are eBay Authenticity Guaranteed.",
    body: `<h2>How to tell a real Rolex from a fake</h2>
<p>Rolex is the most counterfeited watch brand in the world, and modern "super clones" can pass a quick glance. The listings on this page are filtered to eBay's Authenticity Guarantee where available, meaning a professional authenticator inspects the watch before it reaches you - which matters more here than on almost any other item. The checks below help you judge a listing.</p>
<h2>The Cyclops and the date</h2>
<p>The Cyclops lens over the date should magnify it 2.5 times, so the date number looks large, bold, and fills the lens, and the lens itself is visibly domed (convex). On many fakes the magnification is weak - the date looks only slightly larger, sits off-centre, or floats in the middle of the window. A flat, low-magnification Cyclops is a strong fake sign.</p>
<h2>The laser-etched crown and rehaut</h2>
<p>Since around 2002, genuine Rolex crystals carry a tiny laser-etched crown at the 6 o'clock position, made of microscopic dots that are almost invisible without a loupe. Fakes either skip it or etch it too large and obvious. Since 2008, the rehaut (the inner ring between dial and crystal) is engraved "ROLEXROLEXROLEX" all the way around with the serial number at 6 o'clock - if the engraving runs around with no break for a serial, it is a cheap fake.</p>
<h2>The caseback and movement</h2>
<p>Almost every Rolex sport model - Submariner, GMT-Master, Daytona, Sea-Dweller - has a solid, plain screw-down caseback. A clear "exhibition" caseback showing the movement on one of these references is an almost certain fake; counterfeiters add them to show off the clone movement. The ultimate check is the movement itself, which no fake replicates perfectly - but that requires a watchmaker, which is exactly why buying Authenticity Guaranteed removes the guesswork.</p>`,
    agOnly: true,
    related: ["spot-fake-jordan-1", "spot-fake-yeezys"],
    faqs: [
      ["What is the fastest fake Rolex check?", "Look through the Cyclops at the date - on a real Rolex it is magnified 2.5x, large, bold and centred. Weak magnification or an off-centre date is a fake sign."],
      ["Should a Rolex have a clear caseback?", "Almost all Rolex sport models (Submariner, GMT, Daytona, Sea-Dweller) have a solid caseback. A clear exhibition back on these is an almost certain fake."],
      ["What is the rehaut engraving?", "Since 2008 the inner ring reads 'ROLEXROLEXROLEX' around the dial with the serial number at 6 o'clock. If there is no break for the serial, it is a cheap fake."]
    ]
  },

  // ── WAVE 2+ : add a slug here only once its unique content is written. ──
  // Any slug NOT in this map returns null below → falls through (never a thin page).
};

function seoCardHtml(item) {
  const src = String(item.source || "").toLowerCase();
  const price = (item.price != null && Number(item.price) > 0) ? "$" + Number(item.price).toFixed(2) : "";
  const title = String(item.title || "").replace(/[\u2014\u2013]/g, "-").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const img = item.image || "";
  const link = item.url || "#";
  // eBay Authenticity Guarantee badge - shown only when eBay's own qualifiedPrograms flag
  // marks this listing as AG-eligible (a third-party authenticator checks the item before
  // it ships to the buyer). Worded as eBay's program, not a FindAI verification.
  const agBadge = item.agEligible
    ? `<span class="ag-badge" title="eBay Authenticity Guarantee: an independent authenticator inspects this item before it ships to you">&#10003; Authenticity Guarantee</span>`
    : "";
  return `<a class="card" href="${link}" target="_blank" rel="nofollow sponsored">` +
    `<div class="thumb">${img ? `<img src="${img}" alt="${title}" loading="lazy">` : ""}${agBadge}</div>` +
    `<div class="card-body"><div class="card-title">${title}</div>` +
    `<div class="ac-meta"><span class="src">${src}</span><span class="price">${price}</span></div></div></a>`;
}

function seoPageHtml(slug, cfg, listings) {
  const grid = listings.map(seoCardHtml).join("");
  const faqJson = JSON.stringify({
    "@context": "https://schema.org", "@type": "FAQPage",
    "mainEntity": cfg.faqs.map(([q, a]) => ({ "@type": "Question", "name": q, "acceptedAnswer": { "@type": "Answer", "text": a } }))
  });
  const faqHtml = cfg.faqs.map(([q, a]) => `<div class="faq"><h3>${q}</h3><p>${a}</p></div>`).join("");
  const ctaLabel = cfg.h1.replace(/^Cheap |^Pre-owned /, "");
  // Spot-a-fake pages are educational first: the listings are a small eBay-verified row,
  // and we DROP the big "See All" button so it doesn't pull readers away from the how-to text.
  // The cheap-X pages keep the button (they're a shopping funnel). agOnly flags spot-fake pages.
  const isSpotFake = cfg.agOnly === true;
  // Spot-a-fake pages drop the subtitle line entirely (it overclaimed "Authenticity
  // Guaranteed" when listings can fall back to regular eBay). The how-to text carries the page.
  const subHtml = isSpotFake ? "" : `<p class="sub">${cfg.sub}</p>`;
  const ctaHtml = isSpotFake
    ? ""
    : `<div class="bigcta"><a href="/?q=${encodeURIComponent(cfg.query)}">See All ${ctaLabel} &rarr;</a></div>`;
  // "Related guides" - internal links between SEO pages. cfg.related holds slugs; we look up
  // each one's H1 for the link text. Cross-links the spot-a-fake pages to each other and to
  // their paired "cheap X" pages, which helps Google crawl them and passes authority between them.
  const relatedHtml = (Array.isArray(cfg.related) && cfg.related.length)
    ? `<div class="related"><div class="related-h">Related guides</div>` +
      cfg.related
        .filter(rs => SEO_PAGES[rs])
        .map(rs => `<a class="related-link" href="/${rs}">${SEO_PAGES[rs].h1}</a>`)
        .join("") +
      `</div>`
    : "";
  return `<!DOCTYPE html><html lang="en"><head>` +
`<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">` +
`<title>${cfg.title}</title><meta name="description" content="${cfg.meta}">` +
`<link rel="canonical" href="https://findai.ai/${slug}">` +
`<meta property="og:title" content="${cfg.h1}"><meta property="og:description" content="${cfg.meta}">` +
`<meta property="og:url" content="https://findai.ai/${slug}"><meta property="og:type" content="website">` +
`<meta name="theme-color" content="#1a6fff">` +
`<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">` +
`<script type="application/ld+json">${faqJson}</script><style>` +
`*{box-sizing:border-box;margin:0;padding:0}body{font-family:'DM Sans',sans-serif;background:#000;color:#e5e5e5;line-height:1.6}` +
`nav{padding:0 20px;display:flex;align-items:center;justify-content:space-between;height:52px;position:sticky;top:0;background:#000;border-bottom:1px solid #1a1a1a}` +
`.nav-logo{font-size:24px;font-weight:700;color:#fff;text-decoration:none}.nav-cta{padding:7px 18px;border-radius:20px;font-size:13px;font-weight:600;color:#000;background:#fff;text-decoration:none}` +
`.wrap{max-width:1100px;margin:0 auto;padding:30px 20px 70px}h1{font-size:clamp(26px,4.5vw,38px);font-weight:700;color:#fff;margin-bottom:6px}` +
`.sub{font-size:15px;color:#9a9a9a;margin-bottom:24px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(165px,1fr));gap:14px;margin-bottom:18px}` +
`.card{background:#0c0c0c;border:1px solid #1a1a1a;border-radius:14px;overflow:hidden;text-decoration:none;display:flex;flex-direction:column}` +
`.thumb{position:relative;aspect-ratio:1/1;background:#101216;display:flex;align-items:center;justify-content:center;overflow:hidden}.thumb img{width:100%;height:100%;object-fit:cover}` +
`.ag-badge{position:absolute;top:8px;right:8px;background:#1a6fff;color:#fff;font-size:10px;font-weight:600;padding:4px 8px;border-radius:20px;display:flex;align-items:center;gap:3px;line-height:1;letter-spacing:.2px}` +
`.card-body{padding:9px 10px}.card-title{font-size:12.5px;color:#d8d8d8;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:34px}` +
`.ac-meta{position:relative;display:flex;align-items:center;justify-content:center;min-height:26px;margin-top:6px}` +
`.src{position:absolute;left:0;top:50%;transform:translateY(-50%);font-size:10px;font-weight:600;color:#6b7280}.price{font-size:15px;font-weight:700;color:#fff}` +
`.bigcta{text-align:center;margin:8px 0 38px}.bigcta a{display:inline-block;background:#1a6fff;color:#fff;font-weight:600;font-size:17px;padding:16px 42px;border-radius:32px;text-decoration:none}` +
`.content{max-width:720px}.content h2{font-size:20px;color:#fff;font-weight:600;margin:24px 0 10px}.content p{color:#c4c4c4;margin-bottom:12px;font-size:15px}` +
`.faq{border-top:1px solid #1a1a1a;padding:14px 0}.faq h3{font-size:15px;color:#fff;margin-bottom:5px}.faq p{font-size:14px;color:#bcbcbc;margin:0}` +
`.related{max-width:720px;margin:30px 0 0;padding-top:18px;border-top:1px solid #1a1a1a}` +
`.related-h{font-size:13px;color:#888;font-weight:600;margin-bottom:10px}` +
`.related-link{display:inline-block;font-size:13px;color:#4d9fe6;border:1px solid #1f3a52;border-radius:16px;padding:5px 12px;margin:0 8px 8px 0;text-decoration:none}` +
`.related-link:hover{background:#0e2a44}` +
`footer{text-align:center;padding:24px;font-size:12px;color:#555;border-top:1px solid #111}footer a{color:#777;text-decoration:none}` +
`</style></head><body>` +
`<nav><a href="/" class="nav-logo">FindAI</a><a href="/?q=${encodeURIComponent(cfg.query)}" class="nav-cta">Search</a></nav>` +
`<main class="wrap"><h1>${cfg.h1}</h1>${subHtml}` +
`<div class="grid">${grid}</div>` +
`${ctaHtml}` +
`<div class="content">${cfg.body}<h2>Quick questions</h2>${faqHtml}</div>${relatedHtml}</main>` +
`<footer><span>&copy; 2026 FindAI · <a href="/">findai.ai</a> · <a href="/about.html">About</a></span></footer>` +
`</body></html>`;
}

// Minimum days of REAL snapshot history before a product page is allowed to
// be indexed. Below this, the page still renders (so early visitors/direct
// links work) but carries <meta name="robots" content="noindex"> - a page
// with an empty/near-empty chart is thin content, and Google seeing a batch
// of those hurts trust for the WHOLE domain, not just those pages.
const PRODUCT_SEO_MIN_SNAPSHOT_DAYS = 7;

// Server-rendered SVG price chart - same visual language as the tracker's
// canvas chart (drawPriceChart in index.html): dark gridlines, gradient area
// fill, green/red/blue line by trend direction, dashed baseline for a single
// data point. This is an <svg> baked directly into the HTML, so it's real
// content Google sees immediately - not a JS canvas that renders after load.
function priceHistorySvg(history) {
  const W = 860, H = 220, padL = 6, padR = 6, padT = 15, padB = 25;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const grid = [0, 1, 2, 3].map(g => {
    const y = padT + plotH * g / 3;
    return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#1a1a1a" stroke-width="1"/>`;
  }).join('');
  if (!history.length) {
    return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">` +
      `<rect width="${W}" height="${H}" fill="#0b0b0b"/>${grid}` +
      `<text x="${W / 2}" y="115" fill="#666" font-size="13" font-family="DM Sans, sans-serif" text-anchor="middle">Price history builds as this item is tracked</text>` +
      `</svg>`;
  }
  const vals = history.map(h => h.avg_price || 0);
  let min = Math.min(...vals), max = Math.max(...vals);
  const pad = (max - min) * 0.18 || max * 0.1 || 1;
  min -= pad; max += pad;
  const single = history.length === 1;
  const trend = single ? 0 : (vals[vals.length - 1] - vals[0]);
  const rgb = trend > 0 ? '34,197,94' : (trend < 0 ? '239,68,68' : '26,111,255');
  const col = trend > 0 ? '#22c55e' : (trend < 0 ? '#ef4444' : '#1a6fff');
  const xAt = i => single ? (W - padR - 5) : (padL + plotW * i / (history.length - 1));
  const yAt = v => padT + plotH - ((v - min) / (max - min)) * plotH;

  let body;
  if (single) {
    const yv = yAt(vals[0]);
    body = `<line x1="${padL}" y1="${yv}" x2="${xAt(0)}" y2="${yv}" stroke="rgba(26,111,255,0.35)" stroke-width="2" stroke-dasharray="5,6"/>` +
      `<circle cx="${xAt(0)}" cy="${yv}" r="4" fill="${col}"/>`;
  } else {
    const linePts = vals.map((v, i) => `${xAt(i)},${yAt(v)}`).join(' ');
    const areaPts = `${xAt(0)},${padT + plotH} ${linePts} ${xAt(vals.length - 1)},${padT + plotH}`;
    const dots = vals.map((v, i) => `<circle cx="${xAt(i)}" cy="${yAt(v)}" r="2.5" fill="${col}"/>`).join('');
    body = `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0%" stop-color="rgba(${rgb},0.32)"/><stop offset="100%" stop-color="rgba(${rgb},0.02)"/></linearGradient></defs>` +
      `<polygon points="${areaPts}" fill="url(#g)"/>` +
      `<polyline points="${linePts}" fill="none" stroke="${col}" stroke-width="2"/>${dots}`;
  }
  const dateLabels = [0, Math.floor((history.length - 1) / 2), history.length - 1]
    .filter((v, i, a) => a.indexOf(v) === i)
    .map(i => `<text x="${xAt(i)}" y="${H - 6}" fill="#666" font-size="11" font-family="DM Sans, sans-serif" text-anchor="middle">${(history[i].snapshot_date || '').slice(5)}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">` +
    `<rect width="${W}" height="${H}" fill="#0b0b0b"/>${grid}${body}${dateLabels}</svg>`;
}

function productSeoImgUrl(u) {
  if (!u) return '';
  return /^https:\/\/images\.stockx\.com\//i.test(u) ? `https://findai.ai/img?u=${encodeURIComponent(u)}` : u;
}

function productSeoEsc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function productSeoPlain(value, maxLength = 5000) {
  return String(value == null ? '' : value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function productSeoPageHtml(p, history, listings, indexable) {
  const graph = p._productGraph || {};
  const rawTitle = productSeoPlain(p.title || p.model || '', 300);
  const rawBrand = productSeoPlain(p.brand || '', 120);
  const titleBase = rawTitle || [rawBrand, productSeoPlain(p.model || '', 220), productSeoPlain(p.colorway || '', 120)].filter(Boolean).join(' ') || 'Product';
  const title = rawBrand && !titleBase.toLowerCase().startsWith(rawBrand.toLowerCase()) ? `${rawBrand} ${titleBase}` : titleBase;
  const productCode = productSeoPlain(p.manufacturer_part_number || p.style_id || '', 120);
  const styleLine = productCode ? ` (${productCode})` : '';
  const h1 = productSeoEsc(`${title} Price History${styleLine}`);
  const min = history.length ? Math.min(...history.map(h => h.min_price || h.avg_price)) : null;
  const max = history.length ? Math.max(...history.map(h => h.max_price || h.avg_price)) : null;
  const latest = history.length ? history[history.length - 1] : null;
  const marketNames = (p.category_key === 'sneakers' || p.product_type === 'sneaker') ? 'eBay and StockX' : 'major marketplaces';
  const metaText = min && max
    ? `Track ${title}'s real price history — ranging from $${Math.round(min)} to $${Math.round(max)} across ${marketNames}. Updated daily.`
    : `Compare live listings for ${title}, view official product information and watch its price history build over time on FindAI.`;
  const meta = productSeoEsc(metaText.slice(0, 300));
  const descriptionText = productSeoPlain(p.long_description || p.short_description || graph.longDescription || graph.shortDescription || '', 6000);
  const bodyParas = [];
  if (descriptionText) bodyParas.push(`<p>${productSeoEsc(descriptionText)}</p>`);
  bodyParas.push(`<p>${productSeoEsc(title)}${productCode ? ` (model ${productSeoEsc(productCode)})` : ''} is tracked on FindAI across ${productSeoEsc(marketNames)}, so you can compare current offers with its historical market price.</p>`);
  bodyParas.push(min && max
    ? `<p>So far, ${productSeoEsc(title)} has ranged from <strong>$${Math.round(min)}</strong> to <strong>$${Math.round(max)}</strong>${latest ? `, with a current market price around <strong>$${Math.round(latest.avg_price)}</strong>` : ''}. This range updates as new listings are observed.</p>`
    : `<p>This product was recently added to FindAI. Its price history will build as verified marketplace listings are observed.</p>`);

  const graphSpecs = Array.isArray(graph.specs) ? graph.specs : [];
  const visibleSpecs = graphSpecs
    .filter(s => s && s.name && (s.presentation_value || s.presentationValue || s.value))
    .slice(0, 24);
  const specsHtml = visibleSpecs.length
    ? `<div class="card" style="margin-top:20px"><h2>Specifications</h2><div class="spec-grid">${visibleSpecs.map(s => {
        const name = productSeoEsc(productSeoPlain(s.name, 160));
        const value = productSeoEsc(productSeoPlain(s.presentation_value || s.presentationValue || s.value, 400));
        return `<div class="spec"><span>${name}</span><strong>${value}</strong></div>`;
      }).join('')}</div></div>`
    : '';

  const heroImg = productSeoImgUrl(graph.primaryImageUrl || p.image_url) || (listings[0] && listings[0].image) || '';

  const priced = listings.filter(l => l.price > 0);
  const cheapest = priced.length ? Math.min(...priced.map(l => l.price)) : null;
  const highest = priced.length ? Math.max(...priced.map(l => l.price)) : null;
  const listingCards = listings.slice(0, 9).map(l => {
    const isBest = cheapest !== null && l.price === cheapest;
    const isHighest = highest !== null && l.price === highest && highest !== cheapest;
    const srcLabel = productSeoEsc(l.source || (l.stockx || l._stockx ? 'StockX' : 'Marketplace'));
    const img = productSeoImgUrl(l.stockxImage || l.image);
    const listingTitle = productSeoEsc(productSeoPlain(l.title || '', 100));
    return `<div class="lc${isBest ? ' best' : ''}">` +
      (img ? `<div class="lc-thumb"><img src="${productSeoEsc(img)}" alt="" loading="lazy"></div>` : '') +
      `<div class="lc-src">${srcLabel}</div>` +
      `<div class="lc-price">${l.price ? '$' + Number(l.price).toLocaleString() : 'See listing'}</div>` +
      `<div class="lc-title">${listingTitle}</div>` +
      (l.url ? `<a class="lc-btn" href="${l.url}" target="_blank" rel="noopener nofollow">View listing</a>` : '') +
      (isBest ? `<div class="lc-badge">Best Price</div>` : (isHighest ? `<div class="lc-badge" style="background:#333">Highest Price</div>` : '')) +
      `</div>`;
  }).join('');

  // Four pre-rendered ranges, ALL baked into the initial HTML (not fetched on
  // tab click) - so every range is real, crawlable content from the first
  // response, and the tabs are pure client-side visibility toggling with zero
  // extra network requests.
  const now = new Date();
  const windowed = (days) => {
    const cutoff = new Date(now); cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    return history.filter(h => h.snapshot_date >= cutoffStr);
  };
  const ranges = { '7': windowed(7), '30': windowed(30), '90': windowed(90), '365': windowed(365) };
  const rangeSvgs = Object.keys(ranges).map(k =>
    `<div class="rng-panel" data-range="${k}" style="display:${k === '30' ? 'block' : 'none'}">${priceHistorySvg(ranges[k])}</div>`
  ).join('');

  const primaryGtin = Array.isArray(graph.identifiers)
    ? (graph.identifiers.find(i => String(i.scheme || '').toLowerCase() === 'gtin') || {}).value
    : undefined;
  const jsonLd = JSON.stringify(Object.assign({
    "@context": "https://schema.org",
    "@type": "Product",
    "name": title,
    "description": descriptionText || undefined,
    "brand": p.brand ? { "@type": "Brand", "name": p.brand } : undefined,
    "sku": productCode || p.fpid || undefined,
    "mpn": p.manufacturer_part_number || p.style_id || undefined,
    "gtin": primaryGtin || undefined,
    "category": p.category_key || p.product_type || undefined,
    "image": heroImg || undefined
  }, (min && max) ? {
    "offers": {
      "@type": "AggregateOffer",
      "lowPrice": Math.round(min),
      "highPrice": Math.round(max),
      "priceCurrency": "USD",
      "offerCount": history.length
    }
  } : {}));
  const robotsTag = indexable ? '' : `<meta name="robots" content="noindex,follow">`;

  return `<!DOCTYPE html><html lang="en"><head>` +
`<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">` +
`<title>${h1} | FindAI</title><meta name="description" content="${meta}">` +
`<link rel="canonical" href="https://findai.ai/price/${p.slug}">` +
`${robotsTag}` +
`<meta property="og:title" content="${h1}"><meta property="og:description" content="${meta}">` +
`<meta property="og:url" content="https://findai.ai/price/${p.slug}"><meta property="og:type" content="website">` +
`${heroImg ? `<meta property="og:image" content="${heroImg}">` : ''}` +
`<meta name="theme-color" content="#1a6fff">` +
`<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">` +
`<script type="application/ld+json">${jsonLd}</script><style>` +
`*{box-sizing:border-box;margin:0;padding:0}body{font-family:'DM Sans',sans-serif;background:#000;color:#e5e5e5;line-height:1.6}` +
// ── Nav: same classes/colors as the real app's header ──────────────────
`nav{padding:0 20px;display:flex;align-items:center;justify-content:space-between;height:52px;position:sticky;top:0;background:#000;border-bottom:1px solid #1a1a1a;z-index:20}` +
`.nav-logo{font-size:24px;font-weight:700;color:#fff;text-decoration:none;cursor:pointer;border:none;background:none;font-family:'DM Sans',sans-serif}` +
`.nav-links{display:flex;align-items:center;gap:10px}` +
`.nav-secondary{background:#fff;color:#000;border:none;font-weight:600;padding:8px 16px;border-radius:20px;font-size:13px;cursor:pointer;font-family:'DM Sans',sans-serif}` +
`.nav-cta{padding:8px 18px;border-radius:20px;font-size:13px;font-weight:600;color:#000;background:#1a6fff;color:#fff;border:none;cursor:pointer;font-family:'DM Sans',sans-serif}` +
`.nav-avatar{width:34px;height:34px;border-radius:50%;background:#333;color:#fff;border:none;font-weight:700;cursor:pointer;font-family:'DM Sans',sans-serif}` +
// ── Search bar: same visual language as the app's centered search ──────
`.searchbar-wrap{max-width:700px;margin:22px auto 0;padding:0 20px;position:relative}` +
`.searchbar{display:flex;gap:8px}` +
`.searchbar input{flex:1;background:#111;border:1.5px solid #2a2a2a;color:#fff;padding:14px 20px;border-radius:26px;font-size:15px;font-family:'DM Sans',sans-serif}` +
`.searchbar input:focus{outline:none;border-color:#1a6fff}` +
`.searchbar button{background:#1a6fff;border:none;color:#fff;padding:0 26px;border-radius:26px;font-size:14px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif}` +
`.suggest{position:absolute;top:calc(100% + 8px);left:20px;right:20px;background:#111;border:1px solid #2a2a2a;border-radius:14px;max-height:400px;overflow-y:auto;z-index:15;display:none;box-shadow:0 12px 32px rgba(0,0,0,.6)}` +
`.sug-item{display:flex;align-items:center;gap:12px;padding:10px 14px;cursor:pointer}.sug-item:hover{background:#1a1a1a}` +
`.sug-item img,.sug-ph{width:52px;height:52px;object-fit:contain;background:#fff;border-radius:8px;flex-shrink:0}.sug-ph{display:flex;align-items:center;justify-content:center;background:#1a1a1a;font-size:20px}` +
`.sug-title{font-size:14px;color:#fff;font-weight:600}.sug-sub{font-size:12px;color:#888;margin-top:2px}` +
// ── Auth modal ───────────────────────────────────────────────────────────
`.auth-bg{display:none;position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:100;align-items:center;justify-content:center}` +
`.auth-box{background:#0c0c0c;border:1px solid #222;border-radius:16px;padding:28px;width:340px;text-align:center}` +
`.auth-box h3{color:#fff;font-size:18px;margin-bottom:16px}.auth-close{position:absolute;top:14px;right:18px;background:none;border:none;color:#888;font-size:20px;cursor:pointer}` +
`.gbtn{background:#fff;color:#000;border:none;padding:11px 20px;border-radius:24px;font-weight:600;font-size:14px;cursor:pointer;width:100%;font-family:'DM Sans',sans-serif}` +
// ── Body content ─────────────────────────────────────────────────────────
`.wrap{max-width:1040px;margin:0 auto;padding:26px 20px 70px;display:grid;grid-template-columns:280px 1fr;gap:26px;align-items:start}` +
`@media(max-width:800px){.wrap{grid-template-columns:1fr}}` +
`.left{display:flex;flex-direction:column;gap:16px}h1{font-size:clamp(22px,3.4vw,30px);font-weight:700;color:#fff;margin-bottom:6px;grid-column:1/-1}` +
`.photo{width:100%;aspect-ratio:1/1;background:#fff;border-radius:14px;display:flex;align-items:center;justify-content:center;overflow:hidden}.photo img{width:100%;height:100%;object-fit:contain}` +
`.card{background:#0c0c0c;border:1px solid #1a1a1a;border-radius:12px;padding:16px}.card h2{font-size:14px;font-weight:700;color:#fff;margin-bottom:10px}` +
`.row{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #1a1a1a;font-size:13px}.row:last-child{border-bottom:none}` +
`.row span:first-child{color:#888}.row span:last-child{color:#fff;font-weight:600;text-align:right}` +
`.spec-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:0 18px}.spec{display:flex;justify-content:space-between;gap:14px;padding:8px 0;border-bottom:1px solid #1a1a1a;font-size:12px}.spec span{color:#888}.spec strong{color:#fff;text-align:right;font-weight:600}` +
`.track-btn{background:#111;border:1px solid #2a2a2a;color:#fff;padding:9px 18px;border-radius:20px;font-size:13px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;width:100%}` +
`.track-btn.on{background:#1a6fff;border-color:#1a6fff}` +
`.chart-head{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:6px}` +
`.rtabs{display:flex;gap:4px;background:#111;border-radius:10px;padding:3px}` +
`.rtab{background:transparent;border:none;color:#888;padding:6px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif}.rtab.on{background:#1a6fff;color:#fff}` +
`.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin:12px 0 16px}` +
`.stat{background:#111;border:1px solid #1a1a1a;border-radius:10px;padding:12px 14px}.stat-label{font-size:11px;color:#888}.stat-value{font-size:20px;font-weight:700;color:#4d9fe6;margin-top:2px}` +
`.content{color:#c4c4c4;font-size:14px}.content strong{color:#fff}` +
`.bigcta{margin:20px 0 6px}.bigcta a{display:inline-block;background:#1a6fff;color:#fff;font-weight:600;font-size:15px;padding:12px 28px;border-radius:28px;text-decoration:none}` +
`.lgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-top:12px}` +
`.lc{position:relative;background:#111;border:1px solid #1a1a1a;border-radius:10px;padding:12px}.lc.best{border-color:#1a6fff}` +
`.lc-thumb{width:100%;height:100px;border-radius:8px;overflow:hidden;background:#fff;margin-bottom:8px;display:flex;align-items:center;justify-content:center}.lc-thumb img{width:100%;height:100%;object-fit:contain}` +
`.lc-src{font-size:10px;font-weight:700;color:#888;text-transform:uppercase}.lc-price{font-size:17px;font-weight:700;color:#fff;margin:4px 0}` +
`.lc-title{font-size:11px;color:#999;line-height:1.35;min-height:28px}.lc-btn{display:block;text-align:center;margin-top:8px;background:#1a6fff;color:#fff;text-decoration:none;padding:6px;border-radius:7px;font-size:12px;font-weight:600}` +
`.lc-badge{position:absolute;top:-8px;right:8px;background:#1a6fff;color:#fff;font-size:9px;font-weight:700;padding:2px 7px;border-radius:9px}` +
`footer{text-align:center;padding:24px;font-size:12px;color:#555;border-top:1px solid #111;margin-top:30px}footer a{color:#777;text-decoration:none}` +
`</style></head><body>` +
// ── Nav ──────────────────────────────────────────────────────────────────
`<nav><button class="nav-logo" onclick="location.href='https://findai.ai/'">FindAI</button>` +
`<div class="nav-links" id="nav-out"><button class="nav-secondary" onclick="openAuth('Welcome back')">Log in</button><button class="nav-cta" onclick="openAuth('Create your free account')">Sign up for free</button></div>` +
`<div class="nav-links" id="nav-in" style="display:none"><button class="nav-avatar" id="nav-av" onclick="location.href='https://findai.ai/'">U</button></div>` +
`</nav>` +
// ── Search bar + typeahead ───────────────────────────────────────────────
`<div class="searchbar-wrap">` +
`<div class="searchbar"><input id="seo-search" placeholder="Search any item to track its price..." autocomplete="off" oninput="onSeoInput(this.value)" onkeydown="onSeoKeydown(event)"><button onclick="submitSeoSearch()">Track</button></div>` +
`<div class="suggest" id="seo-suggest"></div>` +
`</div>` +
// ── Auth modal ───────────────────────────────────────────────────────────
`<div class="auth-bg" id="auth-bg"><div class="auth-box" style="position:relative"><button class="auth-close" onclick="closeAuth()">&times;</button>` +
`<h3 id="auth-title">Sign in to FindAI</h3><button class="gbtn" onclick="startGAuth()">Continue with Google</button><div id="auth-err" style="color:#f66;font-size:12px;margin-top:10px"></div></div></div>` +
// ── Product content ──────────────────────────────────────────────────────
`<main class="wrap"><h1>${h1}</h1>` +
`<div class="left">` +
`<div class="photo">${heroImg ? `<img src="${productSeoEsc(heroImg)}" alt="${productSeoEsc(title)}" loading="lazy">` : ''}</div>` +
`<button class="track-btn" id="track-btn" onclick="toggleSeoTrack()">&#9733; Track this item</button>` +
`<div class="card"><h2>Product Details</h2>` +
`<div class="row"><span>Product</span><span>${productSeoEsc(title)}</span></div>` +
(p.brand ? `<div class="row"><span>Brand</span><span>${productSeoEsc(p.brand)}</span></div>` : '') +
(productCode ? `<div class="row"><span>${p.product_type === 'sneaker' ? 'Style Code' : 'Model Number'}</span><span>${productSeoEsc(productCode)}</span></div>` : '') +
(p.category_key ? `<div class="row"><span>Category</span><span>${productSeoEsc(String(p.category_key).replace(/-/g, ' '))}</span></div>` : '') +
(p.colorway ? `<div class="row"><span>Colourway</span><span>${productSeoEsc(p.colorway)}</span></div>` : '') +
(p.fpid ? `<div class="row"><span>FindAI ID</span><span>${productSeoEsc(p.fpid)}</span></div>` : '') +
(p.icecat_id ? `<div class="row"><span>Icecat ID</span><span>${productSeoEsc(p.icecat_id)}</span></div>` : '') +
`<div class="row"><span>Condition</span><span>Brand New</span></div>` +
`</div></div>` +
`<div>` +
`<div class="chart-head"><h2 style="font-size:15px;color:#fff">Price History</h2>` +
`<div class="rtabs" id="rtabs"><button class="rtab" data-r="7" onclick="setRng(7)">7D</button><button class="rtab on" data-r="30" onclick="setRng(30)">30D</button><button class="rtab" data-r="90" onclick="setRng(90)">90D</button><button class="rtab" data-r="365" onclick="setRng(365)">1Y</button></div></div>` +
(min && max ? `<div class="stats">` +
  `<div class="stat"><div class="stat-label">Lowest Seen</div><div class="stat-value">$${Math.round(min)}</div></div>` +
  `<div class="stat"><div class="stat-label">Highest Seen</div><div class="stat-value">$${Math.round(max)}</div></div>` +
  `<div class="stat"><div class="stat-label">Days Tracked</div><div class="stat-value">${history.length}</div></div>` +
`</div>` : '') +
rangeSvgs +
`<div class="content" style="margin-top:16px">${bodyParas.join('')}</div>` +
`${specsHtml}` +
`<div class="bigcta"><a href="https://findai.ai/?q=${encodeURIComponent(title)}">Open in FindAI App &rarr;</a></div>` +
(listingCards ? `<div class="card" style="margin-top:20px"><h2>Where to Buy</h2><div class="lgrid">${listingCards}</div></div>` : '') +
`</div></main>` +
`<footer><span>&copy; 2026 FindAI · <a href="/">findai.ai</a></span></footer>` +
// ── Client-side JS: progressive enhancement only - nothing above depends on
// this running. Typeahead hits the SAME /tracker/suggest endpoint, auth hits
// the SAME Google Sign-In + /auth/google-token endpoint as the main app, and
// Track hits the SAME /tracker/add endpoint. This is a duplicated copy of
// that logic (per the explicit "copy is acceptable for now" direction),
// NOT a separate/different backend integration. ──────────────────────────
`<script>` +
`var WORKER='https://api.carsearchapi.workers.dev';` +
`var GOOGLE_CLIENT_ID='258387139240-a60g5n1hortfo0tnpm03dj8ht7jemqt0.apps.googleusercontent.com';` +
`var PID=${JSON.stringify(String(p.id))},PSLUG=${JSON.stringify(p.slug)},PQUERY=${JSON.stringify((p.model || title).toLowerCase())};` +
`var tokenClient=null;` +
`function openAuth(t){document.getElementById('auth-title').textContent=t||'Sign in to FindAI';document.getElementById('auth-bg').style.display='flex';}` +
`function closeAuth(){document.getElementById('auth-bg').style.display='none';}` +
`function startGAuth(){if(!tokenClient){document.getElementById('auth-err').textContent='Still loading, try again in a moment.';return;}tokenClient.requestAccessToken();}` +
`function initGAuth(){try{var u=JSON.parse(localStorage.getItem('findai_user')||'null');if(u)updateAuthUI(u);}catch(e){}if(!(window.google&&google.accounts&&google.accounts.oauth2)){setTimeout(initGAuth,400);return;}tokenClient=google.accounts.oauth2.initTokenClient({client_id:GOOGLE_CLIENT_ID,scope:'openid email profile',callback:handleGToken});}` +
`async function handleGToken(resp){if(!resp||!resp.access_token){document.getElementById('auth-err').textContent='Sign-in was cancelled.';return;}try{var r=await fetch(WORKER+'/auth/google-token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({access_token:resp.access_token})});var data=await r.json();if(data&&data.email){localStorage.setItem('findai_user',JSON.stringify(data));updateAuthUI(data);closeAuth();}else{document.getElementById('auth-err').textContent=(data&&data.error)||'Sign-in failed.';}}catch(e){document.getElementById('auth-err').textContent='Network error, try again.';}}` +
`function updateAuthUI(u){var o=document.getElementById('nav-out'),i=document.getElementById('nav-in');if(u&&u.email){o.style.display='none';i.style.display='flex';document.getElementById('nav-av').textContent=(u.name||u.email)[0].toUpperCase();}else{o.style.display='flex';i.style.display='none';}}` +
`window.addEventListener('load',initGAuth);` +
`var sugTimer=null,sugSeq=0,lastSug=[];` +
`function onSeoInput(v){clearTimeout(sugTimer);var q=(v||'').trim();if(q.length<2){hideSug();return;}sugTimer=setTimeout(function(){fetchSug(q);},250);}` +
`function onSeoKeydown(e){if(e.key==='Enter'){hideSug();submitSeoSearch();}if(e.key==='Escape')hideSug();}` +
`async function fetchSug(q){var seq=++sugSeq;try{var r=await fetch(WORKER+'/tracker/suggest?q='+encodeURIComponent(q));var d=await r.json();if(seq!==sugSeq)return;renderSug(d.suggestions||[]);}catch(e){hideSug();}}` +
`function renderSug(list){var box=document.getElementById('seo-suggest');if(!list.length){hideSug();return;}box.innerHTML=list.map(function(s,i){var sub=[s.styleId,s.colorway].filter(Boolean).join(' \\u00b7 ');return '<div class="sug-item" onclick="pickSug('+i+')">'+(s.image?'<img src="'+s.image+'" alt="" loading="lazy" onerror="this.outerHTML=\\'<div class=&quot;sug-ph&quot;>\\uD83D\\uDC5F</div>\\'">':'<div class="sug-ph">\\uD83D\\uDC5F</div>')+'<div><div class="sug-title">'+s.title+'</div>'+(sub?'<div class="sug-sub">'+sub+'</div>':'')+'</div></div>';}).join('');box.style.display='block';lastSug=list;}` +
`function hideSug(){var b=document.getElementById('seo-suggest');if(b){b.style.display='none';b.innerHTML='';}}` +
`document.addEventListener('click',function(e){if(!e.target.closest('.searchbar-wrap'))hideSug();});` +
`function pickSug(i){var s=lastSug[i];if(!s)return;hideSug();location.href=WORKER+'/price-redirect?pid='+encodeURIComponent(s.pid)+'&title='+encodeURIComponent(s.title)+'&styleId='+encodeURIComponent(s.styleId||'')+'&colorway='+encodeURIComponent(s.colorway||'')+'&brand='+encodeURIComponent(s.brand||'');}` +
`function submitSeoSearch(){var q=(document.getElementById('seo-search').value||'').trim();if(!q)return;location.href=WORKER+'/price-redirect?q='+encodeURIComponent(q)+'&title='+encodeURIComponent(q);}` +
`function setRng(d){document.querySelectorAll('.rtab').forEach(function(t){t.classList.toggle('on',Number(t.dataset.r)===d);});document.querySelectorAll('.rng-panel').forEach(function(p){p.style.display=(p.dataset.range==String(d))?'block':'none';});}` +
`var tracking=false;` +
`function updateTrackBtn(){var b=document.getElementById('track-btn');b.textContent=tracking?'\\u2713 Tracking':'\\u2605 Track this item';b.classList.toggle('on',tracking);}` +
`async function toggleSeoTrack(){var u=null;try{u=JSON.parse(localStorage.getItem('findai_user')||'null');}catch(e){}if(!u||!u.email){openAuth('Sign in to track items');return;}var ep=tracking?'/tracker/remove':'/tracker/add';try{await fetch(WORKER+ep,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:u.email,query:PQUERY})});tracking=!tracking;updateTrackBtn();}catch(e){}}` +
`</script>` +
`<script src="https://accounts.google.com/gsi/client" async></script>` +
`</body></html>`;
}

async function maybeProductSeoPage(url, env, ctx) {
  const m = url.pathname.match(/^\/price\/([a-z0-9-]+)$/i);
  if (!m || !env.DB) return null;
  const slug = m[1];

  const cache = caches.default;
  const cacheKey = new Request(`${url.origin}/__pseo/${slug}`, { method: 'GET' });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  let p;
  try {
    p = await env.DB.prepare('SELECT * FROM products WHERE slug = ?').bind(slug).first();
  } catch (e) { logErr('product seo lookup', e); return null; }
  if (!p) return null;

  // Hydrate the existing product row with official Icecat descriptions,
  // specifications and the mirrored R2 image. This remains best-effort so an
  // old sneaker page still works before the product-graph migration is run.
  try {
    const graphProduct = await FindAIProductGraph.getCanonicalProduct(env, p.fpid || p.id, {
      requestOrigin: url.origin,
      specLimit: 80
    });
    if (graphProduct) {
      p = {
        ...p,
        fpid: graphProduct.fpid || p.fpid,
        title: graphProduct.title || p.title,
        model: graphProduct.model || p.model,
        manufacturer_part_number: graphProduct.manufacturerPartNumber || p.manufacturer_part_number,
        category_key: graphProduct.categoryKey || p.category_key,
        short_description: graphProduct.shortDescription || p.short_description,
        long_description: graphProduct.longDescription || p.long_description,
        image_url: graphProduct.primaryImageUrl || p.image_url,
        _productGraph: graphProduct
      };
    }
  } catch (e) { logErr('product seo graph hydration', e); }

  let history = [];
  try {
    const res = await env.DB.prepare(
      `SELECT snapshot_date, min_price, avg_price, max_price FROM product_price_snapshots
       WHERE product_id = ? ORDER BY snapshot_date ASC LIMIT 400`
    ).bind(p.id).all();
    history = res.results || [];
  } catch (e) { logErr('product seo history', e); }

  // Live listings for "Where to Buy" - the SAME accurate, exact-matched data
  // the interactive tracker uses (searchListings + stockxSearch, filtered
  // through exactItemFilter), not a stored/stale substitute. This IS a live
  // marketplace call, but the whole response is edge-cached for an hour right
  // below, so it's bounded to at most once/hour per product regardless of
  // how much crawler or visitor traffic hits this page - not "a live call on
  // every crawl."
  let listings = [];
  try {
    const isSneaker = p.product_type === 'sneaker' || p.category_key === 'sneakers';
    const code = p.manufacturer_part_number || p.style_id || '';
    const marketQuery = `${p.brand || ''} ${code || p.model || p.title || ''} ${isSneaker ? (p.colorway || '') : ''}`.trim();
    const searchResult = await searchListings(marketQuery, '', 'US', env).catch(() => ({ items: [] }));
    let all = Array.isArray(searchResult.items) ? searchResult.items : [];
    if (isSneaker) {
      const sx = await stockxSearch(marketQuery, 'USD', env, 6, ctx).catch(() => []);
      all = all.concat(Array.isArray(sx) ? sx : []);
      all = exactItemFilter(all, { styleId: p.style_id, brand: p.brand, colorway: p.colorway }, p.model || p.title || '');
    } else if (code) {
      // Prefer listings carrying the exact manufacturer number. Fall back to
      // the search engine result only when marketplaces omit the code in titles.
      const codeNorm = String(code).toLowerCase().replace(/[^a-z0-9]/g, '');
      const exactCode = all.filter(item => String(item.title || '').toLowerCase().replace(/[^a-z0-9]/g, '').includes(codeNorm));
      if (exactCode.length >= 2) all = exactCode;
    }
    listings = all.sort((a, b) => (a.price || 1e9) - (b.price || 1e9));
  } catch (e) { logErr('product seo listings', e); }

  // Maturity gate: distinct days of real history. Below the threshold, the
  // page still renders (direct links work) but stays noindex.
  const indexable = history.length >= PRODUCT_SEO_MIN_SNAPSHOT_DAYS;

  const html = productSeoPageHtml(p, history, listings, indexable);
  const resp = new Response(html, {
    headers: { 'content-type': 'text/html;charset=UTF-8', 'cache-control': 'public, max-age=3600' }
  });
  try { await cache.put(cacheKey, resp.clone()); } catch (_) {}
  return resp;
}


async function maybeSeoPage(url, request, env) {
  const slug = url.pathname.replace(/^\/+|\/+$/g, "");
  const cfg = SEO_PAGES[slug];
  if (!cfg) return null;                                  // not an SEO page → fall through

  const cache = caches.default;
  const cacheKey = new Request(`${url.origin}/__seo/${slug}`, { method: "GET" });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const country = detectCountry(request);
  const isSpotFake = cfg.agOnly === true;
  let items = [];
  try {
    if (isSpotFake) {
      // Spot-a-fake pages: ONE row (6) of eBay listings, AliExpress never shown.
      // Prefer Authenticity Guaranteed listings; if eBay returns fewer than a full row of
      // AG items, top up with regular eBay listings (still no AliExpress) so the row always
      // fills. This keeps the page from going empty when AG-routed sellers are scarce.
      const ROW = 6;
      const agRes = await searchListings(cfg.query, "", country, env, true);
      const agItems = (agRes.items || []).filter(i => (i.source || '').toLowerCase() === 'ebay');
      const seen = new Set(agItems.map(i => i.itemId));
      let row = agItems.slice(0, ROW);
      if (row.length < ROW) {
        // Top-up: regular eBay search (no AG filter, no AliExpress), skipping dupes.
        const ebRes = await searchEbay(cfg.query, country, '', env, false).catch(() => ({ items: [] }));
        const extra = (ebRes.items || []).filter(i => i.itemId && !seen.has(i.itemId) && i.image && i.url);
        row = row.concat(extra).slice(0, ROW);
      }
      items = row;
    } else {
      // Cheap-X pages keep the full grid (eBay + AliExpress, no AG filter).
      const r = await searchListings(cfg.query, "", country, env, false);
      items = (r.items || []).slice(0, 24);
    }
  } catch (_) { items = []; }                             // render content-only if search hiccups

  const resp = new Response(seoPageHtml(slug, cfg, items), {
    headers: { "content-type": "text/html;charset=UTF-8", "cache-control": "public, max-age=3600" }
  });
  try { await cache.put(cacheKey, resp.clone()); } catch (_) {}
  return resp;
}

// ── Main ──────────────────────────────────────────────────────────────────
// ── Email sending via Resend ────────────────────────────────────────────────
// Sends an email as "FindAI <no-reply@findai.ai>". Requires the RESEND_API_KEY
// secret to be set on the Worker. Returns the raw Resend API fetch response.
async function sendEmail(env, to, subject, html) {
  return fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: "FindAI <noreply@findai.ai>",
      to: Array.isArray(to) ? to : [to],
      subject,
      html
    })
  });
}

// ── Shared user upsert ──────────────────────────────────────────────────────
// Creates/updates a user, returns whether they were new, and fires the welcome
// email once on first signup. Used by both Google and email (magic-link) login.
async function upsertUser(env, ctx, email, name, notify) {
  let isNewUser = false;
  if (env.DB) {
    try {
      const existing = await env.DB.prepare('SELECT email FROM users WHERE email = ?').bind(email).first();
      isNewUser = !existing;
      await env.DB
        .prepare('INSERT INTO users (email, name, created_at, notify) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET name = excluded.name, notify = MAX(users.notify, excluded.notify)')
        .bind(email, name || '', new Date().toISOString(), notify ? 1 : 0)
        .run();
    } catch (_) { /* don't block login if the write fails */ }
  }
  if (isNewUser && env.RESEND_API_KEY) {
    try {
      const wh = buildWelcomeEmail(name);
      if (ctx && ctx.waitUntil) ctx.waitUntil(sendEmail(env, email, 'Welcome to FindAI', wh));
      else await sendEmail(env, email, 'Welcome to FindAI', wh);
    } catch (_) {}
  }
  return isNewUser;
}

// ── "Still interested?" re-engagement email template ────────────────────────
// Light-background, email-client-safe HTML featuring the user's most-engaged
// item, plus an optional "Similar picks" row (like eBay's insight emails).
// `firstName` personalizes the headline; `similar` is an array of item objects.
// `unsubUrl` is the one-click unsubscribe link (legally required).
function buildInterestEmail(item, firstName, similar, unsubUrl, opts) {
  const mode = (opts && opts.mode) === 'search' ? 'search' : 'viewed';
  const searchTerm = String((opts && opts.searchTerm) || '').replace(/[\u2014\u2013]/g, "-");
  const esc = (s) => String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const priceStr = (it) => {
    const cur = it.currency === "AUD" ? "A$" : "$";
    return (it.price != null && Number(it.price) > 0) ? cur + Number(it.price).toFixed(2) : "";
  };
  const name = esc((firstName || "").trim().split(/\s+/)[0] || "");
  const termEsc = esc(searchTerm);
  const headline = mode === 'search'
    ? (name ? `${name}, fresh finds for you` : `Fresh finds for you`)
    : (name ? `${name}, are you still interested in this?` : `Are you still interested in this?`);
  const introLine = mode === 'search'
    ? (termEsc ? `Based on your recent search for "${termEsc}", here are some picks.` : `Based on your recent searches, here are some picks for you.`)
    : `Take another look at the item you viewed, plus similar picks we found for you.`;
  const mainLabel = mode === 'search' ? 'Top pick for you' : 'You recently viewed';
  const title = esc((item.title || "").replace(/[\u2014\u2013]/g, "-"));
  const price = priceStr(item);
  const img = esc(item.image || "");
  const link = esc(item.url || "https://findai.ai");
  const src = esc(String(item.source || "").toLowerCase());
  const unsub = esc(unsubUrl || "https://findai.ai");

  // Similar picks row (up to 3), each a small clickable card.
  const sims = (Array.isArray(similar) ? similar : []).filter(s => s && s.image && s.url).slice(0, 3);
  const similarHtml = sims.length ? (
    `<tr><td style="padding:6px 28px 4px;"><span style="font-size:14px;font-weight:700;color:#111;">Similar picks for you</span></td></tr>` +
    `<tr><td style="padding:8px 22px 6px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>` +
    sims.map(s => {
      const st = esc((s.title || "").replace(/[\u2014\u2013]/g, "-"));
      const sp = priceStr(s);
      const si = esc(s.image || "");
      const sl = esc(s.url || "https://findai.ai");
      return `<td width="33%" valign="top" style="padding:0 6px;">` +
        `<a href="${sl}" style="text-decoration:none;color:inherit;display:block;">` +
        `<img src="${si}" alt="${st}" width="120" style="width:100%;max-width:120px;border-radius:8px;border:1px solid #eee;display:block;">` +
        `<div style="font-size:11px;color:#444;line-height:1.3;margin:6px 0 2px;max-height:28px;overflow:hidden;">${st}</div>` +
        (sp ? `<div style="font-size:13px;font-weight:700;color:#111;">${sp}</div>` : ``) +
        `</a></td>`;
    }).join("") +
    `</tr></table></td></tr>`
  ) : "";

  return `<!DOCTYPE html><html><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1"></head>` +
    `<body style="margin:0;padding:0;background:#f4f4f5;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 0;">` +
    `<tr><td align="center">` +
    `<table role="presentation" width="460" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:14px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;max-width:460px;width:100%;">` +
    `<tr><td style="padding:18px 24px 0;"><span style="font-size:12px;color:#888;">${esc(introLine)}</span></td></tr>` +
    `<tr><td style="padding:12px 24px 6px;"><a href="https://findai.ai" style="text-decoration:none;"><span style="font-size:24px;font-weight:700;color:#1a6fff;">FindAI</span></a></td></tr>` +
    `<tr><td style="padding:2px 24px 4px;"><span style="font-size:18px;font-weight:700;color:#111;">${esc(headline)}</span></td></tr>` +
    `<tr><td style="padding:8px 24px 8px;"><span style="font-size:12px;font-weight:600;color:#1a6fff;text-transform:uppercase;letter-spacing:0.03em;">${esc(mainLabel)}</span></td></tr>` +
    // main item: image LEFT, details RIGHT (compact, eBay-style)
    `<tr><td style="padding:0 24px;">` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>` +
        (img ? `<td width="150" valign="top" style="padding-right:14px;">` +
          `<a href="${link}"><img src="${img}" alt="${title}" width="150" style="width:150px;max-width:150px;border-radius:10px;display:block;border:1px solid #eee;"></a></td>` : ``) +
        `<td valign="top">` +
          `<div style="font-size:14px;color:#222;line-height:1.35;margin-bottom:6px;">${title}</div>` +
          (price ? `<div style="font-size:20px;font-weight:700;color:#111;margin-bottom:2px;">${price}</div>` : ``) +
          (src ? `<div style="font-size:12px;font-weight:600;color:#888;text-transform:capitalize;margin-bottom:12px;">${src}</div>` : `<div style="margin-bottom:12px;"></div>`) +
          `<a href="${link}" style="display:inline-block;background:#1a6fff;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;padding:11px 22px;border-radius:24px;">View item &rarr;</a>` +
        `</td>` +
      `</tr></table>` +
    `</td></tr>` +
    (similarHtml ? `<tr><td style="padding:20px 0 0;"><div style="border-top:1px solid #eee;"></div></td></tr>` + similarHtml : ``) +
    `<tr><td style="padding:18px 24px 22px;border-top:1px solid #eee;">` +
      `<span style="font-size:11px;color:#999;">You're getting this because you signed up for FindAI deal alerts. ` +
      `<a href="${unsub}" style="color:#999;text-decoration:underline;">Unsubscribe</a></span>` +
    `</td></tr>` +
    `</table></td></tr></table></body></html>`;
}

// ── Welcome email ───────────────────────────────────────────────────────────
// Sent once when a user first signs up. Clean clickable FindAI header, short
// greeting, and a single "Search FindAI" button. Signed off "FindAI".
function buildWelcomeEmail(firstName) {
  const esc = (s) => String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const name = esc((firstName || "").trim().split(/\s+/)[0] || "there");
  return `<!DOCTYPE html><html><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1"></head>` +
    `<body style="margin:0;padding:0;background:#f4f4f5;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 0;">` +
    `<tr><td align="center">` +
    `<table role="presentation" width="460" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:14px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;max-width:460px;width:100%;">` +
    // clean clickable logo header
    `<tr><td style="padding:24px 28px 10px;"><a href="https://findai.ai" style="text-decoration:none;"><span style="font-size:24px;font-weight:700;color:#1a6fff;">FindAI</span></a></td></tr>` +
    // body
    `<tr><td style="padding:6px 28px 0;font-size:15px;line-height:1.6;color:#222;">` +
      `<p style="margin:0 0 14px;">Hi ${name},</p>` +
      `<p style="margin:0 0 14px;">Welcome to FindAI. Your account is ready.</p>` +
      `<p style="margin:0;">Start your search for the best deal now.</p>` +
    `</td></tr>` +
    // button
    `<tr><td style="padding:20px 28px 8px;">` +
      `<a href="https://findai.ai" style="display:inline-block;background:#1a6fff;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;padding:14px 34px;border-radius:28px;">Search FindAI &rarr;</a>` +
    `</td></tr>` +
    // sign-off
    `<tr><td style="padding:16px 28px 26px;font-size:15px;color:#222;"><p style="margin:0;">FindAI</p></td></tr>` +
    `</table></td></tr></table></body></html>`;
}

// ── Magic-link login email ──────────────────────────────────────────────────
// One-time sign-in link. Plain and simple so it lands well and is trusted.
function buildLoginEmail(loginUrl) {
  const esc = (s) => String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const link = esc(loginUrl || "https://findai.ai");
  return `<!DOCTYPE html><html><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1"></head>` +
    `<body style="margin:0;padding:0;background:#f4f4f5;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 0;">` +
    `<tr><td align="center">` +
    `<table role="presentation" width="460" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:14px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;max-width:460px;width:100%;">` +
    `<tr><td style="padding:24px 28px 10px;"><a href="https://findai.ai" style="text-decoration:none;"><span style="font-size:24px;font-weight:700;color:#1a6fff;">FindAI</span></a></td></tr>` +
    `<tr><td style="padding:6px 28px 0;font-size:15px;line-height:1.6;color:#222;">` +
      `<p style="margin:0 0 14px;">Click below to sign in to FindAI. This link expires in 15 minutes.</p>` +
    `</td></tr>` +
    `<tr><td style="padding:16px 28px 8px;">` +
      `<a href="${link}" style="display:inline-block;background:#1a6fff;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;padding:14px 34px;border-radius:28px;">Sign in to FindAI &rarr;</a>` +
    `</td></tr>` +
    `<tr><td style="padding:12px 28px 26px;font-size:12px;color:#999;">If you didn't request this, you can ignore this email.</td></tr>` +
    `</table></td></tr></table></body></html>`;
}

function buildCodeEmail(code) {
  const esc = (s) => String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const c = esc(code);
  return `<!DOCTYPE html><html><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1"></head>` +
    `<body style="margin:0;padding:0;background:#f4f4f5;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 0;">` +
    `<tr><td align="center">` +
    `<table role="presentation" width="460" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:14px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;max-width:460px;width:100%;">` +
    `<tr><td style="padding:24px 28px 10px;"><a href="https://findai.ai" style="text-decoration:none;"><span style="font-size:24px;font-weight:700;color:#1a6fff;">FindAI</span></a></td></tr>` +
    `<tr><td style="padding:6px 28px 0;font-size:15px;line-height:1.6;color:#222;">` +
      `<p style="margin:0 0 14px;">Enter this code to sign in to FindAI. It expires in 15 minutes.</p>` +
    `</td></tr>` +
    `<tr><td style="padding:8px 28px 8px;">` +
      `<div style="display:inline-block;background:#f4f4f5;border-radius:10px;padding:16px 28px;font-size:34px;font-weight:700;letter-spacing:10px;color:#111;">${c}</div>` +
    `</td></tr>` +
    `<tr><td style="padding:12px 28px 26px;font-size:12px;color:#999;">If you didn't request this, you can ignore this email.</td></tr>` +
    `</table></td></tr></table></body></html>`;
}

// ── Shared daily-email batch ─────────────────────────────────────────────
// The one place the "still interested?" batch send lives. Called by the cron
// (scheduled) AND by the /cron-test route, so both run identical code. Returns
// a report so the test route can show exactly what happened.
async function sendDailyEmails(env, opts) {
  const COOLDOWN_DAYS = 3;
  const ignoreCooldown = !!(opts && opts.ignoreCooldown);
  const report = { matched: 0, sent: 0, skipped: [], errors: [] };
  if (!env.DB || !env.RESEND_API_KEY) {
    report.errors.push('DB or RESEND_API_KEY missing');
    return report;
  }
  const cutoff = new Date(Date.now() - COOLDOWN_DAYS * 86400000).toISOString();
  const query = ignoreCooldown
    ? `SELECT email, name FROM users WHERE notify = 1 LIMIT 80`
    : `SELECT email, name FROM users WHERE notify = 1 AND (last_emailed IS NULL OR last_emailed < ?) LIMIT 80`;
  const stmt = ignoreCooldown ? env.DB.prepare(query) : env.DB.prepare(query).bind(cutoff);
  const users = await stmt.all();
  const rows = (users && users.results) || [];
  report.matched = rows.length;
  for (const u of rows) {
    try {
      const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      let featured = null, mode = 'viewed', searchTerm = '', pool = [];

      // 1) Prefer the user's most-viewed clicked item.
      const top = await env.DB.prepare(
        `SELECT title, price, currency, image, url, source FROM item_views
         WHERE email = ? AND url != '' AND image != ''
         ORDER BY views DESC, last_viewed DESC LIMIT 1`
      ).bind(u.email).first();
      if (top) {
        featured = top;
        const res = await searchListings(String(top.title || '').slice(0, 60), '', 'US', env);
        pool = (res && res.items) ? res.items : [];
      } else {
        // 2) Fallback: feature the top result of the user's most frequent search.
        let srow = null;
        try {
          srow = await env.DB.prepare(
            `SELECT query FROM user_searches WHERE email = ? ORDER BY count DESC, last_searched DESC LIMIT 1`
          ).bind(u.email).first();
        } catch (_) {}
        if (srow && srow.query) {
          const res = await searchListings(String(srow.query).slice(0, 60), '', 'US', env);
          pool = (res && res.items) ? res.items : [];
          const firstItem = pool.find(it => it && it.url && it.image);
          if (firstItem) {
            featured = { title: firstItem.title, price: firstItem.price, currency: firstItem.currency, image: firstItem.image, url: firstItem.url, source: firstItem.source };
            mode = 'search';
            searchTerm = String(srow.query);
          }
        }
      }

      if (!featured) { report.skipped.push({ email: u.email, reason: 'no views or searches' }); continue; }

      // Similar picks: distinct products, never the featured item itself, and
      // RELEVANT - a pick must share at least 2 meaningful words with the
      // featured title (stops car-wax junk appearing under a LEGO set).
      const STOPW = new Set(['the','and','for','with','new','set','box','size','men','mens','womens','women','kids','complete','sealed','retired','edition','rare','vintage','authentic','genuine','original','pcs','piece','pieces']);
      const toks = (s) => norm(s).split(' ').filter(w => w.length >= 3 && !STOPW.has(w) && !/^\d+$/.test(w));
      const featTokens = new Set(toks(featured.title).slice(0, 10));
      const needShared = featTokens.size >= 2 ? 2 : 1;
      const featKey = norm(featured.title);
      const seen = new Set();
      const similar = [];
      for (const it of pool) {
        if (!it || !it.url || !it.image) continue;
        if (it.url === featured.url) continue;
        const k = norm(it.title);
        if (!k || k === featKey) continue;
        if (seen.has(k)) continue;
        const shared = toks(it.title).filter(w => featTokens.has(w)).length;
        if (shared < needShared) continue;
        seen.add(k);
        similar.push(it);
        if (similar.length >= 3) break;
      }

      const unsubUrl = await unsubUrlFor(env, u.email);
      const html = buildInterestEmail(featured, u.name || '', similar, unsubUrl, { mode, searchTerm });
      const first = String(u.name || '').trim().split(/\s+/)[0];
      const subject = mode === 'search'
        ? (first ? `${first}, fresh finds for you` : `Fresh finds for you`)
        : (first ? `${first}, are you still interested in this?` : `Are you still interested in this?`);
      const r = await sendEmail(env, u.email, subject, html);
      if (r.ok) {
        report.sent++;
        await env.DB.prepare('UPDATE users SET last_emailed = ? WHERE email = ?')
          .bind(new Date().toISOString(), u.email).run();
      } else {
        report.errors.push({ email: u.email, status: r.status });
      }
    } catch (e) {
      report.errors.push({ email: u.email, error: String(e && e.message || e) });
    }
  }
  return report;
}

// ── StockX integration ────────────────────────────────────────────────────
// Best-effort market-reference cards. NEVER allowed to break the main search:
// every caller wraps this in try/catch and falls back to [] on any failure.
const STOCKX_CLIENT_ID = 'hRXPzaZirdaJdqJDBhTqMzE7ePyUtY30';
const STOCKX_REDIRECT = 'https://api.carsearchapi.workers.dev/auth/stockx/callback';

let stockxAccessToken = null;
let stockxTokenExpiry = 0;

// Exchange the stored refresh token for a fresh access token (cached in memory
// until ~1 min before expiry). Returns null if StockX is not connected yet.
async function getStockxToken(env) {
  if (stockxAccessToken && Date.now() < stockxTokenExpiry) return stockxAccessToken;
  if (!env.DB || !env.STOCKX_CLIENT_SECRET) return null;
  let refresh = null;
  try {
    const row = await env.DB.prepare('SELECT refresh_token FROM stockx_auth WHERE id = 1').first();
    refresh = row && row.refresh_token ? row.refresh_token : null;
  } catch (_) {}
  if (!refresh) return null;
  try {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: STOCKX_CLIENT_ID,
      client_secret: env.STOCKX_CLIENT_SECRET,
      audience: 'gateway.stockx.com',
      refresh_token: refresh,
    });
    const r = await fetch('https://accounts.stockx.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const data = await r.json();
    if (data && data.access_token) {
      stockxAccessToken = data.access_token;
      stockxTokenExpiry = Date.now() + Math.max(0, (data.expires_in || 43200) - 60) * 1000;
      // CRITICAL: StockX can rotate the refresh token on each use. If a new one
      // comes back, persist it, or the old one eventually dies and every StockX
      // request silently returns nothing.
      if (data.refresh_token && data.refresh_token !== refresh) {
        try {
          await env.DB.prepare('UPDATE stockx_auth SET refresh_token = ?, updated_at = ? WHERE id = 1')
            .bind(data.refresh_token, new Date().toISOString()).run();
        } catch (_) {}
      }
      return stockxAccessToken;
    }
  } catch (_) {}
  return null;
}

// Search StockX for up to `limit` products, each with its lowest ask / highest
// bid. Heavily cached in KV (6h) per term+currency so we almost never spend the
// 1-req/sec, 25k/day quota. Returns [] on any failure or if not connected.
// Fetch the EXACT image StockX itself displays for a product: read the og:image
// meta tag from its product page. Cached in KV for 7 days per product, so this
// is one page fetch ever per shoe. Returns '' if blocked or missing (card then
// falls back to CDN patterns, then the branded tile).
async function stockxImageFor(urlKey, env) {
  if (!urlKey) return '';
  const k = 'stockximg:' + urlKey;
  if (env.CACHE) {
    try { const c = await env.CACHE.get(k); if (c) return c === 'none' ? '' : c; } catch (_) {}
  }
  try {
    const r = await fetch('https://stockx.com/' + encodeURIComponent(urlKey), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (r.ok) {
      const html = await r.text();
      const m = html.match(/property="og:image"\s+content="([^"]+)"/) || html.match(/content="([^"]+)"\s+property="og:image"/);
      if (m && m[1]) {
        const img = m[1];
        if (env.CACHE) { try { await env.CACHE.put(k, img, { expirationTtl: 604800 }); } catch (_) {} }
        return img;
      }
    }
  } catch (_) {}
  if (env.CACHE) { try { await env.CACHE.put(k, 'none', { expirationTtl: 86400 }); } catch (_) {} }
  return '';
}

// A REAL eBay photo for a query, cached 7 days in KV. This is what gives the
// suggest dropdown the same reliable image the detail page shows, without
// running a full searchListings on every keystroke: one light Browse call the
// first time a given query is ever seen, then a cache hit forever after. Models
// the exact endpoint / auth / image field used by searchEbay.
async function ebayImageFor(query, env) {
  const qn = String(query || '').trim().toLowerCase();
  if (!qn) return '';
  // v4 bypasses any stale negative ('none') entries created by the earlier fallback.
  const k = 'ebayimg:v4:' + qn.slice(0, 80);
  if (env.CACHE) {
    try { const c = await env.CACHE.get(k); if (c) return c; } catch (_) {}
  }
  let img = '';
  try {
    const token = await getEbayToken(env);
    if (!token) {
      console.error('[LEGO image] eBay OAuth returned no token for', query);
      return '';
    }
    const hdr = { 'Authorization': `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US', 'Content-Type': 'application/json' };
    const base = 'https://api.ebay.com/buy/browse/v1/item_summary/search?q=' + encodeURIComponent(query) + '&limit=20';
    const pick = async (u, stage) => {
      try {
        const res = await fetch(u, { headers: hdr });
        if (!res.ok) {
          console.error('[LEGO image] eBay Browse failed', stage, res.status, (await res.text()).slice(0, 300));
          return '';
        }
        const data = await res.json();
        const items = (data && data.itemSummaries) || [];
        for (const it of items) {
          const c = (it && ((it.image && it.image.imageUrl) || (it.thumbnailImages && it.thumbnailImages[0] && it.thumbnailImages[0].imageUrl))) || '';
          if (c) return c;
        }
        console.log('[LEGO image] eBay returned zero usable images', stage, query, 'items=', items.length);
      } catch (e) {
        console.error('[LEGO image] eBay lookup exception', stage, query, e && (e.message || String(e)));
      }
      return '';
    };
    // Prefer a clean new/new-other listing photo, then accept any condition.
    img = await pick(base + '&filter=' + encodeURIComponent('conditionIds:{1000|1500}'), 'new');
    if (!img) img = await pick(base, 'any');
  } catch (e) {
    console.error('[LEGO image] ebayImageFor failed', query, e && (e.message || String(e)));
  }
  // KV free-tier writes may be exhausted. Cache successes only; never spend a write
  // on a negative result and never let a failed KV put prevent the real image returning.
  if (img && env.CACHE) {
    try { await env.CACHE.put(k, img, { expirationTtl: 604800 }); } catch (e) {
      console.warn('[LEGO image] KV image cache write skipped/failed', e && (e.message || String(e)));
    }
  }
  return img;
}

async function persistLegoImage(setId, imageUrl, env) {
  const sid = String(setId || '').replace(/-\d+$/, '').trim();
  if (!sid || !imageUrl || !env.DB) return;
  try {
    await env.DB.prepare('UPDATE lego_sets SET img_url = ? WHERE set_id = ?').bind(imageUrl, sid).run();
  } catch (e) {
    console.warn('[LEGO image] D1 image persistence failed', sid, e && (e.message || String(e)));
  }
}

async function stockxSearch(term, currency, env, limit = 3, ctx = null) {
  const key = `stockx11:${currency}:${String(term || '').toLowerCase().slice(0, 60)}`;
  if (env.CACHE) {
    try { const cached = await env.CACHE.get(key, 'json'); if (cached && cached.items) return cached.items.slice(0, limit); } catch (_) {}
  }
  const token = await getStockxToken(env);
  if (!token) return [];
  const apiKey = env.STOCKX_API_KEY;
  if (!apiKey) return [];
  const headers = { 'Authorization': 'Bearer ' + token, 'x-api-key': apiKey, 'Content-Type': 'application/json' };
  const wait = (ms) => new Promise(res => setTimeout(res, ms));
  const imageFromUrlKey = (uk) => {
    if (!uk) return '';
    const pretty = String(uk).split('-').map(s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s).join('-');
    // First frame of StockX's 360 spin = the front-facing white-background studio
    // shot. Its path is fully deterministic from the urlKey, unlike the old
    // "{Title}-Product.jpg" filename which 404s for a large share of products.
    return 'https://images.stockx.com/360/' + pretty + '/Images/' + pretty + '/Lv2/img01.jpg';
  };

  let products = [];
  try {
    const sr = await fetch('https://api.stockx.com/v2/catalog/search?query=' + encodeURIComponent(term) + '&pageNumber=1&pageSize=' + Math.max(limit * 4, 10), { headers });
    if (sr.status === 429 || sr.status === 401) {
      // Rate-limited or auth failure: cache empty briefly so we stop hammering.
      if (env.CACHE) { try { await env.CACHE.put(key, JSON.stringify({ items: [] }), { expirationTtl: 300 }); } catch (_) {} }
      return [];
    }
    const sd = await sr.json();
    // Handle multiple possible response shapes.
    products = (sd && (sd.products || sd.results || sd.data)) || [];
    if (!Array.isArray(products)) products = [];
  } catch (_) { return []; }

  // RELEVANCE GATE: EVERY meaningful word the user typed must appear in the
  // product title. "nike rf" must match BOTH "nike" AND "rf" (not just any Nike);
  // "lego hogwarts" must contain "hogwarts", not just "lego". Short tokens like
  // "rf" are kept (2+ chars) because they carry the real intent.
  const normT = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const STOPT = new Set(['the','and','for','with','new','set','box','size','men','mens','womens','women','kids']);
  const sing = (w) => w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w;
  const toksT = (s) => normT(s).split(' ').filter(w => w.length >= 2 && !STOPT.has(w)).map(sing);
  const qToks = toksT(term);
  const relevant = products.filter(p => {
    const title = p.title || p.name || p.productName || '';
    const tTok = toksT(title);
    // ALL query tokens must be present (a number like "350" counts too).
    return qToks.length > 0 && qToks.every(w => tTok.includes(w));
  });

  // VARIETY: never show two near-identical products (e.g. two Travis Scott
  // Jordan 1 Lows). Key on the model + first distinguishing words so each card
  // is a genuinely different shoe.
  const seenModel = new Set();
  const varied = [];
  for (const p of relevant) {
    const t = toksT(p.title || '');
    // Drop the query words themselves; what's left is what makes it distinct.
    const distinct = t.filter(w => !qToks.includes(w)).slice(0, 2).join('-');
    const key = distinct || (p.title || '').toLowerCase();
    if (seenModel.has(key)) continue;
    seenModel.add(key);
    varied.push(p);
    if (varied.length >= limit) break;
  }
  const chosen = varied.slice(0, limit);
  if (!chosen.length) {
    if (env.CACHE) { try { await env.CACHE.put(key, JSON.stringify({ items: [] }), { expirationTtl: 600 }); } catch (_) {} }
    return [];
  }

  // Build cards IMMEDIATELY from the catalog search - no market-data wait, no
  // page scraping in the critical path. Prices come from a per-product price
  // cache if we've fetched them before; otherwise the card shows "market" and
  // Build cards WITH live prices. Per your call, we always fetch the real
  // Lowest Ask + Highest Bid inline (slower first search, but the price is
  // always shown). Per-product price is cached 6h so repeat searches are fast.
  const items = [];
  for (const p of chosen) {
    const pid = p.productId || p.id || p.uuid;
    if (!pid) continue;
    const styleId = String(p.styleId || p.styleID || '').trim();
    // imgix StockX studio image (white bg via imgix params).
    const c1 = imageFromUrlKey(p.urlKey);
    const stockxImage = c1 ? (c1 + '?fit=fill&bg=FFFFFF&w=400&h=286&auto=format,compress&q=90') : '';

    let lowestAsk = null, highestBid = null, mktCurrency = null;
    // Try per-product price cache first.
    if (env.CACHE) {
      try {
        const pc = await env.CACHE.get('stockxprice:' + currency + ':' + pid, 'json');
        if (pc) { lowestAsk = pc.lowestAsk || null; highestBid = pc.highestBid || null; mktCurrency = pc.currency || null; }
      } catch (_) {}
    }
    // Not cached -> fetch live now (paced for the 1/sec limit).
    if (lowestAsk == null && highestBid == null) {
      await wait(1100);
      try {
        const mr = await fetch('https://api.stockx.com/v2/catalog/products/' + encodeURIComponent(pid) + '/market-data?currencyCode=' + encodeURIComponent(currency), { headers });
        if (mr.ok) {
          const md = await mr.json();
          const rows = Array.isArray(md) ? md : [md];
          const asks = [];
          for (const row of rows) {
            if (!row) continue;
            if (!mktCurrency && row.currencyCode) mktCurrency = row.currencyCode;
            const nest = row.standardMarketData || row.flexMarketData || row.directMarketData || {};
            const askRaw = row.lowestAskAmount != null ? row.lowestAskAmount : (nest.lowestAsk != null ? nest.lowestAsk : nest.lowestAskAmount);
            const bidRaw = row.highestBidAmount != null ? row.highestBidAmount : nest.highestBidAmount;
            const ask = askRaw != null ? Number(askRaw) : null;
            const bid = bidRaw != null ? Number(bidRaw) : null;
            if (ask && ask > 0) asks.push(ask);
            if (bid && (!highestBid || bid > highestBid)) highestBid = bid;
          }
          if (asks.length) lowestAsk = Math.min.apply(null, asks);
          if (env.CACHE) {
            try { await env.CACHE.put('stockxprice:' + currency + ':' + pid, JSON.stringify({ lowestAsk, highestBid, currency: mktCurrency || currency }), { expirationTtl: 21600 }); } catch (_) {}
          }
        }
      } catch (_) {}
    }

    items.push({
      source: 'StockX',
      itemId: 'stockx_' + pid,
      _pid: pid,
      styleId,                         // for exact SKU matching against eBay MPN
      title: p.title || p.name || p.productName || '',
      stockxImage,                     // StockX's own studio image (imgix)
      colorway: String((p.productAttributes && p.productAttributes.colorway) || ''),
      url: p.urlKey ? ('https://stockx.com/' + p.urlKey) : 'https://stockx.com',
      price: lowestAsk,
      currency: mktCurrency || currency,
      lowestAsk,
      highestBid,
      stockx: true,
    });
  }

  if (env.CACHE && items.length) {
    try { await env.CACHE.put(key, JSON.stringify({ items }), { expirationTtl: 21600 }); } catch (_) {}
  }

  return items.slice(0, limit);
}

// Fast, catalog-only suggestion lookup for live typeahead search - deliberately
// skips the market-data fetch (and its 1.1s/item pacing) that stockxSearch does,
// since a dropdown that updates as you type needs to come back in well under a
// second, not several. No price here - just title/styleId/colorway/image so the
// user can pick the exact product before we go fetch anything live.
// ── Canonical product resolver ──────────────────────────────────────────────
// Turns a picked StockX suggestion into a permanent products.id. Only items
// with a real style code get canonicalized (that's the strong identifier we
// trust) - vague items with no style code fall back to the existing
// query-based tracking untouched, exactly as the migration plan calls for.
// ON CONFLICT keeps one row per canonical_key forever and refreshes its
// brand/colorway/image as we see better data for it over time.
// Deterministic, human-readable slug for the SEO page URL - built from the
// SAME real identity fields as the canonical_key (title + style code), so
// it's stable and never needs a random/incrementing disambiguator.
function slugifyProduct(title, styleId) {
  const base = String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const code = String(styleId || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return (code && !base.includes(code)) ? `${base}-${code}`.slice(0, 90) : base.slice(0, 90);
}

async function resolveCanonicalProduct(product, env) {
  if (!env.DB || !product || !product.styleId) return null;
  // This function only knows how to canonicalize sneakers (product_type is
  // hardcoded below). LEGO suggestions carry a set number in styleId too, but
  // canonicalizing them here would mislabel a LEGO set as a "sneaker" -
  // LEGO canonicalization is separate, deliberately-deferred future work, not
  // something to fall into by accident via a shared styleId field.
  if (product.brand === 'LEGO') return null;
  const styleKey = String(product.styleId).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!styleKey) return null;
  const canonicalKey = `sneaker:${styleKey}`;
  const slug = slugifyProduct(product.title, product.styleId);
  try {
    const row = await env.DB.prepare(
      `INSERT INTO products (canonical_key, product_type, brand, model, style_id, colorway, image_url, slug, updated_at)
       VALUES (?, 'sneaker', ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(canonical_key) DO UPDATE SET
         brand = COALESCE(excluded.brand, products.brand),
         model = COALESCE(excluded.model, products.model),
         colorway = COALESCE(excluded.colorway, products.colorway),
         image_url = COALESCE(excluded.image_url, products.image_url),
         slug = COALESCE(products.slug, excluded.slug),
         updated_at = CURRENT_TIMESTAMP
       RETURNING id`
    ).bind(
      canonicalKey,
      product.brand || null,
      product.title || null,
      String(product.styleId).slice(0, 40),
      product.colorway || null,
      product.image || null,
      slug
    ).first();
    if (row && row.id) return row.id;
  } catch (e) {
    // RETURNING isn't supported on every D1 version - fall back to a plain
    // upsert + lookup so this never breaks the request it's attached to.
    try {
      await env.DB.prepare(
        `INSERT INTO products (canonical_key, product_type, brand, model, style_id, colorway, image_url, slug, updated_at)
         VALUES (?, 'sneaker', ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(canonical_key) DO UPDATE SET
           brand = COALESCE(excluded.brand, products.brand),
           model = COALESCE(excluded.model, products.model),
           colorway = COALESCE(excluded.colorway, products.colorway),
           image_url = COALESCE(excluded.image_url, products.image_url),
           slug = COALESCE(products.slug, excluded.slug),
           updated_at = CURRENT_TIMESTAMP`
      ).bind(canonicalKey, product.brand || null, product.title || null, String(product.styleId).slice(0, 40), product.colorway || null, product.image || null, slug).run();
      const sel = await env.DB.prepare('SELECT id FROM products WHERE canonical_key = ?').bind(canonicalKey).first();
      if (sel && sel.id) return sel.id;
    } catch (e2) { logErr('resolveCanonicalProduct fallback', e2); }
  }
  return null;
}

async function stockxCatalogSuggest(term, env, limit = 8) {
  const key = `stockxsuggest2:${String(term || '').toLowerCase().slice(0, 60)}`;
  if (env.CACHE) {
    try { const cached = await env.CACHE.get(key, 'json'); if (cached) return cached; } catch (_) {}
  }
  const token = await getStockxToken(env);
  const apiKey = env.STOCKX_API_KEY;
  if (!token || !apiKey) return [];
  const headers = { 'Authorization': 'Bearer ' + token, 'x-api-key': apiKey, 'Content-Type': 'application/json' };
  const imageFromUrlKey = (uk) => {
    if (!uk) return '';
    const pretty = String(uk).split('-').map(s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s).join('-');
    // 360 first-frame studio shot (deterministic path) + imgix sizing/white-bg.
    return 'https://images.stockx.com/360/' + pretty + '/Images/' + pretty + '/Lv2/img01.jpg?fit=fill&bg=FFFFFF&w=300&h=214&auto=format,compress&q=80';
  };
  // Older flat "-Product.jpg" format - a different CDN path that sometimes
  // succeeds when the 360 path 404s (and vice versa). Returned as a second
  // candidate so the frontend can try both before falling back to a listing
  // photo, rather than giving up after one URL.
  const imageFromUrlKey2 = (uk) => {
    if (!uk) return '';
    const pretty = String(uk).split('-').map(s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s).join('-');
    return 'https://images.stockx.com/images/' + pretty + '-Product.jpg?fit=fill&bg=FFFFFF&w=300&h=214&auto=format,compress&q=80';
  };
  let products = [];
  try {
    const sr = await fetch('https://api.stockx.com/v2/catalog/search?query=' + encodeURIComponent(term) + '&pageNumber=1&pageSize=40', { headers });
    if (!sr.ok) return [];
    const sd = await sr.json();
    products = (sd && (sd.products || sd.results || sd.data)) || [];
    if (!Array.isArray(products)) products = [];
  } catch (_) { return []; }

  // Same relevance gate as stockxSearch: every meaningful query word must
  // appear in the title. "yeezy zebra" must contain BOTH "yeezy" and "zebra" -
  // this is what keeps "Yeezy x Gap Hoodie" and "Yeezy Zyon" out of the
  // dropdown when someone specifically typed "zebra".
  const normT = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const STOPT = new Set(['the', 'and', 'for', 'with', 'new', 'set', 'box', 'size']);
  const sing = (w) => w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w;
  const toksT = (s) => normT(s).split(' ').filter(w => w.length >= 2 && !STOPT.has(w)).map(sing);
  const qToks = toksT(term);
  const qMentionsKids = /\b(kid|infant|toddler|gs|ps|td)\b/i.test(term);

  let relevant = products.filter(p => {
    const title = p.title || p.name || p.productName || '';
    const tTok = toksT(title);
    return qToks.length > 0 && qToks.every(w => tTok.includes(w));
  });

  // Push kids/infant variants to the back unless the user actually asked for
  // them - "yeezy zebra" should surface the adult shoe first, not the infant
  // size run, even though both technically match every token.
  relevant.sort((a, b) => {
    const aKid = /\b(kids?|infants?|toddler)\b/i.test(a.title || '') ? 1 : 0;
    const bKid = /\b(kids?|infants?|toddler)\b/i.test(b.title || '') ? 1 : 0;
    if (!qMentionsKids && aKid !== bKid) return aKid - bKid;
    return 0; // otherwise keep StockX's own relevance/popularity ordering
  });

  // Dynamic result count: a very specific query (4+ words, e.g. "yeezy boost
  // 350 v2 onyx") means the person knows the exact shoe, so a short tight list
  // is enough. A broad query ("yeezy", "yeezy 350") means they're browsing the
  // range, so show the full set of matches (up to 10) rather than just 3.
  const dynamicLimit = qToks.length >= 4 ? Math.min(limit, 5) : Math.min(limit, 10);

  const out = relevant.slice(0, dynamicLimit).map(p => ({
    pid: p.productId || p.id || p.uuid || '',
    title: p.title || p.name || p.productName || '',
    styleId: String(p.styleId || p.styleID || '').trim(),
    colorway: String((p.productAttributes && p.productAttributes.colorway) || ''),
    brand: String(p.brand || (p.productAttributes && p.productAttributes.brand) || '').trim(),
    urlKey: String(p.urlKey || '').trim(),   // carried through so the detail page can resolve the REAL studio photo
    _guess1: imageFromUrlKey(p.urlKey),      // reconstructed CDN guess - kept only as a fallback candidate now
    _guess2: imageFromUrlKey2(p.urlKey)      // alternate CDN guess - second fallback candidate
  })).filter(p => p.pid && p.title);

  // Resolve the REAL image (og:image from the actual StockX product page) in
  // parallel for every suggestion - this is what actually fixes inconsistent
  // dropdown images. stockxImageFor caches each result 7 days per urlKey, so
  // this is slow only the very first time any given product is ever looked
  // up anywhere in the app; every repeat is a cache hit. The guessed CDN URLs
  // become fallback candidates instead of the primary source.
  await Promise.all(out.map(async p => {
    const real = p.urlKey ? await stockxImageFor(p.urlKey, env).catch(() => '') : '';
    p.image = real || p._guess1;
    p.image2 = real ? p._guess1 : p._guess2;
    delete p._guess1; delete p._guess2;
  }));

  if (env.CACHE) { try { await env.CACHE.put(key, JSON.stringify(out), { expirationTtl: 3600 }); } catch (_) {} }
  return out;
}

// ── Discogs: music catalogue (vinyl / CD / cassette) + real marketplace price ──
// Read-only search of the Discogs database, gated on the CLIENT to music queries.
// Auth is the simple consumer key/secret header — no OAuth needed for public data.
// FULLY SELF-CONTAINED AND FAIL-SAFE: returns [] on any error or missing keys, so
// it can never break the main search. Discogs requires a User-Agent on every call.
async function searchDiscogs(term, country, env, limit = 3) {
  const key = env.DISCOGS_KEY, secret = env.DISCOGS_SECRET;
  if (!key || !secret || !term) return [];
  const curr = currencyFor(country) || 'USD';
  const cacheKey = `discogs2:${curr}:${String(term).toLowerCase().slice(0, 60)}`;
  if (env.CACHE) { try { const c = await env.CACHE.get(cacheKey, 'json'); if (c && Array.isArray(c.items)) return c.items.slice(0, limit); } catch (_) {} }

  const headers = {
    'Authorization': `Discogs key=${key}, secret=${secret}`,
    'User-Agent': 'FindAI/1.0 +https://findai.ai'
  };

  let results = [];
  try {
    const sr = await fetch(
      'https://api.discogs.com/database/search?type=release&per_page=' +
      Math.max(limit * 2, 6) + '&q=' + encodeURIComponent(term),
      { headers }
    );
    if (!sr.ok) { logErr('discogs search status ' + sr.status, term); return []; }
    const sd = await sr.json();
    results = Array.isArray(sd && sd.results) ? sd.results : [];
  } catch (e) { logErr('discogs search', e); return []; }

  results = results.filter(r => r && r.id && r.title).slice(0, limit);
  if (!results.length) {
    if (env.CACHE) { try { await env.CACHE.put(cacheKey, JSON.stringify({ items: [] }), { expirationTtl: 1800 }); } catch (_) {} }
    return [];
  }

  // Real price signal per release: lowest current asking price + for-sale count.
  // One extra call each, run in parallel; Discogs allows 60/min authed and we
  // cache 6h, so this stays well within limits. A failed stats call => price null
  // (the card just shows "View on Discogs"), never an error.
  const items = await Promise.all(results.map(async (r) => {
    let price = null, priceCur = curr, forSale = 0;
    try {
      const mr = await fetch(
        'https://api.discogs.com/marketplace/stats/' + encodeURIComponent(r.id) +
        '?curr_abbr=' + encodeURIComponent(curr),
        { headers }
      );
      if (mr.ok) {
        const md = await mr.json();
        forSale = Number(md && md.num_for_sale) || 0;
        if (md && md.lowest_price && md.lowest_price.value != null) {
          price = Number(md.lowest_price.value);
          priceCur = md.lowest_price.currency || curr;
        }
      }
    } catch (_) {}
    const uri = r.uri
      ? ('https://www.discogs.com' + (String(r.uri)[0] === '/' ? r.uri : '/' + r.uri))
      : ('https://www.discogs.com/release/' + r.id);
    return {
      source: 'Discogs',
      _discogs: true,
      itemId: 'discogs_' + r.id,
      title: String(r.title || ''),                 // "Artist - Album"
      image: r.cover_image || r.thumb || '',
      price: price,                                  // lowest current asking price (may be null)
      currency: priceCur,
      url: uri,
      year: r.year || '',
      format: Array.isArray(r.format) ? r.format.slice(0, 2).join(', ') : '',
      forSale: forSale
    };
  }));

  if (env.CACHE && items.length) { try { await env.CACHE.put(cacheKey, JSON.stringify({ items }), { expirationTtl: 21600 }); } catch (_) {} }
  return items.slice(0, limit);
}

// ── Etsy: handmade / vintage / craft listings (read-only) ────────────────────
// Keyword search across all of Etsy via the Open API v3, app-level x-api-key
// auth (no OAuth needed for public active listings). Gated on the CLIENT to
// non-sneaker queries (Etsy sneakers are mostly customs/replicas). FULLY
// SELF-CONTAINED AND FAIL-SAFE: returns [] on any error or missing key, so it
// can never break the main search. Approved commercial use: display title,
// image, price and redirect to Etsy.
// Low-level Etsy fetch that tries both documented auth formats: keystring-only
// (the standard) first, then "keystring:shared_secret" (which Etsy's docs hint
// at). Returns the parsed results plus the raw status/body of the last attempt
// so a ?debug=1 call can show exactly what Etsy said instead of us guessing.
async function etsyFetchRaw(term, env, limit) {
  const key = env.ETSY_KEY;
  if (!key || !term) return { ok: false, results: [], status: 0, body: 'missing ETSY_KEY or term', tried: [] };
  const url = 'https://openapi.etsy.com/v3/application/listings/active?limit=' +
    Math.max(limit * 2, 6) + '&includes=Images&keywords=' + encodeURIComponent(term);
  const auths = [{ label: 'keystring', value: key }];
  if (env.ETSY_SECRET) auths.push({ label: 'keystring:secret', value: key + ':' + env.ETSY_SECRET });
  const tried = [];
  let last = { status: 0, body: '' };
  for (const a of auths) {
    try {
      const r = await fetch(url, { headers: { 'x-api-key': a.value, 'Content-Type': 'application/json' } });
      const text = await r.text();
      last = { status: r.status, body: text.slice(0, 400) };
      tried.push({ auth: a.label, status: r.status });
      if (r.ok) {
        let d = {}; try { d = JSON.parse(text); } catch (_) {}
        const results = Array.isArray(d && d.results) ? d.results : [];
        return { ok: true, results, status: r.status, body: '', tried };
      }
    } catch (e) {
      last = { status: -1, body: String(e && e.message || e) };
      tried.push({ auth: a.label, status: -1 });
    }
  }
  return { ok: false, results: [], status: last.status, body: last.body, tried };
}

async function searchEtsy(term, env, limit = 3) {
  const key = env.ETSY_KEY;
  if (!key || !term) return [];
  const cacheKey = `etsy1:${String(term).toLowerCase().slice(0, 60)}`;
  if (env.CACHE) { try { const c = await env.CACHE.get(cacheKey, 'json'); if (c && Array.isArray(c.items)) return c.items.slice(0, limit); } catch (_) {} }

  const res = await etsyFetchRaw(term, env, limit);
  const results = res.ok ? res.results : [];

  const items = results.filter(l => l && l.listing_id && l.title).slice(0, limit).map(l => {
    let price = null, cur = 'USD';
    if (l.price && l.price.amount != null && l.price.divisor) {
      price = Number(l.price.amount) / Number(l.price.divisor);
      cur = l.price.currency_code || 'USD';
    }
    // Etsy image fields vary; take whichever sized URL is present.
    let img = '';
    if (Array.isArray(l.images) && l.images[0]) {
      const im = l.images[0];
      img = im.url_570xN || im.url_680x540 || im.url_fullxfull || im.url_300x300 || im.url_170x135 || im.url_75x75 || '';
    }
    if (!img && l.MainImage) { img = l.MainImage.url_570xN || l.MainImage.url_fullxfull || ''; }
    return {
      source: 'Etsy',
      _etsy: true,
      itemId: 'etsy_' + l.listing_id,
      title: String(l.title || ''),
      image: img,
      price: price,
      currency: cur,
      url: l.url || ('https://www.etsy.com/listing/' + l.listing_id)
    };
  }).filter(i => i.title);

  // includes=Images often returns no image on this endpoint, so for any card
  // still missing a photo, fetch it from Etsy's dedicated images endpoint by
  // listing_id (always returns images). Only a few cards, quota is 100K/day.
  const authVal = env.ETSY_SECRET ? (key + ':' + env.ETSY_SECRET) : key;
  await Promise.all(items.map(async (it) => {
    if (it.image) return;
    const lid = String(it.itemId || '').replace('etsy_', '');
    if (!lid) return;
    try {
      const ir = await fetch(
        'https://openapi.etsy.com/v3/application/listings/' + encodeURIComponent(lid) + '/images',
        { headers: { 'x-api-key': authVal, 'Content-Type': 'application/json' } }
      );
      if (!ir.ok) return;
      const id = await ir.json();
      const first = Array.isArray(id && id.results) ? id.results[0] : null;
      if (first) it.image = first.url_570xN || first.url_680x540 || first.url_fullxfull || first.url_300x300 || '';
    } catch (_) {}
  }));

  if (env.CACHE && items.length) { try { await env.CACHE.put(cacheKey, JSON.stringify({ items }), { expirationTtl: 10800 }); } catch (_) {} }
  return items.slice(0, limit);
}

// ── Exact-item filter ─────────────────────────────────────────────────────
// When someone opens ONE specific product, every listing shown must be the
// SAME item — not the kids/infant size, not a different silhouette (e.g. Yeezy
// "CMPCT"), not a look-alike. We match on the strongest identifier available:
//   1) a style code / set number (from the picked product OR the query) that
//      appears in the listing title — the reliable, exact signal; and
//   2) if that isn't available, we at least strip child/variant sizes when the
//      tracked item is the standard adult version.
// This leans on marketplace titles carrying the code; where a seller omits it,
// that one listing can't be matched perfectly — so it's tight, not magic.
function exactItemFilter(list, product, query) {
  const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const isCode = (s) => /^[A-Z]{0,4}\d{4,7}$/.test(s);
  const ids = new Set();
  const styleId = product && product.styleId ? norm(product.styleId) : '';
  if (styleId && isCode(styleId)) ids.add(styleId);
  (String(query).match(/\b[A-Za-z]{0,4}\d{4,7}\b/g) || []).forEach(t => { const n = norm(t); if (isCode(n)) ids.add(n); });

  const variantRe = /\b(kids?|infants?|toddler|youth|baby|crib|little\s*kids?|big\s*kids?|pre[-\s]*school|td|gs|ps|cmpct|compact)\b/i;
  const ctx = ((product && product.colorway) || '') + ' ' + String(query);
  const trackedIsStandard = !variantRe.test(ctx);

  // Did the USER's query contain a set number? If they searched "lego spongebob"
  // with no number, filtering every result down to titles that happen to include
  // the styleId is wrong — most genuine eBay listings for a set describe it by
  // name, not number, so it collapses the grid. Only hard-filter on an ID when
  // the query itself supplied one (e.g. "lego 3818"); otherwise fall through to
  // the gentle variant trim, which keeps the by-name listings.
  const queryHasId = (String(query).match(/\b[A-Za-z]{0,4}\d{4,7}\b/g) || []).some(t => isCode(norm(t)));

  // 1) Strong match: keep listings whose title carries an ID token, OR (for
  // StockX) whose own catalog styleId equals the tracked product's.
  if (ids.size && queryHasId) {
    const strong = list.filter(it => {
      const t = norm(it.title);
      for (const id of ids) if (t.includes(id)) return true;
      if ((it.stockx || it._stockx) && it.styleId && ids.has(norm(it.styleId))) return true;
      return false;
    });
    const isSx = (it) => !!(it && (it.stockx || it._stockx || /stockx/i.test(it.source || '')));
    const strongHasNonSx = strong.some(it => !isSx(it));
    const listHasNonSx = list.some(it => !isSx(it));
    if (strong.length >= 1 && (strongHasNonSx || !listHasNonSx)) return strong;
  }
  // 2) Safety net: drop child/variant sizes for a standard adult item.
  if (trackedIsStandard) {
    const trimmed = list.filter(it => !variantRe.test(it.title || ''));
    if (trimmed.length >= 1) return trimmed;
  }
  return list;
}

// ── Stable listing identity, for observation dedup ──────────────────────────
// eBay/AliExpress items have a real itemId. StockX has no per-seller listing -
// it's a matched market - so the product id itself IS the stable key, meaning
// StockX naturally collapses to one observation per product per day. That's
// correct, not a bug. Last resort: a deterministic hash of the URL.
function listingKeyFor(it) {
  if (it && it.itemId) return String(it.itemId).slice(0, 80);
  if (it && (it.stockx || it._stockx) && it.pid) return 'sx:' + String(it.pid).slice(0, 60);
  if (it && it.url) {
    let h = 0; const s = String(it.url);
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return 'url:' + (h >>> 0).toString(36);
  }
  return null;
}

// Storage cap for the raw observation layer, PER PRODUCT PER SOURCE PER DAY.
// A named constant so the cap can be tuned later without touching the
// sampling algorithm itself.
const MAX_OBSERVATIONS_PER_PRODUCT_PER_DAY = 25;

// ── Raw observation layer (canonicalized products only) ─────────────────────
// One batched D1 round trip, no new marketplace API calls - consumes listings
// already fetched by the caller. Aggregates (price_snapshots/price_samples)
// stay untouched; this is purely additive. Silently no-ops without a
// productId, by design - keeps this table honest to the canonical layer
// rather than re-fragmenting history under bare query strings.
//
// Sampling: below the cap, store every listing - full fidelity, no bias.
// Above the cap, DON'T just keep the extremes (cheapest/priciest) forever -
// that would permanently erase the middle of the market from the historical
// record and bias any future distribution-shape analysis. Instead: guarantee
// the min, median, and max are captured (so the spread is always known),
// then fill the rest of the cap with a random sample of what's left, so the
// stored set stays statistically representative of the real distribution
// rather than skewed toward extremes. Note this only affects the raw
// observation layer - today's min/median/avg/max/count in price_snapshots
// are computed upstream from the FULL listing set before this cap applies.
async function writePriceObservations(env, productId, query, source, listings) {
  if (!env.DB || !productId || !listings || !listings.length) return;
  const today = new Date().toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();

  // Only listings we can actually key and price - same validity check as
  // before, just done up front so the cap/sample decision is based on the
  // real candidate count, not the raw (possibly unkeyable) input length.
  const candidates = listings.filter(it => listingKeyFor(it) && Number(it && it.price) > 0);

  let selected;
  if (candidates.length <= MAX_OBSERVATIONS_PER_PRODUCT_PER_DAY) {
    selected = candidates;
  } else {
    const byPrice = candidates.slice().sort((a, b) => Number(a.price) - Number(b.price));
    const keep = new Set([byPrice[0], byPrice[byPrice.length - 1], byPrice[Math.floor(byPrice.length / 2)]]);
    const guaranteed = [...keep];
    const remaining = byPrice.filter(it => !keep.has(it));
    // Fisher-Yates partial shuffle - unbiased random sample without replacement.
    for (let i = remaining.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
    }
    const fillCount = Math.max(0, MAX_OBSERVATIONS_PER_PRODUCT_PER_DAY - guaranteed.length);
    selected = guaranteed.concat(remaining.slice(0, fillCount));
  }

  const stmts = [];
  for (const it of selected) {
    const key = listingKeyFor(it);
    const price = Number(it.price);
    stmts.push(env.DB.prepare(
      `INSERT INTO price_observations (product_id, query, source, listing_key, price, currency, title, observed_date, seen_at)
       VALUES (?, ?, ?, ?, ?, 'USD', ?, ?, ?)
       ON CONFLICT(product_id, source, listing_key, observed_date) DO NOTHING`
    ).bind(productId, query || null, source, key, price, String(it.title || '').slice(0, 200), today, nowIso));
  }
  if (stmts.length) { try { await env.DB.batch(stmts); } catch (e) { logErr('price_observations batch', e); } }
}


// ── Safe market-history helpers (calculation version 2) ────────────────
// The listing cards and Live Price remain immediate/live. These helpers only
// decide whether a MARKET (median) point is trustworthy enough to write into
// chart history.
function dedupeTrackerListings(items) {
  const seen = new Set();
  const out = [];
  for (const it of (items || [])) {
    if (!it || !(Number(it.price) > 0)) continue;
    const key = listingKeyFor(it)
      || String(it.url || '').trim().toLowerCase()
      || [String(it.title || '').trim().toLowerCase(), String(it.seller || '').trim().toLowerCase(), Number(it.price).toFixed(2)].join('|');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

async function validateMarketSample(env, productId, query, source, s) {
  if (!env.DB || !s || Number(s.count) < 3 || !(Number(s.median) > 0)) {
    return { accepted: false, reason: 'minimum_listings' };
  }
  const src = source || 'all';
  const sampleKey = productId ? ('p:' + productId) : ('q:' + String(query || '').toLowerCase());
  let previous = null;
  try {
    if (productId) {
      previous = await env.DB.prepare(
        `SELECT median_price FROM product_price_samples
         WHERE product_id = ? AND source = ? AND CAST(COALESCE(calculation_version, '1') AS INTEGER) = 2
         ORDER BY sampled_at DESC LIMIT 1`
      ).bind(productId, src).first();
    } else {
      previous = await env.DB.prepare(
        `SELECT median_price FROM price_samples
         WHERE query = ? AND source = ? AND CAST(COALESCE(calculation_version, '1') AS INTEGER) = 2
         ORDER BY sampled_at DESC LIMIT 1`
      ).bind(String(query || '').toLowerCase(), src).first();
    }
  } catch (_) {}

  const prevMedian = previous && Number(previous.median_price);
  if (!(prevMedian > 0)) {
    try { await env.DB.prepare('DELETE FROM pending_price_changes WHERE sample_key = ? AND source = ?').bind(sampleKey, src).run(); } catch (_) {}
    return { accepted: true, reason: 'first_clean_sample' };
  }

  const newMedian = Number(s.median);
  const changeRatio = Math.abs(newMedian - prevMedian) / prevMedian;
  if (changeRatio <= 0.30) {
    try { await env.DB.prepare('DELETE FROM pending_price_changes WHERE sample_key = ? AND source = ?').bind(sampleKey, src).run(); } catch (_) {}
    return { accepted: true, reason: 'normal_change', changeRatio };
  }

  let pending = null;
  try {
    pending = await env.DB.prepare(
      'SELECT candidate_median FROM pending_price_changes WHERE sample_key = ? AND source = ?'
    ).bind(sampleKey, src).first();
  } catch (_) {}
  const candidate = pending && Number(pending.candidate_median);
  if (candidate > 0 && Math.abs(newMedian - candidate) / candidate <= 0.10) {
    try { await env.DB.prepare('DELETE FROM pending_price_changes WHERE sample_key = ? AND source = ?').bind(sampleKey, src).run(); } catch (_) {}
    return { accepted: true, reason: 'confirmed_large_change', changeRatio };
  }

  try {
    await env.DB.prepare(
      `INSERT INTO pending_price_changes (sample_key, source, candidate_median, previous_median, listing_count, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(sample_key, source) DO UPDATE SET
         candidate_median = excluded.candidate_median,
         previous_median = excluded.previous_median,
         listing_count = excluded.listing_count,
         last_seen_at = CURRENT_TIMESTAMP`
    ).bind(sampleKey, src, newMedian, prevMedian, Number(s.count) || 0).run();
  } catch (_) {}
  return { accepted: false, reason: 'large_change_pending', changeRatio };
}

// Fetch a tracker query, apply the SAME new-only + junk filters as the detail
// page, and return the live floor (cheapest new listing), plus avg / max /
// count. Used by /tracker/search, the 15-min live sampler, and the daily
// snapshot so every stored point matches exactly what the page shows.
// Returns null when there are no valid prices.
async function trackerSample(query, env, ctx, product = null) {
  const [{ items }, sx] = await Promise.all([
    searchListings(query, '', 'US', env).catch(() => ({ items: [] })),
    stockxSearch(query, 'USD', env, 6, ctx).catch(() => [])
  ]);
  const isNew = (c) => !c || (/new/i.test(c) && !/defect|open box|for parts|parts only/i.test(c));
  let all = items.concat(Array.isArray(sx) ? sx : []).filter(it => isNew(it && it.condition) && !USED_TITLE_RE.test((it && it.title) || '') && !BUNDLE_RE.test((it && it.title) || ''));
  if (TRACKER_SNEAKER_RE.test(query)) {
    all = all.filter(it => !/aliexpress|ali\s*express/i.test((it && it.source) || ''));
  }
  const pr0 = all.map(i => Number(i.price)).filter(p => p > 0).sort((a, b) => a - b);
  if (pr0.length >= 4) {
    const floor = pr0[Math.floor(pr0.length / 2)] * 0.2;
    all = all.filter(it => !(Number(it.price) > 0 && Number(it.price) < floor));
  }
  // Keep only the exact item. When called from the scheduler we now pass the
  // STORED product identity (styleId/brand/colorway) so the daily sample matches
  // the same shoe the live page showed — not just whatever the query text finds.
  all = exactItemFilter(all, product, query);
  all = dedupeTrackerListings(all);
  const priced = all.filter(it => Number(it.price) > 0);
  const prices = priced.map(it => Number(it.price)).sort((a, b) => a - b);
  if (!prices.length) return null;
  const median = prices.length % 2
    ? prices[(prices.length - 1) / 2]
    : (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2;
  // Per-source contribution, so the stored data can prove which marketplaces
  // were present (and catch a source silently dropping out on a given day).
  const ebayN = priced.filter(it => !it.stockx && !it._stockx && !/stockx/i.test(it.source || '')).length;
  const stockxN = priced.filter(it => it.stockx || it._stockx || /stockx/i.test(it.source || '')).length;
  return {
    live: prices[0],                                    // cheapest new listing
    median,                                             // median asking price across qualifying listings
    avg: prices.reduce((a, b) => a + b, 0) / prices.length,
    max: prices[prices.length - 1],
    count: prices.length,                               // PRICED listings (the median basis), not raw results
    ebayCount: ebayN,
    stockxCount: stockxN,
    items: priced                                       // for writePriceObservations - no extra API calls needed
  };
}

// ── Programmatic SEO: server-rendered product page ───────────────────────────
// Builds a COMPLETE HTML document (not a JS shell) so Googlebot sees real
// content + structured data on fetch — the requirement for these pages to rank.
// JSON destined for a <script> block. JSON.stringify does NOT escape "/", so a
// product name containing </script> would close the tag and let the rest of the
// string execute as HTML. Since the name is derived from a user-supplied URL
// slug, that was a live XSS on findai.ai. Escaping < (and the JS line
// terminators) makes the payload inert while keeping it valid JSON.
function jsonForScript(obj) {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function htmlEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderSeoItemPage(query, listings, stats, product, history, url) {
  const nice = query.replace(/\b\w/g, c => c.toUpperCase());
  const name = (product && product.title) ? product.title : nice;
  const brand = (product && product.brand) || '';
  const styleId = (product && product.styleId) || '';
  const colorway = (product && product.colorway) || '';
  // Prefer a listing (eBay) photo — those load reliably. StockX studio images
  // hotlink-block, so route any stockx.com URL through the /img proxy.
  const seoImg = (raw) => {
    if (!raw) return '';
    if (/stockx\.com/i.test(raw)) return url.origin + '/img?u=' + encodeURIComponent(raw);
    return raw;
  };
  const rawImg = (listings[0] && listings[0].image) || (product && (product.image || product.stockxImage)) || '';
  const img = seoImg(rawImg);
  const canonical = (url.origin + url.pathname);
  const priced = (stats && stats.count) ? stats : null;
  const low = priced ? Math.round(priced.live) : null;
  const high = priced ? Math.round(priced.max) : null;
  const median = priced ? Math.round(priced.median) : null;

  const title = priced
    ? `${name} — Prices from $${low} | Live Market Data | FindAI`
    : `${name} — Prices & Listings | FindAI`;
  const desc = priced
    ? `Compare live prices for ${name} across eBay, StockX and more. Lowest $${low}, market value $${median}, across ${priced.count} listings. Price history and buying insights on FindAI.`
    : `Compare prices and listings for ${name} across marketplaces on FindAI.`;

  // JSON-LD structured data — this is what powers rich product results.
  const ld = { '@context': 'https://schema.org', '@type': 'Product', name };
  if (img) ld.image = img;
  if (brand) ld.brand = { '@type': 'Brand', name: brand };
  if (styleId) ld.sku = styleId;
  if (priced) {
    ld.offers = {
      '@type': 'AggregateOffer', priceCurrency: 'USD',
      lowPrice: low, highPrice: high, offerCount: priced.count,
      availability: 'https://schema.org/InStock'
    };
  }

  const specRows = [
    brand && ['Brand', brand], styleId && ['Style / Set #', styleId], colorway && ['Colourway', colorway]
  ].filter(Boolean).map(r => `<tr><th>${htmlEscape(r[0])}</th><td>${htmlEscape(r[1])}</td></tr>`).join('');

  const buyCards = listings.slice(0, 8).map(l => {
    const src = htmlEscape(l.source || (l.stockx ? 'StockX' : 'Marketplace'));
    const price = l.price ? ('$' + Number(l.price).toLocaleString()) : 'See listing';
    return `<li class="buy"><a href="${htmlEscape(l.url || '#')}" rel="nofollow noopener" target="_blank">`
      + `<span class="src">${src}</span><span class="pr">${price}</span>`
      + `<span class="ti">${htmlEscape((l.title || '').slice(0, 70))}</span></a></li>`;
  }).join('');

  const histNote = (history && history.length > 1)
    ? `<p>FindAI has tracked this item's price across ${history.length} days, ranging from the recorded low to high over that period.</p>`
    : `<p>FindAI is building this item's price history — check back as more data is recorded.</p>`;

  const priceBlock = priced ? `
    <div class="stats">
      <div class="stat"><span>Live Price</span><b>$${low.toLocaleString()}</b><small>cheapest new listing</small></div>
      <div class="stat"><span>Market Price</span><b>$${median.toLocaleString()}</b><small>median across listings</small></div>
      <div class="stat"><span>Highest</span><b>$${high.toLocaleString()}</b></div>
      <div class="stat"><span>Listings</span><b>${priced.count}</b></div>
    </div>` : `<p class="checking">We're checking live prices for this item right now.</p>`;

  const robots = priced ? 'index, follow' : 'noindex, follow';

  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${htmlEscape(title)}</title>
<meta name="description" content="${htmlEscape(desc)}">
<meta name="robots" content="${robots}">
<link rel="canonical" href="${htmlEscape(canonical)}">
<meta property="og:type" content="product"><meta property="og:title" content="${htmlEscape(title)}">
<meta property="og:description" content="${htmlEscape(desc)}"><meta property="og:url" content="${htmlEscape(canonical)}">
${img ? `<meta property="og:image" content="${htmlEscape(img)}">` : ''}
<script type="application/ld+json">${jsonForScript(ld)}</script>
<style>
:root{color-scheme:dark}body{margin:0;background:#000;color:#eee;font-family:'DM Sans',system-ui,sans-serif;line-height:1.5}
.wrap{max-width:1000px;margin:0 auto;padding:24px}
a{color:#4d9fe6}.brand,.brand2{font-weight:800;font-size:22px;color:#fff;text-decoration:none}
.top{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:16px;padding:14px 24px;background:rgba(0,0,0,.92);backdrop-filter:blur(8px);border-bottom:1px solid #161616}
.top .search{flex:1;max-width:560px;margin:0 auto;position:relative}
.top .search input{width:100%;box-sizing:border-box;background:#111;border:1px solid #262626;border-radius:999px;padding:11px 18px;color:#fff;font-size:15px;font-family:inherit;outline:none}
.top .search input:focus{border-color:#1a6fff}
.top .sug{position:absolute;left:0;right:0;top:48px;background:#0d0d0d;border:1px solid #222;border-radius:14px;overflow:hidden;display:none;box-shadow:0 12px 40px rgba(0,0,0,.6)}
.top .sug a{display:flex;justify-content:space-between;gap:10px;padding:11px 16px;color:#eee;text-decoration:none;font-size:14px;border-bottom:1px solid #171717}
.top .sug a:last-child{border-bottom:none}.top .sug a:hover{background:#161616}.top .sug span{color:#666;font-size:12px}
.top .auth{display:flex;gap:10px;flex:none}
.top .auth a{text-decoration:none;font-weight:600;font-size:14px;padding:9px 16px;border-radius:999px}
.top .ghost{color:#eee;border:1px solid #2a2a2a}.top .solid{background:#fff;color:#000}
@media(max-width:640px){.top .auth .ghost{display:none}.top{gap:8px;padding:10px 12px}}
h1{font-size:28px;margin:18px 0 4px}.sub{color:#888;margin:0 0 20px}
.hero{display:flex;gap:24px;flex-wrap:wrap}.photo{width:320px;max-width:100%;aspect-ratio:1;background:#fff;border-radius:14px;object-fit:contain}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin:18px 0}
.stat{background:#111;border:1px solid #1c1c1c;border-radius:12px;padding:14px}
.stat span{color:#888;font-size:13px;display:block}.stat b{color:#4d9fe6;font-size:26px;display:block}.stat small{color:#666}
table{border-collapse:collapse;margin:14px 0}th,td{text-align:left;padding:6px 18px 6px 0;border-bottom:1px solid #1a1a1a}th{color:#888;font-weight:600}
ul.buys{list-style:none;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
.buy a{display:block;background:#111;border:1px solid #1c1c1c;border-radius:12px;padding:14px;text-decoration:none;color:#eee}
.buy .src{font-size:12px;font-weight:700;color:#888;text-transform:uppercase}.buy .pr{display:block;font-size:20px;font-weight:700;margin:4px 0}
.buy .ti{display:block;font-size:13px;color:#aaa}h2{margin-top:34px}.checking{color:#888}
.cta{display:inline-block;margin-top:20px;background:#1a6fff;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:700}
footer{margin-top:40px;color:#666;font-size:13px;border-top:1px solid #1a1a1a;padding-top:16px}
</style></head><body><div class="wrap">
<header class="top">
  <a class="brand2" href="https://findai.ai/">FindAI</a>
  <div class="search">
    <input id="seo-q" type="text" placeholder="Search any item…" autocomplete="off" spellcheck="false">
    <div class="sug" id="seo-sug"></div>
  </div>
  <div class="auth">
    <a class="ghost" href="https://findai.ai/?login=1">Log in</a>
    <a class="solid" href="https://findai.ai/?signup=1">Sign up</a>
  </div>
</header>
<div class="hero">
  ${img ? `<img class="photo" src="${htmlEscape(img)}" alt="${htmlEscape(name)}">` : ''}
  <div style="flex:1;min-width:280px">
    <h1>${htmlEscape(name)}</h1>
    <p class="sub">Live prices and market data across marketplaces</p>
    ${priceBlock}
    <a class="cta" href="/">Track this item on FindAI &rarr;</a>
  </div>
</div>
${specRows ? `<h2>Product details</h2><table>${specRows}</table>` : ''}
<h2>Where to buy</h2>
${buyCards ? `<ul class="buys">${buyCards}</ul>` : '<p class="checking">No live listings found right now.</p>'}
<h2>Price history</h2>
${histNote}
<h2>About this price data</h2>
<p>FindAI aggregates live listings from multiple marketplaces and records daily price snapshots to build an honest market-price history. Prices shown are item prices (excluding shipping) in USD, updated regularly. This page reflects the most recent data FindAI has recorded for ${htmlEscape(name)}.</p>
<footer>FindAI &middot; AI shopping search &amp; price tracking. Prices are indicative and may change; always confirm on the seller's site before buying.</footer>
</div>
<script>
(function(){
  var API='${url.origin}';
  var q=document.getElementById('seo-q'), sug=document.getElementById('seo-sug'), t;
  function slug(s){return String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');}
  function esc(s){return String(s).replace(/[<>&"]/g,function(c){return{'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c];});}
  function hide(){sug.style.display='none';}
  q.addEventListener('input',function(){
    clearTimeout(t); var v=q.value.trim();
    if(v.length<2){sug.innerHTML='';hide();return;}
    t=setTimeout(function(){
      fetch(API+'/tracker/suggest?q='+encodeURIComponent(v)).then(function(r){return r.json();}).then(function(d){
        var items=(d&&d.suggestions)||[];
        if(!items.length){hide();return;}
        sug.innerHTML=items.slice(0,7).map(function(it){
          var ti=it.title||'';
          return '<a href="/item/'+slug(ti)+'"><span>'+esc(ti)+'</span>'+(it.styleId?'<span>'+esc(it.styleId)+'</span>':'')+'</a>';
        }).join('');
        sug.style.display='block';
      }).catch(hide);
    },220);
  });
  q.addEventListener('keydown',function(e){ if(e.key==='Enter'){ var v=q.value.trim(); if(v) location.href='/item/'+slug(v); }});
  document.addEventListener('click',function(e){ if(!sug.contains(e.target)&&e.target!==q) hide(); });
})();
</script>
</body></html>`;
}

// ── Currency (display only) ───────────────────────────────────────────────
// The DB always stores USD. We convert to the visitor's currency at render
// time using their Cloudflare country and daily FX rates cached in KV. We
// never store or compute stats on a converted value.
const COUNTRY_CCY = {
  US: 'USD', GB: 'GBP', JP: 'JPY', CN: 'CNY', CH: 'CHF',
  HK: 'HKD', SG: 'SGD', CA: 'CAD', AU: 'AUD',
  // Eurozone
  AT: 'EUR', BE: 'EUR', CY: 'EUR', EE: 'EUR', FI: 'EUR', FR: 'EUR', DE: 'EUR',
  GR: 'EUR', IE: 'EUR', IT: 'EUR', LV: 'EUR', LT: 'EUR', LU: 'EUR', MT: 'EUR',
  NL: 'EUR', PT: 'EUR', SK: 'EUR', SI: 'EUR', ES: 'EUR', HR: 'EUR'
};
const CCY_SYM = { USD: '$', EUR: '\u20AC', JPY: '\u00A5', GBP: '\u00A3', CNY: 'CN\u00A5', AUD: 'A$', CAD: 'C$', CHF: 'CHF ', HKD: 'HK$', SGD: 'S$' };
// Static fallback so a failed rate fetch never breaks pricing (approx, USD base).
const FX_FALLBACK = { USD: 1, EUR: 0.92, JPY: 157, GBP: 0.79, CNY: 7.2, AUD: 1.51, CAD: 1.37, CHF: 0.88, HKD: 7.8, SGD: 1.34 };

async function getFxRates(env) {
  const K = 'fx:rates:usd';
  if (env.CACHE) {
    try { const c = await env.CACHE.get(K); if (c) { const j = JSON.parse(c); if (j && j.rates) return j.rates; } } catch (_) {}
  }
  let rates = null;
  try {
    const r = await fetch('https://open.er-api.com/v6/latest/USD');
    if (r.ok) { const d = await r.json(); if (d && d.rates && d.rates.EUR) rates = d.rates; }
  } catch (_) {}
  if (!rates && env.CACHE) {
    // last-good (never expires) if today's fetch failed
    try { const c = await env.CACHE.get(K + ':last'); if (c) { const j = JSON.parse(c); if (j && j.rates) rates = j.rates; } } catch (_) {}
  }
  if (!rates) rates = FX_FALLBACK;
  if (env.CACHE) {
    try {
      const payload = JSON.stringify({ rates, at: Date.now() });
      await env.CACHE.put(K, payload, { expirationTtl: 86400 });
      await env.CACHE.put(K + ':last', payload);
    } catch (_) {}
  }
  return rates;
}

function fxForCountry(country, rates) {
  const cur = COUNTRY_CCY[String(country || '').toUpperCase()] || 'USD';
  const rate = (rates && typeof rates[cur] === 'number' && rates[cur] > 0) ? rates[cur] : (FX_FALLBACK[cur] || 1);
  return { currency: cur, symbol: CCY_SYM[cur] || (cur + ' '), rate };
}

// ── BrickLink API (OAuth 1.0a) ────────────────────────────────────────────
// Credentials come from Worker SECRETS, never hardcoded:
//   BL_CONSUMER_KEY, BL_CONSUMER_SECRET, BL_TOKEN, BL_TOKEN_SECRET
// Enriches LEGO sets with retired status + release year. Catalog facts rarely
// change, so responses are cached in KV for 30 days. NOTE: BrickLink does not
// expose RRP or minifig count — those require Brickset.
function blPct(s){ return encodeURIComponent(String(s)).replace(/[!*'()]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase()); }

async function blHmacSha1(key, msg){
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg));
  let bin = ''; const bytes = new Uint8Array(sig);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// OAuth 1.0a signing. Two rules that the original version got away with only
// because every call it made was query-less:
//   1. The base string uses the URL WITHOUT its query string.
//   2. Query parameters must be merged into the sorted parameter list that gets
//      signed, alongside the oauth_* ones.
// Adding a query string (?guide_type=sold&...) without doing both produces a
// signature BrickLink rejects with 401. This handles both, so it stays correct
// for the existing catalog calls and works for the price guide.
async function blAuthHeader(method, url, env){
  const oauth = {
    oauth_consumer_key: env.BL_CONSUMER_KEY,
    oauth_token: env.BL_TOKEN,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_nonce: Math.random().toString(36).slice(2) + Date.now().toString(36),
    oauth_version: '1.0'
  };

  // Split the URL: sign the bare endpoint, and pull the query into the params.
  let baseUrl = String(url), queryPairs = [];
  try {
    const u = new URL(String(url));
    baseUrl = u.origin + u.pathname;
    u.searchParams.forEach((v, k) => queryPairs.push([k, v]));
  } catch (_) {
    const qi = baseUrl.indexOf('?');
    if (qi >= 0) baseUrl = baseUrl.slice(0, qi);
  }

  // Merge oauth_* and query params, then sort by encoded key (then value),
  // which is what the spec requires.
  const all = Object.keys(oauth).map(k => [k, oauth[k]]).concat(queryPairs);
  const encoded = all.map(([k, v]) => [blPct(k), blPct(v)]);
  encoded.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const params = encoded.map(([k, v]) => k + '=' + v).join('&');

  const base = method.toUpperCase() + '&' + blPct(baseUrl) + '&' + blPct(params);
  const signingKey = blPct(env.BL_CONSUMER_SECRET) + '&' + blPct(env.BL_TOKEN_SECRET);
  oauth.oauth_signature = await blHmacSha1(signingKey, base);
  // Only oauth_* params go in the header; query params stay in the URL.
  return 'OAuth ' + Object.keys(oauth).sort().map(k => blPct(k) + '="' + blPct(oauth[k]) + '"').join(', ');
}

async function blGetSet(setNo, env){
  if (!env.BL_CONSUMER_KEY || !env.BL_TOKEN) return null;
  const no = String(setNo || '').trim();
  if (!no) return null;
  const cacheKey = 'bl:set:' + no;
  if (env.CACHE) { try { const c = await env.CACHE.get(cacheKey); if (c) return JSON.parse(c); } catch (_) {} }
  const setId = /-\d+$/.test(no) ? no : (no + '-1');   // BrickLink set numbers carry a "-1" variant suffix
  const url = 'https://api.bricklink.com/api/store/v1/items/SET/' + encodeURIComponent(setId);
  let out = null;
  try {
    const auth = await blAuthHeader('GET', url, env);
    const r = await fetch(url, { headers: { Authorization: auth, Accept: 'application/json' } });
    if (r.ok) {
      const j = await r.json();
      const d = j && j.data;
      if (d) out = {
        released: d.year_released || null,
        retired: !!d.is_obsolete,
        image: (function (u) { if (!u) return ''; u = String(u); return u.indexOf('//') === 0 ? ('https:' + u) : u.replace(/^http:/i, 'https:'); })(d.image_url || d.thumbnail_url || '')
      };
    }
  } catch (_) {}
  if (env.CACHE && out) { try { await env.CACHE.put(cacheKey, JSON.stringify(out), { expirationTtl: 2592000 }); } catch (_) {} }
  return out;
}

// Pull a LEGO set number out of a query string or an existing style_id.
// ── LEGO listing scoring ─────────────────────────────────────────────────────
// Deterministic 0–100 score combining RELEVANCE (is this the right set?) and
// AUTHENTICITY (real LEGO, not a clone/part/accessory?). No AI, no network call.
// A SCORE, not a gate: no single rule decides, because the fakes vary. An honest
// clone declares brand "Unbranded"; a deceptive one leaves brand blank and hides
// "Mock"/"compatible" in the title. Only the SUM of signals separates the real
// Denmark-sourced set from both.
function scoreLegoListing(item, setNumber, marketValue) {
  const title = String((item && item.title) || '').toLowerCase();
  const brand = String((item && item.brand) || '').trim().toLowerCase();
  const price = Number(item && item.price) || 0;
  const setNo = String(setNumber || '').replace(/-\d+$/, '');
  const reasons = [];

  // ── STAGE 1: ELIGIBILITY (hard disqualifiers) ──────────────────────────────
  // A listing is EITHER the real set or it is not. No quantity of relevance
  // bonuses can rescue a clone, a parts lot or an accessory — decided here,
  // before scoring, so a lucky stack of positives can never lift a bad listing
  // over a threshold. (This is the fix from review: eligibility THEN ranking.)
  let eligible = true;
  const brandIsClone = /unbranded|generic|compatible|for\s*lego|non[-\s]?lego|not\s*lego|lepin|sluban|cada|mould\s*king|xingbao|bela|decool|sembo/.test(brand);
  const titleFakeTell = /\bmock\b|\bcompatible\b|\bmoc\b|not\s*(?:an?\s*)?official|non[-\s]?lego|generic\s*(?:brick|block)|building\s*block\s*set|knock[-\s]?off|replica|\bclone\b/.test(title);
  const isPartsEtc = /instructions?\s*only|manual\s*only|box\s*only|empty\s*box|parts?\s*only|spare\s*parts?|minifig(?:ure)?s?\s*only|figure\s*only|stickers?\s*only|incomplete|missing\s*(?:pieces?|parts?)/.test(title) || legoLooksLikeStandalonePart(item);
  const isAccessory = /display\s*(?:case|stand|frame|box)|wall\s*mount|acrylic|light(?:ing)?\s*kit|led\s*kit|stand\s*for|case\s*for/.test(title);
  // A DIFFERENT set number in the title (and not ours) means it's the wrong set.
  const wrongSetNum = setNo && /\b\d{4,7}\b/.test(title) && !new RegExp('\\b' + setNo + '\\b').test(title);
  // Far below real market value is a clone/not-the-item tell strong enough to DQ.
  const farBelowMarket = marketValue > 0 && price > 0 && price < marketValue * 0.50;

  if (brandIsClone)   { eligible = false; reasons.push('dq:brand-clone'); }
  if (titleFakeTell)  { eligible = false; reasons.push('dq:fake-tell'); }
  if (isPartsEtc)     { eligible = false; reasons.push('dq:not-the-set'); }
  if (isAccessory)    { eligible = false; reasons.push('dq:accessory'); }
  if (wrongSetNum)    { eligible = false; reasons.push('dq:wrong-set'); }
  if (farBelowMarket) { eligible = false; reasons.push('dq:below-market'); }

  // ── STAGE 2: RANKING SCORE (only meaningful for eligible listings) ──────────
  // Among listings that ARE the real set, rank by how confidently so. This only
  // orders the survivors; it can never make an ineligible listing eligible.
  let score = 50;
  if (/lego/.test(brand)) { score += 20; reasons.push('brand:lego'); }
  else if (!brand)        { reasons.push('brand:blank'); } // unknown, allowed
  if (setNo && new RegExp('\\b' + setNo + '\\b').test(title)) { score += 25; reasons.push('setnum:match'); }
  if (/\bsealed\b|brand\s*new|\bnisb\b|complete\s*set|\bmisb\b/.test(title)) { score += 15; reasons.push('cond:sealed'); }
  else if (/\bnew\b/.test(title)) { score += 8; reasons.push('cond:new'); }
  score = Math.max(0, Math.min(100, Math.round(score)));

  const setMatch = setNo ? new RegExp('\\b' + setNo + '\\b').test(title) : false;
  // isReal is now the ELIGIBILITY verdict, not a score threshold.
  return { score, isReal: eligible, eligible, setMatch, reasons };
}

// Fetch ONE eBay listing's full item-specifics + description for FINALISTS only.
// The search API returns neither description nor all aspects, so the deceptive
// fakes (real set number, "New", box render, "Mock"/"not official" buried in
// text) can only be caught here. Called on the top 1–3 candidates, never all —
// 1–3 extra calls per search, not 50. Cached 24h.
async function ebayVerifyReal(item, env) {
  const id = item && (item.itemId || item.legacyItemId || item.id);
  if (!id || !env) return { ok: true, checked: false };
  const cacheKey = 'ebayverify:' + id;
  if (env.CACHE) { try { const c = await env.CACHE.get(cacheKey, 'json'); if (c) return c; } catch (_) {} }
  let verdict = { ok: true, checked: true };
  try {
    const token = await getEbayToken(env);
    const ep = `https://api.ebay.com/buy/browse/v1/item/${encodeURIComponent(id)}`;
    const marketplaceId = String((item && item.marketplaceId) || 'EBAY_US');
    const r = await fetch(ep, { headers: { Authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': marketplaceId } });
    if (r.ok) {
      const d = await r.json();
      const hay = [d.title, d.shortDescription, d.description, JSON.stringify(d.localizedAspects || []), (d.brand || '')].join(' ').toLowerCase();
      if (/not\s*(?:an?\s*)?official|this\s*is\s*not\s*lego|unbranded|compatible\s*(?:with|building)|non[-\s]?lego|\bmock\b|generic\s*(?:brick|block)|not\s*associated\s*with\s*lego/.test(hay)) {
        verdict = { ok: false, checked: true, reason: 'description-reveals-fake' };
      } else if (LEGO_NOT_THE_SET_RE.test(hay) || LEGO_ACCESSORY_RE.test(hay)
        || LEGO_OPENED_RE.test(hay) || LEGO_FAKE_RE.test(hay)
        || legoLooksLikeStandalonePart({ title: d.title || '' })) {
        verdict = { ok: false, checked: true, reason: 'description-reveals-part-or-accessory' };
      }
    }
  } catch (e) { logErr('ebayVerifyReal', e); }
  if (env.CACHE) { try { await env.CACHE.put(cacheKey, JSON.stringify(verdict), { expirationTtl: 86400 }); } catch (_) {} }
  return verdict;
}

// Set numbers are 4-7 digits, optionally with BrickLink's "-1" variant suffix.
// Guarded against grabbing years ("lego 2019 sets") or piece counts.
function legoSetNumberFrom(query, styleId) {
  const sid = String(styleId || '').trim();
  if (/^\d{4,7}(-\d+)?$/.test(sid)) return sid;
  const q = String(query || '');
  if (!/\blego\b/i.test(q)) return null;
  const matches = q.match(/\b\d{4,7}(?:-\d+)?\b/g) || [];
  for (const m of matches) {
    const bare = m.replace(/-\d+$/, '');
    // A bare 4-digit number in 1960-2035 is far more likely a year than a set.
    if (bare.length === 4) {
      const n = Number(bare);
      if (n >= 1960 && n <= 2035) continue;
    }
    return m;
  }
  return null;
}

// ── BrickLink price guide ───────────────────────────────────────────────────
// The catalog call above gives metadata only. THIS gives real money: BrickLink's
// price guide returns the last 6 months of ACTUAL COMPLETED SALES for a set,
// plus what's currently for sale, split by New/Used.
//
// Why this matters: our own price_snapshots table only knows what we've observed
// since we started polling, so a set nobody has viewed has no history and its
// chart is a flat line. BrickLink already has six months of real sold data for
// every LEGO set in existence. Pulling it means a set that has never been
// clicked before can still render a truthful chart on first view.
//
// guide_type 'sold' = completed transactions (last 6 months).
// guide_type 'stock' = current open listings (asking prices, NOT sales).
// We use 'sold' for history and 'stock' only for a "currently listed" figure.
//
// price_detail carries the individual transactions. For sold guides BrickLink
// includes a date on each one; when present we can plot a REAL dated curve. When
// absent we fall back to the aggregate, and the caller renders a band instead of
// a line rather than inventing dates.
//
// Cached 24h per set/condition — BrickLink rate-limits daily, and sold averages
// over 6 months do not meaningfully move within a day.
// ── LEGO.com grid entry ─────────────────────────────────────────────────────
// Fill this in once Rakuten approves the affiliate application. Everything else
// works without it — links just go out untracked until then.
const LEGO_AFFILIATE_PARAM = '';   // e.g. 'ranMID=...&ranEAID=...&ranSiteID=...'

// LEGO sells in regional storefronts with their own locale paths.
const LEGO_LOCALES = { US:'en-us', GB:'en-gb', AU:'en-au', CA:'en-ca', DE:'de-de', FR:'fr-fr', IT:'it-it', ES:'es-es', NL:'nl-nl', JP:'ja-jp' };

// An official LEGO.com entry for the buy grid.
//
// Gated on Retired === 'No'. LEGO does not sell retired sets at all, so a card
// there would send the user to a dead end — and its absence is informative: for
// a retired set the secondary market IS the market, which is the whole point of
// this page.
//
// The price shown is RRP, not a live price. LEGO discounts, bundles and goes out
// of stock, and regional prices are set independently rather than converted, so
// this is flagged isRrp for the frontend to label as a guide price rather than
// something we have observed on sale today.
// LEGO.com product URLs are /{locale}/product/{slug}-{setNumber}, where the slug
// is the marketing name with the LEGO prefix and theme stripped:
//   LEGO Technic Mercedes-AMG F1 W14 E Performance / 42171
//   -> mercedes-amg-f1-w14-e-performance-42171
// Verified against ~10 locales; the slug is identical across all of them.
function legoSlugFor(product, setNo){
  let name = String((product && (product.name || product.title)) || '').trim();
  if (!name) return '';
  const theme = String((product && product.theme) || '').trim();
  name = name.replace(/^lego\b/i, ' ');
  if (theme) name = name.replace(new RegExp('\\b' + theme.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'ig'), ' ');
  name = name.replace(/\u2122|\u00ae/g, ' ');
  const bare = String(setNo).replace(/-\d+$/, '');
  name = name.replace(new RegExp('\\b' + bare + '\\b', 'g'), ' ');   // don't double the number
  const slug = name.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug ? slug + '-' + bare : '';
}

// Resolve the best LEGO.com link for a set: the direct product page when it
// exists, otherwise a search for the set number.
//
// Sending an affiliate click to a search results page costs a conversion — the
// user has to find and click the product again. So we try the direct URL, verify
// it once, and cache the verdict for a week. That's one extra request per set per
// week, and every visitor after the first gets a direct link.
async function legoResolveUrl(product, setNo, locale, env){
  const bare = String(setNo).replace(/-\d+$/, '');
  const searchUrl = 'https://www.lego.com/' + locale + '/search?q=' + encodeURIComponent(bare);
  const slug = legoSlugFor(product, setNo);
  if (!slug) return searchUrl;
  const directUrl = 'https://www.lego.com/' + locale + '/product/' + slug;

  const cacheKey = 'lego:url:' + locale + ':' + slug;
  if (env && env.CACHE) {
    try {
      const cached = await env.CACHE.get(cacheKey);
      if (cached === 'ok') return directUrl;
      if (cached === 'no') return searchUrl;
    } catch (_) {}
  }
  try {
    // HEAD is enough to distinguish a live product page from a 404, and avoids
    // pulling the whole page.
    const r = await fetch(directUrl, { method: 'HEAD', redirect: 'follow' });
    const good = r.ok;
    if (env && env.CACHE) {
      try { await env.CACHE.put(cacheKey, good ? 'ok' : 'no', { expirationTtl: 604800 }); } catch (_) {}
    }
    return good ? directUrl : searchUrl;
  } catch (e) {
    logErr('legoResolveUrl', e);
    return searchUrl;
  }
}

// An official LEGO.com entry for the buy grid.
//
// Gated on Retired === 'No'. LEGO does not sell retired sets at all, so a card
// there would send the user to a dead end — and its absence is informative: for
// a retired set the secondary market IS the market, which is the whole point of
// this page.
//
// The price shown is RRP, not a live price. LEGO discounts, bundles and goes out
// of stock, and regional prices are set independently rather than converted, so
// this is flagged isRrp for the frontend to label as a guide price rather than
// something we have observed on sale today.
async function legoDotComEntry(product, setNo, country, env, heroImage){
  if (!product || !setNo) return null;
  const retired = String(product.retired || '').trim().toLowerCase();
  if (retired !== 'no' && retired !== 'false') return null;    // retired or unknown -> no card
  // Brickset gives LEGO's own price per region. Match the visitor's currency to
  // a region and use that figure directly; only fall back to converting the US
  // price when we have nothing for their currency.
  const REGION_CCY = { US: 'USD', UK: 'GBP', CA: 'CAD', DE: 'EUR' };
  const wantCcy = currencyFor(country);
  const byRegion = (product && product.rrpByRegion) || {};
  let rrp = null, rrpCcy = 'USD', priceIsLocal = false;
  for (const code of Object.keys(REGION_CCY)) {
    const v = Number(byRegion[code]);
    if (REGION_CCY[code] === wantCcy && isFinite(v) && v > 0) {
      rrp = v; rrpCcy = wantCcy; priceIsLocal = true; break;
    }
  }
  if (rrp === null) {
    const us = Number(byRegion.US);
    if (isFinite(us) && us > 0) { rrp = us; rrpCcy = 'USD'; }
    else rrp = Number(String(product.rrp || product.retailPrice || '').replace(/[^0-9.]/g, ''));
  }
  if (!isFinite(rrp) || rrp <= 0) return null;

  const locale = LEGO_LOCALES[String(country || 'US').toUpperCase()] || 'en-us';
  let url = await legoResolveUrl(product, setNo, locale, env);
  if (LEGO_AFFILIATE_PARAM) url += (url.indexOf('?') >= 0 ? '&' : '?') + LEGO_AFFILIATE_PARAM;

  return {
    source: 'lego',
    isOfficial: true,
    isRrp: true,
    title: 'LEGO.com \u2014 official shop',
    price: rrp,
    currency: rrpCcy,
    priceIsLocal,
    condition: 'New',
    priceNote: 'RRP',
    shippingNote: 'Excl. delivery',
    url,
    image: heroImage || ''
  };
}

// A BrickLink entry for the buy grid, built from the "stock" price guide (what
// is FOR SALE right now, as opposed to the "sold" guide used for the chart).
//
// This is an AGGREGATE, not a single listing: BrickLink's API exposes no
// endpoint for other sellers' individual lots, so we can only report the
// cheapest of N lots and link to the set's catalogue page. It is flagged
// isAggregate so the frontend can label it honestly rather than dressing it up
// as one seller's listing. The price also excludes shipping, which on BrickLink
// is frequently international and material.
async function blGridEntry(setNo, env, heroImage, loc){
  if (!setNo) return null;
  const pg = await blPriceGuide(setNo, env, { guideType: 'stock', condition: 'N', currency: 'USD' })
    .catch(() => null);
  if (!pg || !pg.min) return null;
  const setId = /-\d+$/.test(String(setNo)) ? String(setNo) : (String(setNo) + '-1');
  return {
    source: 'bricklink',
    isAggregate: true,
    title: 'BrickLink \u2014 ' + (pg.unitQuantity || 0) + ' lots available',
    price: pg.min,
    currency: pg.currency || 'USD',
    lots: pg.unitQuantity || 0,
    condition: 'New',
    shippingNote: 'Excl. shipping',
    // Deep-link straight into Items For Sale filtered to NEW. Without the
    // options hash the page opens on "All" condition, where the cheapest lots
    // are incomplete used sets — the exact thing the user is trying to avoid.
    // Format: #T=S (items-for-sale tab) & O={"cond":"N"} (new only).
    // "loc" biases to the buyer's country, which matters on BrickLink because
    // international shipping is frequently more than the item.
    url: 'https://www.bricklink.com/v2/catalog/catalogitem.page?S=' + encodeURIComponent(setId)
       + '#T=S&O=' + encodeURIComponent(JSON.stringify(loc ? { cond: 'N', loc } : { cond: 'N' })),
    image: heroImage || ''
  };
}

// Order the buy grid by cheapest-per-source first, then fill by price.
// Four near-identical eBay cards tell the user nothing about the market; one
// cheapest-per-marketplace card each does. The grid stays honestly price-sorted
// WITHIN that constraint — we never promote a dearer listing over a cheaper one
// from a source that is already represented.
// Fixed slot order: cheapest eBay, cheapest BrickLink, cheapest StockX, then the
// next cheapest eBay. Any source with nothing to show collapses and the slots
// shift up, so a set with no StockX presence becomes eBay / BrickLink / eBay /
// eBay rather than leaving a hole. Within every source we always take the
// cheapest, so no slot ever shows a dearer listing than one we passed over from
// that same source.
// Slot order. Sources with nothing to show collapse and later slots shift up, so
// a retired set (no LEGO.com card) becomes eBay / BrickLink / StockX / eBay on
// its own. Reorder this array to move the slots around — nothing else depends
// on the sequence.
const GRID_SOURCE_ORDER = ['ebay', 'lego', 'bricklink', 'stockx', 'ebay'];

function diversifyListings(items){
  const list = (items || []).filter(Boolean).slice();
  const priceOf = (x) => Number(x && x.price) || Infinity;
  const sourceOf = (x) => String((x && (x.source || x.marketplace)) || 'ebay').toLowerCase();
  list.sort((a,b) => priceOf(a) - priceOf(b));

  const bySource = new Map();
  for (const it of list) {
    const src = sourceOf(it);
    if (!bySource.has(src)) bySource.set(src, []);
    bySource.get(src).push(it);
  }
  const out = [], used = new Set();
  for (const src of GRID_SOURCE_ORDER) {
    const pool = bySource.get(src) || [];
    const next = pool.find(x => !used.has(x));
    if (next) { out.push(next); used.add(next); }
  }
  // Fill any remaining slots with whatever is cheapest and not already shown.
  for (const it of list) if (!used.has(it)) { out.push(it); used.add(it); }
  return out;
}

async function blPriceGuide(setNo, env, opts) {
  if (!env.BL_CONSUMER_KEY || !env.BL_TOKEN) return null;
  const no = String(setNo || '').trim();
  if (!no) return null;
  const o = opts || {};
  const guideType = o.guideType === 'stock' ? 'stock' : 'sold';
  const condition = o.condition === 'U' ? 'U' : 'N';
  const currency = String(o.currency || 'USD').toUpperCase();
  const setId = /-\d+$/.test(no) ? no : (no + '-1');

  const cacheKey = `bl:pg:${setId}:${guideType}:${condition}:${currency}`;
  if (env.CACHE) {
    try { const c = await env.CACHE.get(cacheKey); if (c) return JSON.parse(c); } catch (_) {}
  }

  // BrickLink's OAuth signature covers the query string, so the params have to
  // be baked into the URL we sign, not appended afterwards.
  const url = 'https://api.bricklink.com/api/store/v1/items/SET/'
    + encodeURIComponent(setId) + '/price'
    + '?guide_type=' + guideType
    + '&new_or_used=' + condition
    + '&currency_code=' + currency;

  let out = null;
  try {
    const auth = await blAuthHeader('GET', url, env);
    const r = await fetch(url, { headers: { Authorization: auth, Accept: 'application/json' } });
    if (!r.ok) { logErr('blPriceGuide http ' + r.status, new Error(setId)); return null; }
    const j = await r.json();
    const d = j && j.data;
    if (!d) return null;

    const num = (v) => { const n = Number(v); return isFinite(n) && n > 0 ? n : null; };

    // Individual transactions, newest first where dates exist.
    const detail = Array.isArray(d.price_detail) ? d.price_detail : [];
    const sales = [];
    for (const t of detail) {
      const price = num(t && t.unit_price);
      if (!price) continue;
      const rawDate = t && (t.date_ordered || t.date_created || null);
      let iso = null;
      if (rawDate) {
        const ms = new Date(rawDate).getTime();
        if (isFinite(ms) && ms > 0) iso = new Date(ms).toISOString();
      }
      sales.push({ price, qty: Number(t && t.quantity) || 1, date: iso });
    }
    const dated = sales.filter(s => s.date).sort((a, b) => new Date(a.date) - new Date(b.date));

    out = {
      setId,
      guideType,
      condition,
      currency: d.currency_code || currency,
      min: num(d.min_price),
      max: num(d.max_price),
      avg: num(d.avg_price),
      qtyAvg: num(d.qty_avg_price),
      unitQuantity: Number(d.unit_quantity) || 0,   // number of lots
      totalQuantity: Number(d.total_quantity) || 0, // number of items
      sales,                                        // all transactions
      dated,                                        // only those carrying a date
      hasDatedHistory: dated.length >= 2,
      fetchedAt: new Date().toISOString()
    };
  } catch (e) {
    logErr('blPriceGuide', e);
    return null;
  }

  if (env.CACHE && out) {
    try { await env.CACHE.put(cacheKey, JSON.stringify(out), { expirationTtl: 86400 }); } catch (_) {}
  }
  return out;
}

// Market value from completed sales, weighted toward recent ones.
//
// A plain 6-month average lags a moving market: a set that has climbed all year
// gets dragged down by January prices. Sales inside the last 90 days count
// double, so the figure tracks what the set is worth NOW while still using the
// full window for stability.
//
// Deliberately NOT blended with listing prices. An asking price is what someone
// hopes for; a completed sale is what someone paid. Mixing them — or averaging
// in an RRP, or a "from" floor across dozens of lots — produces a number that
// moves when our own search results change rather than when the market does.
function blMarketValue(pg){
  if (!pg) return null;
  const dated = (pg.dated || []).filter(x => x && x.price > 0 && x.date);
  if (!dated.length) {
    return (pg.avg && pg.avg > 0) ? { value: pg.avg, salesCount: (pg.sales || []).length, weighted: false } : null;
  }
  const cutoff = Date.now() - 90 * 864e5;
  let wsum = 0, w = 0;
  for (const sale of dated) {
    const weight = (new Date(sale.date).getTime() >= cutoff) ? 2 : 1;
    wsum += sale.price * weight;
    w += weight;
  }
  if (!w) return null;
  const last = dated[dated.length - 1];   // blPriceGuide sorts dated ascending
  return {
    value: wsum / w,
    salesCount: dated.length,
    weighted: true,
    lastSalePrice: last.price,
    lastSaleDate: last.date
  };
}

// Collapse BrickLink's dated transactions into one point per day, so the chart
// gets a clean daily series in the same shape as price_snapshots. Every value
// here is a real observed sale price — nothing is interpolated, and days with no
// sales are simply absent rather than filled in.
function blDailySeries(pg) {
  if (!pg || !pg.hasDatedHistory) return [];
  const byDay = new Map();
  for (const s of pg.dated) {
    const day = String(s.date).slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(s.price);
  }
  const out = [];
  for (const [day, prices] of byDay) {
    prices.sort((a, b) => a - b);
    const mid = prices.length % 2
      ? prices[(prices.length - 1) / 2]
      : (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2;
    out.push({
      snapshot_date: day,
      min_price: prices[0],
      median_price: mid,
      avg_price: prices.reduce((a, b) => a + b, 0) / prices.length,
      max_price: prices[prices.length - 1],
      listing_count: prices.length,
      source: 'bricklink'
    });
  }
  out.sort((a, b) => a.snapshot_date < b.snapshot_date ? -1 : 1);
  return out;
}

// ── Brickset API (simple key auth) ─────────────────────────────────────────
// Key from Worker secret BRICKSET_API_KEY. Gives clean catalog image, RRP,
// piece count, minifig count, release year and (derived) retired status in one
// call. Cached 30 days per set. Aggressive caching also keeps us under
// Brickset's daily usage cap.
async function brGetSet(setNo, env){
  if (!env.BRICKSET_API_KEY) return null;
  const no = String(setNo || '').trim();
  if (!no) return null;
  const setId = /-\d+$/.test(no) ? no : (no + '-1');
  const baseSetNo = no.replace(/-\d+$/, '');
  // v3 also persists successful Brickset image URLs into D1 so autocomplete
  // can render them instantly instead of depending on a cold live API call.
  // treated an unknown retirement state as false.
  const cacheKey = 'bs:v3:set:' + setId;
  if (env.CACHE) { try { const c = await env.CACHE.get(cacheKey); if (c) return JSON.parse(c); } catch (_) {} }
  let out = null;
  try {
    const params = encodeURIComponent(JSON.stringify({ setNumber: setId, extendedData: 1 }));
    const url = 'https://brickset.com/api/v3.asmx/getSets?apiKey=' + encodeURIComponent(env.BRICKSET_API_KEY) + '&userHash=&params=' + params;
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (r.ok) {
      const j = await r.json();
      const s = j && j.sets && j.sets[0];
      if (s) {
        const lego = s.LEGOCom || {};
        const region = (code) => (lego && lego[code]) || (s && s[code]) || {};
        const priceOf = (code) => {
          const v = region(code).retailPrice;
          return (v !== null && v !== undefined && v !== '' && Number(v) > 0) ? Number(v) : null;
        };
        let rrp = null;
        const usPrice = priceOf('US'), ukPrice = priceOf('UK'), caPrice = priceOf('CA'), dePrice = priceOf('DE');
        if (usPrice !== null) rrp = '$' + usPrice.toFixed(2);
        else if (ukPrice !== null) rrp = '\u00A3' + ukPrice.toFixed(2);
        else if (caPrice !== null) rrp = 'C$' + caPrice.toFixed(2);
        else if (dePrice !== null) rrp = '\u20AC' + dePrice.toFixed(2);

        // Brickset has a small number of older sets whose historical RRP is
        // visible on the catalogue page but absent from the regional API block.
        // Keep narrowly verified fallbacks here instead of showing no RRP.
        const knownRrp = {
          '10123-1': '$100.00'
        };
        if (!rrp && knownRrp[setId]) rrp = knownRrp[setId];

        const firstAvail = region('US').dateFirstAvailable || region('UK').dateFirstAvailable || null;
        const lastAvail = region('US').dateLastAvailable || region('UK').dateLastAvailable || region('CA').dateLastAvailable || region('DE').dateLastAvailable || null;
        const releasedYear = Number(s.year) || null;
        let retired = null; // tri-state: true, false, or unknown
        if (lastAvail) {
          const d = new Date(lastAvail);
          if (!Number.isNaN(d.getTime())) retired = d < new Date();
        }
        // Historical sets often have no LEGO.com availability record. A set
        // released five or more years ago is safely treated as retired rather
        // than incorrectly displaying "No".
        if (retired === null && releasedYear && releasedYear <= new Date().getUTCFullYear() - 5) retired = true;
        // Only confirm active when Brickset gives a first-available date and no
        // past exit date; otherwise leave it unknown.
        if (retired === null && firstAvail && !lastAvail) retired = false;

        out = {
          image: (s.image && (s.image.imageURL || s.image.thumbnailURL)) || '',
          rrp: rrp,
          // LEGO sets each region's price independently — the UK price is not an
          // FX conversion of the US one. Brickset returns all of them and we were
          // discarding everything but US, which meant a UK visitor saw a converted
          // $219.99 (~£164) against LEGO's actual £199.99. Keep them all so the
          // buy card can show the price LEGO will actually charge.
          rrpByRegion: { US: usPrice, UK: ukPrice, CA: caPrice, DE: dePrice },
          pieces: s.pieces || null,
          minifigs: s.minifigs || null,
          released: releasedYear,
          retired: retired
        };
        // Persist only a real image URL. Never overwrite a valid catalogue image
        // with an empty response, and support databases that store set IDs with
        // or without the BrickLink-style variant suffix.
        if (out.image && env.DB) {
          try {
            await env.DB.prepare(
              `UPDATE lego_sets SET img_url = ? WHERE set_id = ? OR set_id = ?`
            ).bind(out.image, baseSetNo, setId).run();
          } catch (_) {}
        }
      }
    }
  } catch (_) {}
  if (env.CACHE && out) { try { await env.CACHE.put(cacheKey, JSON.stringify(out), { expirationTtl: 2592000 }); } catch (_) {} }
  return out;
}


// ════════════════════════════════════════════════════════════════════════════
// LEGO PRE-COMPUTE PIPELINE — STAGE 3: queue processor + stored price writes
//
// This is the ONLY stage that contacts marketplaces for queued LEGO sets.
// The public /lego/data/:setNumber endpoint remains D1/KV-only.
//
// Call-budget accounting is deliberately conservative: every attempted
// BrickLink/eBay operation consumes one unit even when KV serves the response.
// That guarantees REFRESH_MAX_API_CALLS is never exceeded by this pipeline.
// ════════════════════════════════════════════════════════════════════════════
const LEGO_REFRESH_CALLS_PER_SET = 3; // BrickLink sold + BrickLink stock + eBay
const LEGO_REFRESH_LEASE_MS = 30 * 60 * 1000;
const LEGO_REFRESH_INTERVAL_MS = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000
};

function legoRefreshStats(prices) {
  const a = (prices || []).map(Number).filter(n => Number.isFinite(n) && n > 0).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  const median = a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
  return {
    min: a[0],
    median,
    avg: a.reduce((s, n) => s + n, 0) / a.length,
    max: a[a.length - 1],
    count: a.length
  };
}

async function resolveCanonicalLegoProduct(set, env) {
  if (!env.DB || !set || !set.set_id) return null;
  const setId = String(set.set_id);
  const bare = setId.replace(/-\d+$/, '');
  const canonicalKey = 'lego:' + bare;
  const slug = slugifyProduct(set.name || ('LEGO ' + bare), bare);
  try {
    const row = await env.DB.prepare(
      `INSERT INTO products (canonical_key, product_type, brand, model, style_id, colorway, image_url, slug, updated_at)
       VALUES (?, 'lego', 'LEGO', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(canonical_key) DO UPDATE SET
         model = COALESCE(excluded.model, products.model),
         style_id = COALESCE(products.style_id, excluded.style_id),
         colorway = COALESCE(excluded.colorway, products.colorway),
         image_url = COALESCE(excluded.image_url, products.image_url),
         slug = COALESCE(products.slug, excluded.slug),
         updated_at = CURRENT_TIMESTAMP
       RETURNING id`
    ).bind(canonicalKey, set.name || null, bare, set.theme || null, set.img_url || null, slug).first();
    if (row && row.id) return Number(row.id);
  } catch (_) {
    try {
      await env.DB.prepare(
        `INSERT INTO products (canonical_key, product_type, brand, model, style_id, colorway, image_url, slug, updated_at)
         VALUES (?, 'lego', 'LEGO', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(canonical_key) DO UPDATE SET
           model = COALESCE(excluded.model, products.model),
           style_id = COALESCE(products.style_id, excluded.style_id),
           colorway = COALESCE(excluded.colorway, products.colorway),
           image_url = COALESCE(excluded.image_url, products.image_url),
           slug = COALESCE(products.slug, excluded.slug),
           updated_at = CURRENT_TIMESTAMP`
      ).bind(canonicalKey, set.name || null, bare, set.theme || null, set.img_url || null, slug).run();
      const row = await env.DB.prepare('SELECT id FROM products WHERE canonical_key = ?').bind(canonicalKey).first();
      if (row && row.id) return Number(row.id);
    } catch (e) { logErr('resolveCanonicalLegoProduct', e); }
  }
  return null;
}

async function writeLegoAggregate(env, productId, query, source, sampledAt, snapshotDate, stats, counts) {
  if (!env.DB || !productId || !stats) return;
  const ebayCount = Number(counts && counts.ebayCount) || 0;
  const stockxCount = Number(counts && counts.stockxCount) || 0;
  const ccy = String((counts && counts.currency) || 'USD');
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO product_price_samples
       (product_id, source, sampled_at, live_price, median_price, avg_price, listing_count, ebay_count, stockx_count, currency, calculation_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 2)
       ON CONFLICT(product_id, source, sampled_at) DO NOTHING`
    ).bind(productId, source, sampledAt, stats.min, stats.median, stats.avg, stats.count, ebayCount, stockxCount, ccy),
    env.DB.prepare(
      `INSERT INTO product_price_snapshots
       (product_id, source, snapshot_date, min_price, median_price, avg_price, max_price, listing_count, ebay_count, stockx_count, currency, calculation_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 2)
       ON CONFLICT(product_id, source, snapshot_date) DO UPDATE SET
         min_price=excluded.min_price, median_price=excluded.median_price,
         avg_price=excluded.avg_price, max_price=excluded.max_price,
         listing_count=excluded.listing_count, ebay_count=excluded.ebay_count,
         stockx_count=excluded.stockx_count, currency=excluded.currency,
         calculation_version=2`
    ).bind(productId, source, snapshotDate, stats.min, stats.median, stats.avg, stats.max, stats.count, ebayCount, stockxCount, ccy),
    env.DB.prepare(
      `INSERT INTO price_samples
       (query, source, sampled_at, live_price, median_price, avg_price, listing_count, ebay_count, stockx_count, currency, product_id, calculation_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 2)
       ON CONFLICT(query, source, sampled_at) DO NOTHING`
    ).bind(query, source, sampledAt, stats.min, stats.median, stats.avg, stats.count, ebayCount, stockxCount, ccy, productId),
    env.DB.prepare(
      `INSERT INTO price_snapshots
       (query, source, snapshot_date, min_price, median_price, avg_price, max_price, listing_count, ebay_count, stockx_count, currency, product_id, calculation_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 2)
       ON CONFLICT(query, source, snapshot_date) DO UPDATE SET
         min_price=excluded.min_price, median_price=excluded.median_price,
         avg_price=excluded.avg_price, max_price=excluded.max_price,
         listing_count=excluded.listing_count, ebay_count=excluded.ebay_count,
         stockx_count=excluded.stockx_count, currency=excluded.currency,
         product_id=COALESCE(excluded.product_id, price_snapshots.product_id),
         calculation_version=2`
    ).bind(query, source, snapshotDate, stats.min, stats.median, stats.avg, stats.max, stats.count, ebayCount, stockxCount, ccy, productId)
  ]);
}

async function writeBrickLinkHistory(env, productId, query, pg) {
  const rows = blDailySeries(pg);
  if (!rows.length) return 0;
  const stmts = [];
  for (const r of rows.slice(-183)) {
    stmts.push(env.DB.prepare(
      `INSERT INTO product_price_snapshots
       (product_id, source, snapshot_date, min_price, median_price, avg_price, max_price, listing_count, ebay_count, stockx_count, currency, calculation_version)
       VALUES (?, 'all', ?, ?, ?, ?, ?, ?, 0, 0, ?, 2)
       ON CONFLICT(product_id, source, snapshot_date) DO UPDATE SET
         min_price=excluded.min_price, median_price=excluded.median_price,
         avg_price=excluded.avg_price, max_price=excluded.max_price,
         listing_count=excluded.listing_count, currency=excluded.currency,
         calculation_version=2`
    ).bind(productId, r.snapshot_date, r.min_price, r.median_price, r.avg_price, r.max_price, r.listing_count, pg.currency || 'USD'));
    stmts.push(env.DB.prepare(
      `INSERT INTO price_snapshots
       (query, source, snapshot_date, min_price, median_price, avg_price, max_price, listing_count, ebay_count, stockx_count, currency, product_id, calculation_version)
       VALUES (?, 'all', ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, 2)
       ON CONFLICT(query, source, snapshot_date) DO UPDATE SET
         min_price=excluded.min_price, median_price=excluded.median_price,
         avg_price=excluded.avg_price, max_price=excluded.max_price,
         listing_count=excluded.listing_count, currency=excluded.currency,
         product_id=COALESCE(excluded.product_id, price_snapshots.product_id),
         calculation_version=2`
    ).bind(query, r.snapshot_date, r.min_price, r.median_price, r.avg_price, r.max_price, r.listing_count, pg.currency || 'USD', productId));
  }
  // D1 batches have a statement limit; keep each batch comfortably small.
  for (let i = 0; i < stmts.length; i += 80) await env.DB.batch(stmts.slice(i, i + 80));
  return rows.length;
}

async function refreshOneLegoSet(env, setId, options = {}) {
  if (!env.DB) throw new Error('No DB bound');
  const set = await env.DB.prepare(
    `SELECT set_id, name, year, theme, num_parts, img_url
     FROM lego_sets WHERE set_id IN (?, ?, ?)
     ORDER BY CASE WHEN set_id = ? THEN 0 ELSE 1 END LIMIT 1`
  ).bind(String(setId), String(setId).replace(/-\d+$/, ''), String(setId).replace(/-\d+$/, '') + '-1', String(setId)).first();
  if (!set) throw new Error('set_not_found');

  const productId = await resolveCanonicalLegoProduct(set, env);
  if (!productId) throw new Error('canonical_product_failed');

  const bare = String(set.set_id).replace(/-\d+$/, '');
  const query = ('lego ' + bare + ' ' + String(set.name || '')).trim().toLowerCase();
  const nowIso = new Date().toISOString();
  const today = nowIso.slice(0, 10);
  let callsUsed = 0;

  callsUsed++;
  const sold = await blPriceGuide(bare, env, { guideType: 'sold', condition: 'N', currency: 'USD' });
  callsUsed++;
  const stock = await blPriceGuide(bare, env, { guideType: 'stock', condition: 'N', currency: 'USD' });

  let ebayItems = [];
  if (options.includeEbay !== false) {
    callsUsed++;
    const er = await searchEbay('LEGO ' + bare + ' ' + String(set.name || ''), 'US', null, env, false).catch(() => ({ items: [] }));
    const numberRe = new RegExp('(^|\\D)' + bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\D|$)');
    ebayItems = (er.items || []).filter(it =>
      numberRe.test(String(it.title || '')) &&
      !BUNDLE_RE.test(String(it.title || '')) &&
      isCleanNewLegoListing(it, set, null)
    );
    ebayItems = dedupeTrackerListings(ebayItems);
  }

  // Real completed sales are the authoritative market value. Asking prices are
  // stored separately and never blended into the sale-price median.
  const soldPrices = (sold && sold.sales || []).map(s => Number(s.price)).filter(n => n > 0);
  let allStats = legoRefreshStats(soldPrices);
  if (!allStats && sold && sold.avg) {
    // Aggregate-only fallback: preserve BrickLink's factual aggregate without
    // inventing transactions. Count is the number BrickLink reports.
    const fallback = [sold.min, sold.avg, sold.max].filter(n => Number(n) > 0);
    allStats = legoRefreshStats(fallback);
    if (allStats) allStats.count = Number(sold.unitQuantity || sold.totalQuantity) || fallback.length;
  }

  let historyRows = 0;
  if (sold && sold.hasDatedHistory) historyRows = await writeBrickLinkHistory(env, productId, query, sold);
  if (allStats) {
    await writeLegoAggregate(env, productId, query, 'all', nowIso, today, allStats, {
      ebayCount: ebayItems.length,
      stockxCount: 0,
      currency: (sold && sold.currency) || 'USD'
    });
  }

  const ebayStats = legoRefreshStats(ebayItems.map(x => x.price));
  if (ebayStats) {
    await writeLegoAggregate(env, productId, query, 'ebay', nowIso, today, ebayStats, {
      ebayCount: ebayItems.length, stockxCount: 0, currency: 'USD'
    });
    await writePriceObservations(env, productId, query, 'ebay', ebayItems);
  }

  const stockStats = stock ? legoRefreshStats([stock.min, stock.avg, stock.max]) : null;
  if (stockStats) {
    stockStats.count = Number(stock.unitQuantity) || stockStats.count;
    await writeLegoAggregate(env, productId, query, 'bricklink_stock', nowIso, today, stockStats, {
      ebayCount: 0, stockxCount: 0, currency: stock.currency || 'USD'
    });
  }

  if (!allStats && !ebayStats && !stockStats) throw new Error('no_market_data');

  // Stage 2 caches /lego/data/:setNumber in KV. Invalidate both the canonical
  // base-number key and the exact stored set-id key immediately after a
  // successful refresh so newly written pricing is visible on the next read.
  if (env.CACHE) {
    const cacheKeys = new Set([
      'lego:data:v1:' + bare,
      'lego:data:v1:' + String(set.set_id || ''),
      'lego:data:v2:' + bare,
      'lego:data:v2:' + String(set.set_id || ''),
    ]);
    for (const cacheKey of cacheKeys) {
      try { await env.CACHE.delete(cacheKey); } catch (_) {}
    }
  }

  return {
    setId: String(set.set_id), productId, query, callsUsed,
    soldSales: soldPrices.length,
    brickLinkStockLots: Number(stock && stock.unitQuantity) || 0,
    ebayListings: ebayItems.length,
    historicalDaysWritten: historyRows,
    hasAuthoritativeMarketValue: !!allStats
  };
}

async function finishLegoQueueSuccess(env, setId, tier) {
  const now = Date.now();
  const interval = LEGO_REFRESH_INTERVAL_MS[tier] || LEGO_REFRESH_INTERVAL_MS.monthly;
  // Small jitter prevents thousands of rows lining up on the exact same second.
  const jitter = Math.floor(interval * (Math.random() * 0.20 - 0.10));
  const next = new Date(now + interval + jitter).toISOString();
  await env.DB.prepare(
    `UPDATE refresh_queue SET last_refreshed_at=?, next_refresh_at=?, attempts=0,
       last_error=NULL, last_error_at=NULL, updated_at=CURRENT_TIMESTAMP
     WHERE set_id=?`
  ).bind(new Date(now).toISOString(), next, String(setId)).run();
  return next;
}

async function finishLegoQueueFailure(env, setId, previousAttempts, error) {
  const attempts = Math.max(0, Number(previousAttempts) || 0) + 1;
  const retryHours = Math.min(24, Math.max(1, Math.pow(2, Math.min(attempts - 1, 4))));
  const nowIso = new Date().toISOString();
  const next = new Date(Date.now() + retryHours * 3600e3).toISOString();
  await env.DB.prepare(
    `UPDATE refresh_queue SET attempts=?, last_error=?, last_error_at=?, next_refresh_at=?, updated_at=CURRENT_TIMESTAMP
     WHERE set_id=?`
  ).bind(attempts, String(error && (error.message || error) || 'unknown_error').slice(0, 500), nowIso, next, String(setId)).run();
  return next;
}

async function runLegoRefreshQueue(env, options = {}) {
  if (!env.DB) return { ok: false, error: 'No DB bound' };
  const configured = Math.max(1, Math.min(500, Number(env.REFRESH_MAX_API_CALLS) || 50));
  const requestedBudget = options.maxApiCalls == null ? configured : Math.max(1, Math.min(configured, Number(options.maxApiCalls) || configured));
  const maxSetsByBudget = Math.max(1, Math.floor(requestedBudget / LEGO_REFRESH_CALLS_PER_SET));
  const limit = Math.max(1, Math.min(maxSetsByBudget, Number(options.limit) || maxSetsByBudget));
  const nowIso = new Date().toISOString();

  let rows = [];
  if (options.setId) {
    const r = await env.DB.prepare(
      `SELECT set_id, tier, priority, attempts, next_refresh_at FROM refresh_queue
       WHERE set_id IN (?, ?, ?) AND enabled=1 LIMIT 1`
    ).bind(String(options.setId), String(options.setId).replace(/-\d+$/, ''), String(options.setId).replace(/-\d+$/, '') + '-1').first();
    if (r) rows = [r];
  } else {
    const r = await env.DB.prepare(
      `SELECT set_id, tier, priority, attempts, next_refresh_at
       FROM refresh_queue
       WHERE enabled=1 AND (next_refresh_at IS NULL OR next_refresh_at <= ?)
       ORDER BY priority DESC, next_refresh_at ASC
       LIMIT ?`
    ).bind(nowIso, limit).all();
    rows = r.results || [];
  }

  const summary = { ok: true, budget: requestedBudget, callsUsed: 0, selected: rows.length, processed: 0, succeeded: 0, failed: 0, skippedLease: 0, results: [] };
  for (const row of rows) {
    if (summary.callsUsed + LEGO_REFRESH_CALLS_PER_SET > requestedBudget) break;
    // Atomic-ish lease: only one cron can move a due row from its previous
    // timestamp to the lease timestamp. Manual set runs may claim regardless of
    // due time, but still require the exact observed timestamp to avoid overlap.
    const leaseUntil = new Date(Date.now() + LEGO_REFRESH_LEASE_MS).toISOString();
    let claim;
    if (row.next_refresh_at == null) {
      claim = await env.DB.prepare(
        `UPDATE refresh_queue SET next_refresh_at=?, updated_at=CURRENT_TIMESTAMP
         WHERE set_id=? AND enabled=1 AND next_refresh_at IS NULL`
      ).bind(leaseUntil, row.set_id).run();
    } else {
      claim = await env.DB.prepare(
        `UPDATE refresh_queue SET next_refresh_at=?, updated_at=CURRENT_TIMESTAMP
         WHERE set_id=? AND enabled=1 AND next_refresh_at=?`
      ).bind(leaseUntil, row.set_id, row.next_refresh_at).run();
    }
    if (!claim || !claim.meta || Number(claim.meta.changes) !== 1) { summary.skippedLease++; continue; }

    summary.processed++;
    try {
      const result = await refreshOneLegoSet(env, row.set_id, { includeEbay: true });
      summary.callsUsed += result.callsUsed;
      result.nextRefreshAt = await finishLegoQueueSuccess(env, row.set_id, row.tier);
      summary.succeeded++;
      summary.results.push({ ok: true, ...result });
    } catch (e) {
      // Reserve the full per-set budget on failures too. A failed request still
      // consumed its external attempt and must count toward the hard ceiling.
      summary.callsUsed += LEGO_REFRESH_CALLS_PER_SET;
      const nextRetryAt = await finishLegoQueueFailure(env, row.set_id, row.attempts, e);
      summary.failed++;
      summary.results.push({ ok: false, setId: row.set_id, error: String(e && (e.message || e)), nextRetryAt });
    }
  }
  return summary;
}




// ── FindAI Marketplace foundation (v20) ────────────────────────────────────
// This is deliberately backend-only. No Create Listing button or marketplace
// UI is exposed in the HTML. Every mutating feature is off unless its explicit
// environment flag is enabled, so the schema and test-mode plumbing can be
// deployed safely before FindAI Pty Ltd and live Stripe Connect are ready.
const MARKETPLACE_SCHEMA_VERSION = 1;
const MARKETPLACE_REASON_CODES = new Set([
  'item_not_received', 'not_as_described', 'damaged', 'counterfeit',
  'wrong_item', 'incomplete_item', 'other'
]);

function mpFlag(env, name, fallback = false) {
  const raw = env && Object.prototype.hasOwnProperty.call(env, name) ? env[name] : undefined;
  if (raw === undefined || raw === null || raw === '') return !!fallback;
  return /^(1|true|yes|on)$/i.test(String(raw));
}

function mpInt(env, name, fallback, min, max) {
  const n = Number(env && env[name]);
  const v = Number.isFinite(n) ? Math.round(n) : fallback;
  return Math.max(min, Math.min(max, v));
}

function marketplaceConfig(env) {
  return {
    schemaVersion: MARKETPLACE_SCHEMA_VERSION,
    live: mpFlag(env, 'MARKETPLACE_LIVE', false),
    applicationsEnabled: mpFlag(env, 'MARKETPLACE_BETA_APPLICATIONS', false),
    listingApiEnabled: mpFlag(env, 'MARKETPLACE_LISTING_API_ENABLED', false),
    checkoutEnabled: mpFlag(env, 'MARKETPLACE_CHECKOUT_ENABLED', false),
    disputesEnabled: mpFlag(env, 'MARKETPLACE_DISPUTES_ENABLED', false),
    sellerFeeBps: mpInt(env, 'MARKETPLACE_SELLER_FEE_BPS', 1100, 0, 5000),
    buyerFeeBps: mpInt(env, 'MARKETPLACE_BUYER_FEE_BPS', 500, 0, 5000),
    feeOnShipping: mpFlag(env, 'MARKETPLACE_FEE_ON_SHIPPING', true),
    currency: String((env && env.MARKETPLACE_DEFAULT_CURRENCY) || 'AUD').toUpperCase(),
  };
}

function mpSafeCurrency(value, fallback = 'AUD') {
  const c = String(value || fallback).trim().toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? c : fallback;
}

function mpMinorFromInput(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return fallback;
    return Math.round(value * 100);
  }
  const s = String(value).trim().replace(/,/g, '');
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(s)) return fallback;
  const negative = s.startsWith('-');
  const clean = negative ? s.slice(1) : s;
  const [whole, frac = ''] = clean.split('.');
  const minor = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  return negative ? -minor : minor;
}

function mpReadMinor(body, minorKey, decimalKey, fallback = 0) {
  const direct = Number(body && body[minorKey]);
  if (Number.isInteger(direct)) return direct;
  return mpMinorFromInput(body && body[decimalKey], fallback);
}

function mpQuote(env, itemMinor, shippingMinor = 0, currency = '') {
  const cfg = marketplaceConfig(env);
  itemMinor = Math.max(0, Math.round(Number(itemMinor) || 0));
  shippingMinor = Math.max(0, Math.round(Number(shippingMinor) || 0));
  const feeBaseMinor = itemMinor + (cfg.feeOnShipping ? shippingMinor : 0);
  const sellerFeeMinor = Math.round(feeBaseMinor * cfg.sellerFeeBps / 10000);
  const buyerFeeMinor = Math.round(feeBaseMinor * cfg.buyerFeeBps / 10000);
  const buyerTotalMinor = itemMinor + shippingMinor + buyerFeeMinor;
  const sellerNetMinor = itemMinor + shippingMinor - sellerFeeMinor;
  return {
    currency: mpSafeCurrency(currency, cfg.currency),
    itemMinor, shippingMinor, feeBaseMinor,
    sellerFeeBps: cfg.sellerFeeBps,
    buyerFeeBps: cfg.buyerFeeBps,
    sellerFeeMinor, buyerFeeMinor,
    buyerTotalMinor, sellerNetMinor,
    platformGrossMinor: sellerFeeMinor + buyerFeeMinor,
  };
}

function mpPublicConfig(env) {
  const c = marketplaceConfig(env);
  return {
    schemaVersion: c.schemaVersion,
    live: c.live,
    applicationsEnabled: c.applicationsEnabled,
    listingCreationVisible: false,
    listingApiEnabled: c.listingApiEnabled,
    checkoutEnabled: c.checkoutEnabled,
    disputesEnabled: c.disputesEnabled,
    sellerFeeBps: c.sellerFeeBps,
    sellerFeePercent: c.sellerFeeBps / 100,
    buyerFeeBps: c.buyerFeeBps,
    buyerFeePercent: c.buyerFeeBps / 100,
    feeOnShipping: c.feeOnShipping,
    defaultCurrency: c.currency,
  };
}

function mpId(prefix) {
  return String(prefix || 'mp') + '_' + crypto.randomUUID().replace(/-/g, '');
}

function mpJson(value) {
  try { return JSON.stringify(value === undefined ? null : value); }
  catch (_) { return 'null'; }
}

function mpStripeIsTest(env) {
  return /^sk_test_/i.test(String((env && env.STRIPE_SECRET_KEY) || ''));
}

async function mpStripeRequest(env, path, params, idempotencyKey = '') {
  const key = String((env && env.STRIPE_SECRET_KEY) || '');
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured');
  if (!mpStripeIsTest(env) && !mpFlag(env, 'MARKETPLACE_LIVE', false)) {
    throw new Error('Live Stripe key refused while MARKETPLACE_LIVE is false');
  }
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === '') continue;
    body.append(k, String(v));
  }
  const headers = {
    'Authorization': 'Bearer ' + key,
    'Content-Type': 'application/x-www-form-urlencoded'
  };
  if (idempotencyKey) headers['Idempotency-Key'] = String(idempotencyKey).slice(0, 255);
  const resp = await fetch('https://api.stripe.com/v1' + path, {
    method: 'POST', headers, body: body.toString()
  });
  let data = null;
  try { data = await resp.json(); } catch (_) {}
  if (!resp.ok) {
    const msg = data && data.error && data.error.message ? data.error.message : 'Stripe request failed';
    const err = new Error(msg);
    err.status = resp.status;
    throw err;
  }
  return data || {};
}

async function mpVerifyStripeWebhook(rawBody, signatureHeader, secret) {
  const sig = String(signatureHeader || '');
  const parts = sig.split(',').map(x => x.trim());
  let timestamp = '';
  const signatures = [];
  for (const p of parts) {
    const i = p.indexOf('=');
    if (i < 0) continue;
    const k = p.slice(0, i), v = p.slice(i + 1);
    if (k === 't') timestamp = v;
    if (k === 'v1') signatures.push(v);
  }
  if (!timestamp || !signatures.length || !secret) return false;
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const mac = new Uint8Array(await crypto.subtle.sign(
    'HMAC', key, new TextEncoder().encode(timestamp + '.' + rawBody)
  ));
  const hex = Array.from(mac).map(b => b.toString(16).padStart(2, '0')).join('');
  return signatures.some(s => timingSafeEqual(s, hex));
}

async function marketplaceSetup(env) {
  if (!env || !env.DB) throw new Error('DB binding is required');
  const sql = [
    `CREATE TABLE IF NOT EXISTS marketplace_sellers (
      id TEXT PRIMARY KEY,
      user_email TEXT NOT NULL UNIQUE,
      display_name TEXT,
      country TEXT NOT NULL DEFAULT 'AU',
      status TEXT NOT NULL DEFAULT 'pending',
      stripe_account_id TEXT,
      stripe_details_submitted INTEGER NOT NULL DEFAULT 0,
      stripe_charges_enabled INTEGER NOT NULL DEFAULT 0,
      stripe_payouts_enabled INTEGER NOT NULL DEFAULT 0,
      risk_level TEXT NOT NULL DEFAULT 'new',
      reserve_bps INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS marketplace_listings (
      id TEXT PRIMARY KEY,
      seller_id TEXT NOT NULL,
      product_id INTEGER,
      canonical_key TEXT,
      title TEXT NOT NULL,
      description TEXT,
      category TEXT,
      condition_label TEXT,
      currency TEXT NOT NULL,
      item_price_minor INTEGER NOT NULL,
      shipping_minor INTEGER NOT NULL DEFAULT 0,
      quantity INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'draft',
      image_urls_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      published_at TEXT,
      sold_at TEXT,
      reserved_order_id TEXT,
      reserved_until TEXT,
      FOREIGN KEY (seller_id) REFERENCES marketplace_sellers(id)
    )`,
    `CREATE TABLE IF NOT EXISTS marketplace_orders (
      id TEXT PRIMARY KEY,
      listing_id TEXT NOT NULL,
      seller_id TEXT NOT NULL,
      buyer_email TEXT NOT NULL,
      currency TEXT NOT NULL,
      item_subtotal_minor INTEGER NOT NULL,
      shipping_minor INTEGER NOT NULL DEFAULT 0,
      buyer_fee_minor INTEGER NOT NULL DEFAULT 0,
      seller_fee_minor INTEGER NOT NULL DEFAULT 0,
      platform_gross_minor INTEGER NOT NULL DEFAULT 0,
      seller_net_minor INTEGER NOT NULL,
      tax_minor INTEGER NOT NULL DEFAULT 0,
      total_minor INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending_payment',
      payout_status TEXT NOT NULL DEFAULT 'not_started',
      checkout_session_id TEXT,
      payment_intent_id TEXT,
      charge_id TEXT,
      stripe_transfer_id TEXT,
      tracking_number TEXT,
      shipping_carrier TEXT,
      shipped_at TEXT,
      delivered_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (listing_id) REFERENCES marketplace_listings(id),
      FOREIGN KEY (seller_id) REFERENCES marketplace_sellers(id)
    )`,
    `CREATE TABLE IF NOT EXISTS marketplace_order_events (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      actor_type TEXT NOT NULL,
      actor_email TEXT,
      event_type TEXT NOT NULL,
      payload_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (order_id) REFERENCES marketplace_orders(id)
    )`,
    `CREATE TABLE IF NOT EXISTS marketplace_disputes (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      opened_by_email TEXT NOT NULL,
      reason_code TEXT NOT NULL,
      statement TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      seller_response TEXT,
      resolution TEXT,
      refund_minor INTEGER NOT NULL DEFAULT 0,
      response_due_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      resolved_at TEXT,
      FOREIGN KEY (order_id) REFERENCES marketplace_orders(id)
    )`,
    `CREATE TABLE IF NOT EXISTS marketplace_dispute_evidence (
      id TEXT PRIMARY KEY,
      dispute_id TEXT NOT NULL,
      uploaded_by_email TEXT NOT NULL,
      evidence_type TEXT NOT NULL,
      evidence_url TEXT,
      note TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (dispute_id) REFERENCES marketplace_disputes(id)
    )`,
    `CREATE TABLE IF NOT EXISTS marketplace_ledger (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      entry_type TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      currency TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'recorded',
      stripe_reference TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (order_id) REFERENCES marketplace_orders(id)
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS marketplace_orders_checkout_session_uq ON marketplace_orders(checkout_session_id)`,
    `CREATE INDEX IF NOT EXISTS marketplace_listings_status_idx ON marketplace_listings(status, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS marketplace_listings_seller_idx ON marketplace_listings(seller_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS marketplace_orders_buyer_idx ON marketplace_orders(buyer_email, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS marketplace_orders_seller_idx ON marketplace_orders(seller_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS marketplace_disputes_order_idx ON marketplace_disputes(order_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS marketplace_events_order_idx ON marketplace_order_events(order_id, created_at DESC)`
  ];
  for (const statement of sql) await env.DB.prepare(statement).run();
  return { ok: true, schemaVersion: MARKETPLACE_SCHEMA_VERSION, statements: sql.length };
}

async function mpOrderEvent(env, orderId, actorType, actorEmail, eventType, payload) {
  if (!env || !env.DB || !orderId) return;
  await env.DB.prepare(
    `INSERT INTO marketplace_order_events
     (id, order_id, actor_type, actor_email, event_type, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(mpId('evt'), orderId, actorType || 'system', actorEmail || '', eventType, mpJson(payload), new Date().toISOString()).run();
}


// ═══════════════════════════════════════════════════════════════════════════
// FindAI Product Graph + Open Icecat (Phase 1)
// Inlined as an isolated namespace to preserve the single-file Worker.
// ═══════════════════════════════════════════════════════════════════════════
const FindAIProductGraph = (() => {
  // FindAI Product Graph Phase 1 — single-file ES module
  // Generated from the reviewed source modules. Do not edit this generated file directly.


  // ──────────────────────────────────────────────────────────────
  // src/config.js
  // ──────────────────────────────────────────────────────────────
  const PRODUCT_GRAPH_VERSION = 1;

  const LAUNCH_CATEGORIES = Object.freeze([
    {
      key: 'lego',
      name: 'LEGO',
      priority: 100,
      icecatEnabled: true,
      specialistSources: ['BrickLink', 'Brickset', 'Icecat'],
      aliases: ['lego', 'building sets', 'construction toys']
    },
    {
      key: 'phones',
      name: 'Phones',
      priority: 100,
      icecatEnabled: true,
      specialistSources: ['Icecat'],
      aliases: ['phones', 'smartphones', 'mobile phones', 'feature phones']
    },
    {
      key: 'tvs',
      name: 'TVs',
      priority: 99,
      icecatEnabled: true,
      specialistSources: ['Icecat'],
      aliases: ['televisions', 'tvs', 'oled tvs', 'qled tvs', 'led tvs']
    },
    {
      key: 'laptops',
      name: 'Laptops',
      priority: 99,
      icecatEnabled: true,
      specialistSources: ['Icecat'],
      aliases: ['laptops', 'notebooks', 'chromebooks', 'mobile workstations']
    },
    {
      key: 'pc-components',
      name: 'PC Components',
      priority: 99,
      icecatEnabled: true,
      specialistSources: ['Icecat'],
      aliases: [
        'graphics cards', 'video cards', 'processors', 'cpus', 'motherboards',
        'memory modules', 'ram', 'solid state drives', 'ssds', 'internal hard drives',
        'computer cases', 'power supply units', 'computer cooling systems',
        'sound cards', 'network cards', 'optical disc drives'
      ]
    },
    {
      key: 'consoles',
      name: 'Consoles',
      priority: 98,
      icecatEnabled: true,
      specialistSources: ['Icecat'],
      aliases: ['game consoles', 'gaming consoles', 'portable game consoles', 'handheld consoles']
    },
    {
      key: 'cameras',
      name: 'Cameras',
      priority: 96,
      icecatEnabled: true,
      specialistSources: ['Icecat'],
      aliases: ['digital cameras', 'camera bodies', 'camcorders', 'action cameras', 'instant cameras']
    },
    {
      key: 'sneakers',
      name: 'Sneakers',
      priority: 98,
      icecatEnabled: false,
      specialistSources: ['StockX', 'GOAT'],
      aliases: ['sneakers', 'trainers', 'shoes']
    },
    {
      key: 'watches',
      name: 'Watches',
      priority: 97,
      icecatEnabled: false,
      specialistSources: ['Chrono24'],
      aliases: ['watches', 'luxury watches', 'smart watches']
    },
    {
      key: 'perfume',
      name: 'Perfume',
      priority: 95,
      icecatEnabled: false,
      specialistSources: [],
      aliases: ['perfume', 'fragrance', 'eau de parfum', 'eau de toilette', 'cologne']
    },
    {
      key: 'trading-cards',
      name: 'Trading Cards',
      priority: 97,
      icecatEnabled: false,
      specialistSources: ['Cardmarket'],
      aliases: ['trading cards', 'pokemon cards', 'sports cards', 'magic cards', 'yu-gi-oh cards']
    },
    {
      key: 'collectibles',
      name: 'Collectibles',
      priority: 94,
      icecatEnabled: false,
      specialistSources: [],
      aliases: ['collectibles', 'funko', 'figures', 'statues', 'limited editions']
    },
    {
      key: 'headphones',
      name: 'Headphones',
      priority: 95,
      icecatEnabled: true,
      specialistSources: ['Icecat'],
      aliases: ['headphones', 'headsets', 'earbuds', 'earphones']
    },
    {
      key: 'tablets',
      name: 'Tablets',
      priority: 96,
      icecatEnabled: true,
      specialistSources: ['Icecat'],
      aliases: ['tablets', 'tablet computers', 'e-readers']
    },
    {
      key: 'monitors',
      name: 'Monitors',
      priority: 94,
      icecatEnabled: true,
      specialistSources: ['Icecat'],
      aliases: ['computer monitors', 'monitors', 'gaming monitors']
    }
  ]);

  const CATEGORY_BY_KEY = Object.freeze(
    Object.fromEntries(LAUNCH_CATEGORIES.map((category) => [category.key, category]))
  );

  const ICECAT_CATEGORY_RULES = [
    { key: 'phones', patterns: [/\bsmartphones?\b/i, /\bmobile phones?\b/i, /\bfeature phones?\b/i] },
    { key: 'tvs', patterns: [/\btelevisions?\b/i, /\boled televisions?\b/i, /\bqled televisions?\b/i, /\bled televisions?\b/i] },
    { key: 'laptops', patterns: [/\blaptops?\b/i, /\bnotebooks?\b/i, /\bchromebooks?\b/i, /\bmobile workstations?\b/i] },
    {
      key: 'pc-components',
      patterns: [
        /\bgraphics cards?\b/i,
        /\bvideo cards?\b/i,
        /\bprocessors?\b/i,
        /\bmotherboards?\b/i,
        /\bmemory modules?\b/i,
        /\bsolid state drives?\b/i,
        /\binternal hard drives?\b/i,
        /\bcomputer cases?\b/i,
        /\bpower supply units?\b/i,
        /\bcomputer cooling systems?\b/i,
        /\bcpu coolers?\b/i,
        /\bsound cards?\b/i,
        /\bnetwork cards?\b/i,
        /\boptical disc drives?\b/i
      ]
    },
    { key: 'consoles', patterns: [/\bgame consoles?\b/i, /\bportable game consoles?\b/i, /\bhandheld game consoles?\b/i] },
    { key: 'cameras', patterns: [/\bdigital cameras?\b/i, /\bcamera bodies?\b/i, /\bcamcorders?\b/i, /\baction cameras?\b/i, /\binstant cameras?\b/i] },
    { key: 'headphones', patterns: [/\bheadphones?(?:\s*&\s*headsets?)?\b/i, /\bheadsets?\b/i, /\bearbuds?\b/i, /\bearphones?\b/i] },
    { key: 'tablets', patterns: [/\btablets?\b/i, /\btablet computers?\b/i, /\be-readers?\b/i] },
    { key: 'monitors', patterns: [/\bcomputer monitors?\b/i, /\bgaming monitors?\b/i] }
  ];

  function classifyIcecatCategory(input = {}) {
    const brand = String(input.brand || '').trim();
    const categoryName = String(input.categoryName || '').trim();
    const title = String(input.title || '').trim();
    const productName = String(input.productName || '').trim();
    const combined = [categoryName, title, productName].filter(Boolean).join(' ');

    if (/^lego$/i.test(brand) && /\b(building sets?|construction toys?|toys?)\b/i.test(combined)) {
      return CATEGORY_BY_KEY.lego;
    }

    for (const rule of ICECAT_CATEGORY_RULES) {
      if (rule.patterns.some((pattern) => pattern.test(categoryName))) {
        return CATEGORY_BY_KEY[rule.key];
      }
    }

    return null;
  }

  function isIcecatCategoryAllowed(input) {
    const category = classifyIcecatCategory(input);
    return Boolean(category && category.icecatEnabled);
  }

  const ICECAT_DEFAULT_CONTENT = Object.freeze([
    'essentialinfo',
    'marketingtext',
    'gallery',
    'featuregroups',
    'manuals'
  ]);

  const SOURCE_PRIORITY = Object.freeze({
    manual: 100,
    manufacturer: 95,
    icecat: 90,
    bricklink: 88,
    brickset: 86,
    stockx: 84,
    specialist: 82,
    marketplaceCatalog: 65,
    marketplaceListing: 40,
    unknown: 10
  });

  const PRODUCT_GRAPH_LIMITS = Object.freeze({
    maxDescriptionsPerProduct: 12,
    maxImagesPerProduct: 24,
    maxSpecsPerProduct: 400,
    maxAliasesPerProduct: 40,
    maxBatchImportItems: 25,
    maxIndexBatchItems: 500,
    maxImageBytes: 15 * 1024 * 1024,
    defaultCronProducts: 4,
    maxCronProducts: 12,
    maxSearchResults: 20
  });

  // ──────────────────────────────────────────────────────────────
  // src/util.js
  // ──────────────────────────────────────────────────────────────
  const HTML_ENTITY_MAP = Object.freeze({
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&nbsp;': ' '
  });

  function nowIso() {
    return new Date().toISOString();
  }

  function toInt(value, fallback = null) {
    const number = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(number) ? number : fallback;
  }

  function toNumber(value, fallback = null) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function normalizeWhitespace(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function normalizeText(value) {
    return normalizeWhitespace(value)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function normalizeIdentifier(value) {
    return String(value ?? '')
      .normalize('NFKC')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
  }

  function normalizeGtin(value) {
    const digits = String(value ?? '').replace(/\D/g, '');
    return digits.length >= 8 && digits.length <= 14 ? digits : '';
  }

  function normalizeBrand(value) {
    return normalizeText(value).replace(/\s+/g, '-');
  }

  function slugify(value, suffix = '') {
    const base = normalizeText(value).replace(/\s+/g, '-').replace(/^-+|-+$/g, '');
    const cleanSuffix = normalizeIdentifier(suffix).toLowerCase();
    const combined = cleanSuffix && !base.includes(cleanSuffix) ? `${base}-${cleanSuffix}` : base;
    return combined.slice(0, 110).replace(/-+$/g, '');
  }

  function fpidFromId(id) {
    const numeric = Number.parseInt(String(id), 10);
    if (!Number.isFinite(numeric) || numeric <= 0) throw new Error('Invalid product id for FPID');
    return `FPID-${String(numeric).padStart(12, '0')}`;
  }

  function parseFpid(value) {
    const match = String(value || '').trim().match(/^FPID-(\d{1,18})$/i);
    if (!match) return null;
    const id = Number.parseInt(match[1], 10);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  }

  function unique(values) {
    return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ''))];
  }

  function tokenizeSearch(value) {
    const stop = new Set(['the', 'and', 'for', 'with', 'from', 'new', 'edition', 'model', 'series']);
    return unique(
      normalizeText(value)
        .split(' ')
        .filter((token) => token.length >= 2 && !stop.has(token))
        .map((token) => (token.length > 4 && token.endsWith('s') ? token.slice(0, -1) : token))
    ).slice(0, 24);
  }

  function decodeHtmlEntities(value) {
    return String(value ?? '')
      .replace(/&(amp|lt|gt|quot|#39|nbsp);/gi, (entity) => HTML_ENTITY_MAP[entity.toLowerCase()] || entity)
      .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
  }

  function stripHtml(value) {
    return normalizeWhitespace(
      decodeHtmlEntities(
        String(value ?? '')
          .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
          .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
          .replace(/<br\s*\/?>/gi, ' ')
          .replace(/<\/p\s*>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
      )
    );
  }

  function sanitizeLimitedHtml(value) {
    let html = String(value ?? '');
    html = html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '')
      .replace(/<object\b[^>]*>[\s\S]*?<\/object>/gi, '')
      .replace(/<form\b[^>]*>[\s\S]*?<\/form>/gi, '')
      .replace(/\son\w+\s*=\s*(["']).*?\1/gi, '')
      .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
      .replace(/javascript\s*:/gi, '');

    const allowed = new Set(['p', 'br', 'b', 'strong', 'i', 'em', 'sup', 'sub', 'ul', 'ol', 'li']);
    html = html.replace(/<\/?([a-z0-9]+)(?:\s[^>]*)?>/gi, (tag, name) => {
      return allowed.has(String(name).toLowerCase()) ? tag.replace(/\s[^>]*>/, '>') : '';
    });
    return html.trim();
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeJsonParse(value, fallback = null) {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  function stableStringify(value) {
    const seen = new WeakSet();
    const visit = (input) => {
      if (input === null || typeof input !== 'object') return input;
      if (seen.has(input)) throw new TypeError('Cannot stable-stringify circular structure');
      seen.add(input);
      if (Array.isArray(input)) return input.map(visit);
      const output = {};
      for (const key of Object.keys(input).sort()) output[key] = visit(input[key]);
      return output;
    };
    return JSON.stringify(visit(value));
  }

  async function sha256Hex(value) {
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  async function withTimeout(promise, milliseconds, message = 'Operation timed out') {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(message), milliseconds);
    try {
      if (typeof promise === 'function') return await promise(controller.signal);
      return await promise;
    } finally {
      clearTimeout(timeout);
    }
  }

  function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  function chunk(values, size) {
    const output = [];
    for (let index = 0; index < values.length; index += size) output.push(values.slice(index, index + size));
    return output;
  }

  function jsonResponse(data, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(data), {
      status,
      headers: {
        'content-type': 'application/json;charset=UTF-8',
        'cache-control': 'no-store',
        ...extraHeaders
      }
    });
  }

  function constantTimeEqual(left, right) {
    const a = new TextEncoder().encode(String(left ?? ''));
    const b = new TextEncoder().encode(String(right ?? ''));
    const length = Math.max(a.length, b.length);
    let diff = a.length ^ b.length;
    for (let index = 0; index < length; index += 1) diff |= (a[index] || 0) ^ (b[index] || 0);
    return diff === 0;
  }

  function maxIsoDate(values) {
    let best = '';
    let bestMs = 0;
    for (const value of values.filter(Boolean)) {
      const ms = Date.parse(value);
      if (Number.isFinite(ms) && ms > bestMs) {
        bestMs = ms;
        best = new Date(ms).toISOString();
      }
    }
    return best || null;
  }

  // ──────────────────────────────────────────────────────────────
  // src/schema.js
  // ──────────────────────────────────────────────────────────────
  const PRODUCTS_COLUMNS = Object.freeze({
    fpid: 'TEXT',
    brand_id: 'INTEGER',
    category_id: 'INTEGER',
    category_key: 'TEXT',
    title: 'TEXT',
    short_description: 'TEXT',
    long_description: 'TEXT',
    manufacturer_part_number: 'TEXT',
    icecat_id: 'INTEGER',
    release_date: 'TEXT',
    end_of_life_date: 'TEXT',
    data_quality: 'TEXT',
    source_updated_at: 'TEXT',
    primary_image_id: 'INTEGER',
    enrichment_status: "TEXT DEFAULT 'pending'",
    enriched_at: 'TEXT',
    source_json_hash: 'TEXT',
    source_priority: 'INTEGER DEFAULT 0'
  });

  const CREATE_STATEMENTS = [
    `CREATE TABLE IF NOT EXISTS product_graph_meta (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS product_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      parent_key TEXT,
      launch_priority INTEGER NOT NULL DEFAULT 0,
      icecat_enabled INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      aliases_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS product_brands (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      normalized_name TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      icecat_brand_id TEXT,
      logo_url TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS product_identifiers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      scheme TEXT NOT NULL,
      value TEXT NOT NULL,
      normalized_value TEXT NOT NULL,
      brand_scope TEXT NOT NULL DEFAULT '',
      unique_key TEXT NOT NULL UNIQUE,
      is_primary INTEGER NOT NULL DEFAULT 0,
      source TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS product_aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      alias TEXT NOT NULL,
      normalized_alias TEXT NOT NULL,
      alias_type TEXT NOT NULL DEFAULT 'name',
      locale TEXT NOT NULL DEFAULT 'en',
      source TEXT,
      weight INTEGER NOT NULL DEFAULT 50,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(product_id, normalized_alias, alias_type, locale)
    )`,
    `CREATE TABLE IF NOT EXISTS product_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      image_key TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL,
      source_external_id TEXT,
      source_url TEXT,
      source_preview_url TEXT,
      r2_key TEXT,
      mime_type TEXT,
      width INTEGER,
      height INTEGER,
      byte_size INTEGER,
      sort_order INTEGER NOT NULL DEFAULT 999,
      is_primary INTEGER NOT NULL DEFAULT 0,
      image_type TEXT,
      status TEXT NOT NULL DEFAULT 'metadata',
      source_updated_at TEXT,
      mirrored_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS product_specs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      spec_key TEXT NOT NULL,
      group_name TEXT,
      group_sort INTEGER NOT NULL DEFAULT 0,
      feature_id TEXT,
      name TEXT NOT NULL,
      value TEXT,
      raw_value TEXT,
      unit TEXT,
      presentation_value TEXT,
      feature_sort INTEGER NOT NULL DEFAULT 0,
      searchable INTEGER NOT NULL DEFAULT 0,
      locale TEXT NOT NULL DEFAULT 'en',
      source TEXT NOT NULL,
      source_updated_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(product_id, spec_key, locale, source)
    )`,
    `CREATE TABLE IF NOT EXISTS product_descriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      locale TEXT NOT NULL DEFAULT 'en',
      html TEXT,
      plain_text TEXT,
      source TEXT NOT NULL,
      source_updated_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(product_id, kind, locale, source)
    )`,
    `CREATE TABLE IF NOT EXISTS product_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      document_key TEXT NOT NULL UNIQUE,
      kind TEXT,
      title TEXT,
      source TEXT NOT NULL,
      source_url TEXT,
      r2_key TEXT,
      mime_type TEXT,
      byte_size INTEGER,
      locale TEXT,
      status TEXT NOT NULL DEFAULT 'metadata',
      source_updated_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS product_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      source TEXT NOT NULL,
      source_product_id TEXT NOT NULL,
      source_url TEXT,
      source_updated_at TEXT,
      content_hash TEXT,
      raw_r2_key TEXT,
      last_fetched_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(source, source_product_id)
    )`,
    `CREATE TABLE IF NOT EXISTS product_search_terms (
      product_id INTEGER NOT NULL,
      term TEXT NOT NULL,
      weight INTEGER NOT NULL DEFAULT 1,
      source TEXT,
      PRIMARY KEY(product_id, term)
    )`,
    `CREATE TABLE IF NOT EXISTS icecat_index (
      icecat_id INTEGER PRIMARY KEY,
      product_code TEXT,
      model_name TEXT,
      category_id TEXT,
      category_name TEXT,
      category_key TEXT,
      supplier_id TEXT,
      brand TEXT,
      high_pic TEXT,
      xml_path TEXT,
      source_updated_at TEXT,
      allowed INTEGER NOT NULL DEFAULT 0,
      product_id INTEGER,
      imported_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS product_enrichment_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      source_product_id TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 50,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT,
      next_attempt_at TEXT,
      locked_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(source, source_product_id)
    )`,
    `CREATE TABLE IF NOT EXISTS product_import_failures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      source_product_id TEXT,
      stage TEXT,
      error_code TEXT,
      error_message TEXT,
      payload_json TEXT,
      retryable INTEGER NOT NULL DEFAULT 1,
      occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  ];

  const INDEX_STATEMENTS = [
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_products_fpid ON products(fpid)',
    'CREATE INDEX IF NOT EXISTS idx_products_icecat ON products(icecat_id)',
    'CREATE INDEX IF NOT EXISTS idx_products_category_key ON products(category_key)',
    'CREATE INDEX IF NOT EXISTS idx_products_brand_mpn ON products(brand, manufacturer_part_number)',
    'CREATE INDEX IF NOT EXISTS idx_product_identifiers_lookup ON product_identifiers(scheme, normalized_value, brand_scope)',
    'CREATE INDEX IF NOT EXISTS idx_product_aliases_lookup ON product_aliases(normalized_alias)',
    'CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images(product_id, sort_order)',
    'CREATE INDEX IF NOT EXISTS idx_product_specs_product ON product_specs(product_id, group_sort, feature_sort)',
    'CREATE INDEX IF NOT EXISTS idx_product_descriptions_product ON product_descriptions(product_id, kind)',
    'CREATE INDEX IF NOT EXISTS idx_product_sources_product ON product_sources(product_id, source)',
    'CREATE INDEX IF NOT EXISTS idx_product_search_term ON product_search_terms(term, weight)',
    'CREATE INDEX IF NOT EXISTS idx_icecat_index_category ON icecat_index(allowed, category_key, icecat_id)',
    'CREATE INDEX IF NOT EXISTS idx_enrichment_queue_due ON product_enrichment_queue(status, next_attempt_at, priority)'
  ];

  async function tableColumns(db, tableName) {
    const result = await db.prepare(`PRAGMA table_info(${tableName})`).all();
    return new Set((result.results || []).map((row) => String(row.name)));
  }

  async function ensureProductsTable(db) {
    await db.prepare(
      `CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        canonical_key TEXT NOT NULL UNIQUE,
        product_type TEXT,
        brand TEXT,
        model TEXT,
        style_id TEXT,
        colorway TEXT,
        image_url TEXT,
        slug TEXT,
        sitemap_added_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`
    ).run();

    const columns = await tableColumns(db, 'products');
    const applied = [];
    for (const [name, definition] of Object.entries(PRODUCTS_COLUMNS)) {
      if (columns.has(name)) continue;
      await db.prepare(`ALTER TABLE products ADD COLUMN ${name} ${definition}`).run();
      applied.push(name);
    }
    return applied;
  }

  async function seedCategories(db) {
    for (const category of LAUNCH_CATEGORIES) {
      await db.prepare(
        `INSERT INTO product_categories
         (category_key, name, launch_priority, icecat_enabled, active, aliases_json, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(category_key) DO UPDATE SET
           name = excluded.name,
           launch_priority = excluded.launch_priority,
           icecat_enabled = excluded.icecat_enabled,
           active = 1,
           aliases_json = excluded.aliases_json,
           updated_at = excluded.updated_at`
      ).bind(
        category.key,
        category.name,
        category.priority,
        category.icecatEnabled ? 1 : 0,
        JSON.stringify(category.aliases || []),
        nowIso()
      ).run();
    }
  }

  async function setupProductGraph(env) {
    if (!env?.DB) throw new Error('D1 binding env.DB is required');
    const db = env.DB;
    const addedProductColumns = await ensureProductsTable(db);

    for (const statement of CREATE_STATEMENTS) await db.prepare(statement).run();
    for (const statement of INDEX_STATEMENTS) await db.prepare(statement).run();
    await seedCategories(db);

    await db.prepare(
      `INSERT INTO product_graph_meta (key, value, updated_at)
       VALUES ('schema_version', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).bind(String(PRODUCT_GRAPH_VERSION), nowIso()).run();

    return {
      ok: true,
      schemaVersion: PRODUCT_GRAPH_VERSION,
      addedProductColumns,
      categoriesSeeded: LAUNCH_CATEGORIES.length,
      tablesCreated: CREATE_STATEMENTS.length,
      indexesCreated: INDEX_STATEMENTS.length
    };
  }

  // ──────────────────────────────────────────────────────────────
  // src/icecat-client.js
  // ──────────────────────────────────────────────────────────────
  const ICECAT_JSON_ENDPOINT = 'https://live.icecat.biz/api';

  class IcecatError extends Error {
    constructor(message, options = {}) {
      super(message);
      this.name = 'IcecatError';
      this.code = options.code || 'ICECAT_ERROR';
      this.status = options.status || 0;
      this.retryable = options.retryable ?? false;
      this.details = options.details || null;
    }
  }

  function requiredConfig(env) {
    const username = String(env?.ICECAT_USERNAME || '').trim();
    const apiToken = String(env?.ICECAT_API_TOKEN || '').trim();
    const contentToken = String(env?.ICECAT_CONTENT_TOKEN || '').trim();
    if (!username) throw new IcecatError('ICECAT_USERNAME is not configured', { code: 'ICECAT_CONFIG' });
    if (!apiToken) throw new IcecatError('ICECAT_API_TOKEN is not configured', { code: 'ICECAT_CONFIG' });
    return { username, apiToken, contentToken };
  }

  function buildIcecatProductUrl(env, selector, options = {}) {
    const { username } = requiredConfig(env);
    const url = new URL(ICECAT_JSON_ENDPOINT);
    url.searchParams.set('lang', String(options.lang || 'en').toLowerCase());
    url.searchParams.set('shopname', username);

    if (selector?.icecatId) {
      url.searchParams.set('icecat_id', String(selector.icecatId));
    } else if (selector?.gtin) {
      url.searchParams.set('GTIN', String(selector.gtin));
    } else if (selector?.brand && selector?.productCode) {
      url.searchParams.set('Brand', String(selector.brand));
      url.searchParams.set('ProductCode', String(selector.productCode));
    } else {
      throw new IcecatError('Icecat selector requires icecatId, gtin, or brand + productCode', {
        code: 'ICECAT_SELECTOR'
      });
    }

    const content = Array.isArray(options.content) ? options.content : ICECAT_DEFAULT_CONTENT;
    url.searchParams.set('content', content.join(','));
    if (options.relationsLimit) url.searchParams.set('relationslimit', String(options.relationsLimit));
    return url;
  }

  function icecatHeaders(env) {
    const { apiToken, contentToken } = requiredConfig(env);
    const headers = {
      accept: 'application/json',
      'api-token': apiToken,
      'user-agent': 'FindAI-ProductGraph/1.0'
    };
    if (contentToken) headers['content-token'] = contentToken;
    return headers;
  }

  function contentErrorMessage(data) {
    const errors = data?.ContentErrors ?? data?.contentErrors ?? null;
    if (!errors) return '';
    if (typeof errors === 'string') return errors.trim();
    if (Array.isArray(errors)) return errors.map((entry) => entry?.Message || entry?.message || String(entry)).join('; ');
    if (typeof errors === 'object') return errors.Message || errors.message || JSON.stringify(errors);
    return String(errors);
  }

  async function fetchWithRetry(url, init, options = {}) {
    const attempts = Math.max(1, Math.min(Number(options.attempts || 3), 4));
    let lastError;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Number(options.timeoutMs || 20_000));
      try {
        const response = await fetch(url, { ...init, signal: controller.signal });
        if (response.status === 429 || response.status >= 500) {
          const body = await response.text().catch(() => '');
          lastError = new IcecatError(`Icecat returned HTTP ${response.status}`, {
            code: 'ICECAT_HTTP',
            status: response.status,
            retryable: true,
            details: body.slice(0, 500)
          });
        } else {
          return response;
        }
      } catch (error) {
        const timedOut = error?.name === 'AbortError';
        lastError = new IcecatError(timedOut ? 'Icecat request timed out' : `Icecat request failed: ${error?.message || error}`, {
          code: timedOut ? 'ICECAT_TIMEOUT' : 'ICECAT_NETWORK',
          retryable: true
        });
      } finally {
        clearTimeout(timeout);
      }

      if (attempt < attempts) await sleep(250 * 2 ** (attempt - 1));
    }

    throw lastError || new IcecatError('Icecat request failed', { retryable: true });
  }

  async function fetchIcecatProduct(env, selector, options = {}) {
    // Icecat documents content as mandatory. A blank content value requests the
    // complete product sheet and is also the safest compatibility fallback for
    // Open Icecat accounts that may reject granular content selections.
    let url = buildIcecatProductUrl(env, selector, options);
    let response = await fetchWithRetry(url, { method: 'GET', headers: icecatHeaders(env) }, options);
    let text = await response.text();

    if (response.status === 404 && !Array.isArray(options.content)) {
      const fallbackOptions = { ...options, content: [] };
      const fallbackUrl = buildIcecatProductUrl(env, selector, fallbackOptions);
      if (fallbackUrl.toString() !== url.toString()) {
        url = fallbackUrl;
        response = await fetchWithRetry(url, { method: 'GET', headers: icecatHeaders(env) }, options);
        text = await response.text();
      }
    }

    if (!response.ok) {
      throw new IcecatError(`Icecat returned HTTP ${response.status}`, {
        code: response.status === 404 ? 'ICECAT_NOT_FOUND' : 'ICECAT_HTTP',
        status: response.status,
        retryable: response.status === 429 || response.status >= 500,
        details: {
          upstreamBody: text.slice(0, 1000),
          requestUrl: url.toString()
        }
      });
    }

    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new IcecatError('Icecat returned invalid JSON', {
        code: 'ICECAT_INVALID_JSON',
        details: text.slice(0, 500)
      });
    }

    const data = payload?.data || payload?.Data || null;
    const message = String(payload?.msg || payload?.message || '').trim();
    const contentError = contentErrorMessage(data);
    if (!data || contentError || (message && !/^ok$/i.test(message))) {
      const combined = contentError || message || 'Icecat response did not contain product data';
      const notFound = /not found|does not exist|not present/i.test(combined);
      throw new IcecatError(combined, {
        code: notFound ? 'ICECAT_NOT_FOUND' : 'ICECAT_CONTENT_ERROR',
        status: notFound ? 404 : 422,
        retryable: false,
        details: payload
      });
    }

    return { payload, data, requestUrl: url.toString() };
  }

  function extensionFromContentType(contentType) {
    const type = String(contentType || '').split(';')[0].trim().toLowerCase();
    if (type === 'image/jpeg') return 'jpg';
    if (type === 'image/png') return 'png';
    if (type === 'image/webp') return 'webp';
    if (type === 'image/gif') return 'gif';
    if (type === 'image/avif') return 'avif';
    if (type === 'application/pdf') return 'pdf';
    return '';
  }

  async function fetchIcecatAsset(env, sourceUrl, options = {}) {
    const { contentToken } = requiredConfig(env);
    const url = new URL(String(sourceUrl));
    if (contentToken && !url.searchParams.has('content_token')) {
      url.searchParams.set('content_token', contentToken);
    }

    const headers = { accept: options.accept || 'image/*,application/pdf;q=0.8,*/*;q=0.1' };
    if (contentToken) headers['content-token'] = contentToken;

    const response = await fetchWithRetry(url, { method: 'GET', headers }, {
      attempts: options.attempts || 3,
      timeoutMs: options.timeoutMs || 30_000
    });

    if (!response.ok) {
      throw new IcecatError(`Icecat asset returned HTTP ${response.status}`, {
        code: 'ICECAT_ASSET_HTTP',
        status: response.status,
        retryable: response.status === 429 || response.status >= 500
      });
    }

    const contentLength = Number(response.headers.get('content-length') || 0);
    const maxBytes = Number(options.maxBytes || PRODUCT_GRAPH_LIMITS.maxImageBytes);
    if (contentLength && contentLength > maxBytes) {
      throw new IcecatError(`Icecat asset exceeds ${maxBytes} bytes`, {
        code: 'ICECAT_ASSET_TOO_LARGE',
        status: 413,
        retryable: false
      });
    }

    const contentType = String(response.headers.get('content-type') || 'application/octet-stream').split(';')[0];
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > maxBytes) {
      throw new IcecatError(`Icecat asset exceeds ${maxBytes} bytes`, {
        code: 'ICECAT_ASSET_TOO_LARGE',
        status: 413,
        retryable: false
      });
    }

    return {
      bytes: arrayBuffer,
      contentType,
      extension: extensionFromContentType(contentType),
      sourceUrl: url.toString(),
      byteSize: arrayBuffer.byteLength,
      etag: response.headers.get('etag') || ''
    };
  }

  // ──────────────────────────────────────────────────────────────
  // src/icecat-normalize.js
  // ──────────────────────────────────────────────────────────────
  function valueOf(input) {
    if (input === null || input === undefined) return '';
    if (typeof input === 'string' || typeof input === 'number') return normalizeWhitespace(input);
    if (typeof input === 'object') {
      return normalizeWhitespace(input.Value ?? input.value ?? input._ ?? input.Name ?? input.name ?? '');
    }
    return '';
  }

  function arrayOf(input) {
    if (!input) return [];
    return Array.isArray(input) ? input : [input];
  }

  function parseDate(value) {
    const raw = normalizeWhitespace(value);
    if (!raw) return null;
    const direct = Date.parse(raw);
    if (Number.isFinite(direct)) return new Date(direct).toISOString().slice(0, 10);
    const match = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (!match) return null;
    return `${match[3]}-${match[2]}-${match[1]}`;
  }

  function collectGtins(general) {
    const values = [];
    for (const entry of arrayOf(general?.GTIN)) {
      const gtin = normalizeGtin(typeof entry === 'object' ? entry.GTIN ?? entry.Value ?? entry._ : entry);
      if (gtin) values.push(gtin);
    }
    for (const entry of arrayOf(general?.GTINs)) {
      const approved = entry?.IsApproved ?? entry?.isApproved;
      if (approved === false || String(approved).toLowerCase() === 'false' || String(approved) === '0') continue;
      const gtin = normalizeGtin(entry?.GTIN ?? entry?.Value ?? entry?._ ?? entry);
      if (gtin) values.push(gtin);
    }
    return unique(values);
  }

  function descriptionEntries(general, locale) {
    const description = general?.Description || {};
    const summary = general?.SummaryDescription || {};
    const bulletPoints = general?.BulletPoints?.Values || general?.GeneratedBulletPoints?.Values || [];
    const entries = [];

    const push = (kind, htmlOrText, updated = '') => {
      const raw = normalizeWhitespace(htmlOrText);
      if (!raw) return;
      const html = sanitizeLimitedHtml(String(htmlOrText));
      const plainText = stripHtml(String(htmlOrText));
      if (!plainText) return;
      entries.push({ kind, locale, html: html || null, plainText, sourceUpdatedAt: updated || null });
    };

    push('long', description.LongDesc || description.LongProductName, description.Updated);
    push('middle', description.MiddleDesc, description.Updated);
    push('summary-short', summary.ShortSummaryDescription, description.Updated);
    push('summary-long', summary.LongSummaryDescription, description.Updated);
    push('warranty', description.WarrantyInfo, description.Updated);

    if (Array.isArray(bulletPoints) && bulletPoints.length) {
      const limited = bulletPoints.map((item) => stripHtml(item)).filter(Boolean).slice(0, 20);
      if (limited.length) entries.push({
        kind: 'bullet-points',
        locale,
        html: null,
        plainText: limited.join('\n'),
        sourceUpdatedAt: general?.BulletPoints?.Updated || general?.GeneratedBulletPoints?.Updated || null
      });
    }

    return entries.slice(0, PRODUCT_GRAPH_LIMITS.maxDescriptionsPerProduct);
  }

  function imageEntries(data) {
    const output = [];
    const main = data?.Image || {};
    if (main.HighPic || main.Pic500x500 || main.LowPic || main.ThumbPic) {
      output.push({
        externalId: `main:${main.HighPic || main.Pic500x500 || main.LowPic}`,
        sourceUrl: main.HighPic || main.Pic500x500 || main.LowPic || main.ThumbPic,
        previewUrl: main.Pic500x500 || main.LowPic || main.ThumbPic || main.HighPic,
        width: toInt(main.HighPicWidth ?? main.Pic500x500Width ?? main.LowPicWidth),
        height: toInt(main.HighPicHeight ?? main.Pic500x500Height ?? main.LowPicHeight),
        byteSize: toInt(main.HighPicSize ?? main.Pic500x500Size ?? main.LowPicSize),
        sortOrder: 0,
        isPrimary: true,
        imageType: 'main',
        sourceUpdatedAt: main.Updated || null
      });
    }

    for (const image of arrayOf(data?.Gallery)) {
      if (!image || String(image.IsPrivate ?? image.isPrivate ?? '0') === '1') continue;
      const sourceUrl = image.Pic || image.HighPic || image.Pic500x500 || image.LowPic || image.ThumbPic;
      if (!sourceUrl) continue;
      const no = toInt(image.No, 999);
      output.push({
        externalId: String(image.ID || sourceUrl),
        sourceUrl,
        previewUrl: image.Pic500x500 || image.LowPic || image.ThumbPic || sourceUrl,
        width: toInt(image.PicWidth ?? image.HighPicWidth ?? image.Pic500x500Width ?? image.LowWidth),
        height: toInt(image.PicHeight ?? image.HighPicHeight ?? image.Pic500x500Height ?? image.LowHeight),
        byteSize: toInt(image.Size ?? image.HighPicSize ?? image.Pic500x500Size ?? image.LowSize),
        sortOrder: no,
        isPrimary: String(image.IsMain || '').toUpperCase() === 'Y',
        imageType: normalizeWhitespace(image.Type || 'gallery'),
        sourceUpdatedAt: image.Updated || null
      });
    }

    const seen = new Set();
    return output
      .sort((left, right) => Number(right.isPrimary) - Number(left.isPrimary) || left.sortOrder - right.sortOrder)
      .filter((image) => {
        const key = String(image.sourceUrl);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, PRODUCT_GRAPH_LIMITS.maxImagesPerProduct)
      .map((image, index) => ({ ...image, sortOrder: index, isPrimary: index === 0 }));
  }

  function featureEntries(data, locale) {
    const groups = arrayOf(data?.FeaturesGroups || data?.FeatureGroups);
    const output = [];

    for (const group of groups) {
      const groupName = valueOf(group?.FeatureGroup?.Name) || 'Specifications';
      const groupSort = toInt(group?.SortNo, 0);
      for (const feature of arrayOf(group?.Features)) {
        const name = valueOf(feature?.Feature?.Name);
        if (!name) continue;
        const value = normalizeWhitespace(feature?.Value ?? feature?.LocalValue ?? feature?.PresentationValue ?? '');
        const presentationValue = normalizeWhitespace(feature?.PresentationValue ?? feature?.LocalValue ?? feature?.Value ?? '');
        const unit = valueOf(feature?.Feature?.Measure?.Signs) || valueOf(feature?.Feature?.Measure?.Sign) || valueOf(feature?.Feature?.Sign);
        if (!value && !presentationValue) continue;
        const featureId = normalizeWhitespace(feature?.Feature?.ID || feature?.ID || '');
        const specKey = featureId ? `icecat:${featureId}` : `name:${normalizeText(groupName)}:${normalizeText(name)}`;
        output.push({
          specKey,
          groupName,
          groupSort,
          featureId: featureId || null,
          name,
          value: value || presentationValue,
          rawValue: normalizeWhitespace(feature?.RawValue ?? feature?.Value ?? '') || null,
          unit: unit || null,
          presentationValue: presentationValue || value,
          featureSort: toInt(feature?.SortNo, 0),
          searchable: String(feature?.Searchable ?? '0') === '1',
          locale,
          sourceUpdatedAt: feature?.Updated || null
        });
      }
    }

    return output
      .sort((left, right) => right.groupSort - left.groupSort || right.featureSort - left.featureSort)
      .slice(0, PRODUCT_GRAPH_LIMITS.maxSpecsPerProduct);
  }

  function documentEntries(data, locale) {
    const general = data?.GeneralInfo || {};
    const description = general?.Description || {};
    const output = [];

    const add = (kind, title, url, byteSize, updated = '') => {
      if (!url) return;
      output.push({ kind, title, sourceUrl: String(url), byteSize: toInt(byteSize), locale, sourceUpdatedAt: updated || null });
    };

    add('manual', 'User manual', description.ManualPDFURL, description.ManualPDFSize, description.Updated);
    add('leaflet', 'Product leaflet', description.LeafletPDFURL, description.PDFSize, description.Updated);

    for (const item of arrayOf(data?.Multimedia)) {
      const contentType = String(item?.ContentType || '').toLowerCase();
      const type = String(item?.Type || '').toLowerCase();
      if (!contentType.includes('pdf') && !type.includes('pdf') && !type.includes('manual') && !type.includes('leaflet')) continue;
      add(type || 'document', normalizeWhitespace(item?.Description || item?.Type || 'Product document'), item?.URL, item?.Size, item?.Updated);
    }

    const seen = new Set();
    return output.filter((document) => {
      if (seen.has(document.sourceUrl)) return false;
      seen.add(document.sourceUrl);
      return true;
    }).slice(0, 30);
  }

  function titleAliases(general, title, brand, productName, mpn, gtins) {
    const titleInfo = general?.TitleInfo || {};
    const productNameInfo = general?.ProductNameInfo || {};
    return unique([
      title,
      productName,
      valueOf(titleInfo.GeneratedIntTitle),
      valueOf(titleInfo.GeneratedLocalTitle),
      valueOf(titleInfo.BrandLocalTitle),
      valueOf(productNameInfo.ProductIntName),
      valueOf(productNameInfo.ProductLocalName),
      brand && productName ? `${brand} ${productName}` : '',
      brand && mpn ? `${brand} ${mpn}` : '',
      ...gtins
    ]).slice(0, PRODUCT_GRAPH_LIMITS.maxAliasesPerProduct);
  }

  function buildIdentifiers(icecatId, brand, mpn, gtins) {
    const brandScope = normalizeBrand(brand);
    const output = [];
    if (icecatId) output.push({ scheme: 'icecat', value: String(icecatId), normalizedValue: String(icecatId), brandScope: '', isPrimary: false });
    for (const gtin of gtins) output.push({ scheme: 'gtin', value: gtin, normalizedValue: gtin, brandScope: '', isPrimary: true });
    if (mpn) output.push({ scheme: 'mpn', value: mpn, normalizedValue: normalizeIdentifier(mpn), brandScope, isPrimary: gtins.length === 0 });
    return output;
  }

  function canonicalKeyFor(icecatId, brand, mpn, gtins) {
    if (gtins[0]) return `gtin:${gtins[0]}`;
    if (brand && mpn) return `mpn:${normalizeBrand(brand)}:${normalizeIdentifier(mpn).toLowerCase()}`;
    return `icecat:${icecatId}`;
  }

  function normalizeIcecatProduct(data, options = {}) {
    const general = data?.GeneralInfo || {};
    const locale = String(options.lang || 'en').toLowerCase();
    const icecatId = toInt(general.IcecatId ?? general.IcecatID ?? data?.IcecatId);
    if (!icecatId) throw new Error('Icecat response is missing IcecatId');

    const brand = normalizeWhitespace(general.Brand || general?.BrandInfo?.BrandName);
    const productName = normalizeWhitespace(general.ProductName || valueOf(general?.ProductNameInfo?.ProductIntName));
    const title = normalizeWhitespace(general.Title || [brand, productName].filter(Boolean).join(' '));
    const mpn = normalizeWhitespace(general.BrandPartCode || general.ProductCode);
    const categoryName = valueOf(general?.Category?.Name);
    const category = classifyIcecatCategory({ brand, categoryName, title, productName });
    const gtins = collectGtins(general);
    const descriptions = descriptionEntries(general, locale);
    const images = imageEntries(data);
    const specs = featureEntries(data, locale);
    const documents = documentEntries(data, locale);
    const identifiers = buildIdentifiers(icecatId, brand, mpn, gtins);
    const aliases = titleAliases(general, title, brand, productName, mpn, gtins);
    const family = valueOf(general.ProductFamily);
    const series = valueOf(general.ProductSeries);
    const shortDescription = descriptions.find((entry) => entry.kind === 'summary-short')?.plainText
      || descriptions.find((entry) => entry.kind === 'middle')?.plainText
      || '';
    const longDescription = descriptions.find((entry) => entry.kind === 'long')?.plainText
      || descriptions.find((entry) => entry.kind === 'summary-long')?.plainText
      || shortDescription;
    const sourceUpdatedAt = maxIsoDate([
      general?.Description?.Updated,
      ...images.map((image) => image.sourceUpdatedAt),
      ...specs.map((spec) => spec.sourceUpdatedAt)
    ]);

    return {
      source: 'icecat',
      sourcePriority: SOURCE_PRIORITY.icecat,
      sourceProductId: String(icecatId),
      icecatId,
      canonicalKey: canonicalKeyFor(icecatId, brand, mpn, gtins),
      category,
      categoryName,
      categoryExternalId: normalizeWhitespace(general?.Category?.CategoryID || ''),
      brand,
      brandNormalized: normalizeBrand(brand),
      brandExternalId: normalizeWhitespace(general.BrandID || ''),
      brandLogoUrl: normalizeWhitespace(general.BrandLogo || general?.BrandInfo?.BrandLogo || ''),
      title,
      model: productName || title,
      productName,
      family,
      series,
      manufacturerPartNumber: mpn,
      gtins,
      identifiers,
      aliases,
      slug: slugify(title, mpn || gtins[0] || icecatId),
      shortDescription,
      longDescription,
      descriptions,
      images,
      specs,
      documents,
      releaseDate: parseDate(general.ReleaseDate),
      endOfLifeDate: parseDate(general.EndOfLifeDate),
      dataQuality: normalizeWhitespace(general.Quality || general.DataSheetQuality || data?.DataSheetQuality || ''),
      sourceUpdatedAt,
      sourceUrl: normalizeWhitespace(general?.Description?.URL || ''),
      raw: data
    };
  }

  // ──────────────────────────────────────────────────────────────
  // src/media-store.js
  // ──────────────────────────────────────────────────────────────
  function mediaBase(env) {
    return String(env?.PRODUCT_MEDIA_BASE_URL || '').replace(/\/+$/g, '');
  }

  function productMediaUrl(env, r2Key, requestOrigin = '') {
    if (!r2Key) return '';
    const encoded = r2Key.split('/').map(encodeURIComponent).join('/');
    const base = mediaBase(env);
    if (base) return `${base}/${encoded}`;
    if (requestOrigin) return `${String(requestOrigin).replace(/\/+$/g, '')}/product-media/${encoded}`;
    return `/product-media/${encoded}`;
  }

  function extensionFromUrl(url) {
    try {
      const pathname = new URL(url).pathname;
      const match = pathname.match(/\.([a-z0-9]{2,5})$/i);
      return match ? match[1].toLowerCase() : '';
    } catch {
      return '';
    }
  }

  function safeExtension(asset, sourceUrl) {
    return asset.extension || extensionFromUrl(sourceUrl) || 'bin';
  }

  async function mirrorImageRecord(env, imageRecord, options = {}) {
    if (!env?.DB) throw new Error('D1 binding env.DB is required');
    if (!env?.PRODUCT_MEDIA) throw new Error('R2 binding env.PRODUCT_MEDIA is required');
    if (!imageRecord?.id || !imageRecord?.product_id || !imageRecord?.source_url) {
      throw new Error('Image record requires id, product_id and source_url');
    }

    const source = String(imageRecord.source || 'unknown').toLowerCase();
    const asset = source === 'icecat'
      ? await fetchIcecatAsset(env, imageRecord.source_url, {
          maxBytes: options.maxBytes || PRODUCT_GRAPH_LIMITS.maxImageBytes
        })
      : await fetchGenericAsset(imageRecord.source_url, options);

    const hash = await sha256Hex(asset.bytes);
    const extension = safeExtension(asset, imageRecord.source_url);
    const r2Key = `products/${imageRecord.product_id}/${source}/${hash.slice(0, 24)}.${extension}`;
    const mirroredAt = nowIso();

    await env.PRODUCT_MEDIA.put(r2Key, asset.bytes, {
      httpMetadata: {
        contentType: asset.contentType,
        cacheControl: 'public, max-age=31536000, immutable'
      },
      customMetadata: {
        source,
        sourceUrlHash: (await sha256Hex(String(imageRecord.source_url))).slice(0, 32),
        productId: String(imageRecord.product_id),
        imageId: String(imageRecord.id),
        mirroredAt
      }
    });

    await env.DB.prepare(
      `UPDATE product_images
       SET r2_key = ?, mime_type = ?, byte_size = ?, status = 'ready', mirrored_at = ?, updated_at = ?
       WHERE id = ?`
    ).bind(r2Key, asset.contentType, asset.byteSize, mirroredAt, mirroredAt, imageRecord.id).run();

    if (Number(imageRecord.is_primary) === 1) {
      await env.DB.prepare(
        `UPDATE products
         SET primary_image_id = ?, image_url = ?, updated_at = ?
         WHERE id = ?`
      ).bind(imageRecord.id, productMediaUrl(env, r2Key), mirroredAt, imageRecord.product_id).run();
    }

    return {
      imageId: imageRecord.id,
      productId: imageRecord.product_id,
      r2Key,
      url: productMediaUrl(env, r2Key),
      contentType: asset.contentType,
      byteSize: asset.byteSize
    };
  }

  async function fetchGenericAsset(sourceUrl, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(options.timeoutMs || 30_000));
    try {
      const response = await fetch(sourceUrl, {
        headers: { accept: 'image/*' },
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`Image source returned HTTP ${response.status}`);
      const contentType = String(response.headers.get('content-type') || 'application/octet-stream').split(';')[0];
      const bytes = await response.arrayBuffer();
      const maxBytes = Number(options.maxBytes || PRODUCT_GRAPH_LIMITS.maxImageBytes);
      if (bytes.byteLength > maxBytes) throw new Error(`Image exceeds ${maxBytes} bytes`);
      return { bytes, contentType, extension: '', byteSize: bytes.byteLength };
    } finally {
      clearTimeout(timeout);
    }
  }

  async function mirrorProductImages(env, productId, options = {}) {
    const limit = Math.max(1, Math.min(Number(options.limit || 1), PRODUCT_GRAPH_LIMITS.maxImagesPerProduct));
    const result = await env.DB.prepare(
      `SELECT id, product_id, source, source_url, is_primary, sort_order, status
       FROM product_images
       WHERE product_id = ? AND source_url IS NOT NULL
         AND (status != 'ready' OR r2_key IS NULL)
       ORDER BY is_primary DESC, sort_order ASC
       LIMIT ?`
    ).bind(productId, limit).all();

    const mirrored = [];
    const failures = [];
    for (const image of result.results || []) {
      try {
        mirrored.push(await mirrorImageRecord(env, image, options));
      } catch (error) {
        const message = String(error?.message || error).slice(0, 1000);
        failures.push({ imageId: image.id, error: message });
        await env.DB.prepare(
          `UPDATE product_images SET status = 'failed', updated_at = ? WHERE id = ?`
        ).bind(nowIso(), image.id).run();
        await env.DB.prepare(
          `INSERT INTO product_import_failures
           (source, source_product_id, stage, error_code, error_message, payload_json, retryable, occurred_at)
           VALUES (?, ?, 'mirror-image', ?, ?, ?, 1, ?)`
        ).bind(
          String(image.source || 'unknown'),
          String(image.id),
          String(error?.code || 'IMAGE_MIRROR_FAILED'),
          message,
          JSON.stringify({ productId, sourceUrl: image.source_url }),
          nowIso()
        ).run();
      }
    }
    return { mirrored, failures };
  }

  async function handleProductMediaRequest(request, env) {
    if (!env?.PRODUCT_MEDIA) return null;
    const url = new URL(request.url);
    const prefix = '/product-media/';
    if (!url.pathname.startsWith(prefix)) return null;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
    }

    const rawKey = url.pathname.slice(prefix.length);
    let key;
    try {
      key = rawKey.split('/').map(decodeURIComponent).join('/');
    } catch {
      return new Response('Bad media key', { status: 400 });
    }
    if (!key || key.includes('..') || key.startsWith('/')) return new Response('Bad media key', { status: 400 });

    const object = await env.PRODUCT_MEDIA.get(key);
    if (!object) return new Response('Not found', { status: 404 });

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('cache-control', headers.get('cache-control') || 'public, max-age=31536000, immutable');
    headers.set('x-content-type-options', 'nosniff');
    return new Response(request.method === 'HEAD' ? null : object.body, { headers });
  }

  // ──────────────────────────────────────────────────────────────
  // src/product-graph.js
  // ──────────────────────────────────────────────────────────────
  function identifierUniqueKey(identifier) {
    const scheme = String(identifier.scheme || '').toLowerCase();
    const value = String(identifier.normalizedValue || '').trim();
    const brand = scheme === 'mpn' || scheme === 'style' ? String(identifier.brandScope || '') : '';
    return `${scheme}:${brand}:${value}`;
  }

  async function batchRun(db, statements, size = 50) {
    for (const group of chunk(statements, size)) {
      if (!group.length) continue;
      if (typeof db.batch === 'function') await db.batch(group);
      else for (const statement of group) await statement.run();
    }
  }

  async function upsertBrand(db, product) {
    if (!product.brandNormalized || !product.brand) return null;
    const now = nowIso();
    await db.prepare(
      `INSERT INTO product_brands
       (normalized_name, display_name, icecat_brand_id, logo_url, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(normalized_name) DO UPDATE SET
         display_name = COALESCE(NULLIF(excluded.display_name, ''), product_brands.display_name),
         icecat_brand_id = COALESCE(NULLIF(excluded.icecat_brand_id, ''), product_brands.icecat_brand_id),
         logo_url = COALESCE(NULLIF(excluded.logo_url, ''), product_brands.logo_url),
         updated_at = excluded.updated_at`
    ).bind(product.brandNormalized, product.brand, product.brandExternalId || '', product.brandLogoUrl || '', now).run();
    const row = await db.prepare('SELECT id FROM product_brands WHERE normalized_name = ?').bind(product.brandNormalized).first();
    return row?.id || null;
  }

  async function getCategoryId(db, categoryKey) {
    if (!categoryKey) return null;
    const row = await db.prepare('SELECT id FROM product_categories WHERE category_key = ? AND active = 1').bind(categoryKey).first();
    return row?.id || null;
  }

  async function findProductByIdentifier(db, identifier) {
    const key = identifierUniqueKey(identifier);
    const row = await db.prepare(
      `SELECT p.* FROM product_identifiers i
       JOIN products p ON p.id = i.product_id
       WHERE i.unique_key = ? LIMIT 1`
    ).bind(key).first();
    return row || null;
  }

  async function findExistingProduct(db, product) {
    const ordered = [...(product.identifiers || [])].sort((left, right) => Number(right.isPrimary) - Number(left.isPrimary));
    for (const identifier of ordered) {
      const found = await findProductByIdentifier(db, identifier);
      if (found) return found;
    }

    if (product.icecatId) {
      const byIcecat = await db.prepare('SELECT * FROM products WHERE icecat_id = ? LIMIT 1').bind(product.icecatId).first();
      if (byIcecat) return byIcecat;
    }

    if (product.canonicalKey) {
      const byCanonical = await db.prepare('SELECT * FROM products WHERE canonical_key = ? LIMIT 1').bind(product.canonicalKey).first();
      if (byCanonical) return byCanonical;
    }

    if (product.brand && product.manufacturerPartNumber) {
      const byMpn = await db.prepare(
        `SELECT * FROM products
         WHERE lower(brand) = lower(?)
           AND (manufacturer_part_number = ? OR style_id = ?)
         LIMIT 1`
      ).bind(product.brand, product.manufacturerPartNumber, product.manufacturerPartNumber).first();
      if (byMpn) return byMpn;
    }

    return null;
  }

  async function insertProduct(db, product, brandId, categoryId) {
    const now = nowIso();
    await db.prepare(
      `INSERT INTO products
       (canonical_key, product_type, brand, brand_id, model, title, style_id,
        manufacturer_part_number, category_id, category_key, slug, icecat_id,
        short_description, long_description, release_date, end_of_life_date,
        data_quality, source_updated_at, enrichment_status, enriched_at,
        source_priority, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?)`
    ).bind(
      product.canonicalKey,
      product.category?.key || 'product',
      product.brand || null,
      brandId,
      product.model || product.title || null,
      product.title || product.model || null,
      product.category?.key === 'lego' ? product.manufacturerPartNumber || null : null,
      product.manufacturerPartNumber || null,
      categoryId,
      product.category?.key || null,
      product.slug || null,
      product.icecatId || null,
      product.shortDescription || null,
      product.longDescription || null,
      product.releaseDate || null,
      product.endOfLifeDate || null,
      product.dataQuality || null,
      product.sourceUpdatedAt || null,
      now,
      product.sourcePriority || SOURCE_PRIORITY.unknown,
      now,
      now
    ).run();

    return await db.prepare('SELECT * FROM products WHERE canonical_key = ?').bind(product.canonicalKey).first();
  }

  async function updateProduct(db, existing, product, brandId, categoryId) {
    const now = nowIso();
    const incomingPriority = Number(product.sourcePriority || SOURCE_PRIORITY.unknown);
    await db.prepare(
      `UPDATE products SET
         brand = CASE WHEN COALESCE(source_priority, 0) <= ? OR brand IS NULL OR brand = '' THEN COALESCE(NULLIF(?, ''), brand) ELSE brand END,
         brand_id = COALESCE(?, brand_id),
         model = CASE WHEN COALESCE(source_priority, 0) <= ? OR model IS NULL OR model = '' THEN COALESCE(NULLIF(?, ''), model) ELSE model END,
         title = CASE WHEN COALESCE(source_priority, 0) <= ? OR title IS NULL OR title = '' THEN COALESCE(NULLIF(?, ''), title) ELSE title END,
         product_type = COALESCE(NULLIF(product_type, ''), ?),
         style_id = CASE WHEN ? = 'lego' THEN COALESCE(NULLIF(style_id, ''), NULLIF(?, '')) ELSE style_id END,
         manufacturer_part_number = COALESCE(NULLIF(manufacturer_part_number, ''), NULLIF(?, '')),
         category_id = COALESCE(?, category_id),
         category_key = COALESCE(NULLIF(category_key, ''), ?),
         slug = COALESCE(NULLIF(slug, ''), NULLIF(?, '')),
         icecat_id = COALESCE(icecat_id, ?),
         short_description = CASE WHEN COALESCE(source_priority, 0) <= ? OR short_description IS NULL OR short_description = '' THEN COALESCE(NULLIF(?, ''), short_description) ELSE short_description END,
         long_description = CASE WHEN COALESCE(source_priority, 0) <= ? OR long_description IS NULL OR long_description = '' THEN COALESCE(NULLIF(?, ''), long_description) ELSE long_description END,
         release_date = COALESCE(release_date, ?),
         end_of_life_date = COALESCE(end_of_life_date, ?),
         data_quality = COALESCE(NULLIF(?, ''), data_quality),
         source_updated_at = COALESCE(NULLIF(?, ''), source_updated_at),
         enrichment_status = 'ready',
         enriched_at = ?,
         source_priority = MAX(COALESCE(source_priority, 0), ?),
         updated_at = ?
       WHERE id = ?`
    ).bind(
      incomingPriority, product.brand || '', brandId,
      incomingPriority, product.model || product.title || '',
      incomingPriority, product.title || product.model || '',
      product.category?.key || 'product',
      product.category?.key || '', product.manufacturerPartNumber || '',
      product.manufacturerPartNumber || '',
      categoryId,
      product.category?.key || '',
      product.slug || '',
      product.icecatId || null,
      incomingPriority, product.shortDescription || '',
      incomingPriority, product.longDescription || '',
      product.releaseDate || null,
      product.endOfLifeDate || null,
      product.dataQuality || '',
      product.sourceUpdatedAt || '',
      now,
      incomingPriority,
      now,
      existing.id
    ).run();
    return await db.prepare('SELECT * FROM products WHERE id = ?').bind(existing.id).first();
  }

  async function ensureFpid(db, productRow) {
    if (productRow.fpid) return productRow.fpid;
    const fpid = fpidFromId(productRow.id);
    await db.prepare('UPDATE products SET fpid = ?, updated_at = ? WHERE id = ? AND (fpid IS NULL OR fpid = \'\')')
      .bind(fpid, nowIso(), productRow.id).run();
    return fpid;
  }

  async function upsertIdentifiers(db, productId, identifiers, source) {
    const now = nowIso();
    const statements = [];
    for (const identifier of identifiers || []) {
      if (!identifier.scheme || !identifier.normalizedValue) continue;
      const uniqueKey = identifierUniqueKey(identifier);
      statements.push(db.prepare(
        `INSERT INTO product_identifiers
         (product_id, scheme, value, normalized_value, brand_scope, unique_key, is_primary, source, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(unique_key) DO UPDATE SET
           product_id = excluded.product_id,
           value = excluded.value,
           is_primary = MAX(product_identifiers.is_primary, excluded.is_primary),
           source = COALESCE(product_identifiers.source, excluded.source),
           updated_at = excluded.updated_at`
      ).bind(
        productId,
        String(identifier.scheme).toLowerCase(),
        String(identifier.value),
        String(identifier.normalizedValue),
        String(identifier.brandScope || ''),
        uniqueKey,
        identifier.isPrimary ? 1 : 0,
        source,
        now
      ));
    }
    await batchRun(db, statements);
  }

  async function upsertAliases(db, productId, aliases, source) {
    const now = nowIso();
    const statements = [];
    for (const alias of unique(aliases || []).slice(0, PRODUCT_GRAPH_LIMITS.maxAliasesPerProduct)) {
      const normalized = normalizeText(alias);
      if (!normalized) continue;
      statements.push(db.prepare(
        `INSERT INTO product_aliases
         (product_id, alias, normalized_alias, alias_type, locale, source, weight, created_at)
         VALUES (?, ?, ?, 'name', 'en', ?, 60, ?)
         ON CONFLICT(product_id, normalized_alias, alias_type, locale) DO UPDATE SET
           alias = excluded.alias,
           source = COALESCE(product_aliases.source, excluded.source),
           weight = MAX(product_aliases.weight, excluded.weight)`
      ).bind(productId, String(alias).slice(0, 500), normalized.slice(0, 500), source, now));
    }
    await batchRun(db, statements);
  }

  async function upsertDescriptions(db, productId, descriptions, source) {
    const now = nowIso();
    const statements = [];
    for (const entry of (descriptions || []).slice(0, PRODUCT_GRAPH_LIMITS.maxDescriptionsPerProduct)) {
      if (!entry.kind || !entry.plainText) continue;
      statements.push(db.prepare(
        `INSERT INTO product_descriptions
         (product_id, kind, locale, html, plain_text, source, source_updated_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(product_id, kind, locale, source) DO UPDATE SET
           html = excluded.html,
           plain_text = excluded.plain_text,
           source_updated_at = excluded.source_updated_at,
           updated_at = excluded.updated_at`
      ).bind(
        productId,
        String(entry.kind),
        String(entry.locale || 'en'),
        entry.html || null,
        String(entry.plainText).slice(0, 50_000),
        source,
        entry.sourceUpdatedAt || null,
        now
      ));
    }
    await batchRun(db, statements);
  }

  async function upsertSpecs(db, productId, specs, source) {
    const now = nowIso();
    const statements = [];
    for (const spec of (specs || []).slice(0, PRODUCT_GRAPH_LIMITS.maxSpecsPerProduct)) {
      if (!spec.specKey || !spec.name) continue;
      statements.push(db.prepare(
        `INSERT INTO product_specs
         (product_id, spec_key, group_name, group_sort, feature_id, name, value,
          raw_value, unit, presentation_value, feature_sort, searchable, locale,
          source, source_updated_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(product_id, spec_key, locale, source) DO UPDATE SET
           group_name = excluded.group_name,
           group_sort = excluded.group_sort,
           feature_id = excluded.feature_id,
           name = excluded.name,
           value = excluded.value,
           raw_value = excluded.raw_value,
           unit = excluded.unit,
           presentation_value = excluded.presentation_value,
           feature_sort = excluded.feature_sort,
           searchable = excluded.searchable,
           source_updated_at = excluded.source_updated_at,
           updated_at = excluded.updated_at`
      ).bind(
        productId,
        String(spec.specKey).slice(0, 300),
        String(spec.groupName || '').slice(0, 300),
        Number(spec.groupSort || 0),
        spec.featureId || null,
        String(spec.name).slice(0, 300),
        String(spec.value || '').slice(0, 10_000),
        spec.rawValue ? String(spec.rawValue).slice(0, 10_000) : null,
        spec.unit ? String(spec.unit).slice(0, 100) : null,
        spec.presentationValue ? String(spec.presentationValue).slice(0, 10_000) : null,
        Number(spec.featureSort || 0),
        spec.searchable ? 1 : 0,
        String(spec.locale || 'en'),
        source,
        spec.sourceUpdatedAt || null,
        now
      ));
    }
    await batchRun(db, statements);
  }

  async function upsertImages(db, productId, images, source) {
    const now = nowIso();
    const results = [];
    for (const image of (images || []).slice(0, PRODUCT_GRAPH_LIMITS.maxImagesPerProduct)) {
      if (!image.sourceUrl) continue;
      const imageKey = `${source}:${await sha256Hex(`${image.externalId || ''}|${image.sourceUrl}`)}`;
      await db.prepare(
        `INSERT INTO product_images
         (product_id, image_key, source, source_external_id, source_url, source_preview_url,
          width, height, byte_size, sort_order, is_primary, image_type, status,
          source_updated_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'metadata', ?, ?)
         ON CONFLICT(image_key) DO UPDATE SET
           product_id = excluded.product_id,
           source_url = excluded.source_url,
           source_preview_url = excluded.source_preview_url,
           width = COALESCE(excluded.width, product_images.width),
           height = COALESCE(excluded.height, product_images.height),
           byte_size = COALESCE(excluded.byte_size, product_images.byte_size),
           sort_order = excluded.sort_order,
           is_primary = excluded.is_primary,
           image_type = excluded.image_type,
           source_updated_at = excluded.source_updated_at,
           updated_at = excluded.updated_at`
      ).bind(
        productId,
        imageKey,
        source,
        String(image.externalId || '').slice(0, 500) || null,
        String(image.sourceUrl).slice(0, 2000),
        image.previewUrl ? String(image.previewUrl).slice(0, 2000) : null,
        image.width || null,
        image.height || null,
        image.byteSize || null,
        Number(image.sortOrder || 0),
        image.isPrimary ? 1 : 0,
        String(image.imageType || '').slice(0, 120) || null,
        image.sourceUpdatedAt || null,
        now
      ).run();
      const row = await db.prepare('SELECT * FROM product_images WHERE image_key = ?').bind(imageKey).first();
      if (row) results.push(row);
    }
    return results;
  }

  async function upsertDocuments(db, productId, documents, source) {
    const now = nowIso();
    for (const document of documents || []) {
      if (!document.sourceUrl) continue;
      const key = `${source}:${await sha256Hex(`${document.kind || ''}|${document.sourceUrl}`)}`;
      await db.prepare(
        `INSERT INTO product_documents
         (product_id, document_key, kind, title, source, source_url, mime_type,
          byte_size, locale, status, source_updated_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'application/pdf', ?, ?, 'metadata', ?, ?)
         ON CONFLICT(document_key) DO UPDATE SET
           product_id = excluded.product_id,
           kind = excluded.kind,
           title = excluded.title,
           source_url = excluded.source_url,
           byte_size = COALESCE(excluded.byte_size, product_documents.byte_size),
           locale = excluded.locale,
           source_updated_at = excluded.source_updated_at,
           updated_at = excluded.updated_at`
      ).bind(
        productId,
        key,
        String(document.kind || 'document').slice(0, 120),
        String(document.title || 'Product document').slice(0, 500),
        source,
        String(document.sourceUrl).slice(0, 2000),
        document.byteSize || null,
        String(document.locale || 'en'),
        document.sourceUpdatedAt || null,
        now
      ).run();
    }
  }

  async function storeRawSource(env, product, contentHash) {
    if (!env?.PRODUCT_MEDIA || !product?.raw) return null;
    const key = `sources/${product.source}/${product.sourceProductId}/${contentHash.slice(0, 24)}.json`;
    await env.PRODUCT_MEDIA.put(key, stableStringify(product.raw), {
      httpMetadata: { contentType: 'application/json', cacheControl: 'private, max-age=31536000, immutable' },
      customMetadata: {
        source: product.source,
        sourceProductId: product.sourceProductId,
        storedAt: nowIso()
      }
    });
    return key;
  }

  async function upsertSource(db, productId, product, contentHash, rawR2Key) {
    const now = nowIso();
    await db.prepare(
      `INSERT INTO product_sources
       (product_id, source, source_product_id, source_url, source_updated_at,
        content_hash, raw_r2_key, last_fetched_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(source, source_product_id) DO UPDATE SET
         product_id = excluded.product_id,
         source_url = excluded.source_url,
         source_updated_at = excluded.source_updated_at,
         content_hash = excluded.content_hash,
         raw_r2_key = COALESCE(excluded.raw_r2_key, product_sources.raw_r2_key),
         last_fetched_at = excluded.last_fetched_at,
         updated_at = excluded.updated_at`
    ).bind(
      productId,
      product.source,
      product.sourceProductId,
      product.sourceUrl || null,
      product.sourceUpdatedAt || null,
      contentHash,
      rawR2Key,
      now,
      now
    ).run();
  }

  async function rebuildSearchTerms(db, productId, product) {
    const weights = new Map();
    const add = (value, weight) => {
      for (const token of tokenizeSearch(value)) weights.set(token, Math.max(weights.get(token) || 0, weight));
    };
    add(product.title, 100);
    add(product.model, 90);
    add(product.manufacturerPartNumber, 100);
    add(product.brand, 35);
    add(product.family, 35);
    add(product.series, 35);
    add(product.category?.name, 15);
    for (const gtin of product.gtins || []) add(gtin, 100);
    for (const alias of product.aliases || []) add(alias, 60);

    await db.prepare('DELETE FROM product_search_terms WHERE product_id = ?').bind(productId).run();
    const statements = [...weights.entries()].map(([term, weight]) => db.prepare(
      `INSERT INTO product_search_terms (product_id, term, weight, source) VALUES (?, ?, ?, ?)`
    ).bind(productId, term, weight, product.source));
    await batchRun(db, statements);
  }

  async function upsertCanonicalProduct(env, product, options = {}) {
    if (!env?.DB) throw new Error('D1 binding env.DB is required');
    if (!product?.source || !product?.sourceProductId || !product?.canonicalKey) {
      throw new Error('Normalised product requires source, sourceProductId and canonicalKey');
    }
    if (!product.category && options.requireAllowedCategory !== false) {
      return { skipped: true, reason: 'category-not-allowed', sourceProductId: product.sourceProductId };
    }

    const db = env.DB;
    const brandId = await upsertBrand(db, product);
    const categoryId = await getCategoryId(db, product.category?.key);
    let row = await findExistingProduct(db, product);

    if (!row) {
      try {
        row = await insertProduct(db, product, brandId, categoryId);
      } catch (error) {
        row = await findExistingProduct(db, product);
        if (!row) throw error;
      }
    } else {
      row = await updateProduct(db, row, product, brandId, categoryId);
    }

    if (!row?.id) throw new Error('Failed to create or resolve canonical product');
    const fpid = await ensureFpid(db, row);
    row = { ...row, fpid };

    const contentHash = await sha256Hex(stableStringify(product.raw || product));
    const rawR2Key = options.storeRawSource === false ? null : await storeRawSource(env, product, contentHash);

    await upsertIdentifiers(db, row.id, product.identifiers, product.source);
    await upsertAliases(db, row.id, product.aliases, product.source);
    await upsertDescriptions(db, row.id, product.descriptions, product.source);
    await upsertSpecs(db, row.id, product.specs, product.source);
    const imageRows = await upsertImages(db, row.id, product.images, product.source);
    await upsertDocuments(db, row.id, product.documents, product.source);
    await upsertSource(db, row.id, product, contentHash, rawR2Key);
    await rebuildSearchTerms(db, row.id, product);

    const primaryMetadata = imageRows.find((image) => Number(image.is_primary) === 1) || imageRows[0] || null;
    if (primaryMetadata) {
      await db.prepare('UPDATE products SET primary_image_id = COALESCE(primary_image_id, ?), source_json_hash = ?, updated_at = ? WHERE id = ?')
        .bind(primaryMetadata.id, contentHash, nowIso(), row.id).run();
    } else {
      await db.prepare('UPDATE products SET source_json_hash = ?, updated_at = ? WHERE id = ?')
        .bind(contentHash, nowIso(), row.id).run();
    }

    if (product.source === 'icecat') {
      await db.prepare(
        `UPDATE icecat_index SET product_id = ?, imported_at = ?, updated_at = ? WHERE icecat_id = ?`
      ).bind(row.id, nowIso(), nowIso(), product.icecatId).run().catch(() => {});
    }

    return {
      skipped: false,
      productId: row.id,
      fpid,
      slug: row.slug || product.slug,
      categoryKey: product.category?.key || row.category_key,
      source: product.source,
      sourceProductId: product.sourceProductId,
      imageMetadataCount: imageRows.length,
      specCount: product.specs?.length || 0,
      aliasCount: product.aliases?.length || 0,
      contentHash,
      rawR2Key
    };
  }

  function publicImage(row, env, requestOrigin = '') {
    const localUrl = row.r2_key ? productMediaUrl(env, row.r2_key, requestOrigin) : '';
    return {
      id: row.id,
      url: localUrl,
      ready: Boolean(localUrl),
      previewSourceUrl: localUrl ? null : row.source_preview_url || null,
      source: row.source,
      width: row.width,
      height: row.height,
      sortOrder: row.sort_order,
      isPrimary: Boolean(row.is_primary),
      imageType: row.image_type,
      status: row.status
    };
  }

  async function getCanonicalProduct(env, identifier, options = {}) {
    if (!env?.DB) throw new Error('D1 binding env.DB is required');
    const db = env.DB;
    const raw = String(identifier || '').trim();
    let product = null;

    const fpidId = parseFpid(raw);
    if (fpidId) product = await db.prepare('SELECT * FROM products WHERE id = ?').bind(fpidId).first();
    if (!product && /^\d+$/.test(raw)) product = await db.prepare('SELECT * FROM products WHERE id = ? OR icecat_id = ? LIMIT 1').bind(Number(raw), Number(raw)).first();
    if (!product) product = await db.prepare('SELECT * FROM products WHERE fpid = ? OR slug = ? OR canonical_key = ? LIMIT 1').bind(raw, raw, raw).first();
    if (!product) return null;

    const [identifiersResult, aliasesResult, imagesResult, specsResult, descriptionsResult, documentsResult, sourcesResult] = await Promise.all([
      db.prepare('SELECT scheme, value, normalized_value, brand_scope, is_primary, source FROM product_identifiers WHERE product_id = ? ORDER BY is_primary DESC, scheme').bind(product.id).all(),
      db.prepare('SELECT alias, alias_type, locale, source, weight FROM product_aliases WHERE product_id = ? ORDER BY weight DESC, alias').bind(product.id).all(),
      db.prepare('SELECT * FROM product_images WHERE product_id = ? ORDER BY is_primary DESC, sort_order ASC').bind(product.id).all(),
      db.prepare('SELECT group_name, group_sort, feature_id, name, value, raw_value, unit, presentation_value, feature_sort, searchable, locale, source FROM product_specs WHERE product_id = ? ORDER BY group_sort DESC, feature_sort DESC LIMIT ?').bind(product.id, options.specLimit || PRODUCT_GRAPH_LIMITS.maxSpecsPerProduct).all(),
      db.prepare('SELECT kind, locale, html, plain_text, source, source_updated_at FROM product_descriptions WHERE product_id = ? ORDER BY kind').bind(product.id).all(),
      db.prepare('SELECT kind, title, source, source_url, r2_key, mime_type, byte_size, locale, status FROM product_documents WHERE product_id = ? ORDER BY kind, title').bind(product.id).all(),
      db.prepare('SELECT source, source_product_id, source_url, source_updated_at, content_hash, last_fetched_at FROM product_sources WHERE product_id = ? ORDER BY source').bind(product.id).all()
    ]);

    const images = (imagesResult.results || []).map((row) => publicImage(row, env, options.requestOrigin || ''));
    const primary = images.find((image) => image.ready && image.isPrimary) || images.find((image) => image.ready) || null;

    return {
      id: product.id,
      fpid: product.fpid || fpidFromId(product.id),
      canonicalKey: product.canonical_key,
      slug: product.slug,
      categoryKey: product.category_key || product.product_type,
      brand: product.brand,
      title: product.title || product.model,
      model: product.model,
      manufacturerPartNumber: product.manufacturer_part_number || product.style_id,
      styleId: product.style_id,
      colorway: product.colorway,
      icecatId: product.icecat_id,
      shortDescription: product.short_description,
      longDescription: product.long_description,
      releaseDate: product.release_date,
      endOfLifeDate: product.end_of_life_date,
      dataQuality: product.data_quality,
      enrichmentStatus: product.enrichment_status,
      enrichedAt: product.enriched_at,
      primaryImageUrl: primary?.url || product.image_url || '',
      identifiers: identifiersResult.results || [],
      aliases: aliasesResult.results || [],
      images,
      specs: specsResult.results || [],
      descriptions: descriptionsResult.results || [],
      documents: documentsResult.results || [],
      sources: sourcesResult.results || []
    };
  }

  async function findProductByExactIdentifier(env, selector) {
    if (!env?.DB) throw new Error('D1 binding env.DB is required');
    const db = env.DB;
    let identifier = null;

    if (selector?.gtin) {
      const value = normalizeGtin(selector.gtin);
      if (value) identifier = { scheme: 'gtin', normalizedValue: value, brandScope: '' };
    } else if (selector?.icecatId) {
      const value = String(Number(selector.icecatId) || '');
      if (value) identifier = { scheme: 'icecat', normalizedValue: value, brandScope: '' };
    } else if (selector?.brand && selector?.mpn) {
      const value = normalizeIdentifier(selector.mpn);
      const brandScope = normalizeBrand(selector.brand);
      if (value && brandScope) identifier = { scheme: 'mpn', normalizedValue: value, brandScope };
    } else if (selector?.brand && selector?.styleId) {
      const value = normalizeIdentifier(selector.styleId);
      const brandScope = normalizeBrand(selector.brand);
      if (value && brandScope) identifier = { scheme: 'style', normalizedValue: value, brandScope };
    }

    if (!identifier) return null;
    const row = await findProductByIdentifier(db, identifier);
    return row || null;
  }

  async function searchCanonicalProducts(env, query, options = {}) {
    if (!env?.DB) throw new Error('D1 binding env.DB is required');
    const tokens = tokenizeSearch(query);
    if (!tokens.length) return [];
    const limit = Math.max(1, Math.min(Number(options.limit || 8), PRODUCT_GRAPH_LIMITS.maxSearchResults));
    const placeholders = tokens.map(() => '?').join(',');
    const result = await env.DB.prepare(
      `SELECT p.id, p.fpid, p.slug, p.canonical_key, p.category_key, p.brand,
              p.title, p.model, p.manufacturer_part_number, p.style_id, p.image_url,
              SUM(t.weight) AS score, COUNT(DISTINCT t.term) AS matched_terms
       FROM product_search_terms t
       JOIN products p ON p.id = t.product_id
       WHERE t.term IN (${placeholders})
       GROUP BY p.id
       ORDER BY matched_terms DESC, score DESC, p.updated_at DESC
       LIMIT ?`
    ).bind(...tokens, limit).all();

    return (result.results || []).map((row) => ({
      id: row.id,
      fpid: row.fpid || fpidFromId(row.id),
      slug: row.slug,
      canonicalKey: row.canonical_key,
      categoryKey: row.category_key,
      brand: row.brand,
      title: row.title || row.model,
      model: row.model,
      manufacturerPartNumber: row.manufacturer_part_number || row.style_id,
      imageUrl: row.image_url || '',
      score: Number(row.score || 0),
      matchedTerms: Number(row.matched_terms || 0),
      queryTerms: tokens.length,
      coverage: Number(row.matched_terms || 0) / tokens.length
    }));
  }

  // ──────────────────────────────────────────────────────────────
  // src/icecat-importer.js
  // ──────────────────────────────────────────────────────────────
  function selectorSourceId(selector) {
    if (selector?.icecatId) return String(selector.icecatId);
    if (selector?.gtin) return `gtin:${selector.gtin}`;
    if (selector?.brand && selector?.productCode) return `${selector.brand}:${selector.productCode}`;
    return 'unknown';
  }

  async function recordFailure(env, selector, stage, error) {
    if (!env?.DB) return;
    try {
      await env.DB.prepare(
        `INSERT INTO product_import_failures
         (source, source_product_id, stage, error_code, error_message, payload_json, retryable, occurred_at)
         VALUES ('icecat', ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        selectorSourceId(selector),
        stage,
        String(error?.code || 'ICECAT_IMPORT_FAILED'),
        String(error?.message || error).slice(0, 2000),
        JSON.stringify(selector || {}),
        error?.retryable ? 1 : 0,
        nowIso()
      ).run();
    } catch {
      // Failure logging must never hide the original error.
    }
  }

  async function importIcecatProduct(env, selector, options = {}) {
    let fetched;
    try {
      fetched = await fetchIcecatProduct(env, selector, {
        lang: options.lang || 'en',
        content: options.content,
        relationsLimit: options.relationsLimit,
        attempts: options.attempts,
        timeoutMs: options.timeoutMs
      });
    } catch (error) {
      await recordFailure(env, selector, 'fetch', error);
      throw error;
    }

    let normalised;
    try {
      normalised = normalizeIcecatProduct(fetched.data, { lang: options.lang || 'en' });
    } catch (error) {
      await recordFailure(env, selector, 'normalise', error);
      throw error;
    }

    if (!normalised.category || !normalised.category.icecatEnabled) {
      const result = {
        skipped: true,
        reason: 'category-not-allowed',
        icecatId: normalised.icecatId,
        icecatCategory: normalised.categoryName,
        brand: normalised.brand,
        title: normalised.title
      };
      if (options.rejectDisallowed) {
        const error = new IcecatError(`Icecat category is outside the FindAI launch allowlist: ${normalised.categoryName || 'unknown'}`, {
          code: 'ICECAT_CATEGORY_NOT_ALLOWED',
          status: 422,
          retryable: false,
          details: result
        });
        await recordFailure(env, selector, 'category', error);
        throw error;
      }
      return result;
    }

    let upserted;
    try {
      upserted = await upsertCanonicalProduct(env, normalised, {
        requireAllowedCategory: true,
        storeRawSource: options.storeRawSource !== false
      });
    } catch (error) {
      await recordFailure(env, selector, 'database', error);
      throw error;
    }

    let imageResult = { mirrored: [], failures: [] };
    if (!upserted.skipped && options.mirrorImages !== false && env?.PRODUCT_MEDIA) {
      imageResult = await mirrorProductImages(env, upserted.productId, {
        limit: Math.max(1, Math.min(Number(options.imageLimit || 1), PRODUCT_GRAPH_LIMITS.maxImagesPerProduct))
      });
    }

    return {
      ...upserted,
      icecatId: normalised.icecatId,
      title: normalised.title,
      brand: normalised.brand,
      categoryKey: normalised.category.key,
      imagesMirrored: imageResult.mirrored.length,
      imageFailures: imageResult.failures
    };
  }

  async function importIcecatBatch(env, selectors, options = {}) {
    const input = Array.isArray(selectors) ? selectors : [];
    if (!input.length) return { imported: [], skipped: [], failed: [] };
    if (input.length > PRODUCT_GRAPH_LIMITS.maxBatchImportItems) {
      throw new Error(`A batch may contain at most ${PRODUCT_GRAPH_LIMITS.maxBatchImportItems} products`);
    }

    const imported = [];
    const skipped = [];
    const failed = [];
    for (const selector of input) {
      try {
        const result = await importIcecatProduct(env, selector, options);
        if (result.skipped) skipped.push(result);
        else imported.push(result);
      } catch (error) {
        failed.push({
          selector,
          code: String(error?.code || 'IMPORT_FAILED'),
          error: String(error?.message || error),
          retryable: Boolean(error?.retryable)
        });
      }
    }
    return { imported, skipped, failed };
  }

  // ──────────────────────────────────────────────────────────────
  // src/queue.js
  // ──────────────────────────────────────────────────────────────
  function nextRetryIso(attempts) {
    const delayMinutes = Math.min(24 * 60, Math.max(5, 5 * 2 ** Math.max(0, attempts - 1)));
    return new Date(Date.now() + delayMinutes * 60_000).toISOString();
  }

  async function enqueueIcecatProduct(env, selector, options = {}) {
    if (!env?.DB) throw new Error('D1 binding env.DB is required');
    const sourceProductId = selector?.icecatId
      ? String(selector.icecatId)
      : selector?.gtin
        ? `gtin:${selector.gtin}`
        : selector?.brand && selector?.productCode
          ? `${selector.brand}:${selector.productCode}`
          : '';
    if (!sourceProductId) throw new Error('Queue selector requires icecatId, gtin, or brand + productCode');

    const now = nowIso();
    await env.DB.prepare(
      `INSERT INTO product_enrichment_queue
       (source, source_product_id, priority, status, attempts, payload_json, next_attempt_at, created_at, updated_at)
       VALUES ('icecat', ?, ?, 'pending', 0, ?, ?, ?, ?)
       ON CONFLICT(source, source_product_id) DO UPDATE SET
         priority = MAX(product_enrichment_queue.priority, excluded.priority),
         payload_json = excluded.payload_json,
         status = CASE WHEN product_enrichment_queue.status = 'complete' AND ? = 0 THEN 'complete' ELSE 'pending' END,
         next_attempt_at = CASE WHEN product_enrichment_queue.status = 'complete' AND ? = 0 THEN product_enrichment_queue.next_attempt_at ELSE excluded.next_attempt_at END,
         last_error = CASE WHEN ? = 1 THEN NULL ELSE product_enrichment_queue.last_error END,
         updated_at = excluded.updated_at`
    ).bind(
      sourceProductId,
      Math.max(1, Math.min(Number(options.priority || 50), 100)),
      JSON.stringify({ selector, options: { lang: options.lang || 'en', imageLimit: options.imageLimit || 1 } }),
      now,
      now,
      now,
      options.force ? 1 : 0,
      options.force ? 1 : 0,
      options.force ? 1 : 0
    ).run();

    return { queued: true, source: 'icecat', sourceProductId };
  }

  async function claimQueueRows(env, limit) {
    const now = nowIso();
    const result = await env.DB.prepare(
      `SELECT id, source, source_product_id, attempts, payload_json
       FROM product_enrichment_queue
       WHERE status IN ('pending', 'retry')
         AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
         AND (locked_at IS NULL OR locked_at < datetime('now', '-20 minutes'))
       ORDER BY priority DESC, created_at ASC
       LIMIT ?`
    ).bind(now, limit).all();

    const claimed = [];
    for (const row of result.results || []) {
      const update = await env.DB.prepare(
        `UPDATE product_enrichment_queue
         SET status = 'processing', locked_at = ?, updated_at = ?
         WHERE id = ? AND status IN ('pending', 'retry')`
      ).bind(now, now, row.id).run();
      if (Number(update?.meta?.changes ?? 1) > 0) claimed.push(row);
    }
    return claimed;
  }

  async function runProductGraphCron(env, ctx, options = {}) {
    if (!env?.DB) return { processed: 0, completed: 0, skipped: 0, failed: 0 };
    const limit = Math.max(1, Math.min(
      Number(options.maxProducts || PRODUCT_GRAPH_LIMITS.defaultCronProducts),
      PRODUCT_GRAPH_LIMITS.maxCronProducts
    ));
    const rows = await claimQueueRows(env, limit);
    const summary = { processed: rows.length, completed: 0, skipped: 0, failed: 0, results: [] };

    for (const row of rows) {
      const payload = (() => {
        try { return JSON.parse(row.payload_json || '{}'); } catch { return {}; }
      })();
      const selector = payload.selector || { icecatId: row.source_product_id };
      try {
        const result = await importIcecatProduct(env, selector, {
          lang: payload.options?.lang || 'en',
          imageLimit: payload.options?.imageLimit || 1,
          mirrorImages: true,
          storeRawSource: true
        });
        const status = result.skipped ? 'skipped' : 'complete';
        await env.DB.prepare(
          `UPDATE product_enrichment_queue
           SET status = ?, locked_at = NULL, last_error = NULL, updated_at = ?
           WHERE id = ?`
        ).bind(status, nowIso(), row.id).run();
        if (result.skipped) summary.skipped += 1;
        else summary.completed += 1;
        summary.results.push({ id: row.id, status, result });
      } catch (error) {
        const attempts = Number(row.attempts || 0) + 1;
        const retryable = error?.retryable !== false && attempts < 8;
        const status = retryable ? 'retry' : 'failed';
        await env.DB.prepare(
          `UPDATE product_enrichment_queue
           SET status = ?, attempts = ?, next_attempt_at = ?, locked_at = NULL,
               last_error = ?, updated_at = ?
           WHERE id = ?`
        ).bind(
          status,
          attempts,
          retryable ? nextRetryIso(attempts) : null,
          String(error?.message || error).slice(0, 2000),
          nowIso(),
          row.id
        ).run();
        summary.failed += 1;
        summary.results.push({ id: row.id, status, error: String(error?.message || error) });
      }
    }

    return summary;
  }

  // ──────────────────────────────────────────────────────────────
  // src/product-matcher.js
  // ──────────────────────────────────────────────────────────────
  function firstValue(...values) {
    for (const value of values) {
      if (value !== null && value !== undefined && String(value).trim()) return value;
    }
    return '';
  }

  function extractListingIdentity(listing = {}) {
    const gtins = unique([
      listing.gtin,
      listing.ean,
      listing.upc,
      listing.isbn,
      ...(Array.isArray(listing.gtins) ? listing.gtins : []),
      ...(Array.isArray(listing.eans) ? listing.eans : []),
      ...(Array.isArray(listing.upcs) ? listing.upcs : [])
    ].map(normalizeGtin).filter(Boolean));

    const brand = String(firstValue(
      listing.brand,
      listing.manufacturer,
      listing.productBrand,
      listing.productAttributes?.brand
    )).trim();
    const mpn = String(firstValue(
      listing.mpn,
      listing.manufacturerPartNumber,
      listing.productCode,
      listing.sku
    )).trim();
    const styleId = String(firstValue(listing.styleId, listing.styleID, listing.styleCode)).trim();
    const title = String(firstValue(listing.title, listing.name, listing.productName)).trim();

    return {
      gtins,
      brand,
      brandScope: normalizeBrand(brand),
      mpn,
      mpnNormalized: normalizeIdentifier(mpn),
      styleId,
      styleIdNormalized: normalizeIdentifier(styleId),
      title,
      titleNormalized: normalizeText(title),
      titleTokens: tokenizeSearch(title)
    };
  }

  function scoreCandidate(identity, candidate) {
    const candidateTitle = normalizeText(candidate.title || candidate.model || '');
    const candidateTokens = new Set(tokenizeSearch(candidateTitle));
    const titleTokens = identity.titleTokens;
    const matched = titleTokens.filter((token) => candidateTokens.has(token));
    const coverage = titleTokens.length ? matched.length / titleTokens.length : 0;
    const brandMatches = !identity.brand
      || normalizeBrand(candidate.brand) === identity.brandScope
      || candidateTitle.includes(normalizeText(identity.brand));
    const mpn = normalizeIdentifier(candidate.manufacturerPartNumber || '');
    const exactMpn = Boolean(identity.mpnNormalized && mpn && identity.mpnNormalized === mpn);
    const exactStyle = Boolean(identity.styleIdNormalized && mpn && identity.styleIdNormalized === mpn);

    let confidence = coverage * 0.72;
    if (brandMatches) confidence += 0.16;
    if (exactMpn || exactStyle) confidence = 1;
    if (candidateTitle === identity.titleNormalized) confidence = Math.max(confidence, 0.98);
    return { confidence: Math.min(1, confidence), coverage, brandMatches, exactMpn, exactStyle };
  }

  async function resolveProductFromListing(env, listing, options = {}) {
    const identity = extractListingIdentity(listing);

    for (const gtin of identity.gtins) {
      const exact = await findProductByExactIdentifier(env, { gtin });
      if (exact) return {
        productId: exact.id,
        fpid: exact.fpid,
        canonicalKey: exact.canonical_key,
        matchType: 'gtin',
        confidence: 1
      };
    }

    if (identity.brand && identity.mpn) {
      const exact = await findProductByExactIdentifier(env, { brand: identity.brand, mpn: identity.mpn });
      if (exact) return {
        productId: exact.id,
        fpid: exact.fpid,
        canonicalKey: exact.canonical_key,
        matchType: 'brand-mpn',
        confidence: 1
      };
    }

    if (identity.brand && identity.styleId) {
      const exact = await findProductByExactIdentifier(env, { brand: identity.brand, styleId: identity.styleId });
      if (exact) return {
        productId: exact.id,
        fpid: exact.fpid,
        canonicalKey: exact.canonical_key,
        matchType: 'brand-style',
        confidence: 1
      };
    }

    if (options.queueIcecatOnMiss !== false) {
      if (identity.gtins[0]) {
        await enqueueIcecatProduct(env, { gtin: identity.gtins[0] }, { priority: options.queuePriority || 70 }).catch(() => {});
      } else if (identity.brand && identity.mpn) {
        await enqueueIcecatProduct(env, { brand: identity.brand, productCode: identity.mpn }, { priority: options.queuePriority || 65 }).catch(() => {});
      }
    }

    if (!identity.title || options.allowFuzzy === false) return null;
    const candidates = await searchCanonicalProducts(env, identity.title, { limit: options.candidateLimit || 8 });
    let best = null;
    for (const candidate of candidates) {
      const score = scoreCandidate(identity, candidate);
      if (!best || score.confidence > best.confidence) best = { ...candidate, ...score };
    }

    const threshold = Number(options.fuzzyThreshold || 0.92);
    if (!best || best.confidence < threshold) return null;
    return {
      productId: best.id,
      fpid: best.fpid,
      canonicalKey: best.canonicalKey,
      matchType: 'high-confidence-title',
      confidence: best.confidence,
      coverage: best.coverage
    };
  }

  async function attachCanonicalProducts(env, listings, options = {}) {
    const input = Array.isArray(listings) ? listings : [];
    const output = [];
    for (const listing of input) {
      const match = await resolveProductFromListing(env, listing, options).catch(() => null);
      output.push(match ? {
        ...listing,
        productId: match.productId,
        fpid: match.fpid,
        canonicalKey: match.canonicalKey,
        productMatch: {
          type: match.matchType,
          confidence: match.confidence
        }
      } : listing);
    }
    return output;
  }

  // ──────────────────────────────────────────────────────────────
  // src/routes.js
  // ──────────────────────────────────────────────────────────────
  async function readJson(request, maxBytes = 1_000_000) {
    const length = Number(request.headers.get('content-length') || 0);
    if (length > maxBytes) throw new Error('Request body is too large');
    const text = await request.text();
    if (text.length > maxBytes) throw new Error('Request body is too large');
    if (!text.trim()) return {};
    return JSON.parse(text);
  }

  async function isAdminRequest(request, env, hooks = {}) {
    if (typeof hooks.isAdmin === 'function') return Boolean(await hooks.isAdmin(request, env));
    const expected = String(env?.ADMIN_TOKEN || '');
    if (!expected) return false;
    const supplied = request.headers.get('x-findai-admin') || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
    return constantTimeEqual(expected, supplied);
  }

  async function requireAdmin(request, env, hooks) {
    if (await isAdminRequest(request, env, hooks)) return null;
    return jsonResponse({ error: 'unauthorised' }, 403);
  }

  function selectorFromBody(body = {}) {
    if (body.icecatId) return { icecatId: Number(body.icecatId) };
    if (body.gtin) return { gtin: String(body.gtin) };
    if (body.brand && (body.productCode || body.mpn)) {
      return { brand: String(body.brand), productCode: String(body.productCode || body.mpn) };
    }
    return null;
  }

  async function ingestIcecatIndexBatch(env, entries) {
    if (!env?.DB) throw new Error('D1 binding env.DB is required');
    if (!Array.isArray(entries) || !entries.length) return { accepted: 0 };
    if (entries.length > PRODUCT_GRAPH_LIMITS.maxIndexBatchItems) {
      throw new Error(`Index batch may contain at most ${PRODUCT_GRAPH_LIMITS.maxIndexBatchItems} entries`);
    }
    let accepted = 0;
    const now = nowIso();
    for (const entry of entries) {
      const icecatId = Number(entry.icecatId || entry.Product_ID || entry.productId);
      if (!Number.isSafeInteger(icecatId) || icecatId <= 0) continue;
      await env.DB.prepare(
        `INSERT INTO icecat_index
         (icecat_id, product_code, model_name, category_id, category_name, category_key,
          supplier_id, brand, high_pic, xml_path, source_updated_at, allowed, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(icecat_id) DO UPDATE SET
           product_code = excluded.product_code,
           model_name = excluded.model_name,
           category_id = excluded.category_id,
           category_name = excluded.category_name,
           category_key = excluded.category_key,
           supplier_id = excluded.supplier_id,
           brand = COALESCE(NULLIF(excluded.brand, ''), icecat_index.brand),
           high_pic = excluded.high_pic,
           xml_path = excluded.xml_path,
           source_updated_at = excluded.source_updated_at,
           allowed = excluded.allowed,
           updated_at = excluded.updated_at`
      ).bind(
        icecatId,
        String(entry.productCode || entry.Prod_ID || '').slice(0, 500) || null,
        String(entry.modelName || entry.Model_Name || '').slice(0, 1000) || null,
        String(entry.categoryId || entry.Catid || '').slice(0, 100) || null,
        String(entry.categoryName || '').slice(0, 500) || null,
        String(entry.categoryKey || '').slice(0, 100) || null,
        String(entry.supplierId || entry.Supplier_id || '').slice(0, 100) || null,
        String(entry.brand || '').slice(0, 300) || null,
        String(entry.highPic || entry.HighPic || '').slice(0, 2000) || null,
        String(entry.xmlPath || entry.path || '').slice(0, 1000) || null,
        String(entry.updated || entry.Updated || '').slice(0, 100) || null,
        entry.allowed === false ? 0 : 1,
        now
      ).run();
      accepted += 1;
    }
    return { accepted };
  }

  async function productGraphStatus(env) {
    if (!env?.DB) return { ok: false, error: 'No D1 binding' };
    const counts = {};
    for (const [key, sql] of Object.entries({
      products: 'SELECT COUNT(*) AS count FROM products WHERE fpid IS NOT NULL',
      icecatProducts: "SELECT COUNT(*) AS count FROM product_sources WHERE source = 'icecat'",
      readyImages: "SELECT COUNT(*) AS count FROM product_images WHERE status = 'ready' AND r2_key IS NOT NULL",
      queued: "SELECT COUNT(*) AS count FROM product_enrichment_queue WHERE status IN ('pending', 'retry', 'processing')",
      failures: "SELECT COUNT(*) AS count FROM product_import_failures"
    })) {
      try {
        const row = await env.DB.prepare(sql).first();
        counts[key] = Number(row?.count || 0);
      } catch {
        counts[key] = null;
      }
    }
    return {
      ok: true,
      counts,
      icecatConfigured: Boolean(env.ICECAT_USERNAME && env.ICECAT_API_TOKEN),
      r2Configured: Boolean(env.PRODUCT_MEDIA)
    };
  }

  async function handleProductGraphRoute(request, env, ctx, hooks = {}) {
    const mediaResponse = await handleProductMediaRequest(request, env);
    if (mediaResponse) return mediaResponse;

    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/api/products/search' && request.method === 'GET') {
      const q = String(url.searchParams.get('q') || '').trim();
      if (q.length < 2) return jsonResponse({ products: [] }, 200, { 'cache-control': 'public, max-age=30' });
      const products = await searchCanonicalProducts(env, q, { limit: Number(url.searchParams.get('limit') || 8) });
      return jsonResponse({ products }, 200, { 'cache-control': 'public, max-age=60, s-maxage=120' });
    }

    if (path === '/api/products/resolve' && request.method === 'GET') {
      const selector = {
        gtin: url.searchParams.get('gtin') || '',
        icecatId: url.searchParams.get('icecatId') || '',
        brand: url.searchParams.get('brand') || '',
        mpn: url.searchParams.get('mpn') || '',
        styleId: url.searchParams.get('styleId') || ''
      };
      const exact = await findProductByExactIdentifier(env, selector);
      if (exact) return jsonResponse({ match: { productId: exact.id, fpid: exact.fpid, canonicalKey: exact.canonical_key, confidence: 1 } });

      const title = String(url.searchParams.get('q') || '').trim();
      if (!title) return jsonResponse({ match: null });
      const match = await resolveProductFromListing(env, { ...selector, title }, { queueIcecatOnMiss: true });
      return jsonResponse({ match });
    }

    const productMatch = path.match(/^\/api\/products\/([^/]+)$/);
    if (productMatch && request.method === 'GET') {
      const identifier = decodeURIComponent(productMatch[1]);
      const product = await getCanonicalProduct(env, identifier, { requestOrigin: url.origin });
      if (!product) return jsonResponse({ error: 'product not found' }, 404);
      return jsonResponse({ product }, 200, { 'cache-control': 'public, max-age=120, s-maxage=300' });
    }

    if (!path.startsWith('/admin/product-graph') && !path.startsWith('/admin/icecat')) return null;
    const denied = await requireAdmin(request, env, hooks);
    if (denied) return denied;

    try {
      if (path === '/admin/product-graph/setup' && request.method === 'POST') {
        return jsonResponse(await setupProductGraph(env));
      }

      if (path === '/admin/product-graph/status' && request.method === 'GET') {
        return jsonResponse(await productGraphStatus(env));
      }

      if (path === '/admin/product-graph/run-cron' && request.method === 'POST') {
        const body = await readJson(request);
        return jsonResponse(await runProductGraphCron(env, ctx, { maxProducts: body.maxProducts }));
      }

      if (path === '/admin/icecat/import' && request.method === 'POST') {
        const body = await readJson(request);
        const selector = selectorFromBody(body);
        if (!selector) return jsonResponse({ error: 'icecatId, gtin, or brand + productCode is required' }, 400);
        const result = await importIcecatProduct(env, selector, {
          lang: body.lang || 'en',
          mirrorImages: body.mirrorImages !== false,
          imageLimit: body.imageLimit || 1,
          rejectDisallowed: body.rejectDisallowed === true,
          storeRawSource: body.storeRawSource !== false
        });
        return jsonResponse(result);
      }

      if (path === '/admin/icecat/import-batch' && request.method === 'POST') {
        const body = await readJson(request, 2_000_000);
        const selectors = Array.isArray(body.items) ? body.items.map(selectorFromBody).filter(Boolean) : [];
        if (!selectors.length) return jsonResponse({ error: 'items array is required' }, 400);
        return jsonResponse(await importIcecatBatch(env, selectors, {
          lang: body.lang || 'en',
          mirrorImages: body.mirrorImages !== false,
          imageLimit: body.imageLimit || 1,
          storeRawSource: body.storeRawSource !== false
        }));
      }

      if (path === '/admin/icecat/enqueue' && request.method === 'POST') {
        const body = await readJson(request);
        const selector = selectorFromBody(body);
        if (!selector) return jsonResponse({ error: 'icecatId, gtin, or brand + productCode is required' }, 400);
        return jsonResponse(await enqueueIcecatProduct(env, selector, {
          priority: body.priority,
          force: body.force === true,
          lang: body.lang || 'en',
          imageLimit: body.imageLimit || 1
        }));
      }

      if (path === '/admin/icecat/index/batch' && request.method === 'POST') {
        const body = await readJson(request, 5_000_000);
        return jsonResponse(await ingestIcecatIndexBatch(env, body.entries));
      }

      const mirrorMatch = path.match(/^\/admin\/product-graph\/products\/(\d+)\/mirror-images$/);
      if (mirrorMatch && request.method === 'POST') {
        const body = await readJson(request);
        return jsonResponse(await mirrorProductImages(env, Number(mirrorMatch[1]), { limit: body.limit || 1 }));
      }

      return jsonResponse({ error: 'admin route not found' }, 404);
    } catch (error) {
      if (typeof hooks.logError === 'function') hooks.logError('product graph route', error);
      const status = Number(error?.status || 500);
      return jsonResponse({
        error: String(error?.message || error),
        code: String(error?.code || 'PRODUCT_GRAPH_ERROR'),
        retryable: Boolean(error?.retryable),
        // Admin-only diagnostic data. Tokens are headers and are never included.
        details: error?.details || null
      }, status >= 400 && status <= 599 ? status : 500);
    }
  }

  return {
    LAUNCH_CATEGORIES,
    CATEGORY_BY_KEY,
    classifyIcecatCategory,
    setupProductGraph,
    fetchIcecatProduct,
    fetchIcecatAsset,
    IcecatError,
    normalizeIcecatProduct,
    importIcecatProduct,
    importIcecatBatch,
    upsertCanonicalProduct,
    getCanonicalProduct,
    findProductByExactIdentifier,
    searchCanonicalProducts,
    extractListingIdentity,
    resolveProductFromListing,
    attachCanonicalProducts,
    mirrorImageRecord,
    mirrorProductImages,
    handleProductMediaRequest,
    productMediaUrl,
    enqueueIcecatProduct,
    runProductGraphCron,
    handleProductGraphRoute
  };
})();

export default {
  // Needs a KV namespace bound as CACHE and a Cron Trigger (e.g. */15 * * * *) in the dashboard.
  async scheduled(event, env, ctx) {
    const countries = ['US', 'AU', 'UK', 'DE'];
    const tasks = countries.map(async (c) => {
      try { const pool = await buildPreviewsPool(c, env); if (env.CACHE) await env.CACHE.put(`previews:${c}`, JSON.stringify({ items: pool, ts: Date.now() }), { expirationTtl: 3600 }); } catch (_) {}
      try { const payload = await buildHomePayload(c, env); if (env.CACHE) await env.CACHE.put(`home:${c}`, JSON.stringify(payload), { expirationTtl: 3600 }); } catch (_) {}
    });
    await Promise.allSettled(tasks);

    // Stage 3 LEGO queue processor. It has its own hard marketplace-call budget
    // and failures are isolated so it can never break the existing cron jobs.
    try {
      if (env.DB) await runLegoRefreshQueue(env);
    } catch (e) { logErr('lego refresh queue cron', e); }

    // ── Daily "still interested?" emails ──────────────────────────────────
    // The cron fires every 15 min, but we only send in ONE hour of the day so
    // each opted-in user gets at most one email per day. 15:00 UTC ~= 10am ET /
    // 11am ET (good US morning window). Users are only emailed if they opted in
    // AND haven't been emailed in the last 3 days AND have a viewed item.
    try {
      const SEND_HOUR_UTC = 15;
      if (new Date().getUTCHours() === SEND_HOUR_UTC) {
        await sendDailyEmails(env);
      }
    } catch (_) { /* never let email logic break the pre-warmer */ }

    // ── Product SEO pages: staged sitemap rollout (self-scaling) ─────────────
    // A product being "mature" (enough real history to be worth indexing)
    // does NOT mean it goes into the sitemap immediately - new pages are
    // staged in a daily batch instead of all at once, since Google seeing a
    // sudden mass of new pages from one domain reads as a spam signal even
    // when every individual page is good content.
    //
    // Critically, the batch size is NOT a fixed constant forever - it DOUBLES
    // every ROLLOUT_DOUBLING_DAYS, starting from ROLLOUT_BASE_BATCH, up to
    // ROLLOUT_CEILING. A permanently-fixed small batch would take centuries
    // to get through a catalog of millions; this ramps up automatically as
    // the rollout proves itself over time, without needing anyone to
    // remember to go bump a constant.
    const ROLLOUT_BASE_BATCH = 25;
    const ROLLOUT_DOUBLING_DAYS = 14;
    const ROLLOUT_CEILING = 50000;
    const SITEMAP_BATCH_HOUR_UTC = 4;
    try {
      if (env.DB && new Date().getUTCHours() === SITEMAP_BATCH_HOUR_UTC) {
        let state = await env.DB.prepare('SELECT started_at FROM seo_rollout_state WHERE id = 1').first();
        if (!state) {
          const nowIso = new Date().toISOString();
          await env.DB.prepare('INSERT INTO seo_rollout_state (id, started_at) VALUES (1, ?)').bind(nowIso).run();
          state = { started_at: nowIso };
        }
        const daysElapsed = Math.max(0, (Date.now() - new Date(state.started_at).getTime()) / 864e5);
        const doublings = Math.floor(daysElapsed / ROLLOUT_DOUBLING_DAYS);
        const batchSize = Math.min(ROLLOUT_CEILING, Math.round(ROLLOUT_BASE_BATCH * Math.pow(2, doublings)));

        const candidates = await env.DB.prepare(
          `SELECT p.id FROM products p
           WHERE p.slug IS NOT NULL AND p.sitemap_added_at IS NULL
             AND (SELECT COUNT(*) FROM product_price_snapshots s WHERE s.product_id = p.id) >= ?
           LIMIT ?`
        ).bind(PRODUCT_SEO_MIN_SNAPSHOT_DAYS, batchSize).all();
        const nowIso2 = new Date().toISOString();
        for (const row of (candidates.results || [])) {
          try {
            await env.DB.prepare('UPDATE products SET sitemap_added_at = ? WHERE id = ?').bind(nowIso2, row.id).run();
          } catch (e) { logErr('sitemap stage product', e); }
        }
      }
    } catch (e) { logErr('sitemap staging batch', e); }

    // ── Market Watch: demand-tiered price refresh ────────────────────────────
    // Instead of polling every tracked item every 15 min (which capped us at
    // ~15 items on eBay's daily quota), each tick refreshes only a small BATCH
    // of items that are actually DUE, by demand tier:
    //   • explicitly tracked  → every 6h  (4 points/day)
    //   • recently viewed      → daily
    //   • inactive 60d+        → drops out (excluded by the last_viewed window)
    // Each refresh writes an intraday sample + upserts the PERMANENT daily
    // rollup (median / live / avg / max / count — item price only), then
    // schedules its own next refresh. LIMIT 10/tick × 96 ticks ≈ 960 refreshes/
    // day, safely under quota, and supports a few hundred tracked items.
    try {
      if (env.DB) {
        const nowIso = new Date().toISOString();
        const todayStr = nowIso.slice(0, 10);
        const viewWindow = new Date(Date.now() - 60 * 864e5).toISOString();

        // ── Pass 1: canonicalized products, grouped ────────────────────────
        // Several query aliases ("yeezy zebra", "CP9654", "adidas yeezy zebra")
        // can share one product_id - group them so we poll the marketplace and
        // write ONE snapshot per product per tick, not one per alias. This is
        // the fix for the "5 searches = 5 scheduled refreshes for one shoe"
        // quota waste the review flagged.
        const dueProducts = await env.DB.prepare(
          `SELECT product_id, MIN(query) AS query, source,
                  MAX(tracker_count) AS tracker_count,
                  MAX(style_id) AS style_id, MAX(brand) AS brand, MAX(colorway) AS colorway
           FROM tracked_queries
           WHERE product_id IS NOT NULL
             AND (tracker_count > 0 OR (last_viewed IS NOT NULL AND last_viewed >= ?))
             AND (next_refresh_at IS NULL OR next_refresh_at <= ?)
           GROUP BY product_id, source
           ORDER BY (MAX(tracker_count) > 0) DESC, MIN(next_refresh_at) ASC
           LIMIT 6`
        ).bind(viewWindow, nowIso).all();

        for (const row of (dueProducts.results || [])) {
          try {
            const prod = row.style_id ? { styleId: row.style_id, brand: row.brand || '', colorway: row.colorway || '' } : null;
            const s = await trackerSample(row.query, env, ctx, prod);
            const intervalH = Number(row.tracker_count) > 0 ? 6 : 24;
            const nextIso = new Date(Date.now() + intervalH * 3600e3).toISOString();
            const validation = s ? await validateMarketSample(env, row.product_id, row.query, row.source, s) : { accepted:false };
            if (s && validation.accepted) {
              // Authoritative product-keyed rollup - one row per product/day.
              await env.DB.prepare(
                `INSERT INTO product_price_samples (product_id, source, sampled_at, live_price, median_price, avg_price, listing_count, ebay_count, stockx_count, calculation_version)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 2)
                 ON CONFLICT(product_id, source, sampled_at) DO NOTHING`
              ).bind(row.product_id, row.source, nowIso, s.live, s.median, s.avg, s.count, s.ebayCount, s.stockxCount).run();
              await env.DB.prepare(
                `INSERT INTO product_price_snapshots (product_id, source, snapshot_date, min_price, median_price, avg_price, max_price, listing_count, ebay_count, stockx_count, calculation_version)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 2)
                 ON CONFLICT(product_id, source, snapshot_date) DO UPDATE SET
                   min_price = excluded.min_price, median_price = excluded.median_price,
                   avg_price = excluded.avg_price, max_price = excluded.max_price,
                   listing_count = excluded.listing_count,
                   ebay_count = excluded.ebay_count, stockx_count = excluded.stockx_count, calculation_version = 2`
              ).bind(row.product_id, row.source, todayStr, s.live, s.median, s.avg, s.max, s.count, s.ebayCount, s.stockxCount).run();
              // Also write the query-keyed compat tables under the representative
              // alias, so anything still reading the old tables isn't broken.
              await env.DB.prepare(
                `INSERT INTO price_samples (query, source, sampled_at, live_price, median_price, avg_price, listing_count, ebay_count, stockx_count, product_id, calculation_version)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 2)
                 ON CONFLICT(query, source, sampled_at) DO NOTHING`
              ).bind(row.query, row.source, nowIso, s.live, s.median, s.avg, s.count, s.ebayCount, s.stockxCount, row.product_id).run();
              await env.DB.prepare(
                `INSERT INTO price_snapshots (query, source, snapshot_date, min_price, median_price, avg_price, max_price, listing_count, ebay_count, stockx_count, product_id, calculation_version)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 2)
                 ON CONFLICT(query, source, snapshot_date) DO UPDATE SET
                   min_price = excluded.min_price, median_price = excluded.median_price,
                   avg_price = excluded.avg_price, max_price = excluded.max_price,
                   listing_count = excluded.listing_count,
                   ebay_count = excluded.ebay_count, stockx_count = excluded.stockx_count,
                   product_id = COALESCE(excluded.product_id, price_snapshots.product_id), calculation_version = 2`
              ).bind(row.query, row.source, todayStr, s.live, s.median, s.avg, s.max, s.count, s.ebayCount, s.stockxCount, row.product_id).run();
              // Raw observation layer - reuses s.items (already fetched by
              // trackerSample above), no extra marketplace API calls.
              await writePriceObservations(env, row.product_id, row.query, row.source, s.items);
            }
            // Push next_refresh_at for EVERY alias sharing this product_id, not
            // just the representative one - otherwise the other aliases show up
            // as "due" again next tick and we're back to polling per-alias.
            // A poll that returned nothing must NOT get the same cooldown as a
            // successful one. It used to: next_refresh_at jumped a full day
            // either way, so one bad marketplace response cost that product an
            // entire day of history and made a broken sampler look like an idle
            // one. Failures now retry in 90 minutes.
            const retryIso = s
              ? nextIso
              : new Date(Date.now() + 90 * 60 * 1000).toISOString();
            await env.DB.prepare(
              'UPDATE tracked_queries SET last_polled = ?, next_refresh_at = ? WHERE product_id = ? AND source = ?'
            ).bind(nowIso, retryIso, row.product_id, row.source).run();
          } catch (e) { logErr('cron product sampler write', e); }
        }

        // ── Pass 2: non-canonicalized queries (no style code / product match) ──
        // Unchanged per-query polling, exactly as before - this is the honest
        // fallback path for items that can't be canonicalized yet (generic
        // items, categories other than sneakers, etc.).
        const due = await env.DB.prepare(
          `SELECT query, source, tracker_count, style_id, brand, colorway FROM tracked_queries
           WHERE product_id IS NULL
             AND (tracker_count > 0 OR (last_viewed IS NOT NULL AND last_viewed >= ?))
             AND (next_refresh_at IS NULL OR next_refresh_at <= ?)
           ORDER BY (tracker_count > 0) DESC, next_refresh_at ASC
           LIMIT 4`
        ).bind(viewWindow, nowIso).all();

        for (const row of (due.results || [])) {
          try {
            // Reuse the product identity captured when the item was first opened,
            // so the scheduled sample resolves the SAME exact shoe as the live page.
            const prod = row.style_id ? { styleId: row.style_id, brand: row.brand || '', colorway: row.colorway || '' } : null;
            const s = await trackerSample(row.query, env, ctx, prod);
            const intervalH = Number(row.tracker_count) > 0 ? 6 : 24; // tracked vs viewed
            const nextIso = new Date(Date.now() + intervalH * 3600e3).toISOString();
            const validation = s ? await validateMarketSample(env, row.product_id || null, row.query, row.source, s) : { accepted:false };
            if (s && validation.accepted) {
              await env.DB.prepare(
                `INSERT INTO price_samples (query, source, sampled_at, live_price, median_price, avg_price, listing_count, ebay_count, stockx_count, product_id, calculation_version)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 2)
                 ON CONFLICT(query, source, sampled_at) DO NOTHING`
              ).bind(row.query, row.source, nowIso, s.live, s.median, s.avg, s.count, s.ebayCount, s.stockxCount, row.product_id || null).run();
              await env.DB.prepare(
                `INSERT INTO price_snapshots (query, source, snapshot_date, min_price, median_price, avg_price, max_price, listing_count, ebay_count, stockx_count, product_id, calculation_version)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 2)
                 ON CONFLICT(query, source, snapshot_date) DO UPDATE SET
                   min_price = excluded.min_price, median_price = excluded.median_price,
                   avg_price = excluded.avg_price, max_price = excluded.max_price,
                   listing_count = excluded.listing_count,
                   ebay_count = excluded.ebay_count, stockx_count = excluded.stockx_count,
                   product_id = COALESCE(excluded.product_id, price_snapshots.product_id), calculation_version = 2`
              ).bind(row.query, row.source, todayStr, s.live, s.median, s.avg, s.max, s.count, s.ebayCount, s.stockxCount, row.product_id || null).run();
            }
            // Schedule the next refresh regardless (so a query with no results
            // isn't retried every single tick).
            await env.DB.prepare(
              'UPDATE tracked_queries SET last_polled = ?, next_refresh_at = ? WHERE query = ? AND source = ?'
            ).bind(nowIso, nextIso, row.query, row.source).run();
          } catch (e) { logErr('cron sampler write', e); /* one bad query never blocks the rest */ }
        }

        // Prune intraday samples older than 14 days, ~once an hour.
        try {
          if (new Date().getUTCMinutes() < 15) {
            const cutoff = new Date(Date.now() - 14 * 864e5).toISOString();
            await env.DB.prepare('DELETE FROM price_samples WHERE sampled_at < ?').bind(cutoff).run();
          }
        } catch (_) {}
      }
    } catch (_) { /* refresh is best-effort, never break the pre-warmer */ }

    // StockX cache pre-warmer: one popular sneaker term per tick (rotating), so
    // the most common searches always have a hot StockX cache and land in the
    // first render. ~9 API calls per tick, well inside the 25k/day quota.
    try {
      const SX_TERMS = ['yeezy 350', 'jordan 1', 'jordan 4', 'nike dunk', 'air force 1', 'new balance 550', 'yeezy slides', 'jordan 3'];
      const SX_CURRENCIES = ['USD', 'EUR', 'AUD'];
      const tick = Math.floor(Date.now() / 900000); // changes every 15 min
      const term = SX_TERMS[tick % SX_TERMS.length];
      const cur = SX_CURRENCIES[Math.floor(tick / SX_TERMS.length) % SX_CURRENCIES.length];
      await stockxSearch(term, cur, env, 2, ctx);
    } catch (_) { /* warming is best-effort */ }

    // Open Icecat/Product Graph enrichment queue. Four products per 15-minute
    // tick keeps the rollout conservative and never blocks the existing jobs.
    try {
      await FindAIProductGraph.runProductGraphCron(env, ctx, { maxProducts: 4 });
    } catch (e) { logErr('product graph cron', e); }
  },

  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...corsFor(request), 'Access-Control-Max-Age': '86400' } });
    }

    // Every JSON response below is built with the static CORS block. Rather than
    // thread the request through dozens of call sites, patch the header once on
    // the way out so allowlisted origins other than findai.ai still work.
    const withCors = (resp) => {
      try {
        const ct = resp.headers.get('content-type') || '';
        if (!/json/i.test(ct)) return resp;             // HTML pages, images, redirects
        const h = new Headers(resp.headers);
        const c = corsFor(request);
        h.set('Access-Control-Allow-Origin', c['Access-Control-Allow-Origin']);
        h.set('Vary', 'Origin');
        return new Response(resp.body, { status: resp.status, headers: h });
      } catch (_) { return resp; }
    };
    return withCors(await this.handle(request, env, ctx));
  },

  async handle(request, env, ctx) {
    try {
      const url = new URL(request.url);

      // Product Graph/API/media/admin routes are isolated under their own
      // namespaces and return null for every existing FindAI route.
      const productGraphResponse = await FindAIProductGraph.handleProductGraphRoute(request, env, ctx, {
        isAdmin: (req, runtimeEnv) => adminOK(new URL(req.url), runtimeEnv, req),
        logError: logErr
      });
      if (productGraphResponse) return productGraphResponse;

      // ── FindAI Marketplace foundation (backend only) ─────────────────────
      // There is intentionally no marketplace button or Create Listing UI in
      // the deployed HTML. These routes remain off by default and are safe to
      // deploy while the product is still being built in Stripe test mode.
      if (url.pathname === '/marketplace/config' && request.method === 'GET') {
        return jsonResp({ marketplace: mpPublicConfig(env), workerVersion: ENGINE_VERSION }, 200, {
          'Cache-Control': 'public, max-age=60, s-maxage=300'
        });
      }

      if (url.pathname === '/marketplace/quote' && request.method === 'POST') {
        let body = {};
        try { body = await request.json(); } catch (_) {}
        const itemMinor = mpReadMinor(body, 'itemMinor', 'itemPrice', -1);
        const shippingMinor = mpReadMinor(body, 'shippingMinor', 'shipping', 0);
        if (itemMinor < 0 || itemMinor > 1000000000 || shippingMinor < 0 || shippingMinor > 1000000000) {
          return jsonResp({ error: 'Invalid amount' }, 400, { 'Cache-Control': 'no-store' });
        }
        return jsonResp({ quote: mpQuote(env, itemMinor, shippingMinor, body.currency), marketplace: mpPublicConfig(env) }, 200, {
          'Cache-Control': 'no-store'
        });
      }

      if (url.pathname === '/admin/marketplace/setup' && request.method === 'POST') {
        if (!adminOK(url, env, request)) return jsonResp({ error: 'unauthorized' }, 403, { 'Cache-Control': 'no-store' });
        try {
          return jsonResp(await marketplaceSetup(env), 200, { 'Cache-Control': 'no-store' });
        } catch (e) {
          return jsonResp({ error: String(e && e.message || e) }, 500, { 'Cache-Control': 'no-store' });
        }
      }

      if (url.pathname === '/marketplace/seller/apply' && request.method === 'POST') {
        const cfg = marketplaceConfig(env);
        if (!cfg.applicationsEnabled) return jsonResp({ error: 'Seller applications are not open yet' }, 503, { 'Cache-Control': 'no-store' });
        const auth = await requireUser(request, env);
        if (auth.fail) return auth.fail;
        if (!env.DB) return jsonResp({ error: 'Marketplace database is unavailable' }, 503);
        let body = {};
        try { body = await request.json(); } catch (_) {}
        const displayName = String(body.displayName || '').trim().slice(0, 80);
        const country = /^[A-Z]{2}$/.test(String(body.country || '').toUpperCase()) ? String(body.country).toUpperCase() : 'AU';
        const now = new Date().toISOString();
        try {
          const existing = await env.DB.prepare('SELECT id, status FROM marketplace_sellers WHERE user_email = ?').bind(auth.email).first();
          if (existing) return jsonResp({ ok: true, sellerId: existing.id, status: existing.status }, 200, { 'Cache-Control': 'no-store' });
          const id = mpId('sel');
          await env.DB.prepare(
            `INSERT INTO marketplace_sellers
             (id, user_email, display_name, country, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'pending', ?, ?)`
          ).bind(id, auth.email, displayName, country, now, now).run();
          return jsonResp({ ok: true, sellerId: id, status: 'pending' }, 201, { 'Cache-Control': 'no-store' });
        } catch (e) {
          return jsonResp({ error: String(e && e.message || e) }, 500, { 'Cache-Control': 'no-store' });
        }
      }

      if (url.pathname === '/marketplace/me' && request.method === 'GET') {
        const auth = await requireUser(request, env);
        if (auth.fail) return auth.fail;
        if (!env.DB) return jsonResp({ seller: null, marketplace: mpPublicConfig(env) }, 200, { 'Cache-Control': 'no-store' });
        try {
          const seller = await env.DB.prepare(
            `SELECT id, user_email, display_name, country, status, stripe_account_id,
                    stripe_details_submitted, stripe_charges_enabled, stripe_payouts_enabled,
                    risk_level, reserve_bps, created_at, updated_at
             FROM marketplace_sellers WHERE user_email = ?`
          ).bind(auth.email).first();
          return jsonResp({ seller: seller || null, marketplace: mpPublicConfig(env) }, 200, { 'Cache-Control': 'no-store' });
        } catch (e) {
          return jsonResp({ error: String(e && e.message || e) }, 500, { 'Cache-Control': 'no-store' });
        }
      }

      if (url.pathname === '/admin/marketplace/seller/approve' && request.method === 'POST') {
        if (!adminOK(url, env, request)) return jsonResp({ error: 'unauthorized' }, 403, { 'Cache-Control': 'no-store' });
        let body = {};
        try { body = await request.json(); } catch (_) {}
        const email = String(body.email || '').trim().toLowerCase();
        const status = ['approved', 'pending', 'suspended', 'rejected'].includes(String(body.status)) ? String(body.status) : 'approved';
        if (!email) return jsonResp({ error: 'email required' }, 400);
        const now = new Date().toISOString();
        const r = await env.DB.prepare('UPDATE marketplace_sellers SET status = ?, updated_at = ? WHERE user_email = ?')
          .bind(status, now, email).run();
        return jsonResp({ ok: true, status, changed: Number(r && r.meta && r.meta.changes || 0) }, 200, { 'Cache-Control': 'no-store' });
      }

      if (url.pathname === '/marketplace/seller/onboard' && request.method === 'POST') {
        const auth = await requireUser(request, env);
        if (auth.fail) return auth.fail;
        if (!env.DB) return jsonResp({ error: 'Marketplace database is unavailable' }, 503);
        try {
          let seller = await env.DB.prepare('SELECT * FROM marketplace_sellers WHERE user_email = ?').bind(auth.email).first();
          if (!seller || seller.status !== 'approved') return jsonResp({ error: 'Seller approval is required first' }, 403, { 'Cache-Control': 'no-store' });
          let accountId = String(seller.stripe_account_id || '');
          if (!accountId) {
            const account = await mpStripeRequest(env, '/accounts', {
              type: 'express', country: seller.country || 'AU', email: auth.email,
              'capabilities[card_payments][requested]': 'true',
              'capabilities[transfers][requested]': 'true',
              'metadata[findai_seller_id]': seller.id,
              'metadata[findai_user_email]': auth.email
            }, 'findai-seller-' + seller.id);
            accountId = account.id;
            await env.DB.prepare('UPDATE marketplace_sellers SET stripe_account_id = ?, updated_at = ? WHERE id = ?')
              .bind(accountId, new Date().toISOString(), seller.id).run();
          }
          const refreshUrl = String((env && env.MARKETPLACE_ONBOARD_REFRESH_URL) || 'https://findai.ai/?seller_onboarding=refresh');
          const returnUrl = String((env && env.MARKETPLACE_ONBOARD_RETURN_URL) || 'https://findai.ai/?seller_onboarding=complete');
          const link = await mpStripeRequest(env, '/account_links', {
            account: accountId, refresh_url: refreshUrl, return_url: returnUrl, type: 'account_onboarding'
          }, 'findai-account-link-' + seller.id + '-' + Math.floor(Date.now() / 60000));
          return jsonResp({ ok: true, onboardingUrl: link.url, expiresAt: link.expires_at || null, testMode: mpStripeIsTest(env) }, 200, { 'Cache-Control': 'no-store' });
        } catch (e) {
          return jsonResp({ error: String(e && e.message || e) }, Number(e && e.status) || 500, { 'Cache-Control': 'no-store' });
        }
      }

      if (url.pathname === '/marketplace/listings' && request.method === 'POST') {
        const cfg = marketplaceConfig(env);
        if (!cfg.listingApiEnabled) return jsonResp({ error: 'Listing creation is disabled' }, 503, { 'Cache-Control': 'no-store' });
        const auth = await requireUser(request, env);
        if (auth.fail) return auth.fail;
        if (!env.DB) return jsonResp({ error: 'Marketplace database is unavailable' }, 503);
        let body = {};
        try { body = await request.json(); } catch (_) {}
        const seller = await env.DB.prepare('SELECT id, status FROM marketplace_sellers WHERE user_email = ?').bind(auth.email).first();
        if (!seller || seller.status !== 'approved') return jsonResp({ error: 'Approved seller account required' }, 403);
        const title = String(body.title || '').trim().slice(0, 180);
        const itemMinor = mpReadMinor(body, 'itemPriceMinor', 'itemPrice', -1);
        const shippingMinor = mpReadMinor(body, 'shippingMinor', 'shipping', 0);
        if (title.length < 3 || itemMinor < 1 || itemMinor > 1000000000 || shippingMinor < 0) return jsonResp({ error: 'Valid title and price required' }, 400);
        const imageUrls = Array.isArray(body.imageUrls) ? body.imageUrls.map(x => String(x).slice(0, 1000)).filter(x => /^https:\/\//i.test(x)).slice(0, 12) : [];
        const id = mpId('lst'), now = new Date().toISOString();
        await env.DB.prepare(
          `INSERT INTO marketplace_listings
           (id, seller_id, product_id, canonical_key, title, description, category, condition_label,
            currency, item_price_minor, shipping_minor, quantity, status, image_urls_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`
        ).bind(id, seller.id, Number.isInteger(Number(body.productId)) ? Number(body.productId) : null,
          String(body.canonicalKey || '').slice(0, 180), title, String(body.description || '').slice(0, 5000),
          String(body.category || '').slice(0, 80), String(body.condition || '').slice(0, 80),
          mpSafeCurrency(body.currency, cfg.currency), itemMinor, shippingMinor,
          Math.max(1, Math.min(99, Math.round(Number(body.quantity) || 1))), mpJson(imageUrls), now, now).run();
        return jsonResp({ ok: true, listingId: id, status: 'draft', visibleToPublic: false }, 201, { 'Cache-Control': 'no-store' });
      }

      const mpPublishMatch = url.pathname.match(/^\/admin\/marketplace\/listings\/([^/]+)\/status$/);
      if (mpPublishMatch && request.method === 'POST') {
        if (!adminOK(url, env, request)) return jsonResp({ error: 'unauthorized' }, 403, { 'Cache-Control': 'no-store' });
        let body = {};
        try { body = await request.json(); } catch (_) {}
        const status = ['draft', 'active', 'paused', 'removed', 'sold'].includes(String(body.status)) ? String(body.status) : 'draft';
        const now = new Date().toISOString();
        await env.DB.prepare(
          `UPDATE marketplace_listings SET status = ?, updated_at = ?,
           published_at = CASE WHEN ? = 'active' AND published_at IS NULL THEN ? ELSE published_at END
           WHERE id = ?`
        ).bind(status, now, status, now, decodeURIComponent(mpPublishMatch[1])).run();
        return jsonResp({ ok: true, status }, 200, { 'Cache-Control': 'no-store' });
      }

      if (url.pathname === '/marketplace/checkout' && request.method === 'POST') {
        const cfg = marketplaceConfig(env);
        if (!cfg.checkoutEnabled) return jsonResp({ error: 'Marketplace checkout is disabled' }, 503, { 'Cache-Control': 'no-store' });
        const auth = await requireUser(request, env);
        if (auth.fail) return auth.fail;
        if (!env.DB) return jsonResp({ error: 'Marketplace database is unavailable' }, 503);
        if (await rateLimited(env, request, 'marketplace-checkout', 10, 600)) return tooManyResp(600);
        let body = {};
        try { body = await request.json(); } catch (_) {}
        const listingId = String(body.listingId || '').trim();
        if (!listingId) return jsonResp({ error: 'listingId required' }, 400);
        let checkoutOrderId = '';
        try {
          const listing = await env.DB.prepare(
            `SELECT l.*, s.user_email AS seller_email, s.status AS seller_status, s.stripe_account_id
             FROM marketplace_listings l JOIN marketplace_sellers s ON s.id = l.seller_id
             WHERE l.id = ?`
          ).bind(listingId).first();
          if (!listing || listing.status !== 'active' || Number(listing.quantity) < 1) return jsonResp({ error: 'Listing is unavailable' }, 409);
          if (listing.seller_status !== 'approved' || !listing.stripe_account_id) return jsonResp({ error: 'Seller cannot accept payments yet' }, 409);
          if (String(listing.seller_email).toLowerCase() === auth.email) return jsonResp({ error: 'You cannot buy your own listing' }, 400);
          const quote = mpQuote(env, listing.item_price_minor, listing.shipping_minor, listing.currency);
          const orderId = checkoutOrderId = mpId('ord'), now = new Date().toISOString();
          const reserveUntil = new Date(Date.now() + 30 * 60 * 1000).toISOString();
          const reserved = await env.DB.prepare(
            `UPDATE marketplace_listings SET status = 'reserved', reserved_order_id = ?, reserved_until = ?, updated_at = ?
             WHERE id = ? AND status = 'active' AND quantity > 0`
          ).bind(orderId, reserveUntil, now, listing.id).run();
          if (!Number(reserved && reserved.meta && reserved.meta.changes || 0)) {
            return jsonResp({ error: 'Another buyer is already checking out this item' }, 409, { 'Cache-Control': 'no-store' });
          }
          await env.DB.prepare(
            `INSERT INTO marketplace_orders
             (id, listing_id, seller_id, buyer_email, currency, item_subtotal_minor, shipping_minor,
              buyer_fee_minor, seller_fee_minor, platform_gross_minor, seller_net_minor, total_minor,
              status, payout_status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_payment', 'not_started', ?, ?)`
          ).bind(orderId, listing.id, listing.seller_id, auth.email, quote.currency,
            quote.itemMinor, quote.shippingMinor, quote.buyerFeeMinor, quote.sellerFeeMinor,
            quote.platformGrossMinor, quote.sellerNetMinor, quote.buyerTotalMinor, now, now).run();

          const currency = quote.currency.toLowerCase();
          const params = {
            mode: 'payment',
            success_url: String((env && env.MARKETPLACE_CHECKOUT_SUCCESS_URL) || 'https://findai.ai/?marketplace=success&session_id={CHECKOUT_SESSION_ID}'),
            cancel_url: String((env && env.MARKETPLACE_CHECKOUT_CANCEL_URL) || 'https://findai.ai/?marketplace=cancelled'),
            customer_email: auth.email,
            client_reference_id: orderId,
            'metadata[findai_order_id]': orderId,
            'payment_intent_data[metadata][findai_order_id]': orderId,
            'payment_intent_data[application_fee_amount]': quote.platformGrossMinor,
            'payment_intent_data[transfer_data][destination]': listing.stripe_account_id,
            expires_at: Math.floor(Date.now() / 1000) + 1800,
            'line_items[0][quantity]': 1,
            'line_items[0][price_data][currency]': currency,
            'line_items[0][price_data][unit_amount]': quote.itemMinor,
            'line_items[0][price_data][product_data][name]': String(listing.title).slice(0, 120),
          };
          let line = 1;
          if (quote.shippingMinor > 0) {
            params[`line_items[${line}][quantity]`] = 1;
            params[`line_items[${line}][price_data][currency]`] = currency;
            params[`line_items[${line}][price_data][unit_amount]`] = quote.shippingMinor;
            params[`line_items[${line}][price_data][product_data][name]`] = 'Tracked shipping';
            line++;
          }
          if (quote.buyerFeeMinor > 0) {
            params[`line_items[${line}][quantity]`] = 1;
            params[`line_items[${line}][price_data][currency]`] = currency;
            params[`line_items[${line}][price_data][unit_amount]`] = quote.buyerFeeMinor;
            params[`line_items[${line}][price_data][product_data][name]`] = 'FindAI Buyer Protection';
          }
          const idem = (request.headers.get('Idempotency-Key') || '').trim() || ('checkout-' + orderId);
          const session = await mpStripeRequest(env, '/checkout/sessions', params, idem);
          await env.DB.prepare('UPDATE marketplace_orders SET checkout_session_id = ?, updated_at = ? WHERE id = ?')
            .bind(session.id || '', new Date().toISOString(), orderId).run();
          await mpOrderEvent(env, orderId, 'buyer', auth.email, 'checkout_created', { checkoutSessionId: session.id, quote });
          return jsonResp({ ok: true, orderId, checkoutUrl: session.url, quote, testMode: mpStripeIsTest(env) }, 201, { 'Cache-Control': 'no-store' });
        } catch (e) {
          try {
            if (checkoutOrderId) {
              const failNow = new Date().toISOString();
              await env.DB.prepare("UPDATE marketplace_orders SET status = 'payment_failed', updated_at = ? WHERE id = ? AND status = 'pending_payment'").bind(failNow, checkoutOrderId).run();
              await env.DB.prepare("UPDATE marketplace_listings SET status = 'active', reserved_order_id = NULL, reserved_until = NULL, updated_at = ? WHERE reserved_order_id = ?").bind(failNow, checkoutOrderId).run();
            }
          } catch (_) {}
          return jsonResp({ error: String(e && e.message || e) }, Number(e && e.status) || 500, { 'Cache-Control': 'no-store' });
        }
      }

      if (url.pathname === '/marketplace/webhook/stripe' && request.method === 'POST') {
        const raw = await request.text();
        const secret = String((env && env.STRIPE_WEBHOOK_SECRET) || '');
        const signature = request.headers.get('Stripe-Signature') || '';
        if (!await mpVerifyStripeWebhook(raw, signature, secret)) return jsonResp({ error: 'Invalid webhook signature' }, 400, { 'Cache-Control': 'no-store' });
        let event = {};
        try { event = JSON.parse(raw); } catch (_) { return jsonResp({ error: 'Invalid JSON' }, 400); }
        const obj = event && event.data && event.data.object ? event.data.object : {};
        const orderId = String((obj.metadata && obj.metadata.findai_order_id) || obj.client_reference_id || '');
        if (env.DB && orderId) {
          try {
            if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
              const paidNow = new Date().toISOString();
              await env.DB.prepare(
                `UPDATE marketplace_orders SET status = 'paid', payment_intent_id = ?, checkout_session_id = COALESCE(checkout_session_id, ?), updated_at = ? WHERE id = ?`
              ).bind(String(obj.payment_intent || ''), String(obj.id || ''), paidNow, orderId).run();
              await env.DB.prepare(
                `UPDATE marketplace_listings SET status = 'sold', quantity = 0, sold_at = ?, reserved_order_id = NULL, reserved_until = NULL, updated_at = ?
                 WHERE reserved_order_id = ?`
              ).bind(paidNow, paidNow, orderId).run();
              await mpOrderEvent(env, orderId, 'stripe', '', 'payment_completed', { eventId: event.id, paymentIntentId: obj.payment_intent || '' });
              const order = await env.DB.prepare('SELECT * FROM marketplace_orders WHERE id = ?').bind(orderId).first();
              if (order) {
                const now = new Date().toISOString();
                const entries = [
                  ['buyer_payment', Number(order.total_minor), order.currency],
                  ['seller_fee', Number(order.seller_fee_minor), order.currency],
                  ['buyer_fee', Number(order.buyer_fee_minor), order.currency],
                  ['seller_payable', -Number(order.seller_net_minor), order.currency]
                ];
                for (const [kind, amount, currency] of entries) {
                  await env.DB.prepare(
                    `INSERT INTO marketplace_ledger (id, order_id, entry_type, amount_minor, currency, status, stripe_reference, metadata_json, created_at)
                     VALUES (?, ?, ?, ?, ?, 'recorded', ?, ?, ?)`
                  ).bind(mpId('led'), orderId, kind, amount, currency, String(obj.payment_intent || ''), mpJson({ eventId: event.id }), now).run();
                }
              }
            } else if (event.type === 'checkout.session.async_payment_failed' || event.type === 'checkout.session.expired') {
              const failedNow = new Date().toISOString();
              await env.DB.prepare("UPDATE marketplace_orders SET status = 'payment_failed', updated_at = ? WHERE id = ?")
                .bind(failedNow, orderId).run();
              await env.DB.prepare("UPDATE marketplace_listings SET status = 'active', reserved_order_id = NULL, reserved_until = NULL, updated_at = ? WHERE reserved_order_id = ?")
                .bind(failedNow, orderId).run();
              await mpOrderEvent(env, orderId, 'stripe', '', event.type === 'checkout.session.expired' ? 'checkout_expired' : 'payment_failed', { eventId: event.id });
            } else if (event.type === 'charge.dispute.created') {
              await env.DB.prepare("UPDATE marketplace_orders SET status = 'chargeback_open', updated_at = ? WHERE id = ?")
                .bind(new Date().toISOString(), orderId).run();
              await mpOrderEvent(env, orderId, 'stripe', '', 'chargeback_opened', { eventId: event.id, disputeId: obj.id || '' });
            }
          } catch (e) { logErr('marketplace webhook', e); return jsonResp({ error: 'Webhook processing failed' }, 500); }
        }
        return jsonResp({ received: true }, 200, { 'Cache-Control': 'no-store' });
      }

      if (url.pathname === '/marketplace/orders' && request.method === 'GET') {
        const auth = await requireUser(request, env);
        if (auth.fail) return auth.fail;
        if (!env.DB) return jsonResp({ orders: [] }, 200, { 'Cache-Control': 'no-store' });
        try {
          const seller = await env.DB.prepare('SELECT id FROM marketplace_sellers WHERE user_email = ?').bind(auth.email).first();
          const rows = await env.DB.prepare(
            `SELECT o.*, l.title, l.image_urls_json,
                    CASE WHEN o.buyer_email = ? THEN 'buyer' ELSE 'seller' END AS relationship
             FROM marketplace_orders o JOIN marketplace_listings l ON l.id = o.listing_id
             WHERE o.buyer_email = ? OR o.seller_id = ?
             ORDER BY o.created_at DESC LIMIT 100`
          ).bind(auth.email, auth.email, seller ? seller.id : '').all();
          return jsonResp({ orders: rows.results || [] }, 200, { 'Cache-Control': 'no-store' });
        } catch (e) {
          return jsonResp({ error: String(e && e.message || e) }, 500, { 'Cache-Control': 'no-store' });
        }
      }

      const mpShipMatch = url.pathname.match(/^\/marketplace\/orders\/([^/]+)\/ship$/);
      if (mpShipMatch && request.method === 'POST') {
        const auth = await requireUser(request, env);
        if (auth.fail) return auth.fail;
        let body = {};
        try { body = await request.json(); } catch (_) {}
        const tracking = String(body.trackingNumber || '').trim().slice(0, 120);
        const carrier = String(body.carrier || '').trim().slice(0, 80);
        if (!tracking) return jsonResp({ error: 'Tracking number required' }, 400);
        const orderId = decodeURIComponent(mpShipMatch[1]);
        const order = await env.DB.prepare(
          `SELECT o.*, s.user_email AS seller_email FROM marketplace_orders o
           JOIN marketplace_sellers s ON s.id = o.seller_id WHERE o.id = ?`
        ).bind(orderId).first();
        if (!order || String(order.seller_email).toLowerCase() !== auth.email) return jsonResp({ error: 'Order not found' }, 404);
        if (!['paid', 'processing'].includes(String(order.status))) return jsonResp({ error: 'Order cannot be shipped in its current state' }, 409);
        const now = new Date().toISOString();
        await env.DB.prepare(
          `UPDATE marketplace_orders SET status = 'shipped', tracking_number = ?, shipping_carrier = ?, shipped_at = ?, updated_at = ? WHERE id = ?`
        ).bind(tracking, carrier, now, now, orderId).run();
        await mpOrderEvent(env, orderId, 'seller', auth.email, 'marked_shipped', { trackingNumber: tracking, carrier });
        return jsonResp({ ok: true, status: 'shipped' }, 200, { 'Cache-Control': 'no-store' });
      }

      if (url.pathname === '/marketplace/disputes' && request.method === 'POST') {
        const cfg = marketplaceConfig(env);
        if (!cfg.disputesEnabled) return jsonResp({ error: 'Marketplace disputes are disabled' }, 503, { 'Cache-Control': 'no-store' });
        const auth = await requireUser(request, env);
        if (auth.fail) return auth.fail;
        let body = {};
        try { body = await request.json(); } catch (_) {}
        const orderId = String(body.orderId || '').trim();
        const reason = String(body.reasonCode || '').trim();
        const statement = String(body.statement || '').trim().slice(0, 5000);
        if (!orderId || !MARKETPLACE_REASON_CODES.has(reason) || statement.length < 10) return jsonResp({ error: 'Valid order, reason and statement required' }, 400);
        const order = await env.DB.prepare('SELECT * FROM marketplace_orders WHERE id = ? AND buyer_email = ?').bind(orderId, auth.email).first();
        if (!order) return jsonResp({ error: 'Order not found' }, 404);
        if (!['paid', 'processing', 'shipped', 'delivered'].includes(String(order.status))) return jsonResp({ error: 'This order is not eligible for a dispute' }, 409);
        const open = await env.DB.prepare("SELECT id FROM marketplace_disputes WHERE order_id = ? AND status IN ('open','seller_response','under_review') LIMIT 1").bind(orderId).first();
        if (open) return jsonResp({ error: 'An active dispute already exists', disputeId: open.id }, 409);
        const id = mpId('dsp'), now = new Date().toISOString();
        const due = new Date(Date.now() + 3 * 864e5).toISOString();
        await env.DB.prepare(
          `INSERT INTO marketplace_disputes
           (id, order_id, opened_by_email, reason_code, statement, status, response_due_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?)`
        ).bind(id, orderId, auth.email, reason, statement, due, now, now).run();
        await env.DB.prepare("UPDATE marketplace_orders SET status = 'disputed', updated_at = ? WHERE id = ?").bind(now, orderId).run();
        await mpOrderEvent(env, orderId, 'buyer', auth.email, 'dispute_opened', { disputeId: id, reasonCode: reason });
        return jsonResp({ ok: true, disputeId: id, status: 'open', responseDueAt: due }, 201, { 'Cache-Control': 'no-store' });
      }

      const mpEvidenceMatch = url.pathname.match(/^\/marketplace\/disputes\/([^/]+)\/evidence$/);
      if (mpEvidenceMatch && request.method === 'POST') {
        const auth = await requireUser(request, env);
        if (auth.fail) return auth.fail;
        let body = {};
        try { body = await request.json(); } catch (_) {}
        const disputeId = decodeURIComponent(mpEvidenceMatch[1]);
        const evidenceType = String(body.evidenceType || 'note').trim().slice(0, 80);
        const evidenceUrl = String(body.evidenceUrl || '').trim().slice(0, 1200);
        const note = String(body.note || '').trim().slice(0, 5000);
        const dispute = await env.DB.prepare(
          `SELECT d.*, o.buyer_email, s.user_email AS seller_email
           FROM marketplace_disputes d JOIN marketplace_orders o ON o.id = d.order_id
           JOIN marketplace_sellers s ON s.id = o.seller_id WHERE d.id = ?`
        ).bind(disputeId).first();
        if (!dispute || ![String(dispute.buyer_email).toLowerCase(), String(dispute.seller_email).toLowerCase()].includes(auth.email)) return jsonResp({ error: 'Dispute not found' }, 404);
        if (!note && !/^https:\/\//i.test(evidenceUrl)) return jsonResp({ error: 'Evidence note or HTTPS URL required' }, 400);
        const id = mpId('evd');
        await env.DB.prepare(
          `INSERT INTO marketplace_dispute_evidence
           (id, dispute_id, uploaded_by_email, evidence_type, evidence_url, note, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).bind(id, disputeId, auth.email, evidenceType, evidenceUrl, note, new Date().toISOString()).run();
        return jsonResp({ ok: true, evidenceId: id }, 201, { 'Cache-Control': 'no-store' });
      }

      const mpResolveMatch = url.pathname.match(/^\/admin\/marketplace\/disputes\/([^/]+)\/resolve$/);
      if (mpResolveMatch && request.method === 'POST') {
        if (!adminOK(url, env, request)) return jsonResp({ error: 'unauthorized' }, 403, { 'Cache-Control': 'no-store' });
        let body = {};
        try { body = await request.json(); } catch (_) {}
        const resolution = ['buyer_refund', 'seller_release', 'partial_refund', 'closed_no_action'].includes(String(body.resolution)) ? String(body.resolution) : '';
        const refundMinor = Math.max(0, Math.round(Number(body.refundMinor) || 0));
        if (!resolution) return jsonResp({ error: 'Valid resolution required' }, 400);
        const disputeId = decodeURIComponent(mpResolveMatch[1]);
        const dispute = await env.DB.prepare('SELECT * FROM marketplace_disputes WHERE id = ?').bind(disputeId).first();
        if (!dispute) return jsonResp({ error: 'Dispute not found' }, 404);
        const now = new Date().toISOString();
        await env.DB.prepare(
          `UPDATE marketplace_disputes SET status = 'resolved', resolution = ?, refund_minor = ?, resolved_at = ?, updated_at = ? WHERE id = ?`
        ).bind(resolution, refundMinor, now, now, disputeId).run();
        await env.DB.prepare("UPDATE marketplace_orders SET status = ?, updated_at = ? WHERE id = ?")
          .bind(resolution === 'seller_release' ? 'completed' : 'resolved', now, dispute.order_id).run();
        await mpOrderEvent(env, dispute.order_id, 'admin', '', 'dispute_resolved', { disputeId, resolution, refundMinor });
        return jsonResp({ ok: true, resolution, refundMinor, stripeRefundCreated: false }, 200, { 'Cache-Control': 'no-store' });
      }


      // ── sitemap.xml - lists the homepage + every SEO landing page for Google ──
      if (url.pathname === '/sitemap.xml') {
        const today = new Date().toISOString().slice(0, 10);
        let urls = ['https://findai.ai/', 'https://findai.ai/about.html']
          .concat(Object.keys(SEO_PAGES).map(s => `https://findai.ai/${s}`));
        // Product pages: ONLY ones staged into the sitemap by the daily batch
        // job (see scheduled() below) - being mature enough to index doesn't
        // mean a product is in the sitemap yet; new pages are added in a
        // (growing) daily batch over time rather than all at once.
        //
        // AND only when SEO_LIVE is true. Until release, the sitemap advertises
        // only the static site — never an /item/ or /price/ URL — so even a
        // prematurely-staged row can't leak a product page to Google. This is
        // the same gate as the /item/ route, applied to discovery.
        if (env.DB && String(env.SEO_LIVE) === 'true') {
          try {
            const staged = await env.DB.prepare(
              "SELECT slug FROM products WHERE sitemap_added_at IS NOT NULL AND slug IS NOT NULL"
            ).all();
            urls = urls.concat((staged.results || []).map(r => `https://findai.ai/price/${r.slug}`));
          } catch (e) { logErr('sitemap product pages', e); }
        }
        const body = `<?xml version="1.0" encoding="UTF-8"?>\n` +
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
          urls.map(u => `  <url><loc>${u}</loc><lastmod>${today}</lastmod></url>`).join('\n') +
          `\n</urlset>`;
        return new Response(body, {
          headers: { 'content-type': 'application/xml;charset=UTF-8', 'cache-control': 'public, max-age=3600', ...CORS }
        });
      }

      // ── Diagnostic ─ /db-check ─ shows DB state. ADMIN ONLY. ────────────────
      // Previously unauthenticated and returning real user email addresses.
      // Now admin-gated, and it reports counts rather than dumping addresses.
      if (url.pathname === '/db-check') {
        if (!adminOK(url, env, request)) return jsonResp({ error: 'unauthorized' }, 403, { 'Cache-Control': 'no-store' });
        const out = { db_bound: !!env.DB, resend_key: !!env.RESEND_API_KEY, session_secret: !!env.SESSION_SECRET };
        if (env.DB) {
          try {
            const uc = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
            out.user_count = uc ? uc.n : 0;
          } catch (e) { out.users_error = String(e && e.message || e); }
          try {
            const cols = await env.DB.prepare("SELECT name FROM pragma_table_info('users')").all();
            out.users_columns = (cols.results || []).map(c => c.name);
          } catch (e) { out.columns_error = String(e && e.message || e); }
          try {
            const iv = await env.DB.prepare('SELECT COUNT(*) AS n FROM item_views').first();
            out.item_views_count = iv ? iv.n : 0;
          } catch (e) { out.item_views_error = String(e && e.message || e); }
          try {
            // Masked: enough to sanity-check signups without exposing addresses.
            const recent = await env.DB.prepare('SELECT email, notify FROM users ORDER BY created_at DESC LIMIT 5').all();
            out.recent_users = (recent.results || []).map(r => {
              const e = String(r.email || '');
              const at = e.indexOf('@');
              const masked = at > 0 ? e.slice(0, 1) + '***' + e.slice(at) : '***';
              return { email: masked, notify: r.notify };
            });
          } catch (e) { out.recent_error = String(e && e.message || e); }
        }
        return jsonResp(out, 200);
      }

      // ── Cron test (TESTING) ─ /cron-test ────────────────────────────────────
      // Runs the EXACT batch function the daily cron runs, on demand, ignoring
      // the 15:00 UTC clock gate. Add ?force=1 to also ignore the 3-day cooldown
      // (useful right after a manual send). Returns a full report of matched /
      // sent / skipped / errors. Remove this route before production.
      // ── Health check ─ GET /health ─ public, no secrets. Confirms worker + DB. ─
      // ── Programmatic SEO page ─ GET /item/<slug> ─ server-rendered HTML ──────
      // Real crawlable product page: full HTML + JSON-LD baked in server-side.
      // Only marked indexable when it actually has price data (avoids thin pages).
      if (url.pathname.startsWith('/item/')) {
        // ── SEO release gate ────────────────────────────────────────────────
        // Until SEO_LIVE is explicitly "true", these pages do not exist to the
        // public — normal visitors and crawlers get a genuine 404, so there is
        // nothing for Google to crawl or index. A 404 gate is stronger than
        // noindex: noindex still requires the page to be fetched for the crawler
        // to read the directive, whereas this route is simply unavailable.
        //
        // Preview access uses the Authorization header (Bearer <ADMIN_KEY>), NOT
        // a query-string key — URL keys leak into history, logs, analytics and
        // shared links. So you can preview finished pages before release without
        // exposing them. The data endpoint (/lego/data), the refresh queue and
        // the cron pipeline are all unaffected by this gate.
        const seoIsLive = String(env.SEO_LIVE) === 'true';
        let hasPreviewAccess = false;
        try {
          const auth = (request.headers.get('Authorization') || '').trim();
          hasPreviewAccess = !!env.ADMIN_KEY && auth === ('Bearer ' + env.ADMIN_KEY);
        } catch (_) {}
        if (!seoIsLive && !hasPreviewAccess) {
          return new Response('Not found', {
            status: 404,
            headers: {
              'content-type': 'text/plain',
              'Cache-Control': 'no-store',
              'X-Robots-Tag': 'noindex, nofollow'
            }
          });
        }

        let slug = '';
        try { slug = decodeURIComponent(url.pathname.slice(6)).trim(); } catch (_) { slug = ''; }
        // Defence in depth: the slug is attacker-controlled, so allow only
        // characters a real product name needs before it reaches the renderer.
        const query = slug
          .replace(/[-_]+/g, ' ')
          .replace(/[^A-Za-z0-9 .,'&+()/]/g, ' ')
          .replace(/\s+/g, ' ').trim().slice(0, 80);
        if (!query) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
        let listings = [], stats = null, product = null, history = [];
        try {
          const [{ items }, sx, sug] = await Promise.all([
            searchListings(query, '', 'US', env).catch(() => ({ items: [] })),
            stockxSearch(query, 'USD', env, 6, ctx).catch(() => []),
            stockxCatalogSuggest(query, env, 1).catch(() => [])
          ]);
          product = (sug && sug[0]) || null;
          const isNew = (c) => !c || (/new/i.test(c) && !/defect|open box|for parts|parts only/i.test(c));
          let all = items.concat(Array.isArray(sx) ? sx : []).filter(it => isNew(it && it.condition) && !USED_TITLE_RE.test((it && it.title) || '') && !BUNDLE_RE.test((it && it.title) || ''));
          all = exactItemFilter(all, product, query);
          all = dedupeTrackerListings(all);
          all.sort((a, b) => (Number(a && a.price) || Infinity) - (Number(b && b.price) || Infinity));
          const prices = all.map(it => Number(it.price)).filter(p => p > 0);
          if (prices.length) {
            const median = prices.length % 2 ? prices[(prices.length - 1) / 2] : (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2;
            stats = { live: prices[0], median, max: prices[prices.length - 1], avg: prices.reduce((a, b) => a + b, 0) / prices.length, count: prices.length };
          }
          listings = all.slice(0, 12);
          if (env.DB) {
            try {
              const r = await env.DB.prepare("SELECT snapshot_date, min_price, median_price FROM price_snapshots WHERE query = ? AND source = 'all' ORDER BY snapshot_date ASC LIMIT 365").bind(query.toLowerCase()).all();
              history = r.results || [];
            } catch (e) { logErr('seo history read', e); }
          }
        } catch (e) { logErr('seo item build', e); }
        const html = renderSeoItemPage(query, listings, stats, product, history, url);
        const indexable = !!(stats && stats.count);
        return new Response(html, { status: 200, headers: {
          'content-type': 'text/html; charset=utf-8',
          'Cache-Control': 'public, max-age=1800',
          'X-Robots-Tag': indexable ? 'index, follow' : 'noindex, follow'
        }});
      }

      // ── Raw eBay diagnostic ─ ADMIN ONLY ────────────────────────────────────
      // /ebay-raw?q=lego+spongebob  — calls eBay directly and reports the token
      // status, HTTP status, raw count, and the first few titles/prices BEFORE
      // any filtering. This is the ground truth: if rawCount is 0 or there's an
      // auth error here, the problem is the eBay credential or API, not our code.
      if (url.pathname === '/ebay-raw') {
        if (!adminOK(url, env, request)) return jsonResp({ error: 'unauthorized' }, 403, { 'Cache-Control': 'no-store' });
        const q = (url.searchParams.get('q') || '').trim();
        if (!q) return jsonResp({ error: 'Add ?q=search+terms' }, 400);
        const out = {
          query: q,
          ebayClientIdInline: true,   // EBAY_CLIENT_ID is a hardcoded public value
          secretsPresent: { EBAY_CLIENT_SECRET: !!env.EBAY_CLIENT_SECRET }
        };
        try {
          const tok = await getEbayToken(env);
          out.tokenOk = !!tok;
          out.tokenPreview = tok ? (String(tok).slice(0, 12) + '…') : null;
          if (!tok) out.hint = 'No eBay OAuth token. The client credentials are missing or eBay rejected them — this alone empties every grid.';
        } catch (e) { out.tokenError = String(e && e.message || e); }
        try {
          const res = await searchListings(q, '', 'US', env);
          out.searchError = res && res.error ? res.error : null;
          const items = (res && res.items) || [];
          out.rawCount = items.length;
          out.sample = items.slice(0, 6).map(i => ({ title: (i.title || '').slice(0, 70), price: i.price, condition: i.condition, source: i.source || 'ebay' }));
        } catch (e) { out.searchException = String(e && e.message || e); }
        return jsonResp(out, 200, { 'Cache-Control': 'no-store' });
      }

      // ── StockX diagnostic ─ ADMIN ONLY ──────────────────────────────────────
      // /sx-test?q=lego+spongebob+bikini+bottom  — separates "the OAuth token is
      // dead" from "the search terms don't match the StockX product name".
      if (url.pathname === '/sx-test') {
        if (!adminOK(url, env, request)) return jsonResp({ error: 'unauthorized' }, 403, { 'Cache-Control': 'no-store' });
        const q = (url.searchParams.get('q') || '').trim();
        if (!q) return jsonResp({ error: 'Add ?q=some+search+terms' }, 400);
        const out = { query: q, secretsPresent: { STOCKX_API_KEY: !!env.STOCKX_API_KEY, STOCKX_CLIENT_SECRET: !!env.STOCKX_CLIENT_SECRET } };
        try {
          const tok = await getStockxToken(env);
          out.tokenOk = !!tok;
          if (!tok) out.hint = 'No access token. The refresh token in stockx_auth row 1 is missing or expired — re-run /auth/stockx/start with your admin key.';
        } catch (e) { out.tokenError = String(e && e.message || e); }
        try {
          const items = await stockxSearch(q, 'USD', env, 10);
          out.resultCount = Array.isArray(items) ? items.length : 0;
          out.results = (items || []).slice(0, 10).map(i => ({ title: i.title, price: i.price, image: !!(i.image || i.stockxImage), url: i.url }));
        } catch (e) { out.searchError = String(e && e.message || e); }
        return jsonResp(out, 200, { 'Cache-Control': 'no-store' });
      }

      // ── Product router ─ POST /resolve-product ──────────────────────────────
      // The "tracker IS FindAI" routing layer. Given a raw search query, decide
      // whether it maps confidently to a specific product we have a deep tracker
      // experience for. If yes, the frontend sends the user into that experience
      // (chart, market value, scored buy grid) instead of the generic card dump.
      //
      // DETERMINISTIC by design — a lego_sets lookup, not an LLM. "lego ms puff
      // boating school" resolves to set 4982 via the catalogue; "iphone 17" and
      // "best oled tv" resolve to nothing and fall through to generic search.
      // This is what turns the weak conversational search into the strong
      // product-intelligence path for the categories we actually have data for.
      if (url.pathname === '/resolve-product' && request.method === 'POST') {
        let q = '';
        try { const b = await request.json(); q = String(b.query || '').trim(); } catch (_) {}
        const fail = (reason, candidateCount) => jsonResp({
          resolved: false, engineVersion: ENGINE_VERSION,
          reason: reason || 'no_match', candidateCount: candidateCount || 0
        });
        if (!q) return fail('empty_query', 0);

        // Only LEGO has tracker-grade data today. Non-LEGO → generic search.
        const isLego = /\blego\b/i.test(q) || /\bset\s*\d{4,7}\b/i.test(q);
        if (!isLego || !env.DB) return fail('not_lego', 0);

        // Build a successful resolution response with diagnostics.
        const resolveHit = (row, method, confidence, candidateCount) => {
          const bare = String(row.set_id).replace(/-\d+$/, '');
          const slug = String(row.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') + '-' + bare;
          return jsonResp({
            resolved: true,
            engineVersion: ENGINE_VERSION,
            category: 'lego',
            resolutionMethod: method,
            confidence: Math.round(confidence * 100) / 100,
            candidateCount: candidateCount,
            setId: bare,
            name: row.name,
            theme: row.theme,
            year: row.year || null,
            trackerQuery: 'LEGO ' + row.name + ' ' + bare,
            slug,
            // Canonical tracker identity. Passing this through the frontend means
            // /tracker/search does not have to fuzzy-resolve the same set again.
            product: {
              pid: 'lego-' + bare,
              styleId: bare,
              brand: 'LEGO',
              title: 'LEGO ' + String(row.name || ''),
              theme: String(row.theme || ''),
              released: row.year || null
            }
          });
        };

        // ── Browse-intent guard ──────────────────────────────────────────────
        // Words that signal the user is BROWSING a theme/price bracket, not
        // naming one product. These must never resolve to a single set.
        // (Backstop; the ambiguity check below is the real protection.)
        const BROWSE = /\b(cheap|cheapest|best|top|under|below|over|sets?|bundle|lot|job\s*lot|for\s*kids|for\s*adults|christmas|gift|deals?|new\s*releases?|popular|rare|expensive|investment)\b/i;
        // Theme-only queries ("lego star wars", "lego technic") — LEGO + a known
        // theme word and little else — are browse intent, not a product.
        const THEME_ONLY = /^\s*lego\s+(star\s*wars|harry\s*potter|technic|city|creator|ninjago|friends|marvel|icons|architecture|duplo|classic|minecraft|disney|super\s*mario|speed\s*champions|ideas|botanical)\s*$/i;

        try {
          // ── 1) Exact set number → resolve immediately at confidence 1.0 ──────
          const setNo = legoSetNumberFrom(q, '');
          if (setNo) {
            const row = await env.DB.prepare(
              'SELECT set_id, name, theme, year FROM lego_sets WHERE set_id = ? OR set_id = ? LIMIT 1'
            ).bind(setNo, setNo + '-1').first();
            if (row && row.set_id) return resolveHit(row, 'exact_set_number', 1, 1);
            // Query had a set-number shape but it's not in the catalogue → don't
            // guess by name; fall through to name logic only if other terms exist.
          }

          // Distinctive query terms (drop noise + browse words).
          const NOISE = new Set(['lego','set','sets','the','a','an','of','and','new','sealed','used','boxed','complete','genuine','official','building','blocks','brick','bricks']);
          const routerQuery = normalizeLegoQueryAliases(q);
          const terms = routerQuery.split(/\s+/)
            .filter(w => w.length > 2 && !NOISE.has(w));

          // Explicit browse guards.
          if (THEME_ONLY.test(q)) return fail('theme_only_browse', 0);
          if (BROWSE.test(q) && terms.length <= 2) return fail('browse_intent', 0);
          if (!terms.length) return fail('no_distinctive_terms', 0);

          // ── 2) Candidate comparison (rule (a): full distinctive-term coverage)
          // Pull candidates that match ANY distinctive term, then score each by
          // coverage. Cap the pool so a broad term can't scan the whole table.
          const orClauses = terms.map(() => 'LOWER(name) LIKE ?').join(' OR ');
          const binds = terms.map(t => '%' + t + '%');
          const res = await env.DB.prepare(
            `SELECT set_id, name, theme, year FROM lego_sets WHERE ${orClauses} ORDER BY year DESC LIMIT 25`
          ).bind(...binds).all();
          const cands = (res.results || []);
          if (!cands.length) return fail('no_catalogue_match', 0);

          // Score = fraction of distinctive terms present in the name, with a
          // small penalty for extra unmatched words in the candidate's own name
          // (so a long unrelated name can't win on one shared word).
          const scoreOf = (name) => {
            const nm = String(name || '').toLowerCase();
            const nameWords = nm.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
            let hit = 0;
            for (const t of terms) if (nm.includes(t)) hit++;
            const coverage = hit / terms.length;                 // 0..1
            const extra = Math.max(0, nameWords.length - hit);
            const penalty = Math.min(0.15, extra * 0.03);        // capped
            return Math.max(0, coverage - penalty);
          };
          const scored = cands.map(c => ({ c, s: scoreOf(c.name), full: (() => {
            const nm = String(c.name || '').toLowerCase();
            return terms.every(t => nm.includes(t));
          })() })).sort((a, b) => b.s - a.s);

          const fullCoverage = scored.filter(x => x.full);

          // (a) Exactly one candidate covers ALL distinctive terms → resolve.
          if (fullCoverage.length === 1) {
            const conf = Math.min(1, 0.85 + 0.15 * scored[0].s);
            return resolveHit(fullCoverage[0].c, 'unique_full_coverage', conf, cands.length);
          }
          // Multiple full-coverage candidates → genuinely ambiguous → don't route.
          if (fullCoverage.length > 1) return fail('ambiguous_full_coverage', cands.length);

          // (b) No full coverage → resolve ONLY on a conservative, clear-gap score.
          const top = scored[0].s;
          const second = scored[1] ? scored[1].s : 0;
          if (top >= 0.85 && second <= 0.65 && (top - second) >= 0.20) {
            return resolveHit(scored[0].c, 'score_gap', top, cands.length);
          }
          return fail('ambiguous_catalogue_match', cands.length);
        } catch (e) {
          logErr('resolve-product', e);
          return fail('error', 0);
        }
      }

      // ── Product router END ──────────────────────────────────────────────────
      // /bl-price?set=3818  — shows exactly what BrickLink returns for a set, so
      // an auth or set-number problem is visible instead of failing silently.
      // ════════════════════════════════════════════════════════════════════════
      // SEO PRE-COMPUTE PIPELINE — STAGE 1: refresh_queue seed + status
      // Admin-gated. Makes ZERO external API calls. Pure D1 read/write over the
      // existing lego_sets catalogue and the new refresh_queue schedule table.
      // ════════════════════════════════════════════════════════════════════════

      // POST/GET /refresh-queue/seed — copy lego_sets rows into refresh_queue.
      // Idempotent: ON CONFLICT(set_id) DO NOTHING, so reseeding never dupes.
      // Params (all validated & capped):
      //   count   — how many sets to seed this call (1..1000, default 10)
      //   offset  — skip N catalogue rows (>=0, default 0)
      //   mixed=1 — for the acceptance test: pull a spread of recent/mid/old sets
      //             so all three tier assignments are exercised in one small seed
      if (url.pathname === '/refresh-queue/seed') {
        if (!adminOK(url, env, request)) return jsonResp({ error: 'unauthorized' }, 403, { 'Cache-Control': 'no-store' });
        if (!env.DB) return jsonResp({ error: 'No DB bound' }, 500);

        // ---- validate & cap every parameter so no accidental request can seed
        // an unbounded number of rows ----
        const rawCount = parseInt(url.searchParams.get('count') || '10', 10);
        const count = Math.max(1, Math.min(1000, isFinite(rawCount) ? rawCount : 10));
        const rawOffset = parseInt(url.searchParams.get('offset') || '0', 10);
        const offset = Math.max(0, isFinite(rawOffset) ? rawOffset : 0);
        const mixed = url.searchParams.get('mixed') === '1';

        // ---- dynamic, year-relative tier thresholds (never hardcoded) ----
        const nowYear = new Date().getUTCFullYear();
        const tierForYear = (y) => {
          const yr = Number(y);
          if (!isFinite(yr) || yr <= 0) return 'monthly';
          if (yr >= nowYear - 1) return 'daily';        // this year or last year
          if (yr >= nowYear - 5) return 'weekly';        // preceding 2–5 years
          return 'monthly';                              // older
        };
        // Stagger next_refresh_at across the tier's own window so the catalogue
        // never all comes due at once. Returns an ISO string now + random offset.
        const TIER_WINDOW_MS = { daily: 24*60*60*1000, weekly: 7*24*60*60*1000, monthly: 30*24*60*60*1000 };
        const staggeredNext = (tier) => new Date(Date.now() + Math.random() * (TIER_WINDOW_MS[tier] || TIER_WINDOW_MS.monthly)).toISOString();

        try {
          // Select catalogue rows to seed. For the acceptance test, `mixed` pulls
          // a representative spread across the year range so every tier appears.
          let rows;
          if (mixed) {
            const perBucket = Math.max(1, Math.ceil(count / 3));
            const recent = await env.DB.prepare(
              'SELECT set_id, year FROM lego_sets WHERE year >= ? ORDER BY year DESC LIMIT ?'
            ).bind(nowYear - 1, perBucket).all();
            const mid = await env.DB.prepare(
              'SELECT set_id, year FROM lego_sets WHERE year < ? AND year >= ? ORDER BY year DESC LIMIT ?'
            ).bind(nowYear - 1, nowYear - 5, perBucket).all();
            const old = await env.DB.prepare(
              'SELECT set_id, year FROM lego_sets WHERE year < ? ORDER BY year DESC LIMIT ?'
            ).bind(nowYear - 5, perBucket).all();
            rows = [].concat(recent.results || [], mid.results || [], old.results || []).slice(0, count);
          } else {
            const res = await env.DB.prepare(
              'SELECT set_id, year FROM lego_sets ORDER BY set_id LIMIT ? OFFSET ?'
            ).bind(count, offset).all();
            rows = res.results || [];
          }

          if (!rows.length) return jsonResp({ ok: true, added: 0, alreadyPresent: 0, scanned: 0, note: 'No catalogue rows matched.' }, 200, { 'Cache-Control': 'no-store' });

          // Insert idempotently. D1 has no multi-row RETURNING, so we count
          // changes via total_changes before/after per statement in a batch.
          let added = 0;
          const stmts = rows.map(r => {
            const tier = tierForYear(r.year);
            return env.DB.prepare(
              `INSERT INTO refresh_queue (set_id, tier, priority, last_refreshed_at, next_refresh_at, attempts, enabled)
               VALUES (?, ?, 0, NULL, ?, 0, 1)
               ON CONFLICT(set_id) DO NOTHING`
            ).bind(String(r.set_id), tier, staggeredNext(tier));
          });
          const results = await env.DB.batch(stmts);
          for (const rr of results) { added += (rr && rr.meta && rr.meta.changes) ? rr.meta.changes : 0; }

          // Report the tier breakdown of what we just attempted, so the
          // acceptance test can confirm all three tiers were assigned.
          const tierCounts = {};
          for (const r of rows) { const t = tierForYear(r.year); tierCounts[t] = (tierCounts[t] || 0) + 1; }

          return jsonResp({
            ok: true,
            scanned: rows.length,
            added,
            alreadyPresent: rows.length - added,
            tierBreakdown: tierCounts,
            yearRelativeTo: nowYear
          }, 200, { 'Cache-Control': 'no-store' });
        } catch (e) {
          logErr('refresh-queue seed', e);
          return jsonResp({ error: String(e && e.message || e) }, 500);
        }
      }

      // POST/GET /refresh-queue/run — Stage 3 manual acceptance test.
      // Examples:
      //   /refresh-queue/run?set=76417  refresh exactly one queued set
      //   /refresh-queue/run?limit=2    process up to two due rows
      // Admin-only because this route spends marketplace API calls.
      if (url.pathname === '/refresh-queue/run') {
        if (!adminOK(url, env, request)) return jsonResp({ error: 'unauthorized' }, 403, { 'Cache-Control': 'no-store' });
        if (!env.DB) return jsonResp({ error: 'No DB bound' }, 500);
        const rawSet = String(url.searchParams.get('set') || '').trim();
        if (rawSet && !/^\d{3,7}(?:-\d{1,3})?$/.test(rawSet)) {
          return jsonResp({ error: 'invalid_set_number' }, 400, { 'Cache-Control': 'no-store' });
        }
        const rawLimit = parseInt(url.searchParams.get('limit') || '1', 10);
        const limit = Math.max(1, Math.min(10, isFinite(rawLimit) ? rawLimit : 1));
        const rawBudget = parseInt(url.searchParams.get('maxApiCalls') || String(limit * LEGO_REFRESH_CALLS_PER_SET), 10);
        const maxApiCalls = Math.max(LEGO_REFRESH_CALLS_PER_SET, Math.min(Number(env.REFRESH_MAX_API_CALLS) || 50, isFinite(rawBudget) ? rawBudget : limit * LEGO_REFRESH_CALLS_PER_SET));
        try {
          const result = await runLegoRefreshQueue(env, { setId: rawSet || null, limit, maxApiCalls });
          return jsonResp(result, result.ok ? 200 : 500, { 'Cache-Control': 'no-store' });
        } catch (e) {
          logErr('refresh-queue run', e);
          return jsonResp({ ok: false, error: String(e && (e.message || e)) }, 500, { 'Cache-Control': 'no-store' });
        }
      }

      // GET /refresh-queue/status — paginated health + inspection. No writes.
      //   limit  — rows to return (1..200, default 25)
      //   offset — pagination offset (>=0, default 0)
      //   tier   — optional filter: daily|weekly|monthly
      if (url.pathname === '/refresh-queue/status') {
        if (!adminOK(url, env, request)) return jsonResp({ error: 'unauthorized' }, 403, { 'Cache-Control': 'no-store' });
        if (!env.DB) return jsonResp({ error: 'No DB bound' }, 500);

        const rawLimit = parseInt(url.searchParams.get('limit') || '25', 10);
        const limit = Math.max(1, Math.min(200, isFinite(rawLimit) ? rawLimit : 25));
        const rawOffset = parseInt(url.searchParams.get('offset') || '0', 10);
        const qOffset = Math.max(0, isFinite(rawOffset) ? rawOffset : 0);
        const tierFilter = ['daily', 'weekly', 'monthly'].includes(url.searchParams.get('tier') || '') ? url.searchParams.get('tier') : null;

        try {
          const nowIso = new Date().toISOString();
          const summary = {};
          const total = await env.DB.prepare('SELECT COUNT(*) AS c FROM refresh_queue').first();
          summary.totalQueued = (total && total.c) || 0;
          const catTotal = await env.DB.prepare('SELECT COUNT(*) AS c FROM lego_sets').first();
          summary.catalogueTotal = (catTotal && catTotal.c) || 0;
          summary.unseeded = Math.max(0, summary.catalogueTotal - summary.totalQueued);

          const byTier = await env.DB.prepare('SELECT tier, COUNT(*) AS c FROM refresh_queue GROUP BY tier').all();
          summary.byTier = {};
          for (const r of (byTier.results || [])) summary.byTier[r.tier] = r.c;

          const due = await env.DB.prepare('SELECT COUNT(*) AS c FROM refresh_queue WHERE enabled = 1 AND next_refresh_at <= ?').bind(nowIso).first();
          summary.dueNow = (due && due.c) || 0;
          const neverRefreshed = await env.DB.prepare('SELECT COUNT(*) AS c FROM refresh_queue WHERE last_refreshed_at IS NULL').first();
          summary.neverRefreshed = (neverRefreshed && neverRefreshed.c) || 0;
          const withErrors = await env.DB.prepare('SELECT COUNT(*) AS c FROM refresh_queue WHERE attempts > 0').first();
          summary.withErrors = (withErrors && withErrors.c) || 0;
          const disabled = await env.DB.prepare('SELECT COUNT(*) AS c FROM refresh_queue WHERE enabled = 0').first();
          summary.disabled = (disabled && disabled.c) || 0;

          // Page of rows, joined to lego_sets for readable context.
          const where = tierFilter ? 'WHERE q.tier = ?' : '';
          const bind = tierFilter ? [tierFilter, limit, qOffset] : [limit, qOffset];
          const rowsRes = await env.DB.prepare(
            `SELECT q.set_id, q.tier, q.priority, q.last_refreshed_at, q.next_refresh_at,
                    q.attempts, q.last_error, q.enabled, s.name, s.year
             FROM refresh_queue q LEFT JOIN lego_sets s ON s.set_id = q.set_id
             ${where}
             ORDER BY q.next_refresh_at ASC
             LIMIT ? OFFSET ?`
          ).bind(...bind).all();

          return jsonResp({
            ok: true,
            summary,
            page: { limit, offset: qOffset, tier: tierFilter, returned: (rowsRes.results || []).length },
            rows: rowsRes.results || [],
            config: { REFRESH_MAX_API_CALLS: Number(env.REFRESH_MAX_API_CALLS) || 50 }
          }, 200, { 'Cache-Control': 'no-store' });
        } catch (e) {
          logErr('refresh-queue status', e);
          return jsonResp({ error: String(e && e.message || e) }, 500);
        }
      }


      // ════════════════════════════════════════════════════════════════════════
      // LEGO PRE-COMPUTE PIPELINE — STAGE 2: stored-data read endpoint
      // GET /lego/data/:setNumber
      //
      // PUBLIC JSON, but D1/KV ONLY. This route deliberately contains no calls
      // to searchListings, searchEbay, stockxSearch, brGetSet, BrickLink,
      // Rebrickable, fetch(), or any other marketplace/catalogue network path.
      // It is the safe data source for future LEGO pages; it does not render or
      // publish an SEO page by itself.
      // ════════════════════════════════════════════════════════════════════════
      {
        const legoDataMatch = url.pathname.match(/^\/lego\/data\/([^/]+)$/i);
        if (legoDataMatch) {
          if (request.method !== 'GET' && request.method !== 'HEAD') {
            return jsonResp({ error: 'method_not_allowed' }, 405, { 'Allow': 'GET, HEAD', 'Cache-Control': 'no-store' });
          }
          if (!env.DB) return jsonResp({ error: 'database_unavailable' }, 503, { 'Cache-Control': 'no-store' });

          // Accept 76417 and 76417-1, but reject arbitrary text/path injection.
          let requestedSet = '';
          try { requestedSet = decodeURIComponent(legoDataMatch[1] || '').trim(); } catch (_) {}
          if (!/^\d{3,7}(?:-\d{1,3})?$/.test(requestedSet)) {
            return jsonResp({ error: 'invalid_set_number' }, 400, { 'Cache-Control': 'no-store' });
          }
          const baseSet = requestedSet.replace(/-\d+$/, '');
          const setCandidates = [...new Set([requestedSet, baseSet, baseSet + '-1'])];
          const cacheKey = 'lego:data:v2:' + baseSet;

          // KV is only a read-through cache. The source of truth remains D1.
          if (env.CACHE) {
            try {
              const cached = await env.CACHE.get(cacheKey, 'json');
              if (cached && cached.ok && cached.set) {
                const body = JSON.stringify({ ...cached, cache: { hit: true, ttlSeconds: 300 } });
                return new Response(request.method === 'HEAD' ? null : body, {
                  status: 200,
                  headers: { ...corsFor(request), 'Cache-Control': 'public, max-age=60, s-maxage=300', 'Content-Type': 'application/json' }
                });
              }
            } catch (e) { logErr('lego data kv read', e); }
          }

          try {
            const placeholders = setCandidates.map(() => '?').join(',');
            const set = await env.DB.prepare(
              `SELECT set_id, name, year, theme, num_parts, img_url
               FROM lego_sets
               WHERE set_id IN (${placeholders})
               ORDER BY CASE WHEN set_id = ? THEN 0 WHEN set_id = ? THEN 1 ELSE 2 END
               LIMIT 1`
            ).bind(...setCandidates, requestedSet, baseSet).first();

            if (!set) {
              return jsonResp({ ok: false, error: 'set_not_found', setNumber: requestedSet }, 404, {
                'Cache-Control': 'public, max-age=60, s-maxage=300'
              });
            }

            const canonicalSetId = String(set.set_id || baseSet);
            const styleCandidates = [...new Set([canonicalSetId, canonicalSetId.replace(/-\d+$/, ''), baseSet, baseSet + '-1'])];
            const stylePlaceholders = styleCandidates.map(() => '?').join(',');

            // Resolve an existing canonical product without creating or changing data.
            let product = null;
            try {
              product = await env.DB.prepare(
                `SELECT id, canonical_key, product_type, brand, model, style_id, colorway, image_url, slug
                 FROM products
                 WHERE style_id IN (${stylePlaceholders})
                 ORDER BY CASE WHEN style_id = ? THEN 0 ELSE 1 END, id ASC
                 LIMIT 1`
              ).bind(...styleCandidates, baseSet).first();
            } catch (_) { /* products may not exist in an older environment */ }

            // A tracked LEGO query can carry the canonical product id even when the
            // products.style_id representation differs (e.g. 76417 vs 76417-1).
            let trackedLink = null;
            try {
              trackedLink = await env.DB.prepare(
                `SELECT query, product_id, style_id
                 FROM tracked_queries
                 WHERE style_id IN (${stylePlaceholders})
                 ORDER BY CASE WHEN product_id IS NOT NULL THEN 0 ELSE 1 END, last_viewed DESC
                 LIMIT 1`
              ).bind(...styleCandidates).first();
            } catch (_) {}
            const productId = Number((product && product.id) || (trackedLink && trackedLink.product_id)) || null;

            let daily = [];
            let intraday = [];
            let historySource = 'none';

            // Prefer canonical product-keyed history because it cannot fragment
            // across query aliases. Only calculation_version 2 is accepted where
            // the column exists; fallback queries handle older schemas safely.
            if (productId) {
              try {
                const r = await env.DB.prepare(
                  `SELECT snapshot_date, source, min_price, median_price, avg_price, max_price,
                          listing_count, ebay_count, stockx_count, currency
                   FROM product_price_snapshots
                   WHERE product_id = ? AND source = 'all' AND CAST(COALESCE(calculation_version, '1') AS INTEGER) = 2
                   ORDER BY snapshot_date ASC LIMIT 365`
                ).bind(productId).all();
                daily = r.results || [];
              } catch (_) {
                try {
                  const r = await env.DB.prepare(
                    `SELECT snapshot_date, source, min_price, median_price, avg_price, max_price,
                            listing_count, ebay_count, stockx_count, currency
                     FROM product_price_snapshots
                     WHERE product_id = ? AND source = 'all'
                     ORDER BY snapshot_date ASC LIMIT 365`
                  ).bind(productId).all();
                  daily = r.results || [];
                } catch (_) {}
              }
              try {
                const r = await env.DB.prepare(
                  `SELECT sampled_at, source, live_price, median_price, avg_price,
                          listing_count, ebay_count, stockx_count, currency
                   FROM product_price_samples
                   WHERE product_id = ? AND source = 'all' AND CAST(COALESCE(calculation_version, '1') AS INTEGER) = 2
                   ORDER BY sampled_at ASC LIMIT 672`
                ).bind(productId).all();
                intraday = r.results || [];
              } catch (_) {
                try {
                  const r = await env.DB.prepare(
                    `SELECT sampled_at, source, live_price, median_price, avg_price,
                            listing_count, ebay_count, stockx_count, currency
                     FROM product_price_samples
                     WHERE product_id = ? AND source = 'all'
                     ORDER BY sampled_at ASC LIMIT 672`
                  ).bind(productId).all();
                  intraday = r.results || [];
                } catch (_) {}
              }
              if (daily.length || intraday.length) historySource = 'canonical_product';
            }

            // Deterministic query fallback: exact known aliases only. We never use
            // LIKE '%76417%' because that can merge accessories, bundles, or a
            // different product whose text happens to contain the same digits.
            if (!daily.length && !intraday.length) {
              const aliases = [...new Set([
                String((trackedLink && trackedLink.query) || '').trim().toLowerCase(),
                baseSet.toLowerCase(),
                canonicalSetId.toLowerCase(),
                ('lego ' + baseSet).toLowerCase(),
                ('lego ' + canonicalSetId).toLowerCase()
              ].filter(Boolean))];
              const aliasPlaceholders = aliases.map(() => '?').join(',');
              if (aliases.length) {
                try {
                  const r = await env.DB.prepare(
                    `SELECT snapshot_date, source, min_price, median_price, avg_price, max_price,
                            listing_count, ebay_count, stockx_count, currency
                     FROM price_snapshots
                     WHERE lower(query) IN (${aliasPlaceholders}) AND source = 'all'
                       AND CAST(COALESCE(calculation_version, '1') AS INTEGER) = 2
                     ORDER BY snapshot_date ASC LIMIT 365`
                  ).bind(...aliases).all();
                  daily = r.results || [];
                } catch (_) {
                  try {
                    const r = await env.DB.prepare(
                      `SELECT snapshot_date, source, min_price, median_price, avg_price, max_price,
                              listing_count, ebay_count, stockx_count, currency
                       FROM price_snapshots
                       WHERE lower(query) IN (${aliasPlaceholders}) AND source = 'all'
                       ORDER BY snapshot_date ASC LIMIT 365`
                    ).bind(...aliases).all();
                    daily = r.results || [];
                  } catch (_) {}
                }
                try {
                  const r = await env.DB.prepare(
                    `SELECT sampled_at, source, live_price, median_price, avg_price,
                            listing_count, ebay_count, stockx_count, currency
                     FROM price_samples
                     WHERE lower(query) IN (${aliasPlaceholders}) AND source = 'all'
                       AND CAST(COALESCE(calculation_version, '1') AS INTEGER) = 2
                     ORDER BY sampled_at ASC LIMIT 672`
                  ).bind(...aliases).all();
                  intraday = r.results || [];
                } catch (_) {
                  try {
                    const r = await env.DB.prepare(
                      `SELECT sampled_at, source, live_price, median_price, avg_price,
                              listing_count, ebay_count, stockx_count, currency
                       FROM price_samples
                       WHERE lower(query) IN (${aliasPlaceholders}) AND source = 'all'
                       ORDER BY sampled_at ASC LIMIT 672`
                    ).bind(...aliases).all();
                    intraday = r.results || [];
                  } catch (_) {}
                }
                if (daily.length || intraday.length) historySource = 'exact_query_alias';
              }
            }

            let queue = null;
            try {
              queue = await env.DB.prepare(
                `SELECT set_id, tier, priority, last_refreshed_at, next_refresh_at,
                        attempts, last_error, last_error_at, enabled
                 FROM refresh_queue WHERE set_id IN (${stylePlaceholders})
                 ORDER BY CASE WHEN set_id = ? THEN 0 ELSE 1 END LIMIT 1`
              ).bind(...styleCandidates, canonicalSetId).first();
            } catch (_) {}

            const valueOf = (row) => {
              if (!row) return null;
              for (const k of ['median_price', 'live_price', 'avg_price', 'min_price']) {
                const n = Number(row[k]);
                if (Number.isFinite(n) && n > 0) return n;
              }
              return null;
            };
            const latestDaily = daily.length ? daily[daily.length - 1] : null;
            const latestSample = intraday.length ? intraday[intraday.length - 1] : null;
            const currentValue = valueOf(latestSample) || valueOf(latestDaily);
            const currency = String((latestSample && latestSample.currency) || (latestDaily && latestDaily.currency) || 'USD');

            const changeForDays = (days) => {
              if (!(currentValue > 0) || !daily.length) return null;
              const now = Date.now();
              const target = now - days * 86400000;
              let best = null, bestDistance = Infinity;
              for (const row of daily) {
                const t = Date.parse(String(row.snapshot_date || '') + 'T00:00:00Z');
                const v = valueOf(row);
                if (!Number.isFinite(t) || !(v > 0) || t > target + 2 * 86400000) continue;
                const d = Math.abs(t - target);
                if (d < bestDistance) { best = { row, value: v, timestamp: t }; bestDistance = d; }
              }
              if (!best || bestDistance > Math.max(4, Math.ceil(days * 0.35)) * 86400000) return null;
              return {
                days,
                fromDate: best.row.snapshot_date,
                fromValue: best.value,
                absolute: currentValue - best.value,
                percent: ((currentValue - best.value) / best.value) * 100
              };
            };

            const validDailyValues = daily.map(valueOf).filter(v => v > 0);
            const recent30 = daily.filter(r => {
              const t = Date.parse(String(r.snapshot_date || '') + 'T00:00:00Z');
              return Number.isFinite(t) && t >= Date.now() - 30 * 86400000;
            }).map(valueOf).filter(v => v > 0).sort((a, b) => a - b);
            const medianOf = (arr) => arr.length ? (arr.length % 2 ? arr[(arr.length - 1) / 2] : (arr[arr.length / 2 - 1] + arr[arr.length / 2]) / 2) : null;
            const recentMedian = medianOf(recent30);
            const allLow = validDailyValues.length ? Math.min(...validDailyValues) : null;
            const allHigh = validDailyValues.length ? Math.max(...validDailyValues) : null;

            const freshestAt = String((queue && queue.last_refreshed_at) || (latestSample && latestSample.sampled_at) || (latestDaily && latestDaily.snapshot_date) || '');
            const freshnessMs = freshestAt ? Date.now() - Date.parse(freshestAt.length === 10 ? freshestAt + 'T00:00:00Z' : freshestAt) : Infinity;
            const listingCount = Number((latestSample && latestSample.listing_count) || (latestDaily && latestDaily.listing_count) || 0);
            let confidenceScore = 0;
            confidenceScore += Math.min(40, daily.length * 2);
            confidenceScore += Math.min(25, listingCount * 3);
            if (freshnessMs <= 2 * 86400000) confidenceScore += 25;
            else if (freshnessMs <= 8 * 86400000) confidenceScore += 15;
            else if (freshnessMs <= 31 * 86400000) confidenceScore += 5;
            if (historySource === 'canonical_product') confidenceScore += 10;
            confidenceScore = Math.max(0, Math.min(100, Math.round(confidenceScore)));
            const confidenceLabel = confidenceScore >= 75 ? 'high' : confidenceScore >= 45 ? 'medium' : 'low';

            let recommendation = { code: 'insufficient_data', label: 'Insufficient stored data', reason: 'More stored price history is required before making a reliable recommendation.' };
            if (currentValue > 0 && recentMedian > 0 && recent30.length >= 3) {
              const vsRecent = ((currentValue - recentMedian) / recentMedian) * 100;
              if (vsRecent <= -10) recommendation = { code: 'below_recent_market', label: 'Below recent market', reason: `Current stored value is ${Math.abs(vsRecent).toFixed(1)}% below the 30-day median.` };
              else if (vsRecent >= 10) recommendation = { code: 'above_recent_market', label: 'Above recent market', reason: `Current stored value is ${Math.abs(vsRecent).toFixed(1)}% above the 30-day median.` };
              else recommendation = { code: 'near_recent_market', label: 'Near recent market', reason: `Current stored value is within ${Math.abs(vsRecent).toFixed(1)}% of the 30-day median.` };
            }

            const payload = {
              ok: true,
              schemaVersion: 1,
              generatedAt: new Date().toISOString(),
              set: {
                setId: canonicalSetId,
                setNumber: canonicalSetId.replace(/-\d+$/, ''),
                name: set.name || '',
                year: Number(set.year) || null,
                theme: set.theme || '',
                pieces: Number(set.num_parts) || null,
                image: set.img_url || '',
                brand: 'LEGO'
              },
              product: product ? {
                id: product.id,
                styleId: product.style_id || null,
                slug: product.slug || null,
                canonicalKey: product.canonical_key || null
              } : null,
              freshness: queue ? {
                tier: queue.tier,
                priority: Number(queue.priority) || 0,
                lastRefreshedAt: queue.last_refreshed_at || null,
                nextRefreshAt: queue.next_refresh_at || null,
                attempts: Number(queue.attempts) || 0,
                lastError: queue.last_error || null,
                enabled: Number(queue.enabled) !== 0
              } : null,
              market: {
                hasData: !!(currentValue > 0),
                currency,
                currentValue,
                latestMin: latestDaily && Number(latestDaily.min_price) > 0 ? Number(latestDaily.min_price) : null,
                latestMedian: latestDaily && Number(latestDaily.median_price) > 0 ? Number(latestDaily.median_price) : null,
                latestAverage: latestDaily && Number(latestDaily.avg_price) > 0 ? Number(latestDaily.avg_price) : null,
                latestMax: latestDaily && Number(latestDaily.max_price) > 0 ? Number(latestDaily.max_price) : null,
                listingCount,
                observedLow: allLow,
                observedHigh: allHigh,
                recent30DayMedian: recentMedian,
                changes: { day7: changeForDays(7), day30: changeForDays(30), day90: changeForDays(90) },
                confidence: { score: confidenceScore, label: confidenceLabel },
                recommendation
              },
              history: {
                source: historySource,
                daily,
                intraday
              },
              cache: { hit: false, ttlSeconds: 300 },
              guarantees: { storedDataOnly: true, externalApiCalls: 0, rendersSeoPage: false }
            };

            if (env.CACHE) {
              try { await env.CACHE.put(cacheKey, JSON.stringify(payload), { expirationTtl: 300 }); }
              catch (e) { logErr('lego data kv write', e); }
            }
            const body = JSON.stringify(payload);
            return new Response(request.method === 'HEAD' ? null : body, {
              status: 200,
              headers: { ...corsFor(request), 'Cache-Control': 'public, max-age=60, s-maxage=300', 'Content-Type': 'application/json' }
            });
          } catch (e) {
            logErr('lego data endpoint', e);
            return jsonResp({ ok: false, error: 'lego_data_failed' }, 500, { 'Cache-Control': 'no-store' });
          }
        }
      }

      if (url.pathname === '/bl-price') {
        if (!adminOK(url, env, request)) return jsonResp({ error: 'unauthorized' }, 403, { 'Cache-Control': 'no-store' });
        const setNo = (url.searchParams.get('set') || '').trim();
        if (!setNo) return jsonResp({ error: 'Add ?set=3818' }, 400);
        const guideType = url.searchParams.get('type') === 'stock' ? 'stock' : 'sold';
        const out = {
          set: setNo,
          guideType,
          secretsPresent: {
            BL_CONSUMER_KEY: !!env.BL_CONSUMER_KEY, BL_CONSUMER_SECRET: !!env.BL_CONSUMER_SECRET,
            BL_TOKEN: !!env.BL_TOKEN, BL_TOKEN_SECRET: !!env.BL_TOKEN_SECRET
          }
        };
        // Raw call first, so the HTTP status and BrickLink's own message show up.
        const setId = /-\d+$/.test(setNo) ? setNo : (setNo + '-1');
        const rawUrl = 'https://api.bricklink.com/api/store/v1/items/SET/'
          + encodeURIComponent(setId) + '/price?guide_type=' + guideType
          + '&new_or_used=N&currency_code=USD';
        try {
          const auth = await blAuthHeader('GET', rawUrl, env);
          const r = await fetch(rawUrl, { headers: { Authorization: auth, Accept: 'application/json' } });
          out.httpStatus = r.status;
          out.rawBody = (await r.text()).slice(0, 900);
        } catch (e) { out.fetchError = String(e && e.message || e); }
        // Then the parsed helper, so we can see whether dated history came back.
        try {
          const pg = await blPriceGuide(setNo, env, { guideType, condition: 'N', currency: 'USD' });
          out.parsed = pg ? {
            min: pg.min, max: pg.max, avg: pg.avg,
            salesCount: pg.sales.length, datedCount: pg.dated.length,
            hasDatedHistory: pg.hasDatedHistory, chartablePoints: blDailySeries(pg).length
          } : null;
        } catch (e) { out.parseError = String(e && e.message || e); }
        return jsonResp(out, 200, { 'Cache-Control': 'no-store' });
      }

      if (url.pathname === '/health') {
        let db = false;
        try { if (env.DB) { await env.DB.prepare('SELECT 1 AS ok').first(); db = true; } }
        catch (e) { logErr('health db', e); }
        return jsonResp({ ok: true, db, time: new Date().toISOString() }, 200, { 'Cache-Control': 'no-store' });
      }

      // NOTE: the /bl-test and /bs-test diagnostics were removed. They were
      // unauthenticated, echoed upstream API responses straight back to any
      // caller, and burned BrickLink/Brickset quota on request. Re-add them
      // temporarily behind adminOK if you need to debug those integrations.

      if (url.pathname === '/cron-test') {
        if (!adminOK(url, env, request)) return jsonResp({ error: 'unauthorized' }, 403);
        const force = url.searchParams.get('force') === '1';
        try {
          const report = await sendDailyEmails(env, { ignoreCooldown: force });
          return jsonResp({ ok: true, force, report }, 200);
        } catch (e) {
          return jsonResp({ ok: false, error: String(e && e.message || e) }, 500);
        }
      }

      // ── Manual email trigger (TESTING) ─ /run-emails?to=you@email.com ────────
      // Runs the real "still interested?" send for one user on demand, so you
      // don't have to wait for the 15:00 UTC cron. Reports clearly why it did or
      // didn't send. Remove this route before production.
      if (url.pathname === '/run-emails') {
        if (!adminOK(url, env, request)) return jsonResp({ error: 'unauthorized' }, 403);
        if (!env.DB || !env.RESEND_API_KEY) return jsonResp({ error: 'DB or RESEND_API_KEY missing' }, 500);
        const who = (url.searchParams.get('to') || '').trim().toLowerCase();
        if (!who) return jsonResp({ error: 'Add ?to=your@email.com (the logged-in account to test)' }, 400);
        try {
          const u = await env.DB.prepare('SELECT email, name, notify FROM users WHERE email = ?').bind(who).first();
          if (!u) return jsonResp({ sent: false, reason: 'No user with that email in the users table. Log in first.' }, 200);
          if (!u.notify) return jsonResp({ sent: false, reason: 'This account has notify=0. Log in with the "Notify me" box ticked (or opt in) first.' }, 200);
          const top = await env.DB.prepare(
            `SELECT title, price, currency, image, url, source FROM item_views
             WHERE email = ? AND url != '' AND image != '' ORDER BY views DESC, last_viewed DESC LIMIT 1`
          ).bind(who).first();
          if (!top) return jsonResp({ sent: false, reason: 'No tracked item views for this account yet. Click a few items while logged in, then retry.' }, 200);
          let similar = [];
          try {
            const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
            const STOPW = new Set(['the','and','for','with','new','set','box','size','men','mens','womens','women','kids','complete','sealed','retired','edition','rare','vintage','authentic','genuine','original','pcs','piece','pieces']);
            const toks = (s) => norm(s).split(' ').filter(w => w.length >= 3 && !STOPW.has(w) && !/^\d+$/.test(w));
            const topKey = norm(top.title);
            const featTokens = new Set(toks(top.title).slice(0, 10));
            const needShared = featTokens.size >= 2 ? 2 : 1;
            const seen = new Set();
            const res = await searchListings(String(top.title || '').slice(0, 60), '', 'US', env);
            const pool = (res && res.items) ? res.items : [];
            for (const it of pool) {
              if (!it || !it.url || !it.image) continue;
              if (it.url === top.url) continue;
              const k = norm(it.title);
              if (!k || k === topKey) continue;
              if (seen.has(k)) continue;
              const shared = toks(it.title).filter(w => featTokens.has(w)).length;
              if (shared < needShared) continue;
              seen.add(k);
              similar.push(it);
              if (similar.length >= 3) break;
            }
          } catch (_) {}
          const unsubUrl = await unsubUrlFor(env, who);
          const html = buildInterestEmail(top, u.name || '', similar, unsubUrl);
          const first = String(u.name || '').trim().split(/\s+/)[0];
          const subject = first ? `${first}, are you still interested in this?` : `Are you still interested in this?`;
          const r = await sendEmail(env, who, subject, html);
          const body = await r.text();
          return jsonResp({ sent: r.ok, item: top.title, similarCount: similar.length, resend: body }, r.status);
        } catch (e) {
          return jsonResp({ error: String(e && e.message || e) }, 500);
        }
      }

      // ── One-time DB setup ─ visit /db-setup once to create the new tables ──
      // Creates: item_views (per-user engagement), and adds notify/last_emailed
      // columns to users. Safe to run repeatedly. Remove after first run.
      if (url.pathname === '/db-setup') {
        if (!adminOK(url, env, request)) return jsonResp({ error: 'unauthorized' }, 403);
        if (!env.DB) return jsonResp({ error: 'No DB bound' }, 500);
        try {
          await env.DB.prepare(
            `CREATE TABLE IF NOT EXISTS login_tokens (
              token TEXT PRIMARY KEY,
              email TEXT NOT NULL,
              notify INTEGER DEFAULT 0,
              expires TEXT NOT NULL,
              used INTEGER DEFAULT 0
            )`
          ).run();
          // Moved here from /track-search, which was running it on every request.
          await env.DB.prepare(
            `CREATE TABLE IF NOT EXISTS user_searches (
              email TEXT NOT NULL,
              query TEXT NOT NULL,
              count INTEGER DEFAULT 1,
              last_searched TEXT,
              PRIMARY KEY (email, query)
            )`
          ).run();
          await env.DB.prepare(
            `CREATE TABLE IF NOT EXISTS item_views (
              email TEXT NOT NULL,
              item_id TEXT NOT NULL,
              title TEXT,
              price REAL,
              currency TEXT,
              image TEXT,
              url TEXT,
              source TEXT,
              views INTEGER DEFAULT 1,
              last_viewed TEXT,
              PRIMARY KEY (email, item_id)
            )`
          ).run();
          await env.DB.prepare(
            `CREATE TABLE IF NOT EXISTS user_searches (
              email TEXT NOT NULL,
              query TEXT NOT NULL,
              count INTEGER DEFAULT 1,
              last_searched TEXT,
              PRIMARY KEY (email, query)
            )`
          ).run();
          // ── Canonical products layer ────────────────────────────────────
          // One permanent row per real-world product, so "yeezy zebra",
          // "CP9654", and "adidas yeezy zebra" all resolve to the SAME price
          // history instead of three fragmented ones. Additive only — the
          // existing query-based tables are untouched and remain the fallback
          // for anything that can't be canonicalized (no style code, etc.).
          await env.DB.prepare(
            `CREATE TABLE IF NOT EXISTS products (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              canonical_key TEXT NOT NULL UNIQUE,
              product_type TEXT,
              brand TEXT,
              model TEXT,
              style_id TEXT,
              colorway TEXT,
              image_url TEXT,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )`
          ).run();
          // product_price_snapshots / product_price_samples: the AUTHORITATIVE
          // product-keyed history. price_snapshots/price_samples are still
          // written too (query-keyed, for compatibility and non-canonicalized
          // items), but when 5 query aliases share one product_id, THIS table
          // gets exactly one row per day - not five - which is what actually
          // fixes the duplicate-date-in-the-chart problem.
          await env.DB.prepare(
            `CREATE TABLE IF NOT EXISTS product_price_snapshots (
              product_id INTEGER NOT NULL,
              source TEXT NOT NULL,
              snapshot_date TEXT NOT NULL,
              min_price REAL,
              median_price REAL,
              avg_price REAL,
              max_price REAL,
              listing_count INTEGER,
              ebay_count INTEGER,
              stockx_count INTEGER,
              currency TEXT DEFAULT 'USD',
              PRIMARY KEY (product_id, source, snapshot_date)
            )`
          ).run();
          await env.DB.prepare(
            `CREATE TABLE IF NOT EXISTS product_price_samples (
              product_id INTEGER NOT NULL,
              source TEXT NOT NULL,
              sampled_at TEXT NOT NULL,
              live_price REAL,
              median_price REAL,
              avg_price REAL,
              listing_count INTEGER,
              ebay_count INTEGER,
              stockx_count INTEGER,
              currency TEXT DEFAULT 'USD',
              PRIMARY KEY (product_id, source, sampled_at)
            )`
          ).run();
          // seo_rollout_state: single row tracking when the staged SEO-page
          // sitemap rollout started, so the daily batch size can grow over
          // time (see scheduled() below) instead of being frozen at whatever
          // number was reasonable on day one - a fixed small batch forever
          // doesn't scale once there are thousands/millions of candidates.
          await env.DB.prepare(
            `CREATE TABLE IF NOT EXISTS seo_rollout_state (
              id INTEGER PRIMARY KEY CHECK (id = 1),
              started_at TEXT
            )`
          ).run();
          // price_observations: raw per-listing observations for CANONICALIZED
          // products only. product_id is NOT NULL by design - this enforces
          // "canonicalized only" at the schema level rather than trusting every
          // future call site to remember the rule. listing_key + observed_date
          // in the uniqueness constraint prevents the same unchanged listing
          // from being recorded as a new observation on every 6h poll.
          await env.DB.prepare(
            `CREATE TABLE IF NOT EXISTS price_observations (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              product_id INTEGER NOT NULL,
              query TEXT,
              source TEXT NOT NULL,
              listing_key TEXT NOT NULL,
              price REAL NOT NULL,
              currency TEXT DEFAULT 'USD',
              title TEXT,
              observed_date TEXT NOT NULL,
              seen_at TEXT NOT NULL,
              UNIQUE(product_id, source, listing_key, observed_date)
            )`
          ).run();
          await env.DB.prepare(
            `CREATE TABLE IF NOT EXISTS pending_price_changes (
              sample_key TEXT NOT NULL,
              source TEXT NOT NULL DEFAULT 'all',
              candidate_median REAL NOT NULL,
              previous_median REAL,
              listing_count INTEGER DEFAULT 0,
              first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY (sample_key, source)
            )`
          ).run();

          await env.DB.prepare(
            `CREATE TABLE IF NOT EXISTS stockx_auth (
              id INTEGER PRIMARY KEY CHECK (id = 1),
              refresh_token TEXT,
              updated_at TEXT
            )`
          ).run();
          // ── Market Watch tracker tables ──────────────────────────────────
          // tracked_items: per-user "I'm tracking this" record. Many users can
          // share one query/source pair, which is why polling reads from
          // tracked_queries (deduped) instead of looping this table directly.
          await env.DB.prepare(
            `CREATE TABLE IF NOT EXISTS tracked_items (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              email TEXT NOT NULL,
              query TEXT NOT NULL,
              source TEXT DEFAULT 'all',
              created_at TEXT,
              active INTEGER DEFAULT 1,
              UNIQUE(email, query, source)
            )`
          ).run();
          // tracked_queries: ONE row per unique (query, source) actually being
          // polled, regardless of how many users track it. tracker_count is
          // incremented/decremented as users add/remove the same query so the
          // cron only ever calls the marketplace APIs once per unique item.
          await env.DB.prepare(
            `CREATE TABLE IF NOT EXISTS tracked_queries (
              query TEXT NOT NULL,
              source TEXT NOT NULL,
              last_polled TEXT,
              tracker_count INTEGER DEFAULT 1,
              last_viewed TEXT,
              PRIMARY KEY (query, source)
            )`
          ).run();
          // price_snapshots: one row per query/source/day, so a 30D chart is a
          // simple ordered SELECT rather than re-deriving history from raw hits.
          await env.DB.prepare(
            `CREATE TABLE IF NOT EXISTS price_snapshots (
              query TEXT NOT NULL,
              source TEXT NOT NULL,
              snapshot_date TEXT NOT NULL,
              min_price REAL,
              median_price REAL,
              avg_price REAL,
              max_price REAL,
              listing_count INTEGER,
              currency TEXT DEFAULT 'USD',
              PRIMARY KEY (query, source, snapshot_date)
            )`
          ).run();
          // price_samples: intraday samples (last ~14 days, auto-pruned) so the
          // 7D chart moves like a ticker; the daily rollup above is kept forever.
          await env.DB.prepare(
            `CREATE TABLE IF NOT EXISTS price_samples (
              query TEXT NOT NULL,
              source TEXT NOT NULL,
              sampled_at TEXT NOT NULL,
              live_price REAL,
              median_price REAL,
              avg_price REAL,
              listing_count INTEGER,
              PRIMARY KEY (query, source, sampled_at)
            )`
          ).run();
          await env.DB.prepare(
            `CREATE TABLE IF NOT EXISTS price_samples (
              query TEXT NOT NULL,
              source TEXT NOT NULL,
              sampled_at TEXT NOT NULL,
              live_price REAL,
              median_price REAL,
              avg_price REAL,
              listing_count INTEGER,
              currency TEXT DEFAULT 'USD',
              PRIMARY KEY (query, source, sampled_at)
            )`
          ).run();
          // Add columns; ignore "duplicate column" errors on re-run. We report
          // which ones actually applied so /db-setup tells you if a migration was
          // still missing (i.e. it hadn't been run since the last schema change).
          const migrations = [
            "ALTER TABLE users ADD COLUMN notify INTEGER DEFAULT 0",
            "ALTER TABLE users ADD COLUMN last_emailed TEXT",
            "ALTER TABLE tracked_queries ADD COLUMN last_viewed TEXT",
            "ALTER TABLE tracked_queries ADD COLUMN next_refresh_at TEXT",
            "ALTER TABLE tracked_queries ADD COLUMN style_id TEXT",
            "ALTER TABLE tracked_queries ADD COLUMN brand TEXT",
            "ALTER TABLE tracked_queries ADD COLUMN colorway TEXT",
            "ALTER TABLE tracked_queries ADD COLUMN product_id INTEGER",
            "ALTER TABLE products ADD COLUMN slug TEXT",
            "ALTER TABLE products ADD COLUMN sitemap_added_at TEXT",
            "ALTER TABLE price_snapshots ADD COLUMN product_id INTEGER",
            "ALTER TABLE price_samples ADD COLUMN product_id INTEGER",
            "ALTER TABLE price_snapshots ADD COLUMN median_price REAL",
            "ALTER TABLE price_snapshots ADD COLUMN currency TEXT DEFAULT 'USD'",
            "ALTER TABLE price_snapshots ADD COLUMN ebay_count INTEGER",
            "ALTER TABLE price_snapshots ADD COLUMN stockx_count INTEGER",
            "ALTER TABLE price_samples ADD COLUMN median_price REAL",
            "ALTER TABLE price_samples ADD COLUMN currency TEXT DEFAULT 'USD'",
            "ALTER TABLE price_samples ADD COLUMN ebay_count INTEGER",
            "ALTER TABLE price_samples ADD COLUMN stockx_count INTEGER",
            "ALTER TABLE price_snapshots ADD COLUMN calculation_version INTEGER DEFAULT 1",
            "ALTER TABLE price_samples ADD COLUMN calculation_version INTEGER DEFAULT 1",
            "ALTER TABLE product_price_snapshots ADD COLUMN calculation_version INTEGER DEFAULT 1",
            "ALTER TABLE product_price_samples ADD COLUMN calculation_version INTEGER DEFAULT 1"
          ];
          const applied = [];
          for (const col of migrations) {
            try { await env.DB.prepare(col).run(); applied.push(col.split('ADD COLUMN ')[1] || col); } catch (_) {}
          }
          // Indexes on the columns the tracker queries most (safe, speeds reads only).
          for (const idx of [
            "CREATE INDEX IF NOT EXISTS idx_snap_q ON price_snapshots(query, source)",
            "CREATE INDEX IF NOT EXISTS idx_samp_q ON price_samples(query, source)",
            "CREATE INDEX IF NOT EXISTS idx_samp_at ON price_samples(sampled_at)",
            "CREATE INDEX IF NOT EXISTS idx_tq_refresh ON tracked_queries(next_refresh_at)",
            "CREATE INDEX IF NOT EXISTS idx_tq_viewed ON tracked_queries(last_viewed)",
            "CREATE INDEX IF NOT EXISTS idx_products_canonical ON products(canonical_key)",
            "CREATE INDEX IF NOT EXISTS idx_products_slug ON products(slug)",
            "CREATE INDEX IF NOT EXISTS idx_pps_product ON product_price_snapshots(product_id)",
            "CREATE INDEX IF NOT EXISTS idx_ppsamp_product ON product_price_samples(product_id)",
            "CREATE INDEX IF NOT EXISTS idx_pobs_product ON price_observations(product_id)",
            "CREATE INDEX IF NOT EXISTS idx_snap_product ON price_snapshots(product_id)",
            "CREATE INDEX IF NOT EXISTS idx_samp_product ON price_samples(product_id)",
            "CREATE INDEX IF NOT EXISTS idx_tq_product ON tracked_queries(product_id)"
          ]) {
            try { await env.DB.prepare(idx).run(); } catch (e) { logErr('db-setup index', e); }
          }
          const productGraphSetup = await FindAIProductGraph.setupProductGraph(env);
          return jsonResp({
            ok: true,
            message: 'Tables ready',
            migrationsApplied: applied,
            productGraph: productGraphSetup
          }, 200);
        } catch (e) {
          return jsonResp({ error: String(e && e.message || e) }, 500);
        }
      }

      // ── Track a view ─ POST /track-view  body: { email, item } ──────────────
      // Increments engagement for a logged-in user + item. Called by the frontend
      // when a signed-in user opens/clicks an item. Upserts the item snapshot.
      if (url.pathname === '/track-view' && request.method === 'POST') {
        if (!env.DB) return jsonResp({ ok: false }, 200);
        // The email now comes from the signed session, never from the body.
        // Trusting body.email let anyone write rows for any account — and those
        // rows are what the daily cron mails out, so it was a way to send
        // attacker-authored links from our own verified sending domain.
        const auth = await requireUser(request, env);
        if (auth.fail) return auth.fail;
        const email = auth.email;
        let item = null;
        try {
          const body = await request.json();
          item = body && body.item ? body.item : null;
        } catch (_) {}
        if (!item || !item.itemId) return jsonResp({ error: 'item required' }, 400);
        // Cap the stored strings so a single caller can't bloat D1 rows.
        item.title = String(item.title || '').slice(0, 300);
        item.image = String(item.image || '').slice(0, 600);
        item.url = String(item.url || '').slice(0, 800);
        // Only store links to marketplaces we actually search. This is the
        // second line of defence for the email-injection path above.
        if (item.url && !/^https:\/\/([a-z0-9-]+\.)*(ebay|amazon|aliexpress|stockx|discogs|etsy|bricklink|brickset|rebrickable)\.[a-z.]+\//i.test(item.url)) {
          return jsonResp({ ok: false, reason: 'unsupported url' }, 200);
        }
        if (await rateLimited(env, request, 'track-view', 120, 60)) return tooManyResp(60);
        try {
          await env.DB.prepare(
            `INSERT INTO item_views (email, item_id, title, price, currency, image, url, source, views, last_viewed)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
             ON CONFLICT(email, item_id) DO UPDATE SET
               views = item_views.views + 1,
               last_viewed = excluded.last_viewed,
               price = excluded.price,
               image = excluded.image,
               url = excluded.url`
          ).bind(
            email,
            String(item.itemId),
            String(item.title || ''),
            Number(item.price) || 0,
            String(item.currency || 'USD'),
            String(item.image || ''),
            String(item.url || ''),
            String(item.source || ''),
            new Date().toISOString()
          ).run();
          return jsonResp({ ok: true }, 200);
        } catch (e) {
          return jsonResp({ error: String(e && e.message || e) }, 500);
        }
      }

      // ── Track a search ─ POST /track-search  body: { email, query } ──────────
      // Records what a logged-in user searches for, so the daily email can fall
      // back to their top search when they have not clicked any item yet.
      if (url.pathname === '/track-search' && request.method === 'POST') {
        if (!env.DB) return jsonResp({ ok: false }, 200);
        const auth = await requireUser(request, env);
        if (auth.fail) return auth.fail;
        const email = auth.email;
        let query = '';
        try {
          const body = await request.json();
          query = body && body.query ? String(body.query).trim() : '';
        } catch (_) {}
        if (!query || query.length < 2) return jsonResp({ ok: false }, 200);
        query = query.slice(0, 120);
        if (await rateLimited(env, request, 'track-search', 120, 60)) return tooManyResp(60);
        try {
          // The CREATE TABLE that used to run here fired on every single
          // request. It now lives in /db-setup, where it belongs.
          await env.DB.prepare(
            `INSERT INTO user_searches (email, query, count, last_searched)
             VALUES (?, ?, 1, ?)
             ON CONFLICT(email, query) DO UPDATE SET
               count = user_searches.count + 1,
               last_searched = excluded.last_searched`
          ).bind(email, query, new Date().toISOString()).run();
          return jsonResp({ ok: true }, 200);
        } catch (e) {
          return jsonResp({ error: String(e && e.message || e) }, 500);
        }
      }
      // ── Image proxy ─ GET /img?u=<images.stockx.com URL> ────────────────────
      // StockX's image CDN can refuse hotlinked <img> loads from another origin
      // (referrer/hotlink rules), which would leave the tracker showing blank
      // product photos even when the URL is correct. Streaming the bytes through
      // our own worker sidesteps that entirely — the browser loads the image from
      // findai.ai, not stockx.com. Locked to images.stockx.com so it can't be
      // abused as an open proxy. Cached hard (Cloudflare edge + browser, 7d).
      if (url.pathname === '/img') {
        const u = url.searchParams.get('u') || '';
        let ihost = '';
        try { ihost = new URL(u).hostname.toLowerCase(); } catch (_) {}
        const IMG_HOSTS = [
          'images.stockx.com', 'cdn.rebrickable.com', 'img.bricklink.com', 'images.brickset.com',
          'i.ebayimg.com', 'ir.ebaystatic.com', 'thumbs.ebaystatic.com',
          'ae01.alicdn.com', 'ae04.alicdn.com', 'ae-pic-a1.aliexpress-media.com',
          'img.discogs.com', 'i.discogs.com', 'st.discogs.com',
          'i.etsystatic.com', 'img.etsystatic.com'
        ];
        const imgOk = /^https:\/\//i.test(u) && IMG_HOSTS.some(h => ihost === h || ihost.endsWith('.' + h));
        if (!imgOk) {
          return new Response('bad url', { status: 400, headers: CORS });
        }
        const imgReferer = ihost.includes('stockx') ? 'https://stockx.com/'
          : ihost.includes('rebrickable') ? 'https://rebrickable.com/'
          : ihost.includes('brickset') ? 'https://brickset.com/'
          : ihost.includes('bricklink') ? 'https://www.bricklink.com/'
          : (ihost.includes('alicdn') || ihost.includes('aliexpress')) ? 'https://www.aliexpress.com/'
          : ihost.includes('discogs') ? 'https://www.discogs.com/'
          : ihost.includes('etsystatic') ? 'https://www.etsy.com/'
          : ihost.includes('ebay') ? 'https://www.ebay.com/'
          : '';
        try {
          const cache = caches.default;
          const cacheKey = new Request('https://img.cache/v2/' + encodeURIComponent(u));
          let resp = await cache.match(cacheKey);
          if (!resp) {
            const upstream = await fetch(u, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
                'Accept': 'image/avif,image/webp,image/*,*/*;q=0.8',
                ...(imgReferer ? { 'Referer': imgReferer } : {})
              },
              cf: { cacheTtl: 604800, cacheEverything: true }
            });
            if (!upstream.ok) return new Response('not found', { status: 404, headers: CORS });
            resp = new Response(upstream.body, {
              status: 200,
              headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Content-Type': upstream.headers.get('content-type') || 'image/jpeg',
                'Cache-Control': 'public, max-age=604800, immutable'
              }
            });
            ctx.waitUntil(cache.put(cacheKey, resp.clone()));
          }
          return resp;
        } catch (_) {
          return new Response('error', { status: 502, headers: CORS });
        }
      }

      // ── Market Watch: live typeahead ─ GET /tracker/suggest?q=... ────────────
      // ── Data audit ─ GET /tracker/debug?q=<optional> ────────────────────────
      // Read-only. Reports row counts + recent rows for the price tables so we can
      // SEE whether history is actually being recorded, and surfaces any missing-
      // column/table errors (which would mean /db-setup needs re-running). This is
      // how we tell "no history yet" apart from "writes are silently failing".
      if (url.pathname === '/tracker/debug') {
        if (!adminOK(url, env, request)) return jsonResp({ error: 'unauthorized' }, 403, { 'Cache-Control': 'no-store' });
        if (!env.DB) return jsonResp({ error: 'DB binding missing' }, 200, { 'Cache-Control': 'no-store' });
        const q = (url.searchParams.get('q') || '').trim().toLowerCase();
        const out = { now: new Date().toISOString() };
        const one = async (label, sql, binds) => {
          try {
            const st = env.DB.prepare(sql);
            const r = binds ? await st.bind(...binds).all() : await st.all();
            out[label] = r.results || [];
          } catch (e) { out[label] = 'ERR: ' + String(e && e.message || e); }
        };
        const count = async (label, table) => {
          try { const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM ' + table).first(); out[label] = r ? r.n : null; }
          catch (e) { out[label] = 'ERR: ' + String(e && e.message || e); }
        };
        await count('snapshots_total', 'price_snapshots');
        await count('samples_total', 'price_samples');
        await count('tracked_queries_total', 'tracked_queries');
        await one('recent_snapshots', "SELECT query, source, snapshot_date, min_price, median_price, avg_price, max_price, listing_count, ebay_count, stockx_count, currency FROM price_snapshots ORDER BY snapshot_date DESC LIMIT 8");
        await one('recent_samples', "SELECT query, source, sampled_at, live_price, median_price, listing_count, ebay_count, stockx_count, currency FROM price_samples ORDER BY sampled_at DESC LIMIT 8");
        await one('recent_tracked', "SELECT query, source, tracker_count, style_id, brand, colorway, last_viewed, last_polled, next_refresh_at FROM tracked_queries ORDER BY last_viewed DESC LIMIT 10");
        if (q) {
          await one('query_snapshots', "SELECT snapshot_date, median_price, min_price, listing_count, currency FROM price_snapshots WHERE query = ? ORDER BY snapshot_date DESC LIMIT 30", [q]);
          await one('query_samples', "SELECT sampled_at, live_price, median_price, listing_count FROM price_samples WHERE query = ? ORDER BY sampled_at DESC LIMIT 30", [q]);
        }
        return jsonResp(out, 200, { 'Cache-Control': 'no-store' });
      }

      // Catalog-only, no live prices (see stockxCatalogSuggest for why) - this
      // is what powers the dropdown as the user types. Two real catalogs feed
      // it: StockX (sneakers/streetwear, also lists some LEGO but its guessed
      // CDN image URLs don't resolve reliably for non-sneaker products) and
      // your own lego_sets table (Rebrickable catalog, real box-art images) -
      // LEGO results are pulled from lego_sets specifically so the dropdown
      // shows an accurate photo, not a guessed StockX URL that 404s.
      // ── Search-from-SEO-page redirect ─ GET /price-redirect?... ──────────────
      // The SEO page's search bar can't do client-side app navigation (it's a
      // static server-rendered page, not the app), so a search there does a
      // real navigation instead: resolve the picked product to its canonical
      // slug (creating it if new, via the SAME resolveCanonicalProduct used
      // everywhere else) and 302 to that page. Non-canonicalizable queries
      // (no style code) fall back to the main app's search, since there's no
      // /price/:slug page to send them to.
      if (url.pathname === '/price-redirect') {
        const pid = url.searchParams.get('pid') || '';
        const title = url.searchParams.get('title') || '';
        const styleId = url.searchParams.get('styleId') || '';
        const colorway = url.searchParams.get('colorway') || '';
        const brand = url.searchParams.get('brand') || '';
        const q = url.searchParams.get('q') || title;
        if (pid && styleId && env.DB) {
          try {
            const productId = await resolveCanonicalProduct({ pid, title, styleId, colorway, brand }, env);
            if (productId) {
              const row = await env.DB.prepare('SELECT slug FROM products WHERE id = ?').bind(productId).first();
              if (row && row.slug) {
                return new Response(null, { status: 302, headers: { Location: `/price/${row.slug}` } });
              }
            }
          } catch (e) { logErr('price-redirect resolve', e); }
        }
        return new Response(null, { status: 302, headers: { Location: `https://findai.ai/?q=${encodeURIComponent(q)}` } });
      }


      // ── Price Tracker hero cards ─ GET /tracker/ambient ───────────────────
      // DB-only and edge-cached. This endpoint never calls eBay, StockX or
      // BrickLink: it turns products we already track into the small animated
      // live-price cards around the Price Tracker search box.
      if (url.pathname === '/tracker/ambient' && request.method === 'GET') {
        const limit = Math.max(4, Math.min(24, Number(url.searchParams.get('limit')) || 12));
        const country = detectCountry(request);
        const ambientCache = caches.default;
        const ambientKey = new Request(`${url.origin}/__tracker_ambient?v=${ENGINE_VERSION}&c=${country}&n=${limit}`);
        try {
          const hit = await ambientCache.match(ambientKey);
          if (hit) return hit;
        } catch (_) {}
        if (!env.DB) return jsonResp({ items: [], workerVersion: ENGINE_VERSION }, 200, { 'Cache-Control': 'public, max-age=60' });
        try {
          const cr = await env.DB.prepare(
            `SELECT p.id, p.canonical_key, p.product_type, p.brand, p.model, p.style_id,
                    p.colorway, p.image_url, p.updated_at,
                    tq.query, tq.last_viewed, tq.tracker_count,
                    COALESCE(
                      (SELECT ps.live_price FROM product_price_samples ps
                       WHERE ps.product_id=p.id AND ps.source='all' AND ps.live_price>0
                       ORDER BY ps.sampled_at DESC LIMIT 1),
                      (SELECT ss.min_price FROM product_price_snapshots ss
                       WHERE ss.product_id=p.id AND ss.source='all' AND ss.min_price>0
                       ORDER BY ss.snapshot_date DESC LIMIT 1)
                    ) AS live_price
             FROM products p
             LEFT JOIN (
               SELECT product_id, MAX(query) AS query, MAX(last_viewed) AS last_viewed,
                      MAX(COALESCE(tracker_count,0)) AS tracker_count
               FROM tracked_queries WHERE product_id IS NOT NULL GROUP BY product_id
             ) tq ON tq.product_id=p.id
             WHERE COALESCE(p.image_url,'')<>''
               AND COALESCE(p.style_id,'')<>''
               AND EXISTS (SELECT 1 FROM product_price_snapshots s WHERE s.product_id=p.id AND s.source='all')
             ORDER BY COALESCE(tq.tracker_count,0) DESC,
                      COALESCE(tq.last_viewed,p.updated_at) DESC
             LIMIT ?`
          ).bind(limit * 3).all();
          const candidates = (cr.results || []).filter(r => Number(r.live_price) > 0);
          const ids = candidates.map(r => Number(r.id)).filter(Boolean);
          if (!ids.length) return jsonResp({ items: [], workerVersion: ENGINE_VERSION }, 200, { 'Cache-Control': 'public, max-age=120, s-maxage=300' });
          const marks = ids.map(() => '?').join(',');
          const [snapR, sampleR, rates] = await Promise.all([
            env.DB.prepare(
              `SELECT product_id, snapshot_date AS t,
                      COALESCE(median_price,min_price,avg_price) AS v
               FROM product_price_snapshots
               WHERE product_id IN (${marks}) AND source='all'
                 AND COALESCE(median_price,min_price,avg_price)>0
               ORDER BY product_id ASC, snapshot_date DESC`
            ).bind(...ids).all(),
            env.DB.prepare(
              `SELECT product_id, sampled_at AS t,
                      COALESCE(live_price,median_price,avg_price) AS v
               FROM product_price_samples
               WHERE product_id IN (${marks}) AND source='all'
                 AND COALESCE(live_price,median_price,avg_price)>0
               ORDER BY product_id ASC, sampled_at DESC`
            ).bind(...ids).all(),
            getFxRates(env)
          ]);
          const snaps = {}, samples = {};
          for (const r of (snapR.results || [])) {
            const id = Number(r.product_id); if (!snaps[id]) snaps[id] = [];
            if (snaps[id].length < 14) snaps[id].push({ t: r.t, v: Number(r.v) });
          }
          for (const r of (sampleR.results || [])) {
            const id = Number(r.product_id); if (!samples[id]) samples[id] = [];
            if (samples[id].length < 14) samples[id].push({ t: r.t, v: Number(r.v) });
          }
          const fx = fxForCountry(country, rates);
          const items = [];
          for (const r of candidates) {
            const id = Number(r.id);
            // Merge dated snapshots and intraday samples into one chronological
            // series. The previous rail could draw a rising snapshot line but
            // calculate the badge against a newer live sample, making the graph
            // and colour disagree. v22 appends the same live price used by the
            // badge as the final graph point.
            let points = [...(snaps[id] || []), ...(samples[id] || [])]
              .filter(x => Number(x.v) > 0)
              .sort((a, b) => String(a.t || '').localeCompare(String(b.t || '')));
            const dedup = [];
            for (const p of points) {
              const previous = dedup[dedup.length - 1];
              if (!previous || previous.t !== p.t || previous.v !== p.v) dedup.push(p);
            }
            const rawLive = Number(r.live_price) || (dedup.length ? dedup[dedup.length - 1].v : 0);
            if (!rawLive) continue;
            if (!dedup.length || Math.abs(Number(dedup[dedup.length - 1].v) - rawLive) > 0.005) {
              dedup.push({ t: new Date().toISOString(), v: rawLive });
            }
            let graph = (dedup.length ? dedup : [{ v: rawLive }, { v: rawLive }])
              .slice(-12)
              .map(x => Number((Number(x.v) * fx.rate).toFixed(2)));
            if (graph.length === 1) graph.push(graph[0]);
            const first = graph[0] || rawLive * fx.rate;
            const live = graph[graph.length - 1] || Number((rawLive * fx.rate).toFixed(2));
            const pct = first > 0 ? ((live - first) / first) * 100 : 0;
            const title = [r.brand, r.model].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim() || r.query || r.style_id;
            const pid = r.canonical_key || ((String(r.brand || '').toUpperCase() === 'LEGO') ? ('lego:' + r.style_id) : String(r.id));
            items.push({
              id, title, image: r.image_url || '', price: live,
              currency: fx.currency, symbol: fx.symbol,
              changePct: Number(pct.toFixed(1)), history: graph,
              product: {
                pid, styleId: r.style_id || '', title,
                colorway: r.colorway || '', brand: r.brand || '',
                image: r.image_url || '', image2: ''
              }
            });
            if (items.length >= limit) break;
          }
          const resp = jsonResp({ items, fx, workerVersion: ENGINE_VERSION }, 200, {
            'Cache-Control': 'public, max-age=120, s-maxage=300'
          });
          try { if (ctx && ctx.waitUntil) ctx.waitUntil(ambientCache.put(ambientKey, resp.clone())); } catch (_) {}
          return resp;
        } catch (e) {
          logErr('tracker/ambient', e);
          return jsonResp({ items: [], workerVersion: ENGINE_VERSION }, 200, { 'Cache-Control': 'no-store' });
        }
      }

      if (url.pathname === '/tracker/suggest') {
        const q = (url.searchParams.get('q') || '').trim().slice(0, 60);
        if (q.length < 2) return jsonResp({ suggestions: [] }, 200);
        const qNorm = normalizeLegoQueryAliases(q) || q.toLowerCase().replace(/\s+/g, ' ').trim();
        const suggestCache = caches.default;
        const suggestKey = new Request(`${url.origin}/__tracker_suggest?v=${ENGINE_VERSION}&q=${encodeURIComponent(qNorm)}`);
        try {
          const hit = await suggestCache.match(suggestKey);
          if (hit) return hit;
        } catch (_) {}
        try {
          const explicitLego = /\blego\b/i.test(q);
          let suggestions = [];
          const sets = await fastLegoCatalogSuggest(q, env, 10);
          if (sets.length || explicitLego) {
            suggestions = sets.map(s => {
              const sid = bareLegoSetId(s.set_id);
              return {
                pid: 'lego:' + sid,
                title: `LEGO ${s.theme ? s.theme + ' ' : ''}${s.name} Set ${sid}`.replace(/\s+/g, ' ').trim(),
                styleId: sid,
                colorway: '', brand: 'LEGO', urlKey: '',
                image: s.img_url || '', image2: '',
                theme: s.theme || '', pieces: Number(s.num_parts) || null,
                released: Number(s.year) || null
              };
            });

            const missing = suggestions.filter(p => !p.image).slice(0, 3);
            if (missing.length && ctx && ctx.waitUntil) {
              ctx.waitUntil(Promise.allSettled(missing.map(async p => {
                let image = '';
                const bs = await promiseWithin(brGetSet(p.styleId, env), 1800, null);
                if (bs && bs.image) image = bs.image;
                if (!image) image = await promiseWithin(ebayImageFor('lego ' + p.styleId, env), 1800, '');
                if (image) await persistLegoImage(p.styleId, image, env);
              })));
            }
          } else {
            const sx = await promiseWithin(stockxCatalogSuggest(q, env, 10), 2200, []);
            suggestions = Array.isArray(sx) ? sx.slice(0, 10) : [];
          }
          const resp = jsonResp({ suggestions, workerVersion: ENGINE_VERSION }, 200, {
            'Cache-Control': 'public, max-age=120, s-maxage=600'
          });
          try { if (ctx && ctx.waitUntil) ctx.waitUntil(suggestCache.put(suggestKey, resp.clone())); } catch (_) {}
          return resp;
        } catch (e) {
          logErr('tracker/suggest', e);
          return jsonResp({ suggestions: [], workerVersion: ENGINE_VERSION }, 200, { 'Cache-Control': 'no-store' });
        }
      }

      // ── Market Watch: look up an item ─ POST /tracker/search ────────────────
      // body: { query, product? } - product is the exact suggestion the user
      // clicked (pid/styleId/colorway/image from /tracker/suggest), if any.
      // Runs a live cross-marketplace search (reusing the same searchListings +
      // stockxSearch used everywhere else) and returns today's stats plus
      // whatever price_snapshots history already exists for this query. This is
      // called every time someone OPENS the tracker page for an item — it does
      // NOT by itself start daily polling (see /tracker/add for that).
      // Country is hard-locked to 'US' here (matching the daily cron poll) so a
      // live check and the stored history are always in the same currency -
      // otherwise a visitor detected in another country would see today's
      // numbers in a different currency than yesterday's snapshot.
      if (url.pathname === '/tracker/search' && request.method === 'POST') {
        let query = '', product = null;
        try {
          const body = await request.json();
          query = body && body.query ? String(body.query).trim().slice(0, 120) : '';
          product = body && body.product && body.product.pid ? {
            pid: String(body.product.pid).slice(0, 60),
            styleId: String(body.product.styleId || '').slice(0, 40),
            title: String(body.product.title || '').slice(0, 160),
            colorway: String(body.product.colorway || '').slice(0, 80),
            brand: String(body.product.brand || '').slice(0, 40),
            theme: String(body.product.theme || '').slice(0, 80),
            urlKey: String(body.product.urlKey || '').slice(0, 120),
            image: String(body.product.image || '').slice(0, 300),
            image2: String(body.product.image2 || '').slice(0, 300),
            pieces: Number(body.product.pieces) || null,
            released: Number(body.product.released) || null,
            retired: String(body.product.retired || '').slice(0, 10),
            rrp: Number(body.product.rrp) || null,
            minifigures: Number(body.product.minifigures) || null
          } : null;
        } catch (_) {}
        if (!query) return jsonResp({ error: 'Missing query' }, 400);
        const trackerCountry = detectCountry(request);
        const trackerCache = caches.default;
        const trackerIdentity = product && product.styleId ? String(product.styleId) : query.toLowerCase();
        const trackerCacheKey = new Request(`${url.origin}/__tracker?v=${ENGINE_VERSION}&p=${encodeURIComponent(trackerIdentity)}&c=${trackerCountry}`);
        try {
          const cachedTracker = await trackerCache.match(trackerCacheKey);
          if (cachedTracker) return cachedTracker;
        } catch (_) {}

        // A clicked LEGO suggestion can occasionally arrive without styleId
        // (for example a StockX/fallback suggestion). That is not a cache issue:
        // without a canonical set number the enrichment block below cannot query
        // lego_sets, BrickLink or Brickset. Resolve the full product title here and
        // recover the exact set identity before enrichment. Only accept an exact,
        // single-set match so broad searches such as "lego star wars" are never
        // arbitrarily assigned to the first catalogue result.
        if (/\blego\b/i.test(query) && (!product || !product.styleId)) {
          try {
            const lr = await resolveLegoSets(query, env);
            if (lr && lr.mode === 'exact' && Array.isArray(lr.sets) && lr.sets.length === 1) {
              const ls = lr.sets[0];
              product = Object.assign({}, product || {}, {
                pid: (product && product.pid) || ('lego-' + String(ls.set_id)),
                styleId: String(ls.set_id),
                brand: 'LEGO',
                title: 'LEGO ' + String(ls.name || query),
                image: (product && product.image) || String(ls.img_url || ''),
                theme: ls.theme || '',
                pieces: ls.num_parts || null,
                released: ls.year || null
              });
            }
          } catch (e) { logErr('tracker lego identity recovery', e); }
        }
        // Enrich LEGO products with catalog facts we already store (pieces,
        // release year, theme). RRP / retired / minifigures need a Brickset
        // import; they'll populate here automatically once those columns exist.
        if (product && /lego/i.test(product.brand || '') && product.styleId) {
          try {
            const _legoStyle = String(product.styleId).replace(/-\d+$/, '');
            const lrow = await env.DB.prepare(
              'SELECT num_parts, year, theme FROM lego_sets WHERE set_id = ? OR set_id = ? LIMIT 1'
            ).bind(_legoStyle, _legoStyle + '-1').first();
            if (lrow) {
              if (lrow.num_parts) product.pieces = lrow.num_parts;
              if (lrow.year) product.released = lrow.year;
              if (lrow.theme) product.theme = lrow.theme;
            }
          } catch (_) {}
          // Optional external catalogue enrichment runs in parallel and has a
          // strict latency budget. D1 already supplies the identity required for
          // accurate search, so a cold BrickLink/Brickset call must never delay the
          // product page for tens of seconds.
          const ext = await promiseWithin(Promise.all([
            Promise.resolve(blGetSet(product.styleId, env)).catch(() => null),
            Promise.resolve(brGetSet(product.styleId, env)).catch(() => null)
          ]), 900, [null, null]);
          const bl = ext && ext[0], bs = ext && ext[1];
          if (bl) {
            if (bl.released) product.released = bl.released;
            if (bl.retired === true) product.retired = 'Yes';
            if (bl.image) {
              const prevImg = product.image;
              product.image = bl.image;
              if (prevImg && prevImg !== bl.image) product.image2 = prevImg;
            }
          }
          if (bs) {
            if (bs.image) {
              const prevImg = product.image;
              product.image = bs.image;
              if (prevImg && prevImg !== bs.image) product.image2 = prevImg;
            }
            if (bs.rrp) product.rrp = bs.rrp;
            if (bs.minifigs) product.minifigures = bs.minifigs;
            if (bs.pieces) product.pieces = bs.pieces;
            if (bs.released) product.released = bs.released;
            if (bs.retired === true) product.retired = 'Yes';
            else if (bs.retired === false) product.retired = 'No';
          }
        }
        // ── Canonical product resolution (dual-write) ───────────────────────
        // If this search resolved to a real style code, get/create its
        // permanent products.id now. If not (generic text search), fall back
        // to whatever product_id this exact query string was already linked
        // to on a previous view - so history still consolidates over time
        // even without re-picking the suggestion every visit.
        let productId = null;
        try {
          if (product && product.styleId) {
            productId = await resolveCanonicalProduct(product, env);
          } else if (env.DB) {
            const linked = await env.DB.prepare(
              'SELECT product_id FROM tracked_queries WHERE query = ? AND source = ?'
            ).bind(query.toLowerCase(), 'all').first();
            if (linked && linked.product_id) productId = linked.product_id;
          }
        } catch (e) { logErr('tracker product resolve', e); }
        try {
          const trackerSetNo = legoSetNumberFrom(query, product && (product.styleId || product.setNumber));
          const trackerIsLego = /\blego\b/i.test(query) || (product && /lego/i.test(String(product.brand || '')));
          let items = [], sx = [];
          if (trackerIsLego && trackerSetNo) {
            // Exact LEGO tracking does not need the full generic engine's broad
            // fallbacks and 13-market sweep. Two exact US queries are enough to
            // find the set, and they run in parallel with a short StockX budget.
            const exactQueries = [...new Set([
              'lego ' + trackerSetNo,
              product && product.title ? (product.title + ' ' + trackerSetNo) : query
            ].map(v => String(v || '').replace(/\s+/g, ' ').trim()).filter(Boolean))];
            const [ebayRuns, sxFast] = await Promise.all([
              promiseWithin(Promise.allSettled(exactQueries.map(qx => searchEbay(qx, 'US', '', env, false))), 6500, []),
              promiseWithin(stockxSearch('lego ' + trackerSetNo, 'USD', env, 4, ctx), 1800, [])
            ]);
            const seen = new Set();
            for (const r of (ebayRuns || [])) {
              const arr = r && r.status === 'fulfilled' && r.value && Array.isArray(r.value.items) ? r.value.items : [];
              for (const it of arr) {
                const k = String(it.itemId || it.url || it.title || '');
                if (!k || seen.has(k)) continue;
                seen.add(k); items.push(it);
              }
            }
            sx = Array.isArray(sxFast) ? sxFast : [];
          } else {
            const pair = await Promise.all([
              promiseWithin(searchListings(query, '', 'US', env), 8500, { items: [] }),
              promiseWithin(stockxSearch(query, 'USD', env, 6, ctx), 1800, [])
            ]);
            items = pair[0] && Array.isArray(pair[0].items) ? pair[0].items : [];
            sx = Array.isArray(pair[1]) ? pair[1] : [];
          }

          // ── NEW condition only ────────────────────────────────────────────
          // A price tracker's time series is only meaningful if every point is
          // the same condition — mixing new and used prices makes the min/avg/max
          // and the chart noise. StockX/AliExpress are inherently new/deadstock;
          // eBay is mixed, so we keep only its NEW listings. Items with no stated
          // condition (non-eBay sources) are treated as new. "New with defects" /
          // "open box" / "for parts" are excluded.
          const isNew = (c) => {
            if (!c) return true;
            return /new/i.test(c) && !/defect|open box|for parts|parts only/i.test(c);
          };
          const allRaw = items.concat(Array.isArray(sx) ? sx : []);
          let all = allRaw.filter(it => isNew(it && it.condition) && !USED_TITLE_RE.test((it && it.title) || '') && !BUNDLE_RE.test((it && it.title) || ''));

          // ── Drop junk so the graph doesn't record garbage from day one ─────
          // For sneaker queries, AliExpress is wall-to-wall replicas ($5–40 pairs
          // tagged "new") — exclude it entirely. Then a median-relative floor
          // removes any remaining accessory/box/replica outlier priced far below
          // the typical listing (self-calibrating, no hard-coded number).
          if (TRACKER_SNEAKER_RE.test(query)) {
            all = all.filter(it => !/aliexpress|ali\s*express/i.test((it && it.source) || ''));
          }
          {
            const pr = all.map(i => Number(i.price)).filter(p => p > 0).sort((a, b) => a - b);
            if (pr.length >= 4) {
              const floor = pr[Math.floor(pr.length / 2)] * 0.2; // <20% of typical = not the real product
              all = all.filter(it => !(Number(it.price) > 0 && Number(it.price) < floor));
            }
          }

          // Exact item only: match the picked product's style code where present,
          // otherwise strip kids/infant/variant sizes. Everything shown — the
          // Live Price, the buy grid, the chart floor — is now the SAME item.
          all = exactItemFilter(all, product, query);
          all = dedupeTrackerListings(all);

          // LEGO-only image normalization: StockX frequently supplies missing or
          // unstable product-image URLs for LEGO. The canonical Brickset image has
          // already been resolved into product.image above, so use that same clean
          // catalogue image on every StockX LEGO listing card. Preserve the original
          // StockX image separately for diagnostics/fallbacks, but do not let it
          // replace the reliable LEGO catalogue photo returned to the frontend.
          const isLegoProduct = !!(product && (/lego/i.test(product.brand || '') || /^lego[-_]/i.test(product.pid || '')));
          const legoCatalogueImage = isLegoProduct && product && product.image ? String(product.image) : '';
          if (legoCatalogueImage) {
            all = all.map(it => {
              const isStockX = !!(it && (it.stockx || it._stockx || /stockx/i.test(it.source || '')));
              if (!isStockX) return it;
              return {
                ...it,
                originalStockxImage: it.stockxImage || it.image || '',
                image: legoCatalogueImage,
                stockxImage: legoCatalogueImage
              };
            });
          }

          // Sort ascending by price so the cheapest is FIRST everywhere — the
          // Live Price stat, the leftmost buy card, and the "Best Price" badge
          // all read the exact same number. Priced items first, unpriced last.
          all.sort((a, b) => (Number(a && a.price) || Infinity) - (Number(b && b.price) || Infinity));

          // Gate BEFORE computing headline stats. Previously the live price came
          // from the raw list while the grid used the cleaned list, so a rejected
          // £188 minifig lot or counterfeit could set "Live Price" and the deal
          // score even though nothing at that price was buyable on the page. The
          // headline number must come from the same listings we actually show.
          const isLegoQuery = /\blego\b/i.test(query) || (product && /lego/i.test(String(product.brand || '')));
          const sharedSetNo = legoSetNumberFrom(query, product && (product.styleId || product.setNumber));
          const sharedLegoData = (isLegoQuery && sharedSetNo)
            ? await Promise.all([
                promiseWithin(blPriceGuide(sharedSetNo, env, { guideType: 'sold', condition: 'N', currency: 'USD' }), 1400, null),
                promiseWithin(blGridEntry(sharedSetNo, env, product && product.image ? product.image : '', trackerCountry || 'US'), 1400, null)
              ])
            : [null, null];
          const sharedPriceGuide = sharedLegoData[0];
          const sharedBricklinkEntry = sharedLegoData[1];
          // Establish what the set actually sells for BEFORE filtering listings,
          // so we can reject anything priced far below the real market — the most
          // reliable counterfeit signal available without reading each listing's
          // full description. Uses BrickLink completed sales; cached, so this is
          // the same call the chart already makes.
          let marketFloor = 0;
          if (isLegoQuery) {
            try {
              const floorSet = sharedSetNo;
              if (floorSet) {
                const floorPg = sharedPriceGuide;
                const fmv = floorPg ? blMarketValue(floorPg) : null;
                // Reject only listings priced absurdly below market — under 25%
                // of what the set actually sells for. That still catches clones
                // and empty-box/parts listings (a £40 item for a £200 set) while
                // leaving any plausibly-real listing alone. 50% was cutting real
                // listings on higher-value sets.
                if (fmv && fmv.value > 0) marketFloor = fmv.value * 0.50;
              }
            } catch (e) { logErr('marketFloor', e); }
          }
          const cleanAll = isLegoQuery ? all.filter(it => isCleanNewLegoListing(it, product, marketFloor)) : all;
          // Safety net: if the LEGO gate removed EVERY eBay listing, it's almost
          // certainly too aggressive for this particular set (odd titles, missing
          // data, an unusually high market floor). A grid with no eBay results is
          // worse than one with a few imperfect ones, so fall back to the raw
          // listings rather than showing an empty buy section.
          const ebayIn = function(list){ return list.some(function(it){ return !it.stockx && !it._stockx && !/stockx|bricklink|lego/i.test(String(it.source||'')); }); };
          const cleanUsable = (cleanAll.length && ebayIn(cleanAll)) ? cleanAll : all;

          let strictLegoBasis = cleanUsable.slice();
          if (isLegoQuery && sharedSetNo) {
            const mv = sharedPriceGuide ? blMarketValue(sharedPriceGuide) : null;
            const marketValue = mv && mv.value ? mv.value : 0;
            const isSynthetic = (it) => it && (it.source === 'bricklink' || it.source === 'lego' || it.stockx || it._stockx || /stockx/i.test(it.source || ''));
            strictLegoBasis = strictLegoBasis.map(it => {
              if (isSynthetic(it)) return it;
              const s = scoreLegoListing(it, sharedSetNo, marketValue);
              return Object.assign({}, it, { _legoScore: s.score, _legoReal: s.isReal, _legoReasons: s.reasons });
            }).filter(it => isSynthetic(it) || it._legoReal !== false);

            const verifyCandidates = strictLegoBasis
              .filter(it => !isSynthetic(it) && Number(it.price) > 0)
              .sort((a, b) => Number(a.price) - Number(b.price))
              .slice(0, 4);
            await Promise.all(verifyCandidates.map(async cand => {
              const v = await promiseWithin(ebayVerifyReal(cand, env), 850, null);
              if (v && v.ok === false) cand._legoReal = false;
            }));
            strictLegoBasis = strictLegoBasis.filter(it => isSynthetic(it) || it._legoReal !== false);
          }

          let statBasis = strictLegoBasis.slice();
          if (isLegoQuery && sharedBricklinkEntry) statBasis.push(sharedBricklinkEntry);
          if (!statBasis.length) statBasis = cleanUsable.slice();
          statBasis.sort((a, b) => (Number(a && a.price) || Infinity) - (Number(b && b.price) || Infinity));

          const prices = statBasis.map(it => Number(it.price)).filter(p => p > 0);
          const livePrice = prices.length ? prices[0] : 0;   // cheapest CLEAN new listing
          const median = prices.length
            ? (prices.length % 2 ? prices[(prices.length - 1) / 2]
                                 : (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2)
            : 0;                                              // median market price (item price only)
          const pricedItems = statBasis.filter(it => Number(it.price) > 0);
          const ebayN = pricedItems.filter(it => String(it && it.source || '').toLowerCase() === 'ebay').length;
          const stockxN = pricedItems.filter(it => it.stockx || it._stockx || /stockx/i.test(it.source || '')).length;
          const stats = prices.length ? {
            live: livePrice,
            min: livePrice,
            median: median,
            max: prices[prices.length - 1],
            avg: prices.reduce((a, b) => a + b, 0) / prices.length,
            count: prices.length,                             // priced listings (median basis)
            ebayCount: ebayN,
            stockxCount: stockxN
          } : { live: 0, min: 0, median: 0, max: 0, avg: 0, count: 0, ebayCount: 0, stockxCount: 0 };

          // ── Hero product photo ────────────────────────────────────────────
          // Ordered candidate list, not a single URL - StockX studio shots are
          // tried first (clean white background, matches the exact picked
          // product), but StockX images 404 often enough that stopping at one
          // URL left the hero photo blank (the bug in the screenshot). Real
          // eBay/AliExpress listing photos - already for the SAME exact item,
          // since `all` has already been through exactItemFilter - are included
          // as fallback candidates so accuracy wins over an empty box. The
          // frontend cascades through these in order via onerror.
          const imageCandidates = [];
          if (product && product.image) imageCandidates.push(product.image);
          if (product && product.image2) imageCandidates.push(product.image2);
          const sxMatches = all.filter(i => i && i.stockx && i.stockxImage);
          for (const m of sxMatches) if (m.stockxImage) imageCandidates.push(m.stockxImage);
          if (Array.isArray(sx)) for (const m of sx) if (m && m.stockxImage) imageCandidates.push(m.stockxImage);
          // Real listing photos (eBay/AliExpress) for the exact matched item,
          // cheapest-first (already the sort order of `all`).
          for (const it of all) if (it && it.image && !it.stockx && !it._stockx) imageCandidates.push(it.image);
          const heroImage = [...new Set(imageCandidates.filter(Boolean))][0] || '';
          const heroImageCandidates = [...new Set(imageCandidates.filter(Boolean))].slice(0, 6);

          let history = [], samples = [];
          if (env.DB) {
            try {
              // Authoritative product-keyed history when this item is
              // canonicalized - exactly one row per day, no duplicate-date risk
              // even when several query aliases share this product_id. Falls
              // back to per-query history for anything not yet canonicalized.
              const res = productId
                ? await env.DB.prepare(
                    `SELECT snapshot_date, min_price, median_price, avg_price, max_price, listing_count
                     FROM product_price_snapshots WHERE product_id = ?
                       AND (CAST(COALESCE(calculation_version, '1') AS INTEGER)=2 OR NOT EXISTS (SELECT 1 FROM product_price_snapshots v2 WHERE v2.product_id = ? AND v2.source='all' AND CAST(COALESCE(v2.calculation_version, '1') AS INTEGER)=2))
                     ORDER BY snapshot_date ASC LIMIT 365`
                  ).bind(productId, productId).all()
                : await env.DB.prepare(
                    `SELECT snapshot_date, min_price, median_price, avg_price, max_price, listing_count
                     FROM price_snapshots WHERE query = ? AND source = 'all'
                       AND (CAST(COALESCE(calculation_version, '1') AS INTEGER)=2 OR NOT EXISTS (SELECT 1 FROM price_snapshots v2 WHERE v2.query = ? AND v2.source='all' AND CAST(COALESCE(v2.calculation_version, '1') AS INTEGER)=2))
                     ORDER BY snapshot_date ASC LIMIT 365`
                  ).bind(query.toLowerCase(), query.toLowerCase()).all();
              history = res.results || [];
            } catch (e) { logErr('tracker history read', e); }
            try {
              // Intraday samples (last ~14 days) drive the short-range chart;
              // older ranges use the daily rollup above. Same product-first logic.
              const rs = productId
                ? await env.DB.prepare(
                    `SELECT sampled_at, live_price, median_price, avg_price, listing_count
                     FROM product_price_samples WHERE product_id = ?
                       AND (CAST(COALESCE(calculation_version, '1') AS INTEGER)=2 OR NOT EXISTS (SELECT 1 FROM product_price_samples v2 WHERE v2.product_id = ? AND v2.source='all' AND CAST(COALESCE(v2.calculation_version, '1') AS INTEGER)=2))
                     ORDER BY sampled_at ASC LIMIT 1400`
                  ).bind(productId, productId).all()
                : await env.DB.prepare(
                    `SELECT sampled_at, live_price, median_price, avg_price, listing_count
                     FROM price_samples WHERE query = ? AND source = 'all'
                       AND (CAST(COALESCE(calculation_version, '1') AS INTEGER)=2 OR NOT EXISTS (SELECT 1 FROM price_samples v2 WHERE v2.query = ? AND v2.source='all' AND CAST(COALESCE(v2.calculation_version, '1') AS INTEGER)=2))
                     ORDER BY sampled_at ASC LIMIT 1400`
                  ).bind(query.toLowerCase(), query.toLowerCase()).all();
              samples = rs.results || [];
            } catch (e) { logErr('tracker samples read', e); }
          }
          // ── Start this item's chart from today ────────────────────────────
          // Persist today's live point the first time anyone opens an item, so
          // every viewed item begins building history immediately. This reuses
          // the data we already fetched — no extra marketplace API calls. It also
          // registers the query so the daily cron keeps the line current going
          // forward (bounded by last_viewed recency in the cron, so we don't poll
          // one-off searches forever). Runs after the response via waitUntil.
          if (env.DB && stats.count > 0 && stats.avg > 0) {
            const qLower = query.toLowerCase();
            const todayStr = new Date().toISOString().slice(0, 10);
            const nowIso = new Date().toISOString();
            ctx.waitUntil((async () => {
              try {
                const validation = await validateMarketSample(env, productId, qLower, 'all', stats);
                if (!validation.accepted) return;
                await env.DB.prepare(
                  `INSERT INTO price_snapshots
                     (query, source, snapshot_date, min_price, median_price, avg_price, max_price, listing_count, ebay_count, stockx_count, product_id, calculation_version)
                   VALUES (?, 'all', ?, ?, ?, ?, ?, ?, ?, ?, ?, 2)
                   ON CONFLICT(query, source, snapshot_date) DO UPDATE SET
                     min_price = excluded.min_price, median_price = excluded.median_price,
                     avg_price = excluded.avg_price, max_price = excluded.max_price,
                     listing_count = excluded.listing_count,
                     ebay_count = excluded.ebay_count, stockx_count = excluded.stockx_count,
                     product_id = COALESCE(excluded.product_id, price_snapshots.product_id), calculation_version = 2`
                ).bind(qLower, todayStr, stats.min, stats.median, stats.avg, stats.max, stats.count, stats.ebayCount, stats.stockxCount, productId).run();
                // Intraday sample so the short-range chart has points the moment
                // an item is opened (before the cron refreshes it).
                await env.DB.prepare(
                  `INSERT INTO price_samples (query, source, sampled_at, live_price, median_price, avg_price, listing_count, ebay_count, stockx_count, product_id, calculation_version)
                   VALUES (?, 'all', ?, ?, ?, ?, ?, ?, ?, ?, 2)
                   ON CONFLICT(query, source, sampled_at) DO NOTHING`
                ).bind(qLower, nowIso, stats.live, stats.median, stats.avg, stats.count, stats.ebayCount, stats.stockxCount, productId).run();
                // Authoritative product-keyed rollup: exactly ONE row per
                // product per day, however many query aliases point to it.
                if (productId) {
                  await env.DB.prepare(
                    `INSERT INTO product_price_snapshots (product_id, source, snapshot_date, min_price, median_price, avg_price, max_price, listing_count, ebay_count, stockx_count, calculation_version)
                     VALUES (?, 'all', ?, ?, ?, ?, ?, ?, ?, ?, 2)
                     ON CONFLICT(product_id, source, snapshot_date) DO UPDATE SET
                       min_price = excluded.min_price, median_price = excluded.median_price,
                       avg_price = excluded.avg_price, max_price = excluded.max_price,
                       listing_count = excluded.listing_count,
                       ebay_count = excluded.ebay_count, stockx_count = excluded.stockx_count, calculation_version = 2`
                  ).bind(productId, todayStr, stats.min, stats.median, stats.avg, stats.max, stats.count, stats.ebayCount, stats.stockxCount).run();
                  await env.DB.prepare(
                    `INSERT INTO product_price_samples (product_id, source, sampled_at, live_price, median_price, avg_price, listing_count, ebay_count, stockx_count, calculation_version)
                     VALUES (?, 'all', ?, ?, ?, ?, ?, ?, ?, 2)
                     ON CONFLICT(product_id, source, sampled_at) DO NOTHING`
                  ).bind(productId, nowIso, stats.live, stats.median, stats.avg, stats.count, stats.ebayCount, stats.stockxCount).run();
                }
                // Register the view AND capture the product identity (styleId /
                // brand / colourway / canonical product_id) so the scheduler can
                // resolve the same exact shoe later. COALESCE keeps any existing
                // identity if this open had no product match. next_refresh_at
                // only pushed for fresh rows.
                const nextViewIso = new Date(Date.now() + 24 * 3600e3).toISOString();
                const pStyle = (product && product.styleId) ? String(product.styleId).slice(0, 40) : null;
                const pBrand = (product && product.brand) ? String(product.brand).slice(0, 40) : null;
                const pColor = (product && product.colorway) ? String(product.colorway).slice(0, 80) : null;
                await env.DB.prepare(
                  `INSERT INTO tracked_queries (query, source, last_polled, tracker_count, last_viewed, next_refresh_at, style_id, brand, colorway, product_id)
                   VALUES (?, 'all', NULL, 0, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(query, source) DO UPDATE SET
                     last_viewed = excluded.last_viewed,
                     next_refresh_at = COALESCE(tracked_queries.next_refresh_at, excluded.next_refresh_at),
                     style_id = COALESCE(excluded.style_id, tracked_queries.style_id),
                     brand = COALESCE(excluded.brand, tracked_queries.brand),
                     colorway = COALESCE(excluded.colorway, tracked_queries.colorway),
                     product_id = COALESCE(excluded.product_id, tracked_queries.product_id)`
                ).bind(qLower, nowIso, nextViewIso, pStyle, pBrand, pColor, productId).run();
                // Raw observation layer - canonicalized products only, no extra
                // API calls (reuses the 'all' array already fetched above).
                await writePriceObservations(env, productId, qLower, 'all', all);
              } catch (e) { logErr('tracker on-view write', e); }
            })());
          }

          const fx = fxForCountry(request.cf && request.cf.country, await promiseWithin(getFxRates(env), 500, FX_FALLBACK));
          // ── Cold-start context ─────────────────────────────────────────────
          // Our own history starts the day someone first views a product, so a
          // set nobody has clicked has no chart. BrickLink already holds six
          // months of real completed sales for every LEGO set — pull them so a
          // never-visited product still shows truthful market data on first
          // view. Deliberately NOT merged into `history`: these sales are sparse
          // and irregular, so joining them into the line would draw a trend that
          // never happened. They travel separately and render as discrete points.
          let backfill = null;
          try {
            const setNo = sharedSetNo;
            if (setNo) {
              const pg = sharedPriceGuide;
              if (pg && (pg.avg || pg.dated.length)) {
                const mv = blMarketValue(pg);
                backfill = {
                  source: 'bricklink',
                  basis: 'completed sales, last 6 months, new condition',
                  // Below ~3 sales a percentage comparison is noise dressed as
                  // insight, so the frontend suppresses the badge on that flag
                  // rather than computing a deal score off one transaction.
                  marketValue: mv ? mv.value : null,
                  marketValueSales: mv ? mv.salesCount : 0,
                  marketValueReliable: !!(mv && mv.salesCount >= 3),
                  lastSalePrice: mv ? (mv.lastSalePrice || null) : null,
                  lastSaleDate: mv ? (mv.lastSaleDate || null) : null,
                  currency: pg.currency,
                  min: pg.min, max: pg.max, avg: pg.avg,
                  salesCount: pg.totalQuantity || pg.sales.length,
                  hasDatedHistory: pg.hasDatedHistory,
                  sales: pg.dated.map(s => ({ t: s.date, v: s.price, qty: s.qty }))
                };
              }
            }
          } catch (e) { logErr('tracker/search backfill', e); }

          // Grid listings get a stricter gate than the price stats above: the stats
          // want a broad market picture, but the buy grid is what a user actually
          // clicks and pays for, so a mis-tagged or not-actually-the-set listing
          // there is a real-money mistake for them.
          // Reuse the cleaned list computed above for the headline stats — the
          // same listings feed the stat cards and the buy grid, so the two can
          // never disagree again.
          const gridSource = statBasis;
          // If the gate removed everything we fall back to the ungated list rather
          // than showing an empty grid — better a caveated listing than none.
          // Give slot 2 something to hold. Only for LEGO, only when we resolved a
          // set number, and never allowed to fail the whole response.
          let gridPool = gridSource.length ? gridSource.slice() : all.slice();
          let gridSetNo = '';
          if (isLegoQuery) {
            try {
              gridSetNo = sharedSetNo || legoSetNumberFrom(query, product && (product.styleId || product.setNumber));
              const gridCountry = trackerCountry || 'US';
              if (sharedBricklinkEntry && !gridPool.some(it => String(it && it.source || '').toLowerCase() === 'bricklink')) {
                gridPool.push(Object.assign({}, sharedBricklinkEntry, { image: sharedBricklinkEntry.image || heroImage || '' }));
              }
              const legoStoreEntry = await promiseWithin(legoDotComEntry(product, gridSetNo, gridCountry, env, heroImage), 700, null);
              if (legoStoreEntry) gridPool.push(legoStoreEntry);
              // Do not block the first paint on a second regional StockX lookup.
              // The main USD ask is converted through the already-cached FX rate;
              // a background refresh can refine it later.
            } catch (e) { logErr('tracker grid extras', e); }
          }
          // ── LEGO relevance + authenticity scoring ──────────────────────────
          // Rank the real set above clones, parts and accessories using the
          // deterministic score, THEN verify the top few against their full
          // eBay description (which the search API doesn't return) so a
          // disguised "Mock" fake can't wear the Best Price crown. Only LEGO
          // queries, only eBay/real listings (synthetic BrickLink/LEGO/StockX
          // cards are trusted and skip scoring).
          // LEGO eligibility and description verification already ran before
          // headline stats, so the exact same candidates feed the visible grid.
          const gridListings = diversifyListings(gridPool).slice(0, 12);
          const trackerResp = jsonResp({ query, productId, stats, livePrice: stats.live, history, samples, backfill, listings: gridListings, productDetails: product, heroImage: heroImage || '', heroImageCandidates, fx, workerVersion: ENGINE_VERSION }, 200, { 'Cache-Control': 'public, max-age=45, s-maxage=120' });
          try { if (ctx && ctx.waitUntil) ctx.waitUntil(trackerCache.put(trackerCacheKey, trackerResp.clone())); } catch (_) {}
          return trackerResp;
        } catch (e) {
          return jsonResp({ error: String(e && e.message || e) }, 500);
        }
      }

      // ── Market Watch: lightweight 30-second refresh ────────────────
      // DB-only: never calls eBay/StockX/Brickset. The browser can safely ask
      // every 30 seconds whether a newer confirmed sample exists.
      if (url.pathname === '/tracker/latest' && request.method === 'GET') {
        if (!env.DB) return jsonResp({ error: 'No DB bound' }, 500);
        const q = String(url.searchParams.get('q') || '').trim().toLowerCase().slice(0, 120);
        const pid = Number(url.searchParams.get('productId')) || null;
        if (!q && !pid) return jsonResp({ error: 'Missing product' }, 400);
        try {
          let sample = null, history = [];
          if (pid) {
            sample = await env.DB.prepare(
              `SELECT sampled_at, live_price, median_price, avg_price, listing_count
               FROM product_price_samples WHERE product_id = ? AND source = 'all'
                 AND CAST(COALESCE(calculation_version, '1') AS INTEGER) = 2
               ORDER BY sampled_at DESC LIMIT 1`
            ).bind(pid).first();
            const hr = await env.DB.prepare(
              `SELECT snapshot_date, min_price, median_price, avg_price, max_price, listing_count
               FROM product_price_snapshots WHERE product_id = ? AND source = 'all'
                 AND CAST(COALESCE(calculation_version, '1') AS INTEGER) = 2
               ORDER BY snapshot_date ASC LIMIT 365`
            ).bind(pid).all();
            history = hr.results || [];
          } else {
            sample = await env.DB.prepare(
              `SELECT sampled_at, live_price, median_price, avg_price, listing_count
               FROM price_samples WHERE query = ? AND source = 'all'
                 AND CAST(COALESCE(calculation_version, '1') AS INTEGER) = 2
               ORDER BY sampled_at DESC LIMIT 1`
            ).bind(q).first();
            const hr = await env.DB.prepare(
              `SELECT snapshot_date, min_price, median_price, avg_price, max_price, listing_count
               FROM price_snapshots WHERE query = ? AND source = 'all'
                 AND CAST(COALESCE(calculation_version, '1') AS INTEGER) = 2
               ORDER BY snapshot_date ASC LIMIT 365`
            ).bind(q).all();
            history = hr.results || [];
          }
          // ── Cold-start backfill ────────────────────────────────────────────
          // Our own history only starts the day someone first views a product,
          // so a set nobody has clicked has 0-1 points and draws a flat line.
          // For LEGO we don't have to accept that: BrickLink already holds six
          // months of real completed sales for every set. When our own history
          // is too thin to chart, pull theirs and merge it in.
          //
          // Everything merged here is an observed sale price from BrickLink.
          // Nothing is interpolated or invented — if BrickLink has no dated
          // transactions we return an honest aggregate band instead of a line,
          // and the frontend renders it as a range rather than faking a trend.
          let backfill = null;
          if (history.length < 8) {
            const setNo = legoSetNumberFrom(q, url.searchParams.get('styleId'));
            if (setNo) {
              const pg = await blPriceGuide(setNo, env, { guideType: 'sold', condition: 'N', currency: 'USD' })
                .catch(() => null);
              if (pg) {
                const daily = blDailySeries(pg);
                // NOTE: deliberately NOT merged into `history`. These sales are
                // sparse and irregular — a retired set may trade three times in
                // six months — so joining them into the continuous line would
                // draw a trend between points that never existed. They ride
                // alongside as discrete observations instead.
                const mv = blMarketValue(pg);
                backfill = {
                  source: 'bricklink',
                  basis: 'completed sales, last 6 months, new condition',
                  // Below ~3 sales a percentage comparison is noise dressed as
                  // insight, so the frontend suppresses the badge on that flag
                  // rather than computing a deal score off one transaction.
                  marketValue: mv ? mv.value : null,
                  marketValueSales: mv ? mv.salesCount : 0,
                  marketValueReliable: !!(mv && mv.salesCount >= 3),
                  lastSalePrice: mv ? (mv.lastSalePrice || null) : null,
                  lastSaleDate: mv ? (mv.lastSaleDate || null) : null,
                  currency: pg.currency,
                  min: pg.min, max: pg.max, avg: pg.avg,
                  salesCount: pg.totalQuantity || pg.sales.length,
                  charted: daily.length,
                  hasDatedHistory: pg.hasDatedHistory,
                  // Individual dated transactions, so the frontend can plot the
                  // real sales as discrete points rather than drawing a
                  // continuous line through gaps where nothing sold.
                  sales: pg.dated.map(s => ({ t: s.date, v: s.price, qty: s.qty }))
                };
              }
            }
          }

          return jsonResp({ sample: sample || null, history, backfill }, 200, { 'Cache-Control': 'no-store' });
        } catch (e) {
          return jsonResp({ error: String(e && e.message || e) }, 500);
        }
      }

      // ── Market Watch: start tracking ─ POST /tracker/add  body:{email,query} ──
      // Adds the user's personal tracked_items row AND ensures a tracked_queries
      // row exists (or bumps its tracker_count) so the daily cron picks it up.
      // Two users tracking the same query share ONE polled row - see the cron
      // below for why that matters for API quota.
      if (url.pathname === '/tracker/add' && request.method === 'POST') {
        if (!env.DB) return jsonResp({ error: 'No DB bound' }, 500);
        const auth = await requireUser(request, env);
        if (auth.fail) return auth.fail;
        const email = auth.email;
        let query = '';
        try {
          const body = await request.json();
          query = body && body.query ? String(body.query).trim().slice(0, 120).toLowerCase() : '';
        } catch (_) {}
        if (!query) return jsonResp({ error: 'Missing query' }, 400);
        if (await rateLimited(env, request, 'tracker-add', 60, 60)) return tooManyResp(60);
        try {
          const already = await env.DB.prepare(
            'SELECT id FROM tracked_items WHERE email = ? AND query = ? AND source = ?'
          ).bind(email, query, 'all').first();
          if (!already) {
            await env.DB.prepare(
              `INSERT INTO tracked_items (email, query, source, created_at, active)
               VALUES (?, ?, 'all', ?, 1)`
            ).bind(email, query, new Date().toISOString()).run();
            await env.DB.prepare(
              `INSERT INTO tracked_queries (query, source, last_polled, tracker_count, next_refresh_at)
               VALUES (?, 'all', NULL, 1, ?)
               ON CONFLICT(query, source) DO UPDATE SET
                 tracker_count = tracked_queries.tracker_count + 1,
                 next_refresh_at = ?`
            ).bind(query, new Date().toISOString(), new Date().toISOString()).run();
          }
          return jsonResp({ ok: true }, 200);
        } catch (e) {
          return jsonResp({ error: String(e && e.message || e) }, 500);
        }
      }

      // ── Market Watch: stop tracking ─ POST /tracker/remove body:{email,query} ─
      if (url.pathname === '/tracker/remove' && request.method === 'POST') {
        if (!env.DB) return jsonResp({ error: 'No DB bound' }, 500);
        const auth = await requireUser(request, env);
        if (auth.fail) return auth.fail;
        const email = auth.email;
        let query = '';
        try {
          const body = await request.json();
          query = body && body.query ? String(body.query).trim().slice(0, 120).toLowerCase() : '';
        } catch (_) {}
        if (!query) return jsonResp({ error: 'Missing query' }, 400);
        try {
          const row = await env.DB.prepare(
            'SELECT id FROM tracked_items WHERE email = ? AND query = ? AND source = ? AND active = 1'
          ).bind(email, query, 'all').first();
          if (row) {
            await env.DB.prepare(
              'UPDATE tracked_items SET active = 0 WHERE email = ? AND query = ? AND source = ?'
            ).bind(email, query, 'all').run();
            await env.DB.prepare(
              `UPDATE tracked_queries SET tracker_count = MAX(tracker_count - 1, 0)
               WHERE query = ? AND source = 'all'`
            ).bind(query).run();
          }
          return jsonResp({ ok: true }, 200);
        } catch (e) {
          return jsonResp({ error: String(e && e.message || e) }, 500);
        }
      }

      // One-click opt-out. Sets notify=0 for the user. Linked from every email.
      if (url.pathname === '/unsubscribe') {
        const e = (url.searchParams.get('e') || '').trim().toLowerCase();
        const sig = url.searchParams.get('s') || '';
        // The link used to accept any address, so anyone could unsubscribe any
        // user (and enumerate who was subscribed). It now needs the signature
        // we generate when building the email.
        const ok = e && sig && await verifyUnsubSig(env, e, sig);
        if (env.DB && ok) {
          try { await env.DB.prepare('UPDATE users SET notify = 0 WHERE email = ?').bind(e).run(); } catch (_) {}
        }
        if (!ok) {
          return new Response(
            `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Link not valid</title></head>` +
            `<body style="font-family:Arial,sans-serif;background:#f4f4f5;text-align:center;padding:60px 20px;">` +
            `<div style="font-size:22px;font-weight:700;color:#1a6fff;margin-bottom:12px;">FindAI</div>` +
            `<p style="color:#333;font-size:15px;">This unsubscribe link isn't valid. Please use the link in your most recent email, or reply to it and we'll remove you.</p>` +
            `<p><a href="https://findai.ai" style="color:#1a6fff;">Back to FindAI</a></p></body></html>`,
            { status: 400, headers: { 'content-type': 'text/html;charset=UTF-8' } }
          );
        }
        return new Response(
          `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Unsubscribed</title></head>` +
          `<body style="font-family:Arial,sans-serif;background:#f4f4f5;text-align:center;padding:60px 20px;">` +
          `<div style="font-size:22px;font-weight:700;color:#1a6fff;margin-bottom:12px;">FindAI</div>` +
          `<p style="color:#333;font-size:15px;">You've been unsubscribed. You won't get deal emails anymore.</p>` +
          `<p><a href="https://findai.ai" style="color:#1a6fff;">Back to FindAI</a></p></body></html>`,
          { headers: { 'content-type': 'text/html;charset=UTF-8', ...CORS } }
        );
      }

      // ── Test email route ─ /send-test?to=you@example.com&name=James ──────────
      // &type=welcome previews the welcome email; default previews the product email.
      if (url.pathname === '/send-test') {
        if (!adminOK(url, env, request)) return jsonResp({ error: 'unauthorized' }, 403);
        const to = url.searchParams.get('to');
        if (!to) {
          return new Response(JSON.stringify({ error: 'Add ?to=your@email.com' }), {
            status: 400, headers: { 'content-type': 'application/json', ...CORS }
          });
        }
        const testName = url.searchParams.get('name') || 'James';
        if (url.searchParams.get('type') === 'welcome') {
          try {
            const r = await sendEmail(env, to, 'Welcome to FindAI', buildWelcomeEmail(testName));
            const body = await r.text();
            return new Response(body, { status: r.status, headers: { 'content-type': 'application/json', ...CORS } });
          } catch (e) {
            return new Response(JSON.stringify({ error: String(e && e.message || e) }), { status: 500, headers: { 'content-type': 'application/json', ...CORS } });
          }
        }
        const sampleItem = {
          title: "Nike Air Jordan 4 Retro Lightning",
          price: 260.25, currency: "USD",
          image: "https://i.ebayimg.com/images/g/placeholder/s-l400.jpg",
          url: "https://findai.ai", source: "ebay"
        };
        const sampleSimilar = [
          { title: "Air Jordan 4 Retro Thunder", price: 240.00, currency: "USD", image: "https://i.ebayimg.com/images/g/p1/s-l300.jpg", url: "https://findai.ai", source: "ebay" },
          { title: "Air Jordan 4 Military Black", price: 310.50, currency: "USD", image: "https://i.ebayimg.com/images/g/p2/s-l300.jpg", url: "https://findai.ai", source: "ebay" },
          { title: "Air Jordan 4 White Oreo", price: 199.99, currency: "USD", image: "https://i.ebayimg.com/images/g/p3/s-l300.jpg", url: "https://findai.ai", source: "ebay" }
        ];
        const html = buildInterestEmail(sampleItem, testName, sampleSimilar, "https://findai.ai");
        try {
          const subj = testName ? `${testName}, are you still interested in this?` : `Are you still interested in this?`;
          const r = await sendEmail(env, to, subj, html);
          const body = await r.text();
          return new Response(body, {
            status: r.status, headers: { 'content-type': 'application/json', ...CORS }
          });
        } catch (e) {
          return new Response(JSON.stringify({ error: String(e && e.message || e) }), {
            status: 500, headers: { 'content-type': 'application/json', ...CORS }
          });
        }
      }

      // ── SEO landing pages (server-rendered: grid + unique content) ──
      const seoResp = await maybeSeoPage(url, request, env);
      if (seoResp) return seoResp;

      // ── Auto-generated per-product SEO pages (Market Watch tracker) ──
      const productSeoResp = await maybeProductSeoPage(url, env, ctx);
      if (productSeoResp) return productSeoResp;

      // ── TRUST SCORE ENGINE (Phase 1) — test route: ?trustscore=1&itemId=v1|...|0 ──
      // Returns a Trust Score (0-100) + risk flags + eBay Authenticity Guarantee status,
      // built ONLY from fields confirmed present in the Browse API getItem response.
      // Tunable weights live in TS_WEIGHTS below.
      if (url.searchParams.get('trustscore') === '1') {
        const itemId = url.searchParams.get('itemId') || '';
        if (!itemId) return jsonResp({ error: "add &itemId=... (copy from a search result)" }, 200);
        try {
          const tsCountry = detectCountry(request);                       // same marketplace the search card used
          const tsMarketplace = EBAY_MARKETPLACES[tsCountry] || 'EBAY_AU';
          const token = await getEbayToken(env);
          const ep = `https://api.ebay.com/buy/browse/v1/item/${encodeURIComponent(itemId)}`;
          const res = await fetch(ep, {
            headers: { 'Authorization': `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': tsMarketplace, 'Content-Type': 'application/json' },
          });
          if (!res.ok) {
            const t = await res.text();
            return jsonResp({ error: `eBay getItem ${res.status}: ${t.slice(0, 200)}` }, 200);
          }
          const d = await res.json();

          // ── Tunable weights (positive = adds trust, negative = penalty) ──
          const TS_WEIGHTS = {
            authenticityGuarantee: 25,   // eBay verifies the item before delivery — strongest signal
            highFeedbackPct:       15,   // feedback >= 99%
            okFeedbackPct:          8,   // feedback 97-99%
            strongVolume:          12,   // >= 500 ratings
            someVolume:             6,   // 50-499 ratings
            returnsAccepted:        8,
            hasManyPhotos:          5,   // >= 3 images (own photos, not a single stock shot)
            brandPresent:           3,   // listing completeness
            // penalties:
            lowFeedbackPct:       -20,   // < 95%
            tinyVolume:           -12,   // < 10 ratings (new/unproven seller)
            noReturns:             -6,
            onePhoto:              -8,   // single image = higher risk
          };

          const seller = d.seller || {};
          const fbPct  = parseFloat(seller.feedbackPercentage);
          const fbVol  = parseInt(seller.feedbackScore, 10);
          const programs = Array.isArray(d.qualifiedPrograms) ? d.qualifiedPrograms : [];
          const hasAG  = programs.includes('AUTHENTICITY_GUARANTEE');
          const returnsAccepted = !!(d.returnTerms && d.returnTerms.returnsAccepted);
          const imgCount = (d.image ? 1 : 0) + (Array.isArray(d.additionalImages) ? d.additionalImages.length : 0);
          const brand = d.brand && d.brand !== 'Unbranded' ? d.brand : null;
          const buyingOptions = Array.isArray(d.buyingOptions) ? d.buyingOptions : [];

          // ── Extra real signals (all from this same getItem response) ──
          // Returns window (e.g. 30) — from returnTerms.returnPeriod.value
          let returnDays = null;
          if (returnsAccepted && d.returnTerms && d.returnTerms.returnPeriod && Number(d.returnTerms.returnPeriod.value) > 0) {
            returnDays = Number(d.returnTerms.returnPeriod.value);
          }
          // Shipping cost — first shippingOptions entry's shippingCost. 0 => free.
          let shipCost = null, freeShip = false, shipCurrency = '';
          if (Array.isArray(d.shippingOptions) && d.shippingOptions.length) {
            const sc = d.shippingOptions[0].shippingCost;
            if (sc && sc.value != null) {
              shipCost = parseFloat(sc.value);
              shipCurrency = sc.currency || '';
              freeShip = shipCost === 0;
            }
          }
          // Stock + units sold — estimatedAvailabilities[0]
          let stockLeft = null, soldQty = null, stockMoreThan = false;
          if (Array.isArray(d.estimatedAvailabilities) && d.estimatedAvailabilities.length) {
            const ea = d.estimatedAvailabilities[0];
            if (Number(ea.estimatedAvailableQuantity) > 0) stockLeft = Number(ea.estimatedAvailableQuantity);
            if (ea.availabilityThresholdType === 'MORE_THAN') stockMoreThan = true; // "10+"
            if (Number(ea.estimatedSoldQuantity) > 0) soldQty = Number(ea.estimatedSoldQuantity);
          }

          // ── Category eligibility for Authenticity Guarantee ──
          // eBay only offers the Guarantee in specific categories (sneakers, watches, handbags,
          // trading cards, fine jewellery, streetwear, etc.). On all other categories it's never
          // offered, so we should NOT show "not available" there (misleading). We detect eligible
          // categories from the categoryPath text. If hasAG is true, it's obviously eligible.
          const catPath = (d.categoryPath || '').toLowerCase();
          const AG_ELIGIBLE_HINTS = ['athletic shoes','sneaker','wristwatch','watches','watch','handbag','purse','wallets','trading card','ccg','tcg','jewelry','jewellery','fine jewelry','streetwear','men\'s shoes','women\'s shoes'];
          const agEligibleCategory = hasAG || AG_ELIGIBLE_HINTS.some(h => catPath.includes(h));

          // ── Seller credibility signals (only used if eBay actually returns them) ──
          const topRated = d.topRatedBuyingExperience === true;

          let base = 50;                 // neutral starting point
          const positives = [], flags = [];

          // ── Positive signals ──
          if (hasAG) { base += TS_WEIGHTS.authenticityGuarantee; positives.push('eBay Authenticity Guarantee eligible (eBay verifies before delivery)'); }
          if (topRated) { base += 6; positives.push('eBay Top Rated seller'); }
          if (Number.isFinite(fbPct) && fbPct > 0) {
            // Only judge feedback % when we actually have a real value (>0).
            // A 0% with many ratings is almost always missing/unreported data, not a real score —
            // flagging it as "low feedback" would be misleading, so we skip it.
            if (fbPct >= 99)      { base += TS_WEIGHTS.highFeedbackPct; positives.push(`Excellent seller feedback (${fbPct}%)`); }
            else if (fbPct >= 97) { base += TS_WEIGHTS.okFeedbackPct;   positives.push(`Good seller feedback (${fbPct}%)`); }
            else if (fbPct < 95)  { base += TS_WEIGHTS.lowFeedbackPct;  flags.push(`Low seller feedback (${fbPct}%)`); }
          }
          if (Number.isFinite(fbVol)) {
            if (fbVol >= 500)      { base += TS_WEIGHTS.strongVolume; positives.push(`Established seller (${fbVol} ratings)`); }
            else if (fbVol >= 50)  { base += TS_WEIGHTS.someVolume;   positives.push(`${fbVol} seller ratings`); }
            else if (fbVol < 10)   { base += TS_WEIGHTS.tinyVolume;   flags.push(`New / unproven seller (only ${fbVol} ratings)`); }
          }
          if (returnsAccepted) { base += TS_WEIGHTS.returnsAccepted; positives.push(returnDays ? `${returnDays}-day returns accepted` : 'Returns accepted'); }
          else                 { base += TS_WEIGHTS.noReturns;       flags.push('No returns accepted'); }
          if (imgCount >= 3)   { base += TS_WEIGHTS.hasManyPhotos; positives.push(`${imgCount} listing photos`); }
          else if (imgCount <= 1) { base += TS_WEIGHTS.onePhoto;   flags.push('Only one listing photo'); }
          if (brand)           { base += TS_WEIGHTS.brandPresent; positives.push(`Brand specified (${brand})`); }

          // ── PRICE vs ACTIVE MARKET (advisory; only fires on genuine like-for-like matches) ──
          // To avoid false-firing on broad-catalog brands (LV, LEGO), we require comparables to
          // share a MODEL IDENTIFIER (style/set/model code or distinctive token), not just brand.
          // We also sanity-check the spread and clustering — if comparables are all over the place,
          // they're not the same product, so we stay silent. Asking-price only (sold data is 403).
          let priceInsight = null;
          let priceSilentReason = null;   // for an honest "why no price" note in the UI
          try {
            const thisPrice = parseFloat(d.price?.value || 0) || 0;
            const thisCurrency = d.price?.currency || '';
            const rawTitle = (d.title || '');

            // 1) Extract a MODEL IDENTIFIER from the title — the token that pins down the product.
            //    Priorities: a 3-6 digit code (LEGO set / model no.), an alphanumeric style code
            //    (e.g. GW3773, M67601), or the longest distinctive word. This is what makes a
            //    comparable the SAME product, not just the same brand.
            const tokens = rawTitle.replace(/[^a-z0-9\s]/gi, ' ').split(/\s+/).filter(Boolean);
            const styleCode = tokens.find(t => /^[a-z]{1,3}\d{3,}$/i.test(t) || /^\d{4,}$/.test(t) || /^[a-z]\d{2,}[a-z]?$/i.test(t));
            const longWord = tokens.filter(t => t.length >= 4 && !/^\d+$/.test(t)).sort((a,b)=>b.length-a.length)[0] || '';
            const modelId = styleCode || null;

            // Build the comparable query from REAL product words. The old version required words
            // 4+ chars, which dropped "Air"/"1" so "Air Force 1" never formed and it grabbed junk
            // like "Grade School" → almost no comparables. Now we keep alphabetic words 3+ chars,
            // drop generic size/condition/marketing words, and dedupe. The SKU stays in the tight
            // query only (it's too specific for the broad/brand-level comparison).
            const QSTOP = new Set(['the','and','for','with','your','this','from','that','have','size','grade','school','mens','womens','men','women','kids','youth','unisex','brand','new','used','sealed','boxed','unboxed','complete','manual','genuine','authentic','original','vintage','retro','rare','htf','lot','set','pcs','pieces','piece','edition','box','condition','only','left','free','shipping']);
            const wordTokens = tokens.filter(t => /^[a-z]+$/i.test(t) && t.length >= 3 && !QSTOP.has(t.toLowerCase()));
            const distinctive = wordTokens.slice(0, 4).join(' ');
            const dedupe = (s) => { const seen = new Set(); return s.split(/\s+/).filter(w => { const k = w.toLowerCase(); if (!k || seen.has(k)) return false; seen.add(k); return true; }).join(' '); };
            const tightQuery = dedupe(((brand ? brand + ' ' : '') + (modelId ? modelId + ' ' : '') + distinctive).trim());
            const broadQuery = dedupe(((brand ? brand + ' ' : '') + distinctive).trim());

            const curSym = thisCurrency === 'GBP' ? '£' : thisCurrency === 'EUR' ? '€' : '$';
            const fmt = (n) => `${curSym}${Math.round(n).toLocaleString()}`;
            const median = (a) => a.length ? a.slice().sort((x,y)=>x-y)[Math.floor(a.length/2)] : 0;

            if (thisPrice > 0 && (tightQuery || broadQuery)) {
              const sameCondBucket = (c) => (/new/i.test(d.condition || '')) === (/new/i.test(c || ''));
              const clean = (items, key) => (items||[]).filter(it => {
                if (!it || it.itemId === (d.itemId || '')) return false;
                if (!(Number(it.price) > 0)) return false;
                // NOTE: comparables are searched on the SAME marketplace the item was read from (AU below),
                // so prices are directly comparable. We deliberately do NOT filter on currency equality —
                // doing so used to zero-out every comparable for items located outside AU (e.g. a GB listing),
                // which is what caused the false "not enough comparable listings" on popular items.
                if (!sameCondBucket(it.condition)) return false;
                if (key) return (it.title || '').toLowerCase().includes(key);
                return true;
              }).map(it => Number(it.price)).sort((a,b)=>a-b);

              // --- TIER 1: tight match (same product via model id / distinctive word) ---
              const matchKey = (modelId || longWord || '').toLowerCase();
              let tight = [];
              if (matchKey) {
                const r = await searchEbay(tightQuery, tsCountry, '', env);   // same marketplace as getItem → comparable currency
                tight = clean(r && r.items, matchKey);
              }
              const tightArr = (() => {
                if (tight.length < 4) return null;
                const cut = Math.floor(tight.length * 0.1);
                const core = tight.slice(cut, tight.length - cut);
                return core.length >= 3 ? core : tight;
              })();
              const tightOK = tightArr && tightArr[0] > 0 && (tightArr[tightArr.length-1] / tightArr[0]) <= 5;

              if (tightOK) {
                const med = median(tightArr), low = tightArr[0], high = tightArr[tightArr.length-1];
                // FIX: the range bar must always CONTAIN this listing's price, otherwise the
                // marker pins to an edge and the endpoints read as wrong (e.g. a $292 item drawn
                // on a $495–$641 bar). Widen the displayed range to include this price.
                const dispLow = Math.min(low, thisPrice), dispHigh = Math.max(high, thisPrice);
                const ratio = thisPrice / med;
                const cheaperThan = Math.round((tight.filter(p => p > thisPrice).length / tight.length) * 100);
                let verdict = ratio <= 0.85 ? 'below' : ratio >= 1.20 ? 'above' : 'inline';
                priceInsight = {
                  tier: 'high', verdict,
                  thisPrice: Math.round(thisPrice), typical: Math.round(med),
                  rangeLow: Math.round(dispLow), rangeHigh: Math.round(dispHigh),
                  comparables: tight.length,
                  cheaperThanPct: cheaperThan,
                  soldQty: (Number(d.estimatedAvailabilities?.[0]?.estimatedSoldQuantity) > 0) ? Number(d.estimatedAvailabilities[0].estimatedSoldQuantity) : null,
                  freeShipping: (Array.isArray(d.shippingOptions) && d.shippingOptions[0]?.shippingCost?.value != null) ? (parseFloat(d.shippingOptions[0].shippingCost.value) === 0) : null,
                  currency: thisCurrency,
                  thisPriceFmt: fmt(thisPrice), typicalFmt: fmt(med), rangeFmt: `${fmt(dispLow)} – ${fmt(dispHigh)}`,
                  message: verdict === 'below' ? `Priced below similar listings (typical ~${fmt(med)})`
                         : verdict === 'above' ? `Priced above similar listings (typical ~${fmt(med)})`
                         : `Priced in line with similar listings (typical ~${fmt(med)})`,
                };
              } else {
                // --- TIER 2: broad match (same brand/category) — softer wording, still fills the box ---
                // We do NOT claim a "typical price for this exact item". Instead we honestly state
                // where this listing sits among current listings of this brand/type.
                const r = await searchEbay(broadQuery, tsCountry, '', env);   // same marketplace as getItem → comparable currency
                const broad = clean(r && r.items, null);
                if (broad.length >= 4) {
                  // FIX: a brand/category pool ("LEGO Harry Potter") is polluted with cheap
                  // non-equivalent listings — stickers, single minifigs, manuals — so a $4 item
                  // would otherwise define a $200 set's low end. Drop anything priced well below
                  // the typical item (self-calibrating off the median), THEN trim to the
                  // 10th–90th percentile and always include this price.
                  const med = broad[Math.floor(broad.length / 2)] || 0;
                  const floor = med * 0.25;                       // accessories/parts sit far below the median
                  const trimmedLow = broad.filter(p => p >= floor);
                  const useArr = trimmedLow.length >= 5 ? trimmedLow : broad;
                  const cheaperThan = Math.round((useArr.filter(p => p > thisPrice).length / useArr.length) * 100);
                  const pAt = (f) => useArr[Math.min(useArr.length - 1, Math.max(0, Math.floor(useArr.length * f)))];
                  const p10 = pAt(0.10), p90 = pAt(0.90);
                  const lo = Math.min(p10, thisPrice), hi = Math.max(p90, thisPrice);
                  const posFrac = hi > lo ? (thisPrice - lo) / (hi - lo) : 0.5;
                  const positionLabel = posFrac <= 0.33 ? 'lower' : posFrac <= 0.66 ? 'mid' : 'upper';
                  priceInsight = {
                    tier: 'broad',
                    verdict: cheaperThan >= 60 ? 'below' : cheaperThan >= 40 ? 'inline' : 'above',
                    thisPrice: Math.round(thisPrice),
                    rangeLow: Math.round(lo), rangeHigh: Math.round(hi),
                    comparables: useArr.length,
                    cheaperThanPct: cheaperThan,
                    positionLabel,
                    soldQty: (Number(d.estimatedAvailabilities?.[0]?.estimatedSoldQuantity) > 0) ? Number(d.estimatedAvailabilities[0].estimatedSoldQuantity) : null,
                    freeShipping: (Array.isArray(d.shippingOptions) && d.shippingOptions[0]?.shippingCost?.value != null) ? (parseFloat(d.shippingOptions[0].shippingCost.value) === 0) : null,
                    currency: thisCurrency,
                    thisPriceFmt: fmt(thisPrice), rangeFmt: `${fmt(lo)} – ${fmt(hi)}`,
                  };
                } else {
                  // Last resort: we couldn't assemble a reliable comparison set, but we still
                  // show the listing's own price + signals so the box is never empty. No fake range.
                  priceInsight = {
                    tier: 'solo',
                    thisPrice: Math.round(thisPrice),
                    currency: thisCurrency,
                    thisPriceFmt: fmt(thisPrice),
                    soldQty: (Number(d.estimatedAvailabilities?.[0]?.estimatedSoldQuantity) > 0) ? Number(d.estimatedAvailabilities[0].estimatedSoldQuantity) : null,
                    freeShipping: (Array.isArray(d.shippingOptions) && d.shippingOptions[0]?.shippingCost?.value != null) ? (parseFloat(d.shippingOptions[0].shippingCost.value) === 0) : null,
                  };
                }
              }
            } else if (thisPrice > 0) {
              // No usable comparison query at all → still show the listing price (solo), never blank.
              priceInsight = {
                tier: 'solo',
                thisPrice: Math.round(thisPrice),
                currency: thisCurrency,
                thisPriceFmt: fmt(thisPrice),
                soldQty: (Number(d.estimatedAvailabilities?.[0]?.estimatedSoldQuantity) > 0) ? Number(d.estimatedAvailabilities[0].estimatedSoldQuantity) : null,
                freeShipping: (Array.isArray(d.shippingOptions) && d.shippingOptions[0]?.shippingCost?.value != null) ? (parseFloat(d.shippingOptions[0].shippingCost.value) === 0) : null,
              };
            }
          } catch (_) { priceInsight = null; priceSilentReason = null; }

          // Feed the price insight gently into positives/flags too (high-confidence tier only).
          if (priceInsight && priceInsight.tier === 'high') {
            if (priceInsight.verdict === 'below') positives.push(priceInsight.message);
            else if (priceInsight.verdict === 'above') flags.push(priceInsight.message);
          }

          const score = Math.max(0, Math.min(100, Math.round(base)));
          const band = score >= 75 ? 'Low risk' : score >= 50 ? 'Moderate risk' : 'Elevated risk';

          // Build a recommendation that combines TRUST + PRICE (advisory, never a hard "BUY").
          let recommendation = null;
          {
            const trustGood = score >= 75, trustOk = score >= 55;
            const tier = priceInsight ? priceInsight.tier : null;
            const v = priceInsight ? priceInsight.verdict : null;

            if (tier === 'high') {
              // Tight, same-product comparison → confident wording.
              if (v === 'below' && trustGood)
                recommendation = { label: 'Strong buy signal', tone: 'good', text: 'Trusted listing priced below similar listings.' };
              else if (v === 'above' && trustGood)
                recommendation = { label: 'Trusted, but pricey', tone: 'warn', text: 'Reliable listing, but priced above similar listings — you may find it cheaper.' };
              else if (v === 'inline' && trustGood)
                recommendation = { label: 'Fair buy', tone: 'good', text: 'Trusted listing at a typical market price.' };
              else if (!trustOk)
                recommendation = { label: 'Caution advised', tone: 'warn', text: 'This listing has risk flags worth checking before buying.' };
              else if (v === 'below')
                recommendation = { label: 'Cheap — verify carefully', tone: 'good', text: 'Low price, but check the risk flags before buying.' };
            } else if (tier === 'broad') {
              // Looser, brand/category comparison → softer wording, still encouraging, never over-claiming.
              if (v === 'below' && trustOk)
                recommendation = { label: 'Below average asking price', tone: 'good', text: 'Priced under most current listings of this type.' };
              else if (v === 'inline' && trustOk)
                recommendation = { label: 'Around the going rate', tone: 'good', text: 'In line with current listings of this type.' };
              else if (v === 'above' && trustOk)
                recommendation = { label: 'Above average asking price', tone: 'warn', text: 'Priced above most current listings of this type.' };
              else if (!trustOk)
                recommendation = { label: 'Caution advised', tone: 'warn', text: 'This listing has risk flags worth checking before buying.' };
            } else {
              // No price data at all — base it on trust alone so the box still guides.
              if (trustGood) recommendation = { label: 'Trusted listing', tone: 'good', text: 'Strong seller and listing signals.' };
              else if (!trustOk) recommendation = { label: 'Caution advised', tone: 'warn', text: 'This listing has risk flags worth checking before buying.' };
            }
          }


          // Authenticity status: 'Eligible' | 'NotAvailable' (only on eligible categories) | 'NotApplicable' (hide)
          const agStatus = hasAG ? 'Eligible' : (agEligibleCategory ? 'NotAvailable' : 'NotApplicable');

          return jsonResp({
            trustScore: score,
            riskBand: band,
            authenticityStatus: agStatus,
            authenticityGuarantee: hasAG ? 'Eligible' : (agEligibleCategory ? 'Not available for this listing' : null),
            topRatedSeller: topRated,
            shipping: (shipCost != null) ? { cost: shipCost, free: freeShip, currency: shipCurrency } : null,
            stockLeft: stockLeft, stockMoreThan: stockMoreThan, soldQty: soldQty,
            returnDays: returnDays,
            priceInsight: priceInsight,
            priceSilentReason: priceSilentReason,
            recommendation: recommendation,
            positives,
            riskFlags: flags,
            buttons: {
              // AFFILIATE TRACKING. These used to emit the raw eBay URL, which meant a
              // shopper who opened Verify and then bought through it earned nothing -
              // and Verify is the feature people are most likely to click through from.
              // Tracked against the same marketplace the item was read from, matching
              // how the search cards build their links.
              viewOnEbay: addEpnTracking(d.itemWebUrl || '', tsCountry) || null,
              negotiate: buyingOptions.includes('BEST_OFFER') ? (addEpnTracking(d.itemWebUrl || '', tsCountry) || null) : null, // show only if Best Offer
            },
            seller: { feedbackPercentage: seller.feedbackPercentage || null, feedbackScore: seller.feedbackScore || null, username: seller.username || null },
            condition: d.condition || null,
            disclaimer: 'FindAI Trust Score is an automated risk estimate, not proof of authenticity. Always verify with the seller or marketplace before purchasing.',
          }, 200, { 'Cache-Control': 'no-store' });
        } catch (e) {
          return jsonResp({ error: String(e.message || e) }, 200);
        }
      }

      // ── Google Sign-In ──
      //   POST ...?auth=google  body { "credential": "<google JWT>" }
      //   Verifies the token with Google, then saves/updates the user in D1 (env.DB).
      // ── Email code: request ─ POST /auth/request-code {email, notify} ────────
      // Emails a 6-digit sign-in code. Reuses login_tokens (token column holds
      // the code). Same-tab flow, no cross-tab problem. Does not reveal whether
      // the email already exists.
      if (url.pathname === '/auth/request-code') {
        if (request.method !== 'POST') return jsonResp({ error: 'POST only' }, 405);
        let email = '', notify = 0;
        try { const b = await request.json(); email = String(b.email || '').trim().toLowerCase(); notify = b.notify ? 1 : 0; } catch (_) {}
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return jsonResp({ error: 'Enter a valid email' }, 400);
        if (!env.DB || !env.RESEND_API_KEY) return jsonResp({ error: 'Login not available' }, 500);
        // Unlimited requests here = a free email bomb against any address, paid
        // for out of our Resend quota and sender reputation.
        if (await rateLimited(env, request, 'auth-req', 5, 900)) return tooManyResp(900);
        try {
          // Invalidate any earlier unused codes for this email so only the newest works.
          await env.DB.prepare('DELETE FROM login_tokens WHERE email = ? AND used = 0 AND LENGTH(token) = 6').bind(email).run();
          // crypto.getRandomValues, not Math.random — Math.random is not a CSPRNG
          // and a predictable login code is a login bypass.
          const rnd = new Uint32Array(1);
          crypto.getRandomValues(rnd);
          const code = String(100000 + (rnd[0] % 900000));
          const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
          await env.DB.prepare('INSERT INTO login_tokens (token, email, notify, expires, used) VALUES (?, ?, ?, ?, 0)')
            .bind(code, email, notify, expires).run();
          await sendEmail(env, email, `${code} is your FindAI sign-in code`, buildCodeEmail(code));
          return jsonResp({ ok: true }, 200);
        } catch (e) {
          return jsonResp({ error: String(e && e.message || e) }, 500);
        }
      }

      // ── Email code: verify ─ POST /auth/verify-code {email, code} ────────────
      // Validates the code for that email, logs the user in, returns their profile.
      if (url.pathname === '/auth/verify-code') {
        if (request.method !== 'POST') return jsonResp({ error: 'POST only' }, 405);
        let email = '', code = '';
        try { const b = await request.json(); email = String(b.email || '').trim().toLowerCase(); code = String(b.code || '').trim(); } catch (_) {}
        if (!email || !/^\d{6}$/.test(code)) return jsonResp({ error: 'Enter the 6-digit code' }, 400);
        if (!env.DB) return jsonResp({ error: 'Login not available' }, 500);
        // A 6-digit code has a million possibilities and a 15-minute window.
        // Without a cap, that is brute-forceable. 10 attempts per 15 min per IP.
        if (await rateLimited(env, request, 'auth-verify', 10, 900)) return tooManyResp(900);
        try {
          const row = await env.DB.prepare(
            'SELECT notify, expires, used FROM login_tokens WHERE token = ? AND email = ? AND LENGTH(token) = 6'
          ).bind(code, email).first();
          if (!row || row.used) return jsonResp({ error: 'Invalid or expired code' }, 400);
          if (new Date(row.expires).getTime() < Date.now()) return jsonResp({ error: 'This code has expired' }, 400);
          await env.DB.prepare('UPDATE login_tokens SET used = 1 WHERE token = ? AND email = ?').bind(code, email).run();
          const name = email.split('@')[0];
          await upsertUser(env, ctx, email, name, row.notify ? 1 : 0);
          const session = await issueSession(env, email);
          return jsonResp({ email, name, picture: '', session }, 200, { 'Cache-Control': 'no-store' });
        } catch (e) {
          return jsonResp({ error: String(e && e.message || e) }, 500);
        }
      }

      // ── Email magic-link: request ─ POST /auth/request-link {email, notify} ──
      // Emails a one-time sign-in link. Does not reveal whether the email exists.
      if (url.pathname === '/auth/request-link') {
        if (request.method !== 'POST') return jsonResp({ error: 'POST only' }, 405);
        let email = '', notify = 0;
        try { const b = await request.json(); email = String(b.email || '').trim().toLowerCase(); notify = b.notify ? 1 : 0; } catch (_) {}
        // basic email shape check
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return jsonResp({ error: 'Enter a valid email' }, 400);
        if (!env.DB || !env.RESEND_API_KEY) return jsonResp({ error: 'Login not available' }, 500);
        if (await rateLimited(env, request, 'auth-req', 5, 900)) return tooManyResp(900);
        try {
          const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
          const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
          await env.DB.prepare('INSERT INTO login_tokens (token, email, notify, expires, used) VALUES (?, ?, ?, ?, 0)')
            .bind(token, email, notify, expires).run();
          const loginUrl = 'https://findai.ai/?login=' + token;
          await sendEmail(env, email, 'Sign in to FindAI', buildLoginEmail(loginUrl));
          return jsonResp({ ok: true }, 200);
        } catch (e) {
          return jsonResp({ error: String(e && e.message || e) }, 500);
        }
      }

      // ── Email magic-link: verify ─ GET /auth/verify-link?token=... ───────────
      // Validates a one-time token, logs the user in, returns their profile.
      if (url.pathname === '/auth/verify-link') {
        const token = url.searchParams.get('token') || '';
        if (!token || !env.DB) return jsonResp({ error: 'Invalid link' }, 400);
        try {
          const row = await env.DB.prepare('SELECT email, notify, expires, used FROM login_tokens WHERE token = ?').bind(token).first();
          if (!row) return jsonResp({ error: 'Invalid or expired link' }, 400);
          if (row.used) return jsonResp({ error: 'This link has already been used' }, 400);
          if (new Date(row.expires).getTime() < Date.now()) return jsonResp({ error: 'This link has expired' }, 400);
          await env.DB.prepare('UPDATE login_tokens SET used = 1 WHERE token = ?').bind(token).run();
          const email = String(row.email);
          const name = email.split('@')[0]; // no real name for email signups; use handle
          await upsertUser(env, ctx, email, name, row.notify ? 1 : 0);
          const session = await issueSession(env, email);
          return jsonResp({ email, name, picture: '', session }, 200, { 'Cache-Control': 'no-store' });
        } catch (e) {
          return jsonResp({ error: String(e && e.message || e) }, 500);
        }
      }

      if (url.pathname === '/auth/google' || url.searchParams.get('auth') === 'google') {
        if (request.method !== 'POST') return jsonResp({ error: 'POST only' }, 405);

        let credential = '';
        let notify = 0;
        try {
          const body = await request.json();
          credential = body && body.credential ? String(body.credential) : '';
          notify = body && body.notify ? 1 : 0;
        } catch (_) {}
        if (!credential) return jsonResp({ error: 'No credential provided' }, 400);

        // Verify the token with Google's tokeninfo endpoint.
        let info;
        try {
          const vr = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
          info = await vr.json();
        } catch (_) {
          return jsonResp({ error: 'Could not reach Google to verify sign-in' }, 502);
        }

        // Check the token is genuinely for THIS app, and is valid.
        const expectedClientId = '258387139240-a60g5n1hortfo0tnpm03dj8ht7jemqt0.apps.googleusercontent.com';
        if (!info || info.error_description || (info.aud !== expectedClientId)) {
          return jsonResp({ error: 'Sign-in could not be verified' }, 401);
        }
        // tokeninfo reports exp; reject stale tokens, and require a verified
        // address so an unverified Google account can't claim someone's email.
        if (info.exp && (Number(info.exp) * 1000) < Date.now()) {
          return jsonResp({ error: 'Sign-in has expired, please try again' }, 401);
        }
        if (info.email_verified === false || info.email_verified === 'false') {
          return jsonResp({ error: 'Please verify your Google email address first' }, 401);
        }

        const email = info.email ? String(info.email) : '';
        const name = info.name ? String(info.name) : '';
        const picture = info.picture ? String(info.picture) : '';
        if (!email) return jsonResp({ error: 'No email on this Google account' }, 400);

        // Save/update the user + send welcome on first signup (shared helper).
        await upsertUser(env, ctx, email, name, notify);

        const session = await issueSession(env, email);
        return jsonResp({ email, name, picture, session }, 200, { 'Cache-Control': 'no-store' });
      }

      // ── StockX OAuth: start ─ GET /auth/stockx/start ────────────────────────
      // Visit this once in a browser to connect StockX. Redirects to StockX login.
      // ADMIN ONLY. This connects the single app-wide StockX account whose
      // refresh token lives in stockx_auth row id=1. Left open, any stranger
      // could authorise with THEIR account and overwrite that row, hijacking
      // the whole integration. The static state=findai gave no CSRF protection
      // either, so we now mint a random single-use state and check it on return.
      if (url.pathname === '/auth/stockx/start') {
        if (!adminOK(url, env, request)) return jsonResp({ error: 'unauthorized' }, 403, { 'Cache-Control': 'no-store' });
        const state = crypto.randomUUID().replace(/-/g, '');
        if (env.CACHE) {
          try { await env.CACHE.put('stockx_oauth_state:' + state, '1', { expirationTtl: 600 }); }
          catch (e) { logErr('stockx state put', e); }
        }
        const auth = 'https://accounts.stockx.com/authorize?response_type=code'
          + '&client_id=' + encodeURIComponent(STOCKX_CLIENT_ID)
          + '&redirect_uri=' + encodeURIComponent(STOCKX_REDIRECT)
          + '&scope=' + encodeURIComponent('offline_access openid')
          + '&audience=gateway.stockx.com'
          + '&state=' + state;
        return new Response(null, { status: 302, headers: { Location: auth, 'Cache-Control': 'no-store' } });
      }

      // ── StockX OAuth: callback ─ GET /auth/stockx/callback?code=... ──────────
      // StockX redirects here after login. Exchanges the code for tokens and
      // stores the long-lived refresh token in D1.
      if (url.pathname === '/auth/stockx/callback') {
        const code = url.searchParams.get('code') || '';
        const state = url.searchParams.get('state') || '';
        if (!code) return jsonResp({ error: 'No code returned from StockX' }, 400);
        // Only accept a state this Worker minted at /auth/stockx/start, and burn
        // it on use so a callback URL can't be replayed.
        if (!env.CACHE) return jsonResp({ error: 'KV binding CACHE required for OAuth state' }, 500);
        let stateOK = false;
        try {
          if (state && await env.CACHE.get('stockx_oauth_state:' + state)) {
            stateOK = true;
            await env.CACHE.delete('stockx_oauth_state:' + state);
          }
        } catch (e) { logErr('stockx state check', e); }
        if (!stateOK) return jsonResp({ error: 'Invalid or expired OAuth state' }, 403, { 'Cache-Control': 'no-store' });
        if (!env.STOCKX_CLIENT_SECRET) return jsonResp({ error: 'STOCKX_CLIENT_SECRET not set' }, 500);
        try {
          const body = new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: STOCKX_CLIENT_ID,
            client_secret: env.STOCKX_CLIENT_SECRET,
            code,
            redirect_uri: STOCKX_REDIRECT,
          });
          const r = await fetch('https://accounts.stockx.com/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
          });
          const data = await r.json();
          if (!data || !data.refresh_token) {
            return jsonResp({ error: 'No refresh_token from StockX', detail: data }, 502);
          }
          await env.DB.prepare(
            `INSERT INTO stockx_auth (id, refresh_token, updated_at) VALUES (1, ?, ?)
             ON CONFLICT(id) DO UPDATE SET refresh_token = excluded.refresh_token, updated_at = excluded.updated_at`
          ).bind(data.refresh_token, new Date().toISOString()).run();
          if (data.access_token) {
            stockxAccessToken = data.access_token;
            stockxTokenExpiry = Date.now() + Math.max(0, (data.expires_in || 43200) - 60) * 1000;
          }
          return new Response('StockX connected. You can close this tab.', { status: 200, headers: { 'Content-Type': 'text/plain' } });
        } catch (e) {
          return jsonResp({ error: String(e && e.message || e) }, 500);
        }
      }

      // ── StockX market cards ─ GET /stockx/search?q=...&country=AU ────────────
      // Returns up to 3 StockX market-reference cards. Safe: [] on any failure.
      if (url.pathname === '/stockx/search') {
        const q = (url.searchParams.get('q') || '').trim();
        const country = (url.searchParams.get('country') || detectCountry(request)).toUpperCase();
        const limit = Math.max(1, Math.min(3, parseInt(url.searchParams.get('limit') || '2', 10) || 2));
        if (!q) return jsonResp({ items: [] }, 200);
        // TEMP debug: /stockx/search?q=yeezy&debug=1 returns the RAW StockX
        // responses (first search product + its market data) so field names can
        // be verified. Remove with the other temp routes before production.
        if (url.searchParams.get('debug') === '1') {
          const token = await getStockxToken(env);
          if (!token) return jsonResp({ error: 'StockX not connected' }, 200);
          const headers = { 'Authorization': 'Bearer ' + token, 'x-api-key': env.STOCKX_API_KEY || '', 'Content-Type': 'application/json' };
          const out = {};
          try {
            const sr = await fetch('https://api.stockx.com/v2/catalog/search?query=' + encodeURIComponent(q) + '&pageNumber=1&pageSize=1', { headers });
            out.searchStatus = sr.status;
            out.searchBody = await sr.json();
            const p = out.searchBody && out.searchBody.products && out.searchBody.products[0];
            if (p && (p.productId || p.id)) {
              await new Promise(r => setTimeout(r, 1100));
              const pr = await fetch('https://api.stockx.com/v2/catalog/products/' + encodeURIComponent(p.productId || p.id), { headers });
              out.productStatus = pr.status;
              try { out.productBody = await pr.json(); } catch (_) { out.productBody = 'not json'; }
              await new Promise(r => setTimeout(r, 1100));
              const mr = await fetch('https://api.stockx.com/v2/catalog/products/' + encodeURIComponent(p.productId || p.id) + '/market-data?currencyCode=' + encodeURIComponent(currencyFor(country)), { headers });
              out.marketStatus = mr.status;
              try { out.marketBody = await mr.json(); } catch (_) { out.marketBody = 'not json'; }
            }
          } catch (e) { out.error = String(e && e.message || e); }

          // IMAGE DIAGNOSTIC: for the first product, test which image URL
          // candidates actually return a real image (HEAD each), and probe the
          // product page for og:image / __NEXT_DATA__ so we can see if scraping
          // is even an option. This tells us the correct image source definitively.
          try {
            const p0 = out.searchBody && out.searchBody.products && out.searchBody.products[0];
            if (p0) {
              const styleRaw = String(p0.styleId || p0.styleID || '').trim();
              const styleA = styleRaw.split('/')[0].trim().replace(/\s+/g, '-');
              const styleB = (styleRaw.split('/')[1] || '').trim().replace(/\s+/g, '-');
              const uk = p0.urlKey || '';
              const pretty = uk ? uk.split('-').map(s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s).join('-') : '';
              // imgix (images.stockx.com) is a public CDN, not bot-walled. Test the
              // real known formats + a query-string variant imgix uses.
              const candidates = {
                styleA_jpg: styleA ? 'https://images.stockx.com/images/' + styleA + '.jpg' : '',
                styleB_jpg: styleB ? 'https://images.stockx.com/images/' + styleB + '.jpg' : '',
                urlKey_product: pretty ? 'https://images.stockx.com/images/' + pretty + '-Product.jpg' : '',
                urlKey_product_q: pretty ? 'https://images.stockx.com/images/' + pretty + '-Product.jpg?fit=fill&bg=FFFFFF&w=300&h=214&auto=format' : '',
                styleA_360: styleA ? 'https://images.stockx.com/360/' + styleA + '/Images/' + styleA + '/Lv2/img01.jpg' : '',
              };
              out.imageCandidates = {};
              for (const [name, u] of Object.entries(candidates)) {
                if (!u) { out.imageCandidates[name] = { url: u, ok: false }; continue; }
                try {
                  const hr = await fetch(u, { method: 'HEAD' });
                  out.imageCandidates[name] = { url: u, status: hr.status, type: hr.headers.get('content-type'), ok: hr.ok && String(hr.headers.get('content-type') || '').startsWith('image') };
                } catch (e) { out.imageCandidates[name] = { url: u, error: String(e && e.message || e), ok: false }; }
              }
              // Probe the product page (diagnostic only - see if scraping is viable).
              if (uk) {
                try {
                  const pgr = await fetch('https://stockx.com/' + uk, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0 Safari/537.36' } });
                  out.pageProbe = { status: pgr.status, type: pgr.headers.get('content-type') };
                  const ht=await pgr.text();
                  const ogM = ht.match(/property="og:image"\s+content="([^"]+)"/);
                  out.pageProbe.ogImage = ogM ? ogM[1] : null;
                  out.pageProbe.hasNextData = ht.indexOf('__NEXT_DATA__') !== -1;
                  out.pageProbe.first300 = ht.slice(0, 300);
                } catch (e) { out.pageProbe = { error: String(e && e.message || e) }; }
              }
            }
          } catch (e) { out.imageError = String(e && e.message || e); }

          // Recursively scan the ENTIRE search + product response for any field
          // whose key or value looks like an image URL. Settles whether StockX
          // hides an image field anywhere in the payload.
          try {
            const hits = [];
            const rx = /(image|imageurl|image_url|media|gallery|thumb|thumbnail|hero|picture|asset|photo)/i;
            const scan = (obj, path) => {
              if (!obj || typeof obj !== 'object' || hits.length > 40) return;
              for (const k of Object.keys(obj)) {
                const v = obj[k];
                const here = path ? path + '.' + k : k;
                if (rx.test(k) || (typeof v === 'string' && /^https?:\/\/[^ ]+\.(jpg|jpeg|png|webp|avif)/i.test(v))) {
                  hits.push({ path: here, value: typeof v === 'string' ? v.slice(0, 200) : typeof v });
                }
                if (v && typeof v === 'object') scan(v, here);
              }
            };
            scan(out.searchBody, 'search');
            scan(out.productBody, 'product');
            out.imageFieldScan = hits.length ? hits : 'NO image-like fields found anywhere in the response';
          } catch (e) { out.imageFieldScanError = String(e && e.message || e); }

          return jsonResp(out, 200);
        }
        try {
          const items = await stockxSearch(q, currencyFor(country), env, limit, ctx);
          return jsonResp({ items }, 200, { 'Cache-Control': 'public, max-age=1800' });
        } catch (_) {
          return jsonResp({ items: [] }, 200);
        }
      }

      // ── Discogs music cards ─ GET /discogs/search?q=...&country=AU ───────────
      // Vinyl / CD / cassette catalogue + real lowest asking price. Client only
      // calls this for music queries. Safe: [] on any failure or missing keys.
      if (url.pathname === '/discogs/search') {
        const q = (url.searchParams.get('q') || '').trim();
        const country = (url.searchParams.get('country') || detectCountry(request)).toUpperCase();
        const limit = Math.max(1, Math.min(4, parseInt(url.searchParams.get('limit') || '3', 10) || 3));
        if (!q) return jsonResp({ items: [] }, 200);
        try {
          const items = await searchDiscogs(q, country, env, limit);
          // Never edge-cache an empty result — a transient miss would otherwise
          // be served for 30 min and look like a broken integration.
          const cc = items.length ? 'public, max-age=1800' : 'no-store';
          return jsonResp({ items }, 200, { 'Cache-Control': cc });
        } catch (_) {
          return jsonResp({ items: [] }, 200, { 'Cache-Control': 'no-store' });
        }
      }

      // ── Etsy handmade/vintage cards ─ GET /etsy/search?q=... ─────────────────
      // Read-only keyword search across Etsy. Client only calls this for
      // non-sneaker queries. Safe: [] on any failure or missing key.
      if (url.pathname === '/etsy/search') {
        const q = (url.searchParams.get('q') || '').trim();
        const limit = Math.max(1, Math.min(4, parseInt(url.searchParams.get('limit') || '3', 10) || 3));
        if (!q) return jsonResp({ items: [] }, 200);
        // ?debug=1 → return Etsy's raw status/body so we can see exactly why a
        // call failed (403 = auth, 400 = bad param, etc.) instead of guessing.
        if (url.searchParams.get('debug') === '1') {
          try {
            const r = await etsyFetchRaw(q, env, limit);
            return jsonResp({ ok: r.ok, status: r.status, tried: r.tried, resultCount: (r.results || []).length, body: r.body || '' }, 200);
          } catch (e) {
            return jsonResp({ error: String(e && e.message || e) }, 200);
          }
        }
        try {
          const items = await searchEtsy(q, env, limit);
          const cc = items.length ? 'public, max-age=1800' : 'no-store';
          return jsonResp({ items }, 200, { 'Cache-Control': cc });
        } catch (_) {
          return jsonResp({ items: [] }, 200, { 'Cache-Control': 'no-store' });
        }
      }
      // For the custom Google button (OAuth2 token flow). Verifies the token was
      // issued for THIS app, then reads the verified profile. Returns the user.
      if (url.pathname === '/auth/google-token') {
        if (request.method !== 'POST') return jsonResp({ error: 'POST only' }, 405);
        let accessToken = '', notify = 0;
        try {
          const body = await request.json();
          accessToken = body && body.access_token ? String(body.access_token) : '';
          notify = body && body.notify ? 1 : 0;
        } catch (_) {}
        if (!accessToken) return jsonResp({ error: 'No token provided' }, 400);

        const expectedClientId = '258387139240-a60g5n1hortfo0tnpm03dj8ht7jemqt0.apps.googleusercontent.com';
        // 1) Verify the token belongs to THIS app (prevents token substitution).
        let ti;
        try {
          const tr = await fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(accessToken));
          ti = await tr.json();
        } catch (_) {
          return jsonResp({ error: 'Could not reach Google to verify sign-in' }, 502);
        }
        if (!ti || ti.error_description || (ti.aud !== expectedClientId && ti.azp !== expectedClientId)) {
          return jsonResp({ error: 'Sign-in could not be verified' }, 401);
        }
        // 2) Read the verified profile (name + picture) from userinfo.
        let info = {};
        try {
          const ur = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: 'Bearer ' + accessToken }
          });
          info = await ur.json();
        } catch (_) { /* fall back to tokeninfo email below */ }

        const email = String((info && info.email) || ti.email || '');
        const name = String((info && info.name) || '');
        const picture = String((info && info.picture) || '');
        if (!email) return jsonResp({ error: 'No email on this Google account' }, 400);

        await upsertUser(env, ctx, email, name, notify);
        const session = await issueSession(env, email);
        return jsonResp({ email, name, picture, session }, 200, { 'Cache-Control': 'no-store' });
      }
      if (url.searchParams.get('agree') === '1') {
        try {
          const r = await env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct', { prompt: 'agree' });
          return new Response(JSON.stringify({ ok: true, result: r }), { headers: { 'Content-Type': 'application/json', ...CORS } });
        } catch (e) {
          return new Response(JSON.stringify({ ok: false, error: String((e && e.message) || e) }), { headers: { 'Content-Type': 'application/json', ...CORS } });
        }
      }

      // ── AI shopping assistant ──
      //   test in a browser:  GET  ...?chat=1&msg=find me a green labubu under 40
      //   used by the site:   POST ...?chat=1   body { "messages": [{role,content}, ...] }
      if (url.pathname === '/chat' || url.searchParams.get('chat') === '1') {
        let history = [];
        if (request.method === 'POST') {
          try { const body = await request.json(); if (body && Array.isArray(body.messages)) history = body.messages; } catch (_) {}
        }
        const testMsg = (url.searchParams.get('msg') || '').trim();
        if (testMsg) history = [{ role: 'user', content: testMsg }];

        history = history
          .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
          .slice(-12)
          .map(m => ({ role: m.role, content: m.content.slice(0, 1500) }));

        if (!history.length) return jsonResp({ error: 'No message provided', reply: '', items: [] }, 400);
        // Open AI proxy = anyone can burn our Workers AI quota for free.
        if (await rateLimited(env, request, 'chat', 30, 60)) {
          return jsonResp({ reply: "You're sending messages faster than I can think — give me a moment and try again.", items: [] }, 429, { 'Retry-After': '60' });
        }
        if (!env.AI) return jsonResp({ reply: "The assistant isn't switched on yet — add a Workers AI binding named AI to this Worker.", items: [] }, 200);

        const chatCountry = detectCountry(request);
        let assistant;
        try {
          assistant = await askAssistant(history, env);
        } catch (e) {
          return jsonResp({ reply: 'Sorry, I had trouble thinking just now — try again?', items: [], error: String(e.message || e) }, 200);
        }

        let chatItems = [], chatMeta = null;
        if (assistant.search && assistant.search.query) {
          const r = await searchListings(assistant.search.query, String(assistant.search.maxPrice || ''), chatCountry, env);
          chatItems = r.items; chatMeta = r.meta;
        }

        return jsonResp(
          { reply: assistant.reply, items: chatItems, search: assistant.search || null, meta: chatMeta, country: chatCountry },
          200,
          { 'Cache-Control': 'no-store' }
        );
      }

      // ── Image: shop it OR answer it ──
      //   test in a browser:  GET  ...?vision=1&img=<public image url>&msg=optional
      //   used by the site:   POST ...?vision=1   body { imageBase64, msg, messages }
      if (url.pathname === '/vision' || url.pathname === '/vision-search' || url.searchParams.get('vision') === '1') {
        // Vision calls are the most expensive thing this Worker can do.
        if (await rateLimited(env, request, 'vision', 10, 60)) {
          return jsonResp({ reply: 'Too many image searches in a row — try again in a minute.', items: [] }, 429, { 'Retry-After': '60' });
        }
        let body = {};
        let bytes = null;
        let imageBase64Raw = '';
        try {
          if (request.method === 'POST') {
            body = await request.json().catch(() => ({}));
            let b64 = body && body.imageBase64 ? String(body.imageBase64) : '';
            b64 = b64.replace(/^data:[^;]+;base64,/, '');
            imageBase64Raw = b64;
            if (b64) {
              const bin = atob(b64);
              const arr = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
              bytes = Array.from(arr);
            }
          }
          const imgUrl = url.searchParams.get('img');
          if (!bytes && imgUrl) {
            const r = await fetch(imgUrl);
            const buf = await r.arrayBuffer();
            bytes = Array.from(new Uint8Array(buf));
          }
        } catch (e) {
          return jsonResp({ reply: 'I could not read that image — try another.', items: [], error: String(e.message || e) }, 200);
        }
        if (!bytes || !bytes.length) return jsonResp({ error: 'No image provided', reply: '', items: [] }, 400);
        if (!imageBase64Raw) imageBase64Raw = bytesToBase64(bytes);

        const visCountry = detectCountry(request);
        const userMsg = String((request.method === 'POST' ? (body.msg || '') : (url.searchParams.get('msg') || ''))).trim();
        const history = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
        const exactShoppingMode = url.pathname === '/vision-search' ||
          body.mode === 'exact-shopping-product' || body.requireStructuredProduct === true;

        // The mobile scanner uses the hybrid route: first-party eBay visual
        // matching + structured label/OCR evidence + exact cross-market search.
        if (exactShoppingMode) {
          try {
            const hybrid = await runHybridVisionSearch({
              imageBase64: imageBase64Raw, bytes, country: visCountry, userMsg, env
            });
            return jsonResp(hybrid, 200, { 'Cache-Control': 'no-store' });
          } catch (error) {
            logErr('hybrid vision search', error);
            // Fall through to the legacy vision path rather than failing the scan.
          }
        }

        // The hybrid route can still use eBay visual matching when Workers AI is
        // temporarily unavailable. The legacy image assistant cannot.
        if (!env.AI) return jsonResp({ reply: "The assistant isn't switched on yet — add a Workers AI binding named AI to this Worker.", items: [] }, 200);

        // 1) read the image into text (product description OR transcribed question)
        let visionText = '';
        try { visionText = await readImage(bytes, env); }
        catch (e) { return jsonResp({ reply: 'I had trouble reading that image — try again?', items: [], error: String(e.message || e) }, 200, { 'Cache-Control': 'no-store' }); }
        if (!visionText) return jsonResp({ reply: "I couldn't make out that image — try a clearer photo.", items: [], query: '' }, 200, { 'Cache-Control': 'no-store' });

        // 2) hand the contents to the assistant: shop vs answer
        const visionMessage =
          `The user uploaded an image. Here is exactly what it contains:\n"""\n${visionText}\n"""\n` +
          (userMsg ? `The user also wrote: "${userMsg}"\n` : '') +
          `\nDecide what to do:\n- If this is a PRODUCT to shop for, identify the SPECIFIC release: use the brand, model, any transcribed text/logos, and distinctive patterns to name the exact edition or collaboration. For example: a Nike SB Dunk with cow spots and ice-cream graphics is the "Ben & Jerry Chunky Dunky"; a red/white/black Air Jordan 1 High is the "Chicago"; a beige/brown one is the "Mocha". Set "search" with keywords that LEAD with brand + that specific edition/collab name + model — not just generic colours. Put any budget in maxPrice.\n- If this is a QUESTION, problem, or document, ANSWER or SOLVE it in "reply" and set "search" to null.`;

        let assistant;
        try {
          assistant = await askAssistant([...history, { role: 'user', content: visionMessage }], env);
        } catch (e) {
          assistant = { reply: `Looks like: ${visionText.slice(0, 80)}. Here's what I found:`, search: { query: visionText.slice(0, 80), maxPrice: null } };
        }

        let items = [], meta = {};
        if (assistant.search && assistant.search.query) {
          const vr = await searchListings(assistant.search.query, assistant.search.maxPrice || '', visCountry, env);
          items = vr.items; meta = vr.meta;
        }
        return jsonResp(
          {
            reply: assistant.reply,
            query: assistant.search ? assistant.search.query : '',
            items, meta, country: visCountry,
            kind: assistant.search ? 'product' : 'answer'
          },
          200,
          { 'Cache-Control': 'no-store' }
        );
      }

      // Homepage featured AliExpress pools:  GET ...?home=1
      if (url.searchParams.get('home') === '1' || url.searchParams.get('homepage') === '1') {
        const homeCountry = homePoolCountry(detectCountry(request));
        // 1) KV — global warm store kept fresh by the cron pre-warmer.
        if (env.CACHE) {
          try {
            const kv = await env.CACHE.get(`home:${homeCountry}`, 'json');
            if (kv && kv.items) return jsonResp(kv, 200, { 'Cache-Control': 'public, max-age=300' });
          } catch (_) {}
        }
        // 2) Per-colo edge cache.
        const cache = caches.default;
        const cacheKey = new Request(`${url.origin}/__home_pools?c=${homeCountry}`, { method: 'GET' });
        const hit = await cache.match(cacheKey);
        if (hit) return hit;
        // 3) Cold build.
        const payload = await buildHomePayload(homeCountry, env);
        if (env.CACHE) { try { await env.CACHE.put(`home:${homeCountry}`, JSON.stringify(payload), { expirationTtl: 3600 }); } catch (_) {} }
        const resp = jsonResp(payload, 200, { 'Cache-Control': 'public, max-age=1800' });
        try { await cache.put(cacheKey, resp.clone()); } catch (_) {}
        return resp;
      }

      // ── Cached homepage preview pool:  GET ...?previews=1 ──
      // Builds the preview grid server-side ONCE and caches it at the Cloudflare
      // edge for ~10 min, so the homepage loads from a single fast call instead of
      // 9–16 live marketplace searches every visit. The front-end shuffles the
      // returned pool client-side for per-visit freshness.
      if (url.searchParams.get('previews') === '1') {
        const pvCountry = homePoolCountry(detectCountry(request));
        // 1) KV — global warm store kept fresh by the cron pre-warmer → instant everywhere.
        if (env.CACHE) {
          try {
            const kv = await env.CACHE.get(`previews:${pvCountry}`, 'json');
            if (kv && kv.items && kv.items.length)
              return jsonResp({ items: shuffle(kv.items), total: kv.items.length, country: pvCountry, cached: 'kv' }, 200, { 'Cache-Control': 'public, max-age=300' });
          } catch (_) {}
        }
        // 2) Per-colo edge cache.
        const cache = caches.default;
        const cacheKey = new Request(`${url.origin}/__previews_pool?c=${pvCountry}`, { method: 'GET' });
        const hit = await cache.match(cacheKey);
        if (hit) return hit;
        // 3) Cold build (first visitor before the cron has populated KV). eBay-ONLY here.
        const pool = await buildPreviewsPool(pvCountry, env);
        if (env.CACHE) { try { await env.CACHE.put(`previews:${pvCountry}`, JSON.stringify({ items: pool, ts: Date.now() }), { expirationTtl: 3600 }); } catch (_) {} }
        const resp = jsonResp(
          { items: shuffle(pool), total: pool.length, country: pvCountry, cached: true },
          200,
          { 'Cache-Control': 'public, max-age=1800' }
        );
        try { await cache.put(cacheKey, resp.clone()); } catch (_) {}
        return resp;
      }

      // ── BEST DEALS feed:  GET ...?bestdeals=1 ──
      // Scans popular categories and surfaces ONLY genuine deals: a real seller markdown
      // ("Was $X") and/or a price well below the going rate for similar listings. Buy-It-Now
      // only (auctions' low "current" price is misleading). Uses only cheap signals already
      // present in the search results (discount % + below-median) — no per-item lookups — and
      // caches the result in KV for ~15 min so it never hammers the API.
      if (url.searchParams.get('bestdeals') === '1') {
        const c = detectCountry(request);
        if (env.CACHE) {
          try {
            const kv = await env.CACHE.get(`bestdeals:${c}`, 'json');
            if (kv && kv.items && kv.items.length)
              return jsonResp({ items: kv.items, total: kv.items.length, country: c, cached: 'kv' }, 200, { 'Cache-Control': 'public, max-age=300' });
          } catch (_) {}
        }
        // Popular, deal-rich categories across the whole catalogue — deliberately broad so the
        // feed isn't dominated by one type. Each is fairly homogeneous (a single product line)
        // so the "typical price" baseline means something.
        const TERMS = [
          'Nike Dunk','Air Jordan 1','New Balance 550',                                  // sneakers
          'Ralph Lauren polo','Stussy hoodie','Carhartt jacket','North Face jacket','Lululemon', // apparel
          'Seiko watch','Casio G-Shock',                                                 // watches
          'Coach handbag','Michael Kors bag',                                            // bags
          'iPhone 15','iPad Pro','AirPods Pro','Apple Watch','MacBook Air','Kindle',     // apple / e-readers
          'Sony WH-1000','Bose headphones','JBL speaker',                                // audio
          'PlayStation 5','Nintendo Switch','Xbox Series X',                             // gaming
          'GoPro Hero',                                                                  // cameras
          'Pokemon booster box','Funko Pop','Lego Star Wars','Hot Wheels',               // collectibles / toys
          'Stanley tumbler','Le Creuset','Dyson Airwrap'                                 // home / lifestyle
        ];
        // Accessories / spare parts / wrong-class / broken listings — never a "best deal",
        // even when cheap. These are what produce $12 Dyson hoses and $1.6k "watch holders".
        const JUNK = /\b(adapter|adaptor|attachment|nozzle|hose|filter|brush\s?head|bristle|replacement|spare|compatible|protector|tempered\s?glass|lanyard|keychain|keyring|sticker|decal|skin|sleeve|cable|charger|holder|bracket|mount|stand|strap|case\s+for|cover\s+for|display|for\s+(dyson|iphone|samsung|nintendo|ps[45]|xbox|airpods|apple\s?watch)|for\s+parts|not\s+working|spares\s+or\s+repair|faulty|broken|damaged|as\s+is)\b/i;
        const MIN_PRICE = 25; // skip trivial low-value items in the flagship feed
        const results = await Promise.allSettled(TERMS.map(t => searchEbay(t, c, '', env)));
        const deals = [];
        results.forEach((r, ti) => {
          if (r.status !== 'fulfilled' || !Array.isArray(r.value.items)) return;
          // Buy-It-Now, real image, sensible price, and NOT an accessory/part/broken listing.
          const items = r.value.items.filter(i =>
            i.image && i.price >= MIN_PRICE && i.title && !JUNK.test(i.title) &&
            Array.isArray(i.buyingOptions) && i.buyingOptions.includes('FIXED_PRICE'));
          if (items.length < 8) return; // need enough listings to judge a "typical" price

          // Robust "typical" = median of the INTERQUARTILE range (p25..p75): strips lots / rare
          // colourways at the top and bottom-feeders, so normal items don't all read as 66% below.
          const sorted = items.map(i => i.price).sort((a, b) => a - b);
          const at = p => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)))];
          const lo = at(0.25), hi = at(0.75), floor = at(0.10);
          const mid = sorted.filter(p => p >= lo && p <= hi);
          const typical = mid.length ? mid[Math.floor(mid.length / 2)] : (sorted[Math.floor(sorted.length / 2)] || 0);
          // Only trust "below typical" when listings are similar enough for a baseline to mean
          // something. A wide spread (e.g. "Omega" mixing $80 holders with $8k watches, or "PS5"
          // mixing $30 games with $600 consoles) makes it meaningless — markdowns only for those.
          const trustBelow = lo > 0 && (hi / lo) <= 3;

          const termDeals = [];
          for (const it of items) {
            let dealPct = 0, reason = '';
            // (1) genuine seller markdown — reliable, eBay's own "was / now".
            if (it.discountPct >= 15) { dealPct = it.discountPct; reason = 'markdown'; }
            // (2) below the typical price — only for homogeneous terms, only in a believable band.
            if (trustBelow && typical > 0 && it.price >= floor) {
              const belowPct = Math.round((1 - it.price / typical) * 100);
              if (belowPct >= 20 && belowPct <= 55 && belowPct > dealPct) {
                dealPct = belowPct; reason = 'below';
              }
            }
            if (dealPct >= 15) termDeals.push({ ...it, dealPct, dealReason: reason, dealTerm: ti });
          }
          // Cap each category's contribution so one term can't flood the whole feed.
          termDeals.sort((a, b) => b.dealPct - a.dealPct);
          deals.push(...termDeals.slice(0, 4));
        });
        // Dedupe by itemId.
        const seen = new Set();
        const unique = deals.filter(d => d.itemId && !seen.has(d.itemId) && seen.add(d.itemId));
        // Interleave (round-robin) across the source categories so the feed stays varied instead
        // of a wall of one type — strongest deal from each category first, then the next, etc.
        const groups = {};
        for (const d of unique) (groups[d.dealTerm] = groups[d.dealTerm] || []).push(d);
        for (const k in groups) groups[k].sort((a, b) => b.dealPct - a.dealPct);
        const gkeys = Object.keys(groups);
        const ranked = [];
        let pulled = true;
        while (pulled && ranked.length < 60) {
          pulled = false;
          for (const k of gkeys) {
            const g = groups[k];
            if (g && g.length) { ranked.push(g.shift()); pulled = true; if (ranked.length >= 60) break; }
          }
        }
        if (env.CACHE) { try { await env.CACHE.put(`bestdeals:${c}`, JSON.stringify({ items: ranked, ts: Date.now() }), { expirationTtl: 900 }); } catch (_) {} }
        return jsonResp({ items: ranked, total: ranked.length, country: c }, 200, { 'Cache-Control': 'public, max-age=300' });
      }

      const make     = (url.searchParams.get('make')     || '').trim();
      const model    = (url.searchParams.get('model')    || '').trim();
      const year     = (url.searchParams.get('year')     || '').trim();
      // Route by the visitor's real location (Cloudflare geo)
      const country  = detectCountry(request);
      const q             = (url.searchParams.get('q')        || '').trim();
      const maxPriceParam = (url.searchParams.get('maxPrice') || '').trim();

      const rawKeywords = q || [make, model, year].filter(Boolean).join(' ');
      if (!rawKeywords) return jsonResp({ error: 'Missing search query', items: [], total: 0 }, 400);

      // Edge-cache identical searches for 5 min (tracking links are not per-user, so this is safe).
      // Makes repeat searches + homepage personalization near-instant.
      const qCache = caches.default;
      const qKey = new Request(`${url.origin}/__q?v=${ENGINE_VERSION}&k=${encodeURIComponent(rawKeywords.toLowerCase())}&c=${country}&mp=${encodeURIComponent(maxPriceParam)}`, { method: 'GET' });
      const qHit = await qCache.match(qKey);
      if (qHit) return qHit;

      // Understand the request + run the shared search (same engine the assistant uses).
      const { items, meta } = await searchListings(rawKeywords, maxPriceParam, country, env);
      const qResp = jsonResp({ items, ...meta, etsyCount: 0, country, cached: false }, 200, { 'Cache-Control': 'public, max-age=300' });
      try { await qCache.put(qKey, qResp.clone()); } catch (_) {}
      return qResp;

    } catch (err) {
      return jsonResp({ error: String(err?.message || err), items: [], total: 0 }, 500);
    }
  },
};