const fs=require('fs'),assert=require('assert'),{JSDOM}=require('jsdom');
const dom=new JSDOM('<section id="discover" class="active"><div id="feed"></div></section><div id="findaiContextualReelV168" class="show"></div>',{runScripts:'outside-only'}),w=dom.window;
let session='session',purchases=0,offers=0,login=0,fetches=0,resolve,contextualRefresh;
w.renderReelCard=()=>'<article class="reel-card"><div class="product-panel"></div></article>';
w.isFindAIListing=x=>x?.source==='findai';w.wishwaveIsOwnMarketplaceListing=(x,c)=>!!x?.own||!!c?.viewer?.isSeller;w.appMpId=x=>x.itemId;
w.eval('var currentFeedItems=[],appMpListing=null,appMpContext=null;');w.marketplaceSession=()=>session;w.appMpRequireLogin=()=>{if(!session)login++;return !!session;};w.toast=()=>{};
w.appMpBuy=()=>purchases++;w.openAppMarketplaceOfferInMessages=()=>offers++;
w.marketplaceFetch=()=>{fetches++;return new Promise(r=>resolve=r);};w.go=()=>{};w.wishwaveSetHomeFeed=(mode,refresh)=>contextualRefresh={mode,refresh};
w.eval(fs.readFileSync(__dirname+'/../wishwave-reel-commerce.js','utf8'));
const item={itemId:'native',source:'findai',status:'active',price:566,sellerUsername:'seller'};
function setup(x=item){w.currentFeedItems=[x];w.document.getElementById('feed').innerHTML=w.renderReelCard(x,0,{});return w.document.querySelector('.ww-native-reel-actions');}
function event(button){return {target:button,preventDefault(){this.prevented=true},stopPropagation(){this.stopped=true}};}
(async()=>{
 let bar=setup();assert.deepEqual([...bar.querySelectorAll('button')].map(b=>b.textContent),['Make offer','Buy now']);
 let e=event(bar.lastChild),job=w.wishwaveNativeReelAction(0,'buy',e);assert(e.prevented&&e.stopped);assert(bar.lastChild.disabled);await w.wishwaveNativeReelAction(0,'buy',e);assert.equal(fetches,1,'duplicate tap blocked');resolve({listing:item,viewer:{isSeller:false}});await job;assert.equal(purchases,1);assert(!bar.lastChild.disabled);
 bar=setup();job=w.wishwaveNativeReelAction(0,'offer',event(bar.firstChild));resolve({listing:item,viewer:{isSeller:false}});await job;assert.equal(offers,1);
 for(const changed of [{...item,status:'sold'},{...item,listingType:'auction'},{...item,own:true},{...item,source:'ebay'}])assert(!setup(changed),'ineligible listing has no purchase bar');
 assert.equal(setup({...item,offersEnabled:false}).children.length,1,'seller can disable offers');
 bar=setup();job=w.wishwaveNativeReelAction(0,'buy',event(bar.lastChild));resolve({listing:item,viewer:{isSeller:true}});await job;assert.equal(purchases,1,'server ownership blocks checkout');
 bar=setup();job=w.wishwaveNativeReelAction(0,'offer',event(bar.firstChild));resolve({listing:{...item,offersEnabled:false},viewer:{}});await job;assert.equal(offers,1,'server offers setting respected');
 bar=setup();job=w.wishwaveNativeReelAction(0,'buy',event(bar.lastChild));w.currentFeedItems=[{...item,itemId:'new'}];resolve({listing:item,viewer:{}});await job;assert.equal(purchases,1,'late response cannot buy another reel');
 bar=setup();job=w.wishwaveNativeReelAction(0,'buy',event(bar.lastChild));session='';resolve({listing:item,viewer:{}});await job;assert.equal(purchases,1,'logout invalidates request');
 bar=setup();await w.wishwaveNativeReelAction(0,'buy',event(bar.lastChild));assert.equal(login,1);
 w.wishwaveSetHomeFeed('for-you');assert.deepEqual(contextualRefresh,{mode:'for-you',refresh:true});assert(!w.document.getElementById('findaiContextualReelV168').classList.contains('show'));
 console.log('PASS: reel purchase/offer routing, auth, server ownership/status, disabled offers, duplicate taps, stale responses and contextual Home tabs');dom.window.close();
})().catch(e=>{console.error(e);dom.window.close();process.exitCode=1;});
