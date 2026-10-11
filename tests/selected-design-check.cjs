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
  const realCheckoutOpen=w.wishwaveCheckoutOpenItem;let opened=0;w.wishwaveCheckoutOpenItem=()=>opened++;w.eval("currentFeedItems=[{source:'ebay',id:'external'},fixture]");w.wishwaveOpenNativeDetail(0);assert.equal(opened,0);w.wishwaveOpenNativeDetail(1);assert.equal(opened,1);w.openProfileListingItem(0,'listings');assert.equal(opened,2);w.openSearchResultDetail(1);assert.equal(opened,3);w.eval('wishwavePublicSellerData={listings:[fixture]}');w.openWishWavePublicListing(0,'listings');assert.equal(opened,4);saved=[listing];w.openProfileLikedItem(0);assert.equal(opened,5);w.openDeal(1);assert.equal(opened,6);w.wishwaveCheckoutOpenItem=realCheckoutOpen;
  w.eval("appMpListing=fixture;appMpContext={seller:{displayName:'Other seller'},viewer:{isSeller:false}}");
  const calls=[];w.Stripe=()=>({});w.marketplaceFetch=async(path,options)=>{calls.push({path,body:options.body?JSON.parse(options.body):{}});if(path.startsWith('/marketplace/listings/'))return {listing:w.fixture,viewer:{isSeller:false}};if(path==='/marketplace/config')return {marketplace:{detectedCountry:'AU',stripeTestMode:true,stripeTestPublishableKey:'pk_test_fixture'}};if(path==='/marketplace/shipping/quote')return {rates:[{amountMinor:0,service:'Free shipping'}]};if(path==='/marketplace/quote')return {quote:{itemMinor:185000,shippingMinor:0,buyerFeeMinor:7400,buyerTotalMinor:192400}};throw new Error('Payment service unavailable');};
  await w.wishwaveCheckoutOpenItem(w.fixture);await wait(40);
  const checkout=w.document.querySelector('#wwCheckout');assert(checkout.classList.contains('show'));assert(checkout.querySelector('.wwc-grand-total').textContent.includes('1,924'));assert(checkout.querySelector('.wwc-total-row').textContent.includes('1,850'));assert(checkout.querySelector('.wwc-free').textContent.includes('Free'));assert(!checkout.querySelector('.wwc-pay').disabled);assert(!checkout.textContent.includes('92.50'),'must use server fee rather than mockup fee');
  w.wishwaveCheckoutLocation();w.document.querySelector('#wwCheckoutPostal').value='10012';w.wishwaveCheckoutSetLocation({preventDefault(){}});await wait(40);assert(calls.some(c=>c.path==='/marketplace/shipping/quote'&&c.body.destinationPostalCode==='10012'));
  await w.wishwaveCheckoutContinue();assert(checkout.querySelector('.wwc-error').textContent.includes('Payment service unavailable'));assert(!checkout.querySelector('.wwc-pay').disabled);assert(calls.some(c=>c.path==='/marketplace/checkout'&&c.body.listingId==='lst_one'&&c.body.destinationPostalCode==='10012'&&c.body.destinationCountry==='AU'&&c.body.testOnly===true&&c.body.uiMode==='elements'));assert(checkout.textContent.includes('Australia'));assert(checkout.textContent.includes('Delivery estimate not provided'));
  let confirms=0,destroys=0;const mounted=[];w.Stripe=()=>({initCheckoutElementsSdk:()=>({loadActions:async()=>({type:'success',actions:{confirm:async()=>{confirms++;return {type:'success'}}}}),createShippingAddressElement:()=>({mount:s=>mounted.push(s),destroy:()=>destroys++,getValue:async()=>({complete:true,value:{address:{country:'AU',postal_code:'10012'}}})}),createExpressCheckoutElement:()=>({mount:s=>mounted.push(s),destroy:()=>destroys++,on(){}}),createPaymentElement:()=>({mount:s=>mounted.push(s),destroy:()=>destroys++})})});
  const paymentFetch=w.marketplaceFetch;w.marketplaceFetch=async(path,options)=>path==='/marketplace/checkout'?{testMode:true,publishableKey:'pk_test_fixture',clientSecret:'cs_test_fixture_secret'}:paymentFetch(path,options);
  await w.wishwaveCheckoutContinue();assert.deepEqual(mounted,['#wwCheckoutStripeAddress','#wwCheckoutStripeExpress','#wwCheckoutStripeCard']);assert(checkout.querySelector('.wwc-pay').textContent.includes('Pay in test mode'));checkout.querySelector('.wwc-pay').click();await wait(20);assert.equal(confirms,1);
  w.wishwaveCloseCheckout();assert(!checkout.classList.contains('show'));assert.equal(destroys,3);

  w.fixture.shippingMode='calculated';w.appMpBuy();await wait(30);assert(checkout.querySelector('.wwc-pay').disabled,'calculated delivery requires destination');w.wishwaveCloseCheckout();

  assert(w.document.querySelector('#wishwaveMainNav button[data-tab="notifications"]'));
  assert(!w.document.querySelector('#wishwaveMainNav button[data-tab="messages"]'));
  assert.equal(w.document.querySelector('#homeMessageButton').getAttribute('aria-label'),'Messages');
  assert(w.document.querySelector('.wishwave-edit-profile svg'));
  w.findaiOpenSettingsHome();
  assert(w.document.querySelector('#appThemeOverlay .wishwave-reference-settings'));
  assert(w.document.querySelector('#findaiSettingsSearchInput'));
  w.filterFindAISettings('blocked');assert(w.document.querySelector('#findaiSettingsSearchResults').textContent.includes('Blocked accounts'));
  w.filterFindAISettings('');assert.equal(w.document.querySelector('#findaiSettingsHomeSections').style.display,'');
  assert.equal(w.document.querySelectorAll('.wishwave-settings-theme [data-app-theme-choice]').length,3);
  w.document.querySelector('.wishwave-settings-theme [data-app-theme-choice="dark"]').click();assert.equal(w.appThemePreference(),'dark');w.closeAppSettings();
  w.renderAppMpChat('chat_fixture',false);
  w.appMpRenderMessageHeader({id:'chat_fixture',listingId:'lst_one',listingTitle:'Sony A7 III',listingPrice:850,otherParty:'Maya Chen',otherPartyAvatar:'https://images.test/maya.jpg',viewerRole:'buyer'},{online:true});
  assert.equal(w.document.querySelector('#appMpChatHead').childElementCount,0);
  assert(w.document.querySelector('.wishwave-chat-online-dot'));
  assert(w.document.querySelector('.wishwave-chat-presence').textContent.includes('Active'));
  assert(w.document.querySelector('.wishwave-chat-menu'));
  const timeline=w.appMpMessageTimeline([{id:'message_one',body:'Is this available?',mine:false,createdAt:'2026-10-11T21:12:00Z'},{id:'message_two',body:'Yes it is.',mine:true,createdAt:'2026-10-11T21:14:00Z',imageUrl:'https://images.test/camera.jpg'}]);
  const fragment=w.document.createElement('div');fragment.innerHTML=timeline;assert.equal(fragment.querySelectorAll('.wishwave-chat-timestamp').length,2);assert.equal(fragment.querySelectorAll('[data-message-id]').length,2);assert(fragment.querySelector('.app-mp-message-image'));
  w.document.querySelector('#appMpInbox').classList.remove('show','chat-open');
  w.marketplaceFetch=async path=>path.startsWith('/marketplace/following/feed')?{items:[{...w.fixture,id:'lst_followed',marketplaceListingId:'lst_followed',title:'Followed camera'}]}:{items:[],notifications:[]};
  w.eval("feedState.source='personalised';currentFeedItems=[fixture]");
  await w.wishwaveSetHomeFeed('following');assert.equal(w.document.querySelector('[data-home-feed="following"]').getAttribute('aria-selected'),'true');assert.equal(w.eval('currentFeedItems[0].title'),'Followed camera');
  w.renderPersonalisedFeed([{...w.fixture,title:'Background discovery'}]);assert.equal(w.eval('currentFeedItems[0].title'),'Followed camera','background discovery cannot replace Following');
  await w.wishwaveSetHomeFeed('for-you');assert.equal(w.eval('currentFeedItems[0].id'),'lst_one');assert.equal(w.document.querySelector('[data-home-feed="for-you"]').getAttribute('aria-selected'),'true');
  await w.wishwaveOpenNotificationTab();assert.equal(w.document.body.dataset.activeTab,'notifications');assert.equal(w.document.querySelector('#findaiNotificationPanel').parentElement.id,'notifications');assert(w.document.querySelector('#findaiNotificationPanel').classList.contains('show'));assert(w.document.querySelector('#wishwaveMainNav [data-tab="notifications"]').classList.contains('active'));
  w.setHomeNotificationState(2);assert.equal(w.document.querySelector('#navNotificationsBadge').style.display,'block');w.setHomeNotificationState(0);assert.equal(w.document.querySelector('#navNotificationsBadge').style.display,'none');

  const navigation=w.document.getElementById('wishwaveMainNav');
  navigation.getBoundingClientRect=()=>({left:0,width:390});
  navigation.querySelectorAll(':scope > button').forEach((button,index)=>button.getBoundingClientRect=()=>({left:index*78,width:78}));
  w.setMainNavActive('discover');
  const selection=navigation.querySelector('.wishwave-nav-selection');assert(selection);assert(selection.style.transform.includes('11px'));
  w.wishwaveNavSwipeProgress('discover','search',.5);assert.equal(navigation.dataset.navDrag,'true');assert(selection.style.transform.includes('50px'),'highlight follows halfway between Home and Search');
  w.wishwaveNavSwipeSettle('search',180);assert.equal(navigation.dataset.navDrag,'false');assert(selection.style.transform.includes('89px'));assert.equal(navigation.style.getPropertyValue('--ww-nav-motion'),'180ms');
  w.setMainNavActive('profile');assert(selection.style.transform.includes('323px'),'tap animates to Profile');
  w.wishwaveNavSwipeProgress('profile','notifications',.6);w.wishwaveNavSwipeReset();assert(selection.style.transform.includes('323px'),'cancelled gesture returns highlight to selected tab');
  assert(w.renderReelCard({...w.fixture,shippingMode:'free'},0,{}).includes('M10 19a8.2 8.2 0 1 1 4 0l-2 3-2-3Z'),'centred Comments icon renders on listings');
  assert.equal(errors.length,0,JSON.stringify(errors));
  console.log('PASS: original marketplace wordmarks, own and other seller avatars, purchase row ends page, secondary actions menu, direct native checkout, country detection, test-only payment controls, real metadata, gallery, Save, seller ownership, comments, notification filtering/cache indices/calendar groups, notification navigation, settings search/theme selection, reference chat and Following feed isolation');
  w.close();
})().catch(e=>{console.error(e);w.close();process.exitCode=1});
