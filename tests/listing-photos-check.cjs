const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(__dirname+'/../findai-worker.js','utf8'),cache=new Map(),writes=[];let calls=0;
const env={
 CACHE:{get:async k=>cache.get(k),put:async(k,v)=>cache.set(k,JSON.parse(v))},
 DB:{prepare(sql){return {bind(...args){this.args=args;return this;},async run(){writes.push({sql,args:this.args});}};}}
};
const ctx=vm.createContext({URL,URLSearchParams,Date,Map,Set,Number,String,Array,JSON,Math,
 catalogueCountry:c=>c,rateLimited:async()=>false,tooManyResp:()=>new Response('',{status:429}),jsonResp:(b,s=200)=>new Response(JSON.stringify(b),{status:s}),
 getEbayToken:async()=>'',ebayTrafficEnv:(e,lane)=>{assert.equal(lane,'enrichment');return e;},EBAY_MARKETPLACES:{US:'EBAY_US'},
 ebayBrowseFetch:async(e,url)=>{calls++;assert(url.startsWith('https://api.ebay.com/buy/browse/v1/item/'));const id=decodeURIComponent(url.split('/').at(-1));return new Response(JSON.stringify({itemId:id,image:{imageUrl:'https://i.ebayimg.com/front.jpg'},additionalImages:[{imageUrl:'https://i.ebayimg.com/back.jpg'}]}));},
 etsyRequest:async()=>({ok:true,results:[{listing_id:123456789,Images:[{rank:2,url_fullxfull:'https://i.etsystatic.com/back.jpg'},{rank:1,url_fullxfull:'https://i.etsystatic.com/front.jpg'}]}]}),
 wishwaveShoppingSourceKey:x=>x.source,RecommendationShoppingCore:{cleanItem:x=>({...x}),available:()=>true},RecommendationInterestCore:{},findAIEtsyListingId:()=>null});
vm.runInContext(source.slice(source.indexOf('// Real listing galleries'),source.indexOf('function catalogueDocument')),ctx);
(async()=>{
 const item={source:'ebay',itemId:'v1|123456789123|0',title:'Camera',price:50,currency:'USD',url:'https://www.ebay.com/itm/123456789123',image:'https://i.ebayimg.com/front.jpg',images:['https://i.ebayimg.com/front.jpg','https://i.ebayimg.com/back.jpg'],additionalImages:[{imageUrl:'https://i.ebayimg.com/side.jpg'},{imageUrl:'javascript:bad'}]};
 assert.equal(ctx.cataloguePublicItem(item).images.length,3,'catalogue cannot reduce a seller gallery to its cover');
 const request=()=>new Request('https://test/recommendations/listing-images?source=ebay&id='+encodeURIComponent(item.itemId)+'&country=US');
 const results=await Promise.all([ctx.wishwaveListingImages(request(),env),ctx.wishwaveListingImages(request(),env)]);assert.equal(calls,1,'concurrent gallery reads share a provider request');const data=await results[0].json();assert.equal(data.images.length,2);assert.equal(data.itemId,item.itemId);
 await ctx.wishwaveListingImages(request(),env);assert.equal(calls,1,'repeat views use the cached gallery');assert.equal(writes.length,1);assert(!writes[0].sql.includes('observed_at='),'photos must not make old prices appear fresh');
 const etsy=await(await ctx.wishwaveListingImages(new Request('https://test/recommendations/listing-images?source=etsy&id=123456789&country=US'),env)).json();assert(etsy.images[0].endsWith('front.jpg'));assert.equal(etsy.images.length,2);
 const bad=await ctx.wishwaveListingImages(new Request('https://test/recommendations/listing-images?source=ebay&id=https://attacker.test'),env);assert.equal(bad.status,400);assert.equal(calls,1);
 console.log('PASS: catalogue preserves real gallery arrays; eBay/Etsy identity, cache and request sharing; enrichment budget lane; URL guards; photo persistence does not refresh price timestamps');
})().catch(e=>{console.error(e);process.exitCode=1});
