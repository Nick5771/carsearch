const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'..','findai-worker.js'),'utf8').replace(/^import .*;\n/gm,'').replace('export default {','globalThis.worker = {');
const listing=(id=123)=>({listing_id:id,shop_id:45,state:'active',quantity:1,title:'Vintage ceramic vase &amp; bowl',price:{amount:7595,divisor:100,currency_code:'AUD'}});
function runtime(mode='success'){
 const calls=[],cache=new Map();
 const ctx=vm.createContext({console,URL,URLSearchParams,Request,Response,Headers,TextEncoder,TextDecoder,AbortController,AbortSignal,setTimeout,clearTimeout,
 fetch:async(url,options)=>{
   calls.push({url:String(url),options});
   if(mode==='network')throw Error('private upstream detail');
   if(mode==='auth')return new Response('secret-key:secret-value',{status:403});
   if(mode==='invalid')return Response.json({bad:'response'});
   const pathname=new URL(url).pathname;
   if(!['/v3/application/listings/active','/v3/application/listings/batch'].includes(pathname))return new Response('Unknown endpoint',{status:404});
   const detail=pathname==='/v3/application/listings/batch';
   if(mode==='images-failed'&&detail)return new Response('down',{status:503});
   return Response.json({count:1,results:mode==='empty'?[]:[{...listing(),...(detail?{images:[{rank:2,url_fullxfull:'https://i.etsystatic.com/other.jpg'},{rank:1,url_fullxfull:'https://i.etsystatic.com/vase.jpg'}]}:{} )}]});
 }});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'..','wishwave-compare.js'),'utf8'),ctx);
 vm.runInContext(source,ctx);
 return {ctx,calls,env:{ETSY_KEY:'test-key',ETSY_SHARED_SECRET:'test-secret',CACHE:{get:async k=>cache.get(k)||null,put:async(k,v)=>cache.set(k,JSON.parse(v))}}};
}
(async()=>{
 let checks=0;const pass=name=>{checks++;console.log('PASS '+name);};
 let r=runtime();assert.equal(r.ctx.etsyCredentials(r.env).header,'test-key:test-secret');
 assert.equal(r.ctx.etsyCredentials({ETSY_API_KEY:'key:secret'}).configured,true);
 assert.equal(r.ctx.etsyCredentials({ETSY_KEY:'key'}).status,'missing-shared-secret');
 await assert.rejects(r.ctx.searchEtsy('vase',{},8,'AU'),/missing-api-key/);assert.equal(r.calls.length,0);pass('Credentials supported without exposing them or sending incomplete authentication');
 let items=await r.ctx.searchEtsy('vintage ceramic vase',r.env,8,'AU');
 assert.equal(items[0].price,75.95);assert.equal(items[0].currency,'AUD');assert.equal(items[0].title,'Vintage ceramic vase & bowl');
 assert.equal(items[0].image,'https://i.etsystatic.com/vase.jpg');assert.equal(items[0].images.length,2);
 assert.equal(items[0].url,'https://www.etsy.com/listing/123');assert.equal(items[0].shippingCost,null);
 assert.equal(r.calls.length,2);assert.equal(r.calls[0].options.headers['x-api-key'],'test-key:test-secret');
 const search=new URL(r.calls[0].url);assert.equal(search.searchParams.get('currency'),'AUD');assert.equal(search.searchParams.get('buyer_country'),'AU');
 const detail=new URL(r.calls[1].url);assert.equal(detail.pathname,'/v3/application/listings/batch');assert.equal(detail.searchParams.get('includes'),'Images');assert.equal(detail.searchParams.get('listing_ids'),'123');
 pass('Map live listing prices and ordered real photos using one bulk image lookup');
 await r.ctx.searchEtsy('vintage ceramic vase',r.env,8,'AU');assert.equal(r.calls.length,2);pass('Reuse successful cached results');
 await r.ctx.searchEtsy('vintage ceramic vase',r.env,8,'UK');assert.equal(r.calls.length,4);assert.equal(new URL(r.calls[2].url).searchParams.get('buyer_country'),'GB');pass('Separate market caches and send Etsy GB for UK shoppers');
 for(const mode of ['auth','network','invalid','images-failed']){
   r=runtime(mode);await assert.rejects(r.ctx.searchEtsy('vase',r.env),error=>!error.message.includes('secret-value')&&!error.message.includes('private upstream'));
 }
 pass('Report authentication/network/image errors without leaking credentials or caching failures');
 r=runtime('empty');assert.equal((await r.ctx.searchEtsy('vase',r.env)).length,0);assert.equal(r.calls.length,1);pass('Distinguish a successful empty search from a failed provider');
 r=runtime();
 assert.equal(r.ctx.etsyListingItem({...listing(),price:{amount:99,divisor:0,currency_code:'AUD'}}),null);
 assert.equal(r.ctx.etsyListingItem({...listing(),state:'sold_out'}),null);
 assert.equal(r.ctx.etsyListingItem({...listing(),quantity:0}),null);
 assert.equal(r.ctx.etsyListingItem({...listing(),images:[{url_fullxfull:'https://evil.example/x.jpg'}]}).image,'');pass('Reject invalid prices, unavailable listings and unrelated photo URLs');
 for(const q of ['vintage vase on Etsy','Etsy vintage vase','vintage vase Etsy only'])assert.equal(r.ctx.parseSearchIntent(q).source,'etsy');
 assert.equal(r.ctx.parseSearchIntent('vintage vase on Etsy').keywords,'vintage vase');pass('Recognise Etsy source filters and remove the provider name from product keywords');
 r.ctx.searchEbay=async()=>({items:[]});r.ctx.searchAliExpress=async()=>({items:[]});
 let out=await r.ctx.wishwaveShoppingEngineSearch('vintage ceramic vase on Etsy','AU',r.env,null,{limit:8});
 assert.equal(out.items.length,1);assert.equal(out.items[0].source,'Etsy');assert.equal(out.sourceHealth.etsy.status,'returned');assert.equal(out.sourceHealth.ebay,undefined);pass('Explicit Etsy search reaches the adapter and returns cards through the shared shopping engine');
 out=await r.ctx.wishwaveShoppingEngineSearch('vintage ceramic vase','AU',r.env,null,{limit:8,passive:true});
 assert.equal(out.items[0].source,'Etsy');assert.equal(out.sourceHealth.etsy.status,'returned');pass('Relevant passive recommendation queries include Etsy');
 const before=r.calls.length;await r.ctx.wishwaveShoppingEngineSearch('iPhone 17','AU',r.env,null,{limit:8});assert.equal(r.calls.length,before);pass('Unrelated product searches do not call Etsy');
 out=await r.ctx.wishwaveShoppingEngineSearch('vintage ceramic vase on Etsy','AU',{},null,{limit:8});
 assert.equal(out.sourceHealth.etsy.status,'failed');assert.match(out.sourceHealth.etsy.error,/missing-api-key/);
 assert.equal(r.ctx.wishwaveShoppingEngineStatus({}).sources.etsy.configured,false);pass('Missing configuration appears in source health instead of a silent empty result');
 r=runtime('auth');r.ctx.treasureRoute=async()=>null;
 let response=await r.ctx.worker.fetch(new Request('https://api.carsearchapi.workers.dev/etsy/search?q=vase&debug=1'),r.env,{waitUntil(){}});
 let data=await response.json();assert.equal(data.status,403);assert.equal(data.credentials,'configured');assert(!JSON.stringify(data).includes('test-secret'));assert(!JSON.stringify(data).includes('secret-value'));pass('Public diagnostic reports actual Etsy HTTP status without raw auth responses');
 response=await r.ctx.worker.fetch(new Request('https://api.carsearchapi.workers.dev/etsy/search?q=vase'),{}, {waitUntil(){}});
 data=await response.json();assert.equal(data.status,'missing-api-key');assert.equal(response.headers.get('cache-control'),'no-store');pass('Live route exposes missing credentials without caching the failure');
 r=runtime();r.ctx.stockxSearch=async()=>[{source:'StockX',title:'Nike Dunk Low Vintage',price:180,currency:'AUD',url:'https://stockx.com/nike-dunk-low-vintage',image:'https://images.stockx.com/dunk.jpg'}];
 r.ctx.searchEbay=async()=>({items:[]});r.ctx.searchAliExpress=async()=>({items:[]});
 out=await r.ctx.wishwaveShoppingEngineSearch('Nike Dunk Low Vintage','AU',r.env,null,{limit:8});assert(out.items.some(x=>x.source==='StockX'));assert.equal(r.calls.length,2);pass('StockX still returns sneaker listings while Etsy runs once in its separate lane');
 items=await r.ctx.findAIFetchSpecialistResults('vintage ceramic vase',{source:'etsy'},'AU',r.env);assert.equal(items[0].source,'Etsy');pass('Legacy search and scanner specialist calls can retrieve Etsy listings');
 console.log(checks+' Etsy integration checks passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
