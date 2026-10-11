const fs=require('fs'),vm=require('vm'),assert=require('assert');
const {DatabaseSync}=require('node:sqlite');
const crypto=require('crypto').webcrypto;
const source=fs.readFileSync(__dirname+'/../findai-worker.js','utf8');
const block=source.slice(source.indexOf('// ── WishWave shared eBay gateway'),source.indexOf('// ── End shared eBay gateway'));
let now=Date.parse('2026-10-11T12:00:00Z');
class Clock extends Date{constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}}
function database(){const sql=new DatabaseSync(':memory:');return {sql,prepare(text){let args=[];return {bind(...a){args=a;return this;},async first(){return sql.prepare(text).get(...args)||null;},async run(){return sql.prepare(text).run(...args);},async all(){return {results:sql.prepare(text).all(...args)};}};},async batch(statements){sql.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};}
function cache(){const values=new Map();return {values,async get(key,type){const hit=values.get(key);if(!hit||hit.expiry<=now)return null;return type==='json'?JSON.parse(hit.value):hit.value;},async put(key,value,{expirationTtl}){values.set(key,{value,expiry:now+expirationTtl*1000});}};}
function context(upstream=async()=>Response.json({itemSummaries:[{itemId:'1',title:'Dunk',price:{value:'100'}}],total:500})){
 const c=vm.createContext({console:{warn(){}},Date:Clock,Math,Map,WeakMap,JSON,Number,String,URL,Response,Headers,Uint8Array,TextEncoder,crypto,setTimeout,
 fetchWithTimeout:upstream});vm.runInContext(block,c);return c;
}
const url='https://api.ebay.com/buy/browse/v1/item_summary/search?q=dunk&limit=200&offset=0';
const options={headers:{Authorization:'Bearer private-token','X-EBAY-C-MARKETPLACE-ID':'EBAY_AU'}};
(async()=>{
 // Separate VM contexts represent different Worker isolates against the SAME D1.
 const db=database(),env={DB:db,EBAY_DAILY_CALL_LIMIT:'100',EBAY_BUDGET_HEADROOM_PERCENT:'0',EBAY_BUDGET_BURST_PERCENT:'100',EBAY_RESERVATION_BLOCK_SIZE:'1'};
 const regions=Array.from({length:8},()=>context());
 const approvals=await Promise.all(Array.from({length:200},(_,i)=>regions[i%8].reserveEbayCalls(env,'foreground')));
 assert.equal(approvals.filter(x=>x.ok).length,100,'global cap cannot be overspent by concurrent isolates');
 assert.equal(db.sql.prepare('SELECT used FROM wishwave_ebay_budget').get().used,100);
 const dayStatus=await regions[0].ebayGatewayStatus(env);assert.equal(dayStatus.remainingDaily,0);
 now+=86400000;assert.equal((await regions[0].reserveEbayCalls(env)).ok,true,'new UTC day gets new budget');
 db.sql.close();

 const caps=database(),c=context(),capped={DB:caps,EBAY_DAILY_CALL_LIMIT:'100',EBAY_BUDGET_HEADROOM_PERCENT:'0',EBAY_BUDGET_BURST_PERCENT:'100',EBAY_BACKGROUND_PERCENT:'20',EBAY_ENRICHMENT_PERCENT:'10'};
 const bg=await Promise.all(Array.from({length:35},()=>c.reserveEbayCalls(capped,'background')));assert.equal(bg.filter(x=>x.ok).length,20);
 const extra=await Promise.all(Array.from({length:15},()=>c.reserveEbayCalls(capped,'enrichment')));assert.equal(extra.filter(x=>x.ok).length,10);
 const shoppers=await Promise.all(Array.from({length:100},()=>c.reserveEbayCalls(capped,'foreground')));assert.equal(shoppers.filter(x=>x.ok).length,70,'background cannot consume shopper reserve');
 assert.equal((await c.reserveEbayCalls({DB:caps,EBAY_DAILY_CALL_LIMIT:'0'})).ok,false,'zero disables new upstream work');
 caps.sql.close();

 const paced=database(),pc=context(),pe={DB:paced,EBAY_DAILY_CALL_LIMIT:'100',EBAY_BUDGET_HEADROOM_PERCENT:'0'};
 now=Date.parse('2026-10-11T00:00:00Z');
 const burst=await Promise.all(Array.from({length:40},()=>pc.reserveEbayCalls(pe)));assert.equal(burst.filter(x=>x.ok).length,25);
 now+=12*3600000;const noon=await Promise.all(Array.from({length:50},()=>pc.reserveEbayCalls(pe)));assert.equal(noon.filter(x=>x.ok).length,37,'allowance releases progressively through the day');
 paced.sql.close();

 const batched=database(),bc=context(),be={DB:batched,EBAY_DAILY_CALL_LIMIT:'1000000',EBAY_BUDGET_BURST_PERCENT:'100'};
 const million=await Promise.all(Array.from({length:33},()=>bc.reserveEbayCalls(be)));assert(million.every(x=>x.ok));
 assert.equal(batched.sql.prepare('SELECT used FROM wishwave_ebay_budget').get().used,48,'large allowances use conservative blocks without concurrent block wastage');
 assert.equal(bc.ebayGatewayConfig(be).approved,1000000);batched.sql.close();

 let calls=0;const sharedDb=database(),kv=cache();const se={DB:sharedDb,CACHE:kv,EBAY_DAILY_CALL_LIMIT:'100',EBAY_BUDGET_HEADROOM_PERCENT:'0',EBAY_BUDGET_BURST_PERCENT:'100'};
 const live=async()=>{calls++;await new Promise(r=>setTimeout(r,15));return Response.json({itemSummaries:[{itemId:'1'}],total:500});};
 const a=context(live),b=context(live);
 const results=await Promise.all(Array.from({length:20},(_,i)=>(i%2?a:b).ebayBrowseFetch(se,url,options)));
 assert(results.every(x=>x.ok));assert.equal(calls,1,'distributed lease and local coalescing fetch a shared window once');
 await b.ebayBrowseFetch(se,url,{headers:{...options.headers,Authorization:'Bearer rotated-token'}});assert.equal(calls,1,'token rotation does not invalidate public result cache');
 await a.ebayBrowseFetch(se,url.replace('offset=0','offset=200'),options);assert.equal(calls,2,'pagination windows stay separate');
 await a.ebayBrowseFetch(se,url,{headers:{...options.headers,'X-EBAY-C-MARKETPLACE-ID':'EBAY_US'}});assert.equal(calls,3,'regions never share destination-specific prices or shipping');
 for(const key of kv.values.keys())assert(!key.includes('private-token')&&!key.includes('dunk'),'keys are hashes without credentials or image data');

 // Saturate the allowance after expiry of the fresh portion; the remaining valid
 // snapshot may be used, but neither its fetch time nor its six-hour expiry resets.
 sharedDb.sql.prepare('UPDATE wishwave_ebay_budget SET used=100').run();
 const originalAt=Number(results[0].headers.get('X-WishWave-Ebay-Fetched-At'));
 now+=5*3600000;const stale=await a.ebayBrowseFetch(se,url,options);assert(stale.ok);assert.equal(stale.headers.get('X-WishWave-Ebay-State'),'quota_cache');assert.equal(Number(stale.headers.get('X-WishWave-Ebay-Fetched-At')),originalAt);assert.equal(calls,3);
 now+=3600000;const expired=await a.ebayBrowseFetch(se,url,options);assert.equal(expired.status,503,'expired listings cannot be served indefinitely');assert.equal(calls,3);
 // CACHE failure / missing DB never fall back to uncontrolled upstream requests.
 const missing=context(live);assert.equal((await missing.ebayBrowseFetch({CACHE:cache()},url,options)).status,503);assert.equal(calls,3);
 sharedDb.sql.close();

 const throttleDb=database(),te={DB:throttleDb,CACHE:cache(),EBAY_BUDGET_BURST_PERCENT:'100'};let attempts=0;
 const throttled=context(async()=>{attempts++;return new Response('{}',{status:429,headers:{'Retry-After':'300'}});});
 assert.equal((await throttled.ebayBrowseFetch(te,url,options)).status,429);
 const remote=context(async()=>{attempts++;return Response.json({itemSummaries:[]});});
 assert.equal((await remote.ebayBrowseFetch(te,url+'&different=1',options)).status,503);assert.equal(attempts,1,'provider cooldown is shared across isolates');
 now=Date.parse(new Clock(now).toISOString().slice(0,10)+'T23:59:30Z');await throttled.ebayGatewayCooldown(te,new Response('{}',{status:429,headers:{'Retry-After':'300'}}),now);now+=60000;assert.equal((await context().reserveEbayCalls(te)).ok,false,'provider cooldown survives UTC rollover');
 throttleDb.sql.close();

 // The actual Worker shares compiled result windows, slices pages without rebuilding,
 // caps downstream cache TTLs and keeps its diagnostic private.
 const fullSource=source.replace('export default {','globalThis.worker = {');
 const wc=vm.createContext({console,Date:Clock,Math,Map,WeakMap,Set,JSON,Number,String,URL,Request,Response,Headers,Uint8Array,TextEncoder,TextDecoder,crypto,setTimeout,clearTimeout});vm.runInContext(fullSource,wc);
 const windowDb=database(),windowEnv={DB:windowDb,CACHE:cache()};let builds=0;
 wc.wishwaveShoppingEngineSearch=async(q,c,e,ctx,opts)=>{builds++;return {items:Array.from({length:200},(_,i)=>({id:opts.sourceOffset+'-'+i,title:q,price:100})),country:c,sourceHealth:{ebay:{status:'returned'}},ebayHasMore:opts.sourceOffset===0};};
 const route=async(page,extra={})=>wc.worker.fetch(new Request('https://worker.test/search',{method:'POST',body:JSON.stringify({query:'Dunks',country:'AU',limit:40,page,...extra})}),windowEnv,{waitUntil(){}});
 const p1=await (await route(1)).json(),p2=await (await route(2)).json();assert.equal(builds,1);assert.equal(p1.listings[0].id,'0-0');assert.equal(p2.listings[0].id,'0-40');
 await route(6);assert.equal(builds,2,'next source window builds independently');await route(1,{country:'US'});assert.equal(builds,3,'compiled windows isolate regions');await route(1,{passive:true});assert.equal(builds,4,'passive batches cannot replace complete live batches');
 const report=await wc.worker.fetch(new Request('https://worker.test/admin/ebay/quota'),windowEnv,{waitUntil(){}});assert.equal(report.status,403);
 const bounded=wc.jsonResp({items:[{_ebayFetchedAt:now-21600000,title:'expired'},{_ebayFetchedAt:now-21540000,title:'current'}]},200,{'Cache-Control':'public, max-age=300, s-maxage=600'});assert.equal((await bounded.json()).items.length,1);assert(bounded.headers.get('Cache-Control').includes('max-age=55'));
 windowDb.sql.close();

 // Reject a syntactically valid but forbidden host before any upstream work.
 await assert.rejects(()=>context(live).ebayBrowseFetch(se,'https://attacker.test/buy/browse/v1/item/1'),/Unexpected/);
 console.log('PASS: real SQLite global quota race, UTC reset, protected shopper allowance, day pacing, million-call block reservations, cross-isolate deduplication, pagination/region isolation, unchanged freshness, exhausted-quota fallback, fail-closed storage and shared 429 cooldown');
})().catch(e=>{console.error(e);process.exitCode=1;});
