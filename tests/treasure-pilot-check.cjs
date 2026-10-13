const fs=require('fs'),vm=require('vm'),assert=require('assert'),policy=require('../findai-treasure-pilot.js');
const catalogue=require('../data/treasure-hunt-catalogue-v3.json');
assert.equal(catalogue.targets.length,500);assert.equal(new Set(catalogue.targets.map(x=>x.id)).size,500);
assert(catalogue.targets.every(x=>x.inventory===null&&x.rarityVerified===false));
const target=id=>policy.targets.find(x=>x.id===id);
const offer=(title,extra={})=>({title,price:60,currency:'USD',source:'eBay',url:'https://www.ebay.com/itm/123',image:'https://i.ebayimg.com/123.jpg',...extra});
assert(policy.match(target('FF359'),offer('LEGO Ideas Polaroid Camera 21345 SEALED')));
for(const title of ['LocoLee LED Light Kit for Lego 21345 Polaroid','LEGO 21345 empty box only','LEGO 21345 instructions only','LEGO 21345 parts only','LEGO 21345 incomplete missing pieces'])assert(!policy.match(target('FF359'),offer(title)),title);
assert(!policy.match(target('FF005'),offer('TYCO Garfield telephone 1205 tested working')));
assert(policy.match(target('FF005'),offer('TYCO Garfield telephone 1201 tested working')));
assert(!policy.match(target('FF007'),offer('Panasonic Panapet R-70 BLUE radio works')));
assert(policy.match(target('FF007'),offer('Panasonic Panapet R-70 ORANGE radio works')));
assert(!policy.match(target('FF157'),offer('Bluebird Polly Pocket Partytime Surprise 1989 Almost Complete')));
assert(!policy.match(target('FF157'),offer('Bluebird Polly Pocket Partytime Surprise 1989 complete no doll')));
assert(!policy.match(target('FF188'),offer('LEGO Bionicle Tahu 8534 set of 6 complete')));
assert(policy.match(target('FF464'),offer('Loungefly Gengar Glow Mini Backpack free shipping')),'pin exclusion must not match shipping');
for(const extra of [{price:0},{currency:'AUD'},{sold:true},{available:false},{estimatedAvailabilityStatus:'OUT_OF_STOCK'},{_ebayFetchedAt:Date.now()-7*3600000},{image:''},{source:'AliExpress'},{url:'http://www.ebay.com/123'}])assert(!policy.match(target('FF359'),offer('LEGO 21345',extra)));
assert(!policy.previewTargets.some(x=>['FF005','FF092','FF464'].includes(x.id)),'unmatched targets stay out of the preview');
const source=fs.readFileSync(__dirname+'/../findai-worker.js','utf8');
const block=source.slice(source.indexOf('function treasureActiveTargets'),source.indexOf('export default {'));
let calls=0,indexed=0;
const c=vm.createContext({globalThis:{FindAITreasureHunt:policy},URL,Date,Set,String,Array,Math,JSON,
 findAIBoolEnv:(env,name)=>['true','1'].includes(String(env[name])),
 ebayTrafficEnv:e=>e,promiseWithin:async p=>p,
 searchEbay:async()=>{calls++;return {items:[offer('LEGO Ideas Polaroid Camera 21345 SEALED'),offer('LED Light Kit for LEGO 21345')]};},
 catalogueIngest:async items=>{indexed+=items.length;},
 catalogueCountry:x=>x||'AU',jsonResp:(data,status=200)=>({data,status}),
 adminOK:(_u,e,r)=>r.headers.get('X-Admin-Key')===e.ADMIN_KEY
});vm.runInContext(block,c);
(async()=>{
 await c.treasureWarmup({DB:{}});assert.equal(calls,0,'disabled cron consumes no quota');
 await c.treasureWarmup({DB:{},TREASURE_HUNT_ENABLED:'true'});assert.equal(calls,0,'empty reviewed allowlist consumes no quota');
 await c.treasureWarmup({DB:{},TREASURE_HUNT_ENABLED:'true',TREASURE_HUNT_ACTIVE_IDS:'FF359'});assert.equal(calls,1);assert.equal(indexed,1,'only complete matched offer indexed');
 const request=(ids,key)=>new Request('https://api.test/admin/recommendations/treasure-audit',{method:'POST',headers:{'X-Admin-Key':key},body:JSON.stringify({ids})});
 let response=await c.treasureRoute(request(['FF359'],'wrong'),{ADMIN_KEY:'correct'});assert.equal(response.status,401);
 response=await c.treasureRoute(request(['FF999'],'correct'),{ADMIN_KEY:'correct'});assert.equal(response.status,400);
 response=await c.treasureRoute(request(['FF359'],'correct'),{ADMIN_KEY:'correct'});assert.equal(response.data.inventoryWritten,false);assert.equal(response.data.results[0].candidates.length,1);assert.equal(indexed,1,'admin audit is read-only inventory');
 console.log('PASS: 500 staging records; wrong models/colours, partial toys, LEGO lighting/packaging, stock/staleness/currency guards; gated bounded warmup and authenticated read-only audit');
})().catch(e=>{console.error(e);process.exitCode=1});
