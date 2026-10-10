const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'..','findai-worker.js'),'utf8').replace('export default {','globalThis.worker = {');
function runtime(products,market){
 const cache=new Map(),calls=[],ctx=vm.createContext({console:{warn(){}},URL,Request,Response,Headers,TextEncoder,TextDecoder,AbortSignal,setTimeout:(fn,ms)=>setTimeout(fn,Math.min(ms,1)),clearTimeout,
 fetch:async url=>{calls.push(url);return {ok:true,json:async()=>url.includes('/search?')?{products}:market(url)};}});
 vm.runInContext(source,ctx);ctx.getStockxToken=async()=>'test-token';
 return {ctx,calls,env:{STOCKX_API_KEY:'test-key',CACHE:{get:async k=>cache.get(k)||null,put:async(k,v)=>cache.set(k,JSON.parse(v))}},cache};
}
(async()=>{
 let checks=0;const pass=n=>{checks++;console.log('PASS '+n);};
 const p=(id,title)=>({productId:id,title,urlKey:id});
 // One empty-priced catalogue result must not suppress later valid asks.
 let r=runtime([p('empty','Jordan 1 High'),p('priced','Jordan 1 Low')],url=>[{currencyCode:'AUD',lowestAskAmount:url.includes('/priced/')?'180':null,highestBidAmount:'80'}]);
 let out=await r.ctx.stockxSearch('jordan 1','AUD',r.env,1);assert.equal(out.length,1);assert.equal(out[0]._pid,'priced');pass('Skip first matching product without an asking price');
 // Cache write and read must refer to the same per-product key across searches.
 assert.equal(r.cache.get('stockxprice-restored-v1:AUD:priced').lowestAsk,180);
 r.calls.length=0;out=await r.ctx.stockxSearch('Jordan 1 Low','AUD',r.env,1);assert.equal(out[0].price,180);assert(!r.calls.some(x=>x.includes('/priced/market-data')));pass('Reuse per-product ask cache for a different search phrase');
 r=runtime([p('wrong','Jordan 4 High'),p('right','Jordan 1 Low')],()=>[{lowestAskAmount:'200'}]);
 out=await r.ctx.stockxSearch('jordan 1','AUD',r.env,1);assert.equal(out[0]._pid,'right');pass('Keep single-digit models in catalogue relevance gate');
 out=await r.ctx.stockxSearch('Nike Air Jordan 1','AUD',r.env,1);assert.equal(out[0]._pid,'right');
 assert.equal(r.ctx.wishwaveShoppingQueryCoverage({title:'Jordan 1 Low'},'Nike Air Jordan 1'),1);pass('Match canonical Air Jordan query to StockX Jordan title');
 for(const q of ['Jordan 1','Air Jordan 1','Nike Air Jordan 1','AJ1'])assert.equal(r.ctx.parseSearchIntent(q).keywords,'air jordan 1');pass('Normalize Jordan aliases without duplicating Air');
 r=runtime([{productId:'jordan-image',title:'Jordan 1 Retro Low OG SP',urlKey:'air-jordan-1-retro-low-og-sp'}],()=>[{lowestAskAmount:'200'}]);
 out=await r.ctx.stockxSearch('Jordan 1','AUD',r.env,1);assert(out[0].image.includes('OG-SP-Product.jpg'));assert(out[0].imageFallbacks.length>0);assert.equal(out[0].images.length,1);pass('Preserve CDN acronym case and separate image fallbacks from gallery photos');
 r=runtime([p('yeezy','adidas Yeezy Boost 350 V2')],()=>[{lowestAskAmount:'220'}]);
 out=await r.ctx.stockxSearch('yeezy 350s shoes','AUD',r.env,1);assert.equal(out.length,1);assert(r.calls[0].includes('yeezy%20350%20shoes'));pass('Normalize plural model aliases and ignore footwear descriptor for relevance');
 for(const q of ['Asics Gel Kayano 14','Hoka Clifton 9','Puma Suede','Converse Chuck Taylor','Vans Old Skool','Reebok Club C','Saucony Jazz','Salomon XT-6','On Cloud 5','Adidas Sambas'])assert.equal(r.ctx.wishwaveShoppingStockxCategory(q),'sneakers');pass('Route additional footwear brands to StockX');
 r.ctx.stockxSearch=async()=>{throw Error('StockX catalogue request failed (429)');};
 await assert.rejects(r.ctx.findAIFetchSpecialistResults('Nike Dunk',{},'AU',r.env),/429/);pass('Expose StockX failure instead of claiming a completed empty check');
 // Actual outer source deadline must allow a cold response beyond the old 3.6s cutoff.
 const ctx=vm.createContext({console,URL,Request,Response,Headers,TextEncoder,TextDecoder,AbortSignal,setTimeout,clearTimeout});vm.runInContext(source,ctx);
 ctx.searchEbay=async()=>({items:[]});ctx.findAIFetchSpecialistResults=async()=>{await new Promise(resolve=>setTimeout(resolve,3800));return [{source:'StockX',title:'Nike Dunk Low Panda',price:100,currency:'AUD',url:'https://stockx.com/nike-dunk-low-panda',image:'https://images.stockx.com/test.jpg',condition:'New'}];};
 const data=await ctx.wishwaveShoppingEngineSearch('Nike Dunk','AU',{},null,{limit:4});assert.equal(data.items[0].source,'StockX');assert.equal(data.sourceHealth.stockx.status,'returned');pass('Retain cold StockX result after 3.6s');
 console.log(checks+' StockX integration checks passed');
})().catch(e=>{console.error(e);process.exitCode=1});
