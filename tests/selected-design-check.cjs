const fs=require('fs'),assert=require('assert');
const {JSDOM,VirtualConsole}=require(process.env.WISHWAVE_TEST_JSDOM||'jsdom');
const html=fs.readFileSync(__dirname+'/../findai-app.html','utf8'),errors=[],vc=new VirtualConsole();
vc.on('jsdomError',e=>errors.push(e.message));
const dom=new JSDOM(html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,''),{url:'https://findai.ai/findai-app.html',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){
  w.matchMedia=()=>({matches:false,addEventListener(){},addListener(){}});
  w.IntersectionObserver=class{observe(){}disconnect(){}unobserve(){}};w.ResizeObserver=class{observe(){}disconnect(){}};
  w.fetch=async()=>({ok:true,json:async()=>({items:[],listings:[],conversations:[]}),text:async()=>''});
  w.scrollTo=()=>{};w.HTMLElement.prototype.scrollTo=function(){};w.HTMLElement.prototype.scrollIntoView=function(){};
}});
const w=dom.window,wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  await wait(900);
  w.eval("marketplaceSession=()=> 'test';getAccountProfile=()=>({email:'nick@example.com',name:'Nick',username:'nick',avatar:'https://images.test/current-avatar.jpg'});marketplaceFetch=async()=>({profile:{username:'nick',displayName:'Nick'}});");
  for(const source of ['stockx','ebay']){
    const node=w.document.createElement('div');node.innerHTML=w.sourceMarkup(source,{source,url:source==='ebay'?'https://www.ebay.com/itm/1':'https://stockx.com/nike-dunk'});
    assert.equal(node.querySelector('.findai-exact-brand').dataset.brand,source);
    assert(node.querySelector('.findai-exact-brand img'));
    assert(!node.querySelector('.wishwave-market-avatar,.wishwave-market-identity'));

  }
  assert(!w.sourceMarkup('findai',{id:'lst_one',source:'findai'}).includes('wishwave-market-badge'));
  assert(w.document.querySelector('.wishwave-profile-dashboard svg'));
  const cache=w.findaiNotificationState.getCache();cache.splice(0);
  const yesterday=new Date();yesterday.setDate(yesterday.getDate()-1);yesterday.setHours(12,0,0,0);
  const todayStamp=new Date().toISOString();
  cache.push({id:'social',notification_type:'follow',actor_username:'alex',actor_display_name:'Alex',created_at:todayStamp},
    {id:'order',notification_type:'order_shipped',title:'Your order has shipped',created_at:todayStamp,listing_id:'lst_one'},
    {id:'comment',notification_type:'comment',actor_username:'sam',actor_display_name:'Sam',body:'Looks great',created_at:yesterday.toISOString(),image_url:'https://images.test/a.jpg'});
  w.notices=cache.slice();w.eval("marketplaceFetch=async(path)=>path.includes('notifications/summary')?{notifications:notices}:path.includes('profile/me')?{profile:{username:'nick',displayName:'Nick'}}:{};");
  w.findaiNotificationState.render();
  assert(w.document.querySelector('#findaiNotificationList').textContent.includes('Yesterday'));
  w.wishwaveFilterNotifications('orders');await wait(30);
  let rows=w.document.querySelectorAll('#findaiNotificationList .findai-notification-item');assert.equal(rows.length,1);assert.equal(rows[0].dataset.notificationIndex,'1');
  assert(rows[0].querySelector('.findai-notification-hit').getAttribute('onclick').includes(',1)'));
  w.renderHomeNotifications();await wait(30);assert.equal(w.document.querySelector('.findai-notification-item').dataset.notificationIndex,'1','late wrapper cannot renumber filtered cache indices');
  w.wishwaveFilterNotifications('social');await wait(30);rows=w.document.querySelectorAll('#findaiNotificationList .findai-notification-item');assert.deepEqual([...rows].map(r=>r.dataset.notificationIndex),['0','2']);
  const tab=w.document.querySelector('[data-notice-filter="social"]');tab.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));assert.equal(w.document.querySelector('[data-notice-filter="all"]').getAttribute('aria-selected'),'true');
  const listing={id:'lst_one',itemId:'lst_one',source:'findai',title:'Sony A7 IV',price:1850,currency:'USD',condition:'Used · Excellent',description:'Includes original box',status:'active',shippingCost:0,shippingMode:'free',images:['https://images.test/one.jpg','https://images.test/two.jpg']};
  w.fixture=listing;w.eval("appMpListing=fixture;appMpContext={seller:{displayName:'Nick',soldCount:24,avatarUrl:'https://images.test/other-avatar.jpg'},viewer:{isSeller:false}};isTracked=()=>false;");
  w.renderAppMarketplaceListing();
  const root=w.document.querySelector('#appMpProductContent');assert(root.querySelector('.wishwave-detail-actions .primary').textContent.includes('Buy now'));assert.equal(root.querySelectorAll('.wishwave-detail-dots button').length,2);assert(root.textContent.includes('24 sales'));assert(root.textContent.includes('Ask the seller about returns'));assert(!root.textContent.includes('3–6'));assert(!root.querySelector('.app-mp-image-price'));assert(!root.querySelector('.wishwave-product-comments-entry,.app-mp-protection,.wishwave-detail-reference,.wishwave-detail-secondary'));assert.equal(root.querySelector('.wishwave-detail-body').lastElementChild.className,'app-mp-actions wishwave-detail-actions');
  w.wishwaveDetailMenu();assert(w.document.querySelector('#appMpSheetBody').textContent.includes('Report listing'));assert(w.document.querySelector('#appMpSheetBody').textContent.includes('Comments'));w.closeAppMpSheet();
  assert(root.querySelector('.app-mp-avatar img').src.endsWith('other-avatar.jpg'));
  w.appMpSelectImage(1);assert(w.document.querySelector('#appMpMainImage').src.endsWith('two.jpg'));assert.equal(root.querySelectorAll('.app-mp-thumb')[1].getAttribute('aria-pressed'),'true');
  let saved=[],remote=[];w.setTracked=items=>saved=items;w.getTracked=()=>saved;w.appSavedRemoteSet=async(item,active)=>remote.push(active);
  const save=root.querySelector('.wishwave-detail-save');w.wishwaveSaveDetailListing(save);assert.equal(saved[0].marketplaceListingId,'lst_one');assert.equal(save.getAttribute('aria-pressed'),'true');w.wishwaveSaveDetailListing(save);assert.equal(saved.length,0);assert.deepEqual(remote,[true,false]);
  w.eval('appMpContext.viewer.isSeller=true;socialProfileListings=[fixture]');w.renderAppMarketplaceListing();assert(w.document.querySelector('.wishwave-detail-actions .primary').disabled);assert(w.document.querySelector('.app-mp-avatar img').src.endsWith('current-avatar.jpg'));w.wishwaveDetailMenu();assert(!w.document.querySelector('#appMpSheetBody').textContent.includes('Report listing'));w.closeAppMpSheet();assert(w.document.querySelector('#appMpProductContent .wishwave-promote-button'));
  let opened=0;w.openAppMarketplaceListing=()=>opened++;w.eval("currentFeedItems=[{source:'ebay',id:'external'},fixture]");w.wishwaveOpenNativeDetail(0);assert.equal(opened,0);w.wishwaveOpenNativeDetail(1);assert.equal(opened,1);
  assert.equal(errors.length,0,JSON.stringify(errors));
  console.log('PASS: original marketplace wordmarks, own and other seller avatars, purchase row ends page, secondary actions menu, native-only detail entry, real metadata, gallery, Save, seller ownership, comments, notification filtering/cache indices/calendar groups and keyboard tabs');
  w.close();
})().catch(e=>{console.error(e);w.close();process.exitCode=1});
