const fs=require('fs'),assert=require('assert');
const {JSDOM,VirtualConsole}=require(process.env.WISHWAVE_TEST_JSDOM||'jsdom');
const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
const html=fs.readFileSync(process.env.WISHWAVE_TEST_HTML||__dirname+'/../findai-app.html','utf8').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'');
const dom=new JSDOM(html,{url:'https://wishwave.test',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){
  Object.defineProperty(w,'innerHeight',{value:844,writable:true,configurable:true});
  const vv=new w.EventTarget();Object.assign(vv,{height:844,width:390,offsetTop:0,scale:1});Object.defineProperty(w,'visualViewport',{value:vv});
  w.matchMedia=()=>({matches:false,addEventListener(){},addListener(){}});
  w.IntersectionObserver=class{observe(){}disconnect(){}unobserve(){}};w.ResizeObserver=class{observe(){}disconnect(){}};
  w.fetch=async()=>({ok:true,json:async()=>({items:[],listings:[],conversations:[]}),text:async()=>''});
  w.scrollTo=()=>{};w.HTMLElement.prototype.scrollTo=function(){};w.HTMLElement.prototype.scrollIntoView=function(){};
}});
const w=dom.window,wait=ms=>new Promise(r=>setTimeout(r,ms));
function event(target,x,y=420){return {target,touches:[{clientX:x,clientY:y}],changedTouches:[{clientX:x,clientY:y}],cancelable:true,preventDefault(){},stopPropagation(){},stopImmediatePropagation(){}};}
(async()=>{
 await wait(600);const app=w.document.querySelector('.app');let width=390;
 Object.defineProperty(app,'clientWidth',{get:()=>width,configurable:true});app.getBoundingClientRect=()=>({top:0,bottom:844,height:844,width});
 w.eval("marketplaceSession=()=> 'test';getAccountProfile=()=>({name:'Nick'});marketplaceFetch=async()=>({conversations:[],messages:[]});");
 // A quick short move followed by a held finger must spring back, not use stale flick velocity.
 w.openForYou();const home=w.document.getElementById('discover'),surface=home.querySelector('#personalFeed')||home;
 w.__wishwaveTabTouch('touchstart',event(surface,300));w.__wishwaveTabTouch('touchmove',event(surface,270));await wait(120);
 w.__wishwaveTabTouch('touchend',event(surface,270));await wait(330);
 assert.equal(w.document.body.dataset.activeTab,'discover','paused short tab swipe must cancel');assert(!w.__wishwavePageMotion);
 // Browser toolbar/keyboard height events must preserve an active horizontal drag; rotation cancels it.
 w.__wishwaveTabTouch('touchstart',event(surface,300));w.__wishwaveTabTouch('touchmove',event(surface,170));await wait(25);
 w.dispatchEvent(new w.Event('resize'));assert(home.classList.contains('findai-v132-current'),'height-only resize cannot cancel a tab drag');
 w.__wishwaveTabTouch('touchcancel',event(surface,170));await wait(330);assert(!home.classList.contains('findai-v132-current'));
 w.__wishwaveTabTouch('touchstart',event(surface,300));w.__wishwaveTabTouch('touchmove',event(surface,170));await wait(25);width=500;w.dispatchEvent(new w.Event('resize'));assert(!home.classList.contains('findai-v132-current'),'changed width clears obsolete tab geometry');width=390;
 // Preserve an interrupted gallery settle on height events, cancel obsolete geometry on rotation.
 const card=w.document.createElement('article');card.className='reel-card';card.dataset.hasGallery='1';
 card.innerHTML='<div class="reel-gallery-stage" data-gallery-images=\'["https://images.test/a.jpg","https://images.test/b.jpg"]\'><div class="reel-gallery-track"><div class="reel-gallery-slide" data-gallery-slide="0"><img class="reel-gallery-image" src="https://images.test/a.jpg"></div><div class="reel-gallery-slide" data-gallery-slide="1"><img class="reel-gallery-image" data-src="https://images.test/b.jpg"></div></div></div>';
 home.appendChild(card);const stage=card.firstElementChild,track=stage.firstElementChild;let galleryWidth=390,cancelled=0,animations=[];
 Object.defineProperty(stage,'clientWidth',{get:()=>galleryWidth,configurable:true});track.animate=(frames,options)=>{const a={cancel(){cancelled++},onfinish:null};animations.push({frames,options,a});return a;};
 w.__wishwaveGalleryTouchV149('touchstart',event(stage,300));w.__wishwaveGalleryTouchV149('touchmove',event(stage,140));w.__wishwaveGalleryTouchV149('touchend',event(stage,140));
 assert.equal(stage.dataset.galleryIndex,'1');assert.equal(animations.length,1);w.dispatchEvent(new w.Event('resize'));assert.equal(cancelled,0,'height-only resize preserves photo settle');
 galleryWidth=500;w.dispatchEvent(new w.Event('resize'));assert.equal(cancelled,1);assert(track.style.transform.includes('-500px'),'rotation lands on selected image');
 // Child-page back keeps its underlay until settle and ignores height-only viewport changes.
 let returned=0;const child=w.document.createElement('section');child.id='wishwavePublicProfilePage';child.className='show';child.innerHTML='<div>Seller profile</div>';child.getBoundingClientRect=()=>({width:390});app.appendChild(child);
 const closeProfile=w.closeWishWavePublicProfile;w.closeWishWavePublicProfile=()=>{returned++;child.classList.remove('show');};
 w.__wishwavePageTouch('touchstart',event(child.firstChild,30));w.__wishwavePageTouch('touchmove',event(child.firstChild,180));await wait(25);w.dispatchEvent(new w.Event('resize'));assert(child.classList.contains('wishwave-page-return-drag'),'height-only resize preserves child back');
 w.__wishwavePageTouch('touchcancel',event(child.firstChild,180));await wait(330);assert.equal(returned,0);assert.equal(child.style.transform,'');
 w.__wishwavePageTouch('touchstart',event(child.firstChild,30));w.__wishwavePageTouch('touchmove',event(child.firstChild,340));w.__wishwavePageTouch('touchend',event(child.firstChild,340));assert.equal(returned,0,'back waits for settling');await wait(330);assert.equal(returned,1);assert.equal(child.style.transform,'');child.remove();w.closeWishWavePublicProfile=closeProfile;
 // Cancelling a Create tab gesture preserves the draft and never focuses its first input.
 w.wishwaveOpenCreateTab();const create=w.document.getElementById('createListingScreen'),draft=w.document.getElementById('listingItemName');draft.value='Camera draft';const createScroll=create.querySelector('.marketplace-scroll');
 w.__wishwaveTabTouch('touchstart',event(createScroll,300));w.__wishwaveTabTouch('touchmove',event(createScroll,160));await wait(25);w.__wishwaveTabTouch('touchcancel',event(createScroll,160));await wait(330);assert(create.classList.contains('show'));assert.equal(draft.value,'Camera draft');assert.notEqual(w.document.activeElement,draft);w.closeCreateListing();
 // Pausing a chat back gesture before release must also cancel.
 const inbox=w.document.getElementById('appMpInbox');inbox.classList.add('show','chat-open');w.renderAppMpChat('a',true);const messages=w.document.getElementById('appMpMessages');
 w.__wishwaveBackTouch('touchstart',event(messages,30));w.__wishwaveBackTouch('touchmove',event(messages,65));await wait(120);w.__wishwaveBackTouch('touchend',event(messages,65));await wait(330);assert(inbox.classList.contains('chat-open'),'held short back gesture must not navigate');assert(!w.document.querySelector('.wishwave-inbox-preview'));
 // Chat follows viewport pan and retains its size while focus blurs and keyboard is still closing.
 const input=inbox.querySelector('textarea,input');assert(input);input.focus();w.visualViewport.height=400;w.visualViewport.dispatchEvent(new w.Event('resize'));await wait(40);assert.equal(inbox.style.getPropertyValue('--wishwave-chat-height'),'400px');
 input.blur();await wait(140);assert.equal(inbox.style.getPropertyValue('--wishwave-chat-height'),'400px','blur must not expand chat ahead of closing keyboard');
 w.visualViewport.offsetTop=30;w.visualViewport.dispatchEvent(new w.Event('scroll'));await wait(40);assert.equal(inbox.style.getPropertyValue('--wishwave-chat-height'),'430px');
 w.visualViewport.height=844;w.visualViewport.offsetTop=0;w.visualViewport.dispatchEvent(new w.Event('resize'));await wait(40);assert.equal(inbox.style.getPropertyValue('--wishwave-chat-height'),'');
 // Sheet focus correction only touches its local scroller, never document smooth scrolling.
 inbox.classList.remove('show','chat-open');w.openAppMpSheet('Offer','<input id="motionOffer">');const field=w.document.getElementById('motionOffer'),sheetBody=w.document.getElementById('appMpSheetBody');let globalScrolls=0;
 field.scrollIntoView=()=>globalScrolls++;field.getBoundingClientRect=()=>({top:290,bottom:320});sheetBody.getBoundingClientRect=()=>({top:100,bottom:300});field.focus();w.visualViewport.height=400;w.visualViewport.dispatchEvent(new w.Event('resize'));await wait(90);
 assert.equal(globalScrolls,0,'sheet cannot combine smooth document scroll and local correction');assert(sheetBody.scrollTop>0);
 assert.equal(errors.length,0,JSON.stringify(errors));console.log('PASS: paused tab/chat flicks, height-only resize continuity, width-change cleanup, gallery settle preservation/rotation, chat keyboard blur and pan, local sheet focus scrolling; no runtime errors');w.close();
})().catch(e=>{console.error(e);w.close();process.exitCode=1});
