const fs=require('fs'),vm=require('vm'),assert=require('assert'),{DatabaseSync}=require('node:sqlite');
const source=fs.readFileSync('findai-worker.js','utf8'),db=new DatabaseSync(':memory:');
const cache=new Map(),env={DB:{prepare(sql){let args=[];return {bind(...a){args=a;return this},async first(){return db.prepare(sql).get(...args)||null},async run(){db.prepare(sql).run(...args);return {}}}}},CACHE:{get:async k=>cache.get(k),put:async(k,v)=>cache.set(k,v),delete:async k=>cache.delete(k)},GOOGLE_CLIENT_SECRET:'test-secret',APPLE_TEAM_ID:'team',APPLE_SERVICE_ID:'service',APPLE_KEY_ID:'key',APPLE_PRIVATE_KEY:'key',APPLE_REDIRECT_URI:'https://test/auth/apple/callback'};
let exchange,upserts=0,failGoogle=false;
const c=vm.createContext({URL,URLSearchParams,Response,Request,TextEncoder,Uint8Array,crypto:require('crypto').webcrypto,btoa,atob,Date,JSON,console,appleConfigured:e=>!!e.APPLE_SERVICE_ID,jsonResp:(d,s=200,h={})=>new Response(JSON.stringify(d),{status:s,headers:h}),rateLimited:async()=>false,tooManyResp:()=>new Response(null,{status:429}),logErr:()=>{},upsertUser:async()=>{upserts++},issueSession:async()=> 'test-session',fetch:async(url,options)=>{if(String(url).includes('/token')){exchange=new URLSearchParams(options.body);return Response.json(failGoogle?{error:'bad'}:{access_token:'provider-token'},{status:failGoogle?400:200});}return Response.json({sub:'verified-subject',email:'user@example.test',email_verified:true,name:'User',picture:''});}});
vm.runInContext(source.slice(source.indexOf('function b64urlEncode('),source.indexOf('function b64urlDecodeToString(')),c);
vm.runInContext(source.slice(source.indexOf('// Native OAuth uses'),source.indexOf('// ── Unsubscribe links')),c);

const appleBlock=source.slice(source.indexOf("      // ── Sign in with Apple: start"),source.indexOf("      if (url.pathname === '/auth/google'"));
Object.assign(c,{APPLE_STATE_TTL_SEC:600,APPLE_HANDOFF_TTL_SEC:90,APPLE_AUTH_ENDPOINT:'https://appleid.apple.com/auth/authorize',APPLE_TOKEN_ENDPOINT:'https://appleid.apple.com/auth/token',appleClientSecret:async()=> 'apple-secret',verifyAppleIdentityToken:async()=>({email:'apple@example.test'}),findaiAppleStoreRefreshToken:async()=>{}});
vm.runInContext('async function testAppleRoute(request,env,ctx,url){'+appleBlock+'}',c);

async function call(path,body){const url=new URL('https://api.carsearchapi.workers.dev'+path);return c.wishwaveNativeAuthRoute(new Request(url,body?{method:'POST',body:JSON.stringify(body)}:{}),env,{},url);}
(async()=>{
 const verifier='v'.repeat(43),challenge=await c.wishwaveNativeDigest(verifier);
 let config=await (await call('/auth/native/config')).json();assert(config.apple&&config.google);
 assert.equal((await call('/auth/native/start?provider=google&challenge=bad')).status,400);
 const missing={...env,GOOGLE_CLIENT_SECRET:''};let r=await c.wishwaveNativeAuthRoute(new Request('https://test'),missing,{},new URL('https://test/auth/native/start?provider=google&challenge='+challenge));assert(new URL(r.headers.get('Location')).searchParams.get('error')==='not_configured');
 r=await call('/auth/native/start?provider=apple&challenge='+challenge);let location=new URL(r.headers.get('Location'));assert.equal(location.pathname,'/auth/apple/start');assert.equal(location.searchParams.get('client'),'native');assert.equal(location.searchParams.get('challenge'),challenge);
 async function startGoogle(){const r=await call('/auth/native/start?provider=google&challenge='+challenge);const u=new URL(r.headers.get('Location'));assert.equal(u.host,'accounts.google.com');assert.equal(u.searchParams.get('code_challenge_method'),'S256');assert(!u.toString().includes('test-secret'));return u.searchParams.get('state');}
 const state=await startGoogle();r=await call('/auth/native/google/callback?state='+state+'&code=provider-code');location=new URL(r.headers.get('Location'));assert.equal(location.protocol,'com.nickfiani.wishwave:');assert.equal(location.host,'auth');assert(!location.href.includes('test-session'));assert.equal(exchange.get('redirect_uri'),config.googleRedirectUri);assert(exchange.get('code_verifier'));assert.equal(upserts,1);
 const ticket=location.searchParams.get('ticket');assert(ticket);
 assert.equal((await call('/auth/native/complete',{ticket,verifier:'x'.repeat(43)})).status,400);
 const user=await (await call('/auth/native/complete',{ticket,verifier})).json();assert.equal(user.session,'test-session');assert.equal(user.provider,'google');assert.equal((await call('/auth/native/complete',{ticket,verifier})).status,400);
 r=await call('/auth/native/google/callback?state='+state+'&code=provider-code');assert.equal(new URL(r.headers.get('Location')).searchParams.get('error'),'state_expired');assert.equal(upserts,1);
 const cancelled=await startGoogle();r=await call('/auth/native/google/callback?state='+cancelled+'&error=access_denied');assert.equal(new URL(r.headers.get('Location')).searchParams.get('error'),'cancelled');
 failGoogle=true;const failed=await startGoogle();r=await call('/auth/native/google/callback?state='+failed+'&code=bad');assert.equal(new URL(r.headers.get('Location')).searchParams.get('error'),'failed');
 r=await c.wishwaveNativeHandoff(env,'apple',challenge,{email:'apple@example.test',session:'apple-session'});const appleTicket=new URL(r.headers.get('Location')).searchParams.get('ticket');const apple=await (await call('/auth/native/complete',{ticket:appleTicket,verifier})).json();assert.equal(apple.provider,'apple');assert.equal(apple.session,'apple-session');
 r=await c.wishwaveNativeHandoff(env,'apple',challenge,{session:'expired'});db.prepare('UPDATE wishwave_native_auth SET expires=0').run();assert.equal((await call('/auth/native/complete',{ticket:new URL(r.headers.get('Location')).searchParams.get('ticket'),verifier})).status,400);
 assert.equal(new URL(c.appleRedirect('failed','native').headers.get('Location')).protocol,'com.nickfiani.wishwave:');assert.equal(new URL(c.appleRedirect('failed','app').headers.get('Location')).pathname,'/findai-app.html');

 // Exercise the existing Apple start/callback, not just the shared ticket helper.
 const savedFetch=c.fetch;c.fetch=async()=>Response.json({id_token:'verified-apple-token'});
 let appleURL=new URL('https://test/auth/apple/start?client=native&challenge='+challenge);
 r=await c.testAppleRoute(new Request(appleURL),env,{},appleURL);
 const appleState=new URL(r.headers.get('Location')).searchParams.get('state');assert(appleState);
 appleURL=new URL('https://test/auth/apple/callback');
 r=await c.testAppleRoute(new Request(appleURL,{method:'POST',body:new URLSearchParams({state:appleState,code:'apple-code'})}),env,{},appleURL);
 location=new URL(r.headers.get('Location'));assert.equal(location.protocol,'com.nickfiani.wishwave:');assert(location.searchParams.get('ticket'));
 const appleViaCallback=await (await call('/auth/native/complete',{ticket:location.searchParams.get('ticket'),verifier})).json();assert.equal(appleViaCallback.provider,'apple');assert.equal(appleViaCallback.email,'apple@example.test');c.fetch=savedFetch;
 console.log('PASS: native OAuth configuration, provider redirects, Google code + PKCE, proof-bound handoff, wrong-proof protection, atomic replay rejection, expiry, cancel/failure and Apple/web return routes');db.close();
})().catch(e=>{console.error(e);db.close();process.exitCode=1});
