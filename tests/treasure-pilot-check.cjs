const fs=require('fs'),vm=require('vm'),assert=require('assert'),policy=require('../findai-treasure-pilot.js');
const catalogue=require('../data/treasure-hunt-catalogue-v3.json');
assert.equal(catalogue.targets.length,500);assert.equal(new Set(catalogue.targets.map(x=>x.id)).size,500);
assert(catalogue.targets.every(x=>x.inventory===null&&x.rarityVerified===false));
const target=id=>policy.targets.find(x=>x.id===id);
const offer=(title,extra={})=>({title,price:60,currency:'USD',source:'eBay',url:'https://www.ebay.com/itm/123',image:'https://i.ebayimg.com/123.jpg',...extra});
assert(!policy.targets.some(x=>/nickelodeon|panasonic/i.test(x.query)),'rejected novelty picks removed');
assert.equal(new Set(policy.targets.map(x=>x.category)).size,14);
assert(policy.match(target('FF118'),offer('Nintendo Game Boy Color Atomic Purple original console')));
for(const title of ['Nintendo Game Boy Color Atomic Purple replacement shell','Nintendo Game Boy Color Atomic Purple box only','Nintendo Game Boy Color Atomic Purple not working'])assert(!policy.match(target('FF118'),offer(title)),title);
assert(policy.match(target('FF001'),offer('Vintage Carhartt Detroit Jacket J01 Brown')));
assert(!policy.match(target('FF001'),offer('Carhartt Detroit Jacket J01 Black')));
assert(!policy.match(target('FF073'),offer('Champion Magic 32 jersey youth')));
assert(!policy.match(target('FF080'),offer('Nike Barcelona Ronaldinho 2005 2006 away jersey')));
assert(!policy.match(target('FF213'),offer('Pokemon Umbreon VMAX 215/203 PSA 10')));
assert(!policy.match(target('FF224'),offer('Pokemon Magikarp 203/193 Paldea Evolved English LP')));
assert(!policy.match(target('FF459'),offer('Valentino Donna Born in Roma 50ml 15ml Gift Set')));
assert(!policy.match(target('FF425'),offer('Rare Beauty Soft Pinch Blush Hope',{condition:'Used'})));
for(const extra of [{price:0},{currency:'AUD'},{sold:true},{available:false},{estimatedAvailabilityStatus:'OUT_OF_STOCK'},{_ebayFetchedAt:Date.now()-7*3600000},{image:''},{source:'AliExpress'},{url:'http://www.ebay.com/123'}])assert(!policy.match(target('FF118'),offer('Nintendo Game Boy Color Atomic Purple',extra)));
const names={'FF001':'Carhartt Detroit Jacket J01 Brown','FF118':'Nintendo Game Boy Color Atomic Purple','FF366':'Jordan 1 Lost and Found Chicago','FF421':'rhode Peptide Lip Treatment Unscented'};
const many=Object.entries(names).flatMap(([id,title])=>Array.from({length:12},(_,i)=>({...offer(title),itemId:id+'_'+i,_interestQuery:target(id).query})));
const batch=policy.varied(many,[],30);assert.equal(batch.items.length,4,'different sizes/sellers of one target do not fill the feed');assert.equal(new Set(batch.items.map(x=>x._treasureTargetId)).size,4);
const second=policy.varied(many,batch.items,30);assert.equal(second.items.length,0,'duplicate targets remain blocked across batch boundaries');
assert.equal(policy.varied(many,batch.items.concat(Array.from({length:20},(_,i)=>({title:'Other product '+i}))),30).items.length,4,'spacing window permits later return after twenty other products');
assert.equal(policy.varied([offer('Nintendo Donkey Kong DK-52'),offer('Rolex replacement strap'),offer('LEGO 75367 complete set',{currency:'AUD'})],[],30).items.length,0,'unknown cached and wrong-market offers cannot bypass policy');
assert.equal(policy.varied([{...offer('Jordan 1 Lost and Found youth'),_interestQuery:target('FF366').query}],[],30).items.length,0,'query hints cannot authorize a mismatched offer');
const source=fs.readFileSync(__dirname+'/../findai-worker.js','utf8');
const block=source.slice(source.indexOf('function treasureActiveTargets'),source.indexOf('export default {'));
let calls=0,indexed=0;
const c=vm.createContext({globalThis:{FindAITreasureHunt:policy},URL,Date,Set,String,Array,Math,JSON,
 findAIBoolEnv:(env,name)=>['true','1'].includes(String(env[name])),
 ebayTrafficEnv:e=>e,promiseWithin:async p=>p,
 searchEbay:async()=>{calls++;return {items:[offer('Jordan 1 Lost and Found Chicago adult'),offer('Jordan 1 Lost and Found Chicago youth')]};},
 catalogueIngest:async items=>{indexed+=items.length;},
 catalogueCountry:x=>x||'AU',jsonResp:(data,status=200)=>({data,status}),
 adminOK:(_u,e,r)=>r.headers.get('X-Admin-Key')===e.ADMIN_KEY
});vm.runInContext(block,c);
(async()=>{
 await c.treasureWarmup({DB:{}});assert.equal(calls,0,'disabled cron consumes no quota');
 await c.treasureWarmup({DB:{},TREASURE_HUNT_ENABLED:'true'});assert.equal(calls,0,'empty reviewed allowlist consumes no quota');
 await c.treasureWarmup({DB:{},TREASURE_HUNT_ENABLED:'true',TREASURE_HUNT_ACTIVE_IDS:'FF366'});assert.equal(calls,1);assert.equal(indexed,1,'only complete matched offer indexed');
 const request=(ids,key)=>new Request('https://api.test/admin/recommendations/treasure-audit',{method:'POST',headers:{'X-Admin-Key':key},body:JSON.stringify({ids})});
 let response=await c.treasureRoute(request(['FF366'],'wrong'),{ADMIN_KEY:'correct'});assert.equal(response.status,401);
 response=await c.treasureRoute(request(['FF999'],'correct'),{ADMIN_KEY:'correct'});assert.equal(response.status,400);
 response=await c.treasureRoute(request(['FF366'],'correct'),{ADMIN_KEY:'correct'});assert.equal(response.data.inventoryWritten,false);assert.equal(response.data.results[0].candidates.length,1);assert.equal(indexed,1,'admin audit is read-only inventory');
 console.log('PASS: 500 staging records; revised 14-category selection, wrong variants/accessories/condition guards, cross-page seller/size duplicate spacing, gated warmup and read-only audit');
})().catch(e=>{console.error(e);process.exitCode=1});
