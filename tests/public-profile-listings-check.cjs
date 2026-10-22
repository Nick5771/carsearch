const fs=require('node:fs'),assert=require('node:assert/strict'),{JSDOM,VirtualConsole}=require('jsdom');
const source=process.env.WISHWAVE_TEST_HTML?fs.readFileSync(process.env.WISHWAVE_TEST_HTML,'utf8'):fs.readFileSync(__dirname+'/../findai-app.html','utf8');
const dom=new JSDOM(source.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,''),{url:'https://test/?country=US',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:new VirtualConsole(),beforeParse(w){w.matchMedia=()=>({matches:true,addEventListener(){},addListener(){}});w.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};w.ResizeObserver=class{observe(){}disconnect(){}};w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=function(){};w.fetch=async()=>({ok:true,json:async()=>({items:[],listings:[],comments:[]}),text:async()=>''});}});
const w=dom.window,wait=ms=>new Promise(r=>setTimeout(r,ms));
function touch(target,type,x,y=420){const e=new w.Event(type,{bubbles:true,cancelable:true});Object.defineProperties(e,{touches:{value:/end|cancel/.test(type)?[]:[{clientX:x,clientY:y}]},changedTouches:{value:[{clientX:x,clientY:y}]}});target.dispatchEvent(e);return e;}
async function back(root){touch(root,'touchstart',12);touch(root,'touchmove',310);touch(root,'touchend',310);await wait(100);}
(async()=>{
 await wait(350);w.document.body.dataset.activeTab='search';w.setMainNavActive('search');await wait(60);
 w.getAccountProfile=()=>({email:'viewer@test.com',username:'viewer'});w.marketplaceSession=()=>'fixture';w.recordInterest=()=>{};
 w.eval(fs.readFileSync(__dirname+'/../wishwave-comments-motion.js','utf8'));
 w.eval(fs.readFileSync(__dirname+'/../wishwave-navigation-origins.js','utf8'));
 const native={itemId:'native-one',marketplaceListingId:'native-one',source:'findai',title:'Seller monitor',price:249,currency:'USD',condition:'Used',image:'https://example.com/monitor.jpg',status:'active',sellerUsername:'seller',viewCount:234,likeCount:3};
 const external={itemId:'external-one',source:'ebay',title:'LEGO Death Star',price:566,currency:'USD',image:'https://example.com/lego.jpg',status:'active',viewCount:44,likeCount:1};
 const sold={...native,itemId:'sold-one',marketplaceListingId:'sold-one',status:'sold'};
 const data={seller:{id:'seller-id',username:'seller',displayName:'Seller',activeCount:2,soldCount:1},viewer:{signedIn:true,isSeller:false},listings:[native,external,sold]};
 w.eval('wishwavePublicSellerData='+JSON.stringify(data));const page=w.ensureWishWavePublicProfilePage();w.renderWishWavePublicProfile();page.classList.add('show');await wait(30);
 let checkoutCalls=0;w.wishwaveCheckoutOpenItem=()=>checkoutCalls++;
 for(const kind of ['listings','sold']){
  w.setWishWavePublicSellerTab(kind);const grid=w.document.querySelector('#wishwavePublicProfileContent .social-profile-grid'),tile=grid.firstChild,scroll=page.querySelector('.wishwave-public-profile-scroll');scroll.scrollTop=214;
  assert.equal(tile.querySelectorAll('.social-profile-tile-stat').length,1,'public tile shows only views');assert(tile.querySelector('.social-profile-tile-stat').textContent.includes('234'));
  tile.click();await wait(70);const reel=w.document.getElementById('findaiContextualReelV168');assert(reel?.classList.contains('show'),'public native tile opens a reel');assert(!page.classList.contains('show'),'profile cannot cover the listing');assert.equal(checkoutCalls,0);assert(!w.document.getElementById('wwCheckout').classList.contains('show'));assert.equal(w.eval('currentFeedItems[0].itemId'),kind==='sold'?'sold-one':'native-one');
  await back(reel.querySelector('.product-panel'));assert(page.classList.contains('show'));assert.equal(w.eval('wishwavePublicSellerTab'),kind);assert.equal(w.document.querySelector('#wishwavePublicProfileContent .social-profile-grid'),grid);assert.equal(scroll.scrollTop,214);
 }
 w.setWishWavePublicSellerTab('listings');w.document.querySelectorAll('#wishwavePublicProfileContent .social-profile-tile')[1].click();await wait(70);assert.equal(w.eval('currentFeedItems[activeReelIndex].itemId'),'external-one');await back(w.document.querySelector('#findaiContextualReelV168 .product-panel'));
 const own=w.document.createElement('div');own.innerHTML=w.socialProfileTile(native,0,'listings');assert.equal(own.querySelectorAll('.social-profile-tile-stat').length,1,'own profile shows views without likes');
 assert(source.includes('#wishwavePublicProfilePage .social-profile-grid{background:transparent!important;}'),'empty sold columns use the profile background');
 console.log('PASS: actual public tile clicks open native/external/sold reels without checkout or covering profile; back preserves seller/tab/grid/scroll; public and own views-only; transparent incomplete grid');w.close();
})().catch(e=>{console.error(e);w.close();process.exitCode=1});
