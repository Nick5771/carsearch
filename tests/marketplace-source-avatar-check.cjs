const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(path.join(__dirname,'..','findai-app.html'),'utf8');const source=fs.readFileSync(path.join(__dirname,'..','findai-worker.js'),'utf8').replace('export default {','globalThis.worker = {');
function extract(name){const start=html.indexOf('function '+name+'('),end=html.indexOf('\nfunction ',start+10);return html.slice(start,end);}
const ctx=vm.createContext({console,URL,Request,Response,Headers,AbortSignal,TextEncoder,TextDecoder,setTimeout,clearTimeout});vm.runInContext(source,ctx);
const front=vm.createContext({URL});vm.runInContext(extract('wishwaveAllowedListing'),front);
const allowed=[{source:'eBay',url:'https://www.ebay.com.au/itm/123'},{source:'StockX',url:'https://stockx.com/nike-dunk-low'},{source:'AliExpress',url:'https://s.click.aliexpress.com/e/test'},{source:'Etsy',url:'https://www.etsy.com/listing/123'},{source:'findai',itemId:'lst_123'}];
const blocked=[{source:'Puma',url:'https://au.puma.com/shoe'},{source:'GO',url:'https://go.example/shoe'},{source:'StockX',url:'https://unapproved.example/shoe'},{source:'Amazon',url:'https://amazon.com/product'},{source:'Discogs',url:'https://discogs.com/release/123'},{source:'BrickLink',url:'https://bricklink.com/item'}];
for(const item of allowed){assert(ctx.wishwaveAllowedShoppingListing(item));assert(front.wishwaveAllowedListing(item));}
for(const item of blocked){assert(!ctx.wishwaveAllowedShoppingListing(item));assert(!front.wishwaveAllowedListing(item));}
assert.equal(ctx.wishwaveShoppingNormaliseItem({...blocked[0],title:'Puma shoe',price:100},'shoe','AU','retailer'),null);
assert.equal(ctx.webIndexOfferFromRow({product_url:'https://au.puma.com/shoe',retailer_name:'Puma',price:100}),null);
const saved=vm.createContext({URL,localStorage:{getItem:()=>JSON.stringify([blocked[0],allowed[0],blocked[1],allowed[1]])},trackedKey:item=>item.url});vm.runInContext(extract('wishwaveAllowedListing')+'\n'+extract('getTracked'),saved);assert.equal(saved.getTracked().length,2);assert.equal(saved.getTracked()[1].source,'StockX');console.log('PASS cached Likes are filtered consistently before tile and click indices are assigned');
console.log('PASS frontend and backend admit only the four external marketplaces plus WishWave user listings, including legacy indexed offers');
const avatar=vm.createContext({document:{addEventListener(){}},escapeAttr:s=>s,escapeHTML:s=>s,getAccountProfile:()=>({username:'nick',avatar:'https://example.com/current.jpg'}),socialProfileListings:[{itemId:'lst_123'}]});
vm.runInContext(['findaiDefaultAvatarSvg','findaiAvatarLoadError','findaiAvatarImgMarkup','wishwaveSellerMeta','wishwaveAvatarMarkup'].map(extract).join('\n'),avatar);
assert.equal(avatar.wishwaveSellerMeta({itemId:'lst_123',sellerAvatar:'https://example.com/stale.jpg'}).avatar,'https://example.com/current.jpg');assert.equal(avatar.wishwaveSellerMeta({itemId:'lst_other',sellerUsername:'someone',sellerAvatar:'https://example.com/other.jpg'}).avatar,'https://example.com/other.jpg');
assert(avatar.wishwaveAvatarMarkup({avatar:'https://example.com/avatar.jpg'}).includes('findaiAvatarLoadError(this)'));
const img={parentElement:{querySelector:()=>null,classList:{contains:()=>false}},outerHTML:''};avatar.findaiAvatarLoadError(img);assert(img.outerHTML.includes('findai-default-avatar-icon'));assert(avatar.findaiDefaultAvatarSvg().includes('r="32"'));
console.log('PASS own listing uses current avatar, other sellers retain theirs, failed photos receive a complete circular fallback');
for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)){if(match[1].trim()&&!/application\/ld\+json/.test(match[0].split('>')[0]))new vm.Script(match[1]);}console.log('PASS all inline scripts compile');
