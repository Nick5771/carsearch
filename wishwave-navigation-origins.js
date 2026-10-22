/* Child views belong to their opener. Main tab paging only owns root screens. */
(function(){
 'use strict';
 const routes={
  searchResults:'backToPremiumSearch',findaiContextualReelV168:null,searchDetailOverlay:'__wishwaveCloseSearchReelV186',
  wishwavePublicProfilePage:'closeWishWavePublicProfile',appMpProduct:'closeAppMarketplaceListing',
  wishwaveConnectionsPage:'wishwaveCloseConnections',appMpSheetBg:'closeAppMpSheet',wwCheckout:'wishwaveCloseCheckout',
  appThemeOverlay:'closeAppSettings',findaiOwnFollowersPage:'closeOwnFollowersList',
  myListingsScreen:'closeMyListings',purchasesScreen:'closePurchases',
  loginOverlay:'closeLogin',appMpInbox:'appMpInboxBack',wwDashboard:'closeWishWaveDashboard',
  findaiNotificationPanel:'closeHomeNotifications'
 };
 const stack=[],requests=new Map();let restoring=false,depth=0,epoch=0,intent=null,pending=null;
 const node=id=>document.getElementById(id);
 const shown=el=>!!el&&(el.id==='searchResults'?el.classList.contains('active'):el.id==='wwDashboard'?!el.hidden:el.classList.contains('show'));
 function visible(){return Object.keys(routes).map(node).filter(shown);}
 function snapshot(){
  const layers=visible(),main=String(document.body.dataset.activeTab||'discover');
  const screens=Array.from(document.querySelectorAll('.screen')).map(el=>[el,el.classList.contains('active')]);
  const scroll=Array.from(document.querySelectorAll('.app *')).filter(el=>el.scrollTop||el.scrollLeft).map(el=>[el,el.scrollTop,el.scrollLeft]);
  return {main,screens,scroll,collections:['socialProfileContent','premiumDiscoverySections','premiumResultsGrid'].map(id=>node(id)).filter(Boolean).map(el=>({el,children:Array.from(el.childNodes)})),layers:layers.map(el=>({el,classes:el.className,hidden:el.hidden,children:Array.from(el.childNodes),markup:el.innerHTML,tree:[el,...el.querySelectorAll('*')].map(part=>({el:part,children:Array.from(part.childNodes),attrs:Array.from(part.attributes).map(a=>[a.name,a.value])})),dataset:{...el.dataset}})),
   profileTab:typeof socialProfileTab==='undefined'?null:socialProfileTab,
   feed:{items:currentFeedItems,data:currentFeedData,state:feedState,index:activeReelIndex},
   results:{items:premiumResultItems,data:premiumResultData,query:premiumResultQuery,page:premiumResultPage,cursor:premiumResultCursor,more:premiumResultHasMore,compare:premiumCompareContext},
   publicProfile:{data:wishwavePublicSellerData,tab:wishwavePublicSellerTab},
   listing:{item:appMpListing,context:appMpContext},
   comments:{item:wishwaveCommentsItem,data:wishwaveCommentsData},
   chat:{id:appMpConversation,conversation:appMpCurrentConversation,offers:appMpCurrentOffers,mode:appMpInboxMode}
  };
 }
 function restore(saved){
  restoring=true;window.__wishwaveRestoringOrigin=true;
  try{
   for(const el of visible())if(!saved.layers.some(x=>x.el===el)){el.classList.remove('show');if(el.id==='wwDashboard')el.hidden=true;}
   for(const layer of saved.layers){
    const el=layer.el;
    if(layer.children.some((child,i)=>el.childNodes[i]!==child)||el.childNodes.length!==layer.children.length)el.replaceChildren(...layer.children);
    for(const part of layer.tree){if(part.children.some((child,i)=>part.el.childNodes[i]!==child)||part.el.childNodes.length!==part.children.length)part.el.replaceChildren(...part.children);for(const attr of Array.from(part.el.attributes))if(!part.attrs.some(([name])=>name===attr.name))part.el.removeAttribute(attr.name);for(const [name,value] of part.attrs)if(part.el.getAttribute(name)!==value)part.el.setAttribute(name,value);}
    el.className=layer.classes;el.hidden=layer.hidden;
    for(const key of Object.keys(el.dataset))delete el.dataset[key];Object.assign(el.dataset,layer.dataset);
   }
   for(const collection of saved.collections){if(collection.el.isConnected&&(collection.children.some((child,i)=>collection.el.childNodes[i]!==child)||collection.el.childNodes.length!==collection.children.length))collection.el.replaceChildren(...collection.children);}
   saved.screens.forEach(([el,active])=>el.classList.toggle('active',active));
   document.body.dataset.activeTab=saved.main;
   if(saved.profileTab!==null)socialProfileTab=saved.profileTab;
   currentFeedItems=saved.feed.items;currentFeedData=saved.feed.data;feedState=saved.feed.state;activeReelIndex=saved.feed.index;
   premiumResultItems=saved.results.items;premiumResultData=saved.results.data;premiumResultQuery=saved.results.query;premiumResultPage=saved.results.page;premiumResultCursor=saved.results.cursor;premiumResultHasMore=saved.results.more;premiumCompareContext=saved.results.compare;
   wishwavePublicSellerData=saved.publicProfile.data;wishwavePublicSellerTab=saved.publicProfile.tab;
   appMpListing=saved.listing.item;appMpContext=saved.listing.context;
   wishwaveCommentsItem=saved.comments.item;wishwaveCommentsData=saved.comments.data;
   appMpConversation=saved.chat.id;appMpCurrentConversation=saved.chat.conversation;appMpCurrentOffers=saved.chat.offers;appMpInboxMode=saved.chat.mode;
   setMainNavActive(saved.main==='searchResults'?'search':saved.main);
   const scroll=()=>saved.scroll.forEach(([el,y,x])=>{if(el.isConnected){el.scrollTop=y;el.scrollLeft=x;}});scroll();requestAnimationFrame(scroll);
   if(saved.feed.items.length)try{attachReelObserver();beginReelTracking(saved.feed.index);}catch(_){}
  }finally{restoring=false;queueMicrotask(()=>{window.__wishwaveRestoringOrigin=false;});}
 }
 function origin(){
  const current=snapshot();
  // Some inline handlers close their sheet before calling the next opener.
  // The capture-phase click still owns the original, visible parent.
  const earlier=intent?.epoch===epoch&&Date.now()-intent.at<10000?intent.saved:pending?.epoch===epoch?pending.saved:null;
  if(earlier&&earlier.layers.some(x=>!shown(x.el))&&current.layers.length<earlier.layers.length)return earlier;
  return current;
 }
 function willOpen(id){return restoring?null:{id,saved:origin(),epoch};}
 function didOpen(token){
  if(!token||token.epoch!==epoch||restoring)return;
  const root=node(token.id);if(!shown(root))return;
  const same=token.saved.layers.find(x=>x.el===root);
  // An existing surface being updated is not another level of navigation.
  if(same&&same.markup===root.innerHTML)return;
  const last=stack.at(-1);if(last?.root===root&&last.epoch===epoch&&(!same||last.saved===token.saved))return;
  stack.push({root,saved:token.saved,epoch});if(stack.length>24)stack.shift();
 }
 window.__wishwaveWillOpenView=willOpen;window.__wishwaveDidOpenView=didOpen;
 function wrap(name,ids){
  const before=window[name];if(typeof before!=='function')return;
  window[name]=function(...args){
   if(restoring||depth)return before.apply(this,args);
   const saved=origin(),token={saved,epoch};ids.forEach(id=>requests.set(id,token));const previous=pending;pending=token;depth++;
   let result;try{result=before.apply(this,args);}catch(error){pending=previous;throw error;}finally{depth--;}
   const complete=()=>{for(const id of ids){if(requests.get(id)!==token)continue;const root=node(id);if(token.epoch!==epoch){if(root)root.classList.remove('show');continue;}if(shown(root))didOpen({id,saved,epoch:token.epoch});}};
   complete();const release=()=>ids.forEach(id=>{if(requests.get(id)===token)requests.delete(id);});
   if(result?.then)return result.then(value=>{complete();return value;}).finally(()=>{if(pending===token)pending=previous;release();});
   if(pending===token)pending=previous;release();return result;
  };
 }
 const reel=['findaiContextualReelV168','searchDetailOverlay','wwCheckout','appMpProduct'];
 for(const name of ['openProfileListingItem','openProfileSavedItem','openProfileLikedItem','openWishWavePublicListing','__wishwaveOpenTabOwnedReel','__wishwaveStableOpenContextualReel','findaiOpenItemsInHomeReelV155','findaiOpenItemsInHomeReelV158','openPremiumResultItem','openPremiumDiscoveryItem','openPremiumEbayItem','openSearchResultDetail'])wrap(name,reel);
 for(const name of ['findaiNotificationOpenContent','findaiNotificationOpenActor','openFindAINotification'])wrap(name,['appMpSheetBg','wishwavePublicProfilePage',...reel]);
 for(const name of ['findaiOpenSettingsPane'])wrap(name,['appThemeOverlay']);
 for(const name of ['openFindAIProfileByUsername','openPremiumSellerProfileById','showFindAIUserProfileDirect'])wrap(name,['wishwavePublicProfilePage']);
 wrap('launchPremiumSearch',['searchResults']);
 wrap('openAppMarketplaceListing',['appMpProduct']);wrap('wishwaveCheckoutOpenItem',['wwCheckout','appMpProduct']);
 for(const name of ['openWishWaveComments','openWishWaveListingComments','openAppMpSheet'])wrap(name,['appMpSheetBg']);
 for(const [name,id] of [['openAppSettings','appThemeOverlay'],['openOwnFollowersList','findaiOwnFollowersPage'],['openMyListings','myListingsScreen'],['openPurchases','purchasesScreen'],['openLogin','loginOverlay'],['openWishWaveDashboard','wwDashboard'],['openHomeNotifications','findaiNotificationPanel']])wrap(name,[id]);
 for(const name of ['openAppMarketplaceInbox','openAppMarketplaceMessages','appMpOpenConversation','openMessagesTab'])wrap(name,['appMpInbox']);
 function entryFor(target){
  for(let i=stack.length-1;i>=0;i--){const entry=stack[i];if(shown(entry.root)&&entry.root.contains(target))return entry;}
  return null;
 }
 function back(entry){
  const index=stack.indexOf(entry);if(index<0)return;stack.splice(index);intent=null;
  restoring=true;
  try{if(entry.root.id==='appMpInbox'){window.__wishwaveCancelChatBack?.();window.__wishwaveInboxRequest=(window.__wishwaveInboxRequest||0)+1;clearInterval(appMpMessageTimer);clearInterval(appMpTypingTimer);clearTimeout(appMpTypingClearTimer);entry.root.classList.remove('show','chat-open','direct-message-chat');}else {const close=routes[entry.root.id];if(close&&typeof window[close]==='function')window[close]();else entry.root.classList.remove('show');}}finally{restoring=false;}
  restore(entry.saved);
 }
 window.__wishwaveCompleteSheetDismiss=function(){const entry=entryFor(node('appMpSheetBg'));if(!entry||entry.root.id!=='appMpSheetBg')return false;back(entry);return true;};
 function savedPreview(layer,saved){
  // Reused containers (inbox/chat) need a visual of the saved parent while the
  // live container moves. Build from its saved tree, not the current chat DOM.
  const copies=new Map();
  for(const part of layer.tree){const copy=part.el.cloneNode(false);for(const attr of Array.from(copy.attributes))copy.removeAttribute(attr.name);for(const [name,value] of part.attrs)if(name==='id')copy.dataset.inboxPreviewId=value;else if(!/^on/i.test(name))copy.setAttribute(name,value);copies.set(part.el,copy);}
  for(const part of layer.tree)copies.get(part.el).replaceChildren(...part.children.map(child=>copies.get(child)||child.cloneNode(true)));
  const preview=copies.get(layer.el);preview.removeAttribute('id');preview.classList.remove('chat-open','direct-message-chat');preview.classList.add('show','wishwave-inbox-preview','wishwave-inbox-clone');preview.dataset.originPreview='1';preview.setAttribute('aria-hidden','true');preview.inert=true;
  preview.style.setProperty('z-index','999999','important');preview.style.setProperty('pointer-events','none','important');preview.style.setProperty('background',getComputedStyle(layer.el).backgroundColor||'#0c0d0f','important');preview.style.setProperty('color',getComputedStyle(layer.el).color||'#fff','important');
  document.querySelector('.app').appendChild(preview);
  for(const [el,y,x] of saved.scroll){const copy=copies.get(el);if(copy){copy.scrollTop=y;copy.scrollLeft=x;}}
  return preview;
 }
 window.__wishwaveOriginSurface=function(target){
  const entry=entryFor(target);if(!entry)return null;
  if(entry.root.id==='findaiNotificationPanel'&&entry.saved.main==='notifications')return null;
  const root=entry.root,isReel=['findaiContextualReelV168','searchDetailOverlay'].includes(root.id);
  let moved=null,under=null,underActive=false,underShown=false,underScreen=null,screenActive=false,z=null,preview=null;
  return {root,kind:isReel?'searchReel':root.id,originBound:true,open:()=>shown(root),back:()=>back(entry),
   prepareUnder(){
    under=entry.saved.layers.at(-1)?.el||node(entry.saved.main==='messages'?'appMpInbox':entry.saved.main);
    if(under===root&&root.id==='appMpInbox'){preview=savedPreview(entry.saved.layers.find(x=>x.el===root),entry.saved);under=preview;}
    else if(under===root)under=node(entry.saved.main==='messages'?'appMpInbox':entry.saved.main);
    if(under&&under!==root){
     underActive=under.classList.contains('active');underShown=shown(under);
     if(under.classList.contains('screen'))under.classList.add('active');else {under.classList.add('show');if(under.id==='wwDashboard')under.hidden=false;}
     underScreen=under.closest('.screen');if(underScreen){screenActive=underScreen===under?underActive:underScreen.classList.contains('active');underScreen.classList.add('active');}
    }
    z=[root.style.getPropertyValue('z-index'),root.style.getPropertyPriority('z-index')];root.style.setProperty('z-index','1000000','important');
    // Profile reels live inside Home for rendering. Lift only the moving layer
    // so its actual profile grid can be revealed, without cloning either page.
    if(root.id==='findaiContextualReelV168'){
     const parent=root.parentNode,next=root.nextSibling,style=['position','inset','left','top','width','height','z-index'].map(key=>[key,root.style.getPropertyValue(key),root.style.getPropertyPriority(key)]),rect=root.getBoundingClientRect(),app=document.querySelector('.app'),box=app.getBoundingClientRect();
     moved={parent,next,style};app.appendChild(root);root.style.setProperty('position','absolute','important');root.style.setProperty('inset','auto','important');root.style.setProperty('left',(rect.left-box.left)+'px','important');root.style.setProperty('top',(rect.top-box.top)+'px','important');root.style.setProperty('width',(rect.width||app.clientWidth||innerWidth)+'px','important');root.style.setProperty('height',(rect.height||app.clientHeight||innerHeight)+'px','important');root.style.setProperty('z-index','1000000','important');
    }
    return under;
   },
   releaseUnder(closed){
    preview?.remove();
    if(moved){moved.parent.insertBefore(root,moved.next?.parentNode===moved.parent?moved.next:null);moved.style.forEach(([key,value,priority])=>value?root.style.setProperty(key,value,priority):root.style.removeProperty(key));}
    if(z)z[0]?root.style.setProperty('z-index',z[0],z[1]):root.style.removeProperty('z-index');
    if(!closed&&under){if(under.classList.contains('screen'))under.classList.toggle('active',underActive);else {under.classList.toggle('show',underShown);if(under.id==='wwDashboard')under.hidden=!underShown;}if(underScreen)underScreen.classList.toggle('active',screenActive);}
   }
  };
 };
 window.__wishwaveOriginClick=function(event){
  if(event.target.closest?.('.premium-bottom-nav')){stack.length=0;intent=null;pending=null;epoch++;return false;}
  const entry=entryFor(event.target),button=event.target.closest?.('button'),action=button?.getAttribute('onclick')?.trim()||'';
  if(entry&&button&&(/^(?:close\w+|__wishwaveCloseSearchReelV186|wishwaveCloseCheckout)\(\);?$/.test(action)||button.getAttribute('aria-label')==='Back')){
   const surface=window.__wishwaveOriginSurface(event.target);if(surface){window.wishwaveSlidePageBack(surface);return true;}
  }
  // Only navigation needs the full DOM snapshot. Explicitly skip local actions;
  // unknown/listener-based controls retain their pre-click parent for Back.
  const local=event.target.closest?.('.reel-social-action.like,.reel-social-action.bookmark,.premium-card-like,.wishwave-detail-save,input,textarea,[contenteditable="true"],.findai-recent-remove,.findai-recents-clear');
  intent=local?null:{saved:snapshot(),at:Date.now(),epoch};return false;
 };
 window.__wishwaveOriginNav=function(event){if(event.target.closest?.('.premium-bottom-nav')){stack.length=0;intent=null;pending=null;epoch++;}};
 window.wishwaveNavigationOrigins=()=>stack.map(entry=>({view:entry.root.id,origin:entry.saved.main}));
})();
