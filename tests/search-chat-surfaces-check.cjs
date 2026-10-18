const fs=require('node:fs'),assert=require('node:assert/strict'),{JSDOM,VirtualConsole}=require('jsdom');
const html=fs.readFileSync(__dirname+'/../findai-app.html','utf8');
const style=html.match(/<style id="wishwave-search-chat-surfaces-v307">([\s\S]*?)<\/style>/)[1];
// Exercise the old centring/footer rules against the actual new CSS. A preview
// must start at the app's left edge before its parallax transform is applied.
const cssDom=new JSDOM('<style>.wishwave-inbox-preview.wishwave-inbox-clone.show{left:50%!important;transform:translateX(-50%)!important}.findai-search-recents{bottom:50px}'+style+'</style><body><div class="app"><section id="search"><div id="findaiSearchRecents" class="findai-search-recents show"></div></section><div class="wishwave-inbox-preview wishwave-inbox-clone show"></div></div></body>');
assert.equal(cssDom.window.getComputedStyle(cssDom.window.document.getElementById('findaiSearchRecents')).bottom,'0px');
const clone=cssDom.window.document.querySelector('.wishwave-inbox-preview');assert.equal(cssDom.window.getComputedStyle(clone).transform,'none');assert.equal(cssDom.window.getComputedStyle(clone).left,'0px');cssDom.window.close();
const errors=[];const vc=new VirtualConsole();vc.on('jsdomError',e=>{if(/Uncaught/.test(e.message))errors.push(e.message);});
const dom=new JSDOM(html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,''),{url:'https://test/?country=US',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){w.matchMedia=()=>({matches:true,addEventListener(){},addListener(){}});w.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};w.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=function(){};w.fetch=async()=>({ok:true,json:async()=>({items:[],listings:[],comments:[]}),text:async()=>''});}});
const w=dom.window,wait=ms=>new Promise(r=>setTimeout(r,ms)),touch=(el,type,x)=>{const e=new w.Event(type,{bubbles:true,cancelable:true});Object.defineProperties(e,{touches:{value:/end|cancel/.test(type)?[]:[{clientX:x,clientY:430}]},changedTouches:{value:[{clientX:x,clientY:430}]}});el.dispatchEvent(e);};
(async()=>{
 await wait(300);Object.defineProperty(w.document.querySelector('.app'),'clientWidth',{value:390,configurable:true});
 w.getAccountProfile=()=>({email:'nick@test.com',username:'nick'});w.marketplaceSession=()=>'fixture';w.recordInterest=()=>{};w.wishwaveWarmReelDiscovery=async()=>{throw Error('shared reel must not request unrelated discovery');};
 const conversation={id:'chat-a',otherParty:'Sender',otherPartyUsername:'sender',lastMessage:'Shared a listing'};
 w.marketplaceFetch=async url=>String(url).includes('/messages')?{messages:[],conversation,offers:[]}:{conversations:[conversation]};
 w.eval(fs.readFileSync(__dirname+'/../wishwave-compare.js','utf8'));w.eval(fs.readFileSync(__dirname+'/../wishwave-navigation-origins.js','utf8'));
 w.document.body.dataset.activeTab='discover';w.document.getElementById('discover').classList.add('active');
 await w.openMessagesTab();await w.appMpOpenConversation('chat-a');await wait(100);
 const inbox=w.document.getElementById('appMpInbox'),body=w.document.getElementById('appMpInboxBody'),messages=w.document.getElementById('appMpMessages');
 assert(inbox.classList.contains('show'));assert(inbox.classList.contains('chat-open'));const chatChildren=Array.from(body.childNodes),home=w.document.getElementById('personalFeed'),homeMarkup=home.innerHTML;
 messages.scrollTop=127;const input=w.document.getElementById('appMpMessageInput');input.value='Keep my draft';
 const host=w.document.createElement('div');host.dataset.sharedJson=encodeURIComponent(JSON.stringify({title:'Shared camera',price:50,currency:'USD',source:'ebay',listingId:'external-1',imageUrl:'https://example.com/photo.jpg',url:'https://www.ebay.com/itm/123'}));host.setAttribute('onclick','openSharedListingMessageV172(this)');host.textContent='Shared camera';messages.appendChild(host);
 let goCalls=[];const go=w.go;w.go=function(tab){goCalls.push(tab);return go.apply(this,arguments);};
 async function openShared(){host.click();await wait(100);const reel=w.document.getElementById('searchDetailOverlay');assert(reel.classList.contains('show'));assert.equal(reel.dataset.reelOwner,'messages');assert(inbox.classList.contains('show'));assert.equal(w.eval('appMpConversation'),'chat-a');assert.equal(w.eval('currentFeedItems.length'),1);assert.equal(home.innerHTML,homeMarkup,'opening shared listing does not rebuild Home');assert(!goCalls.includes('discover'));assert(reel.querySelector('.search-detail-header button[aria-label="Back"]'));return reel;}
 let reel=await openShared();reel.querySelector('.search-detail-header button[aria-label="Back"]').click();await wait(140);assert(!reel.classList.contains('show'));assert.equal(body.firstChild,chatChildren[0]);assert.equal(w.eval('appMpConversation'),'chat-a');assert.equal(messages.scrollTop,127);assert.equal(input.value,'Keep my draft');
 await wait(400);reel=await openShared();const panel=reel.querySelector('.product-panel');touch(panel,'touchstart',12);touch(panel,'touchmove',320);touch(panel,'touchend',320);await wait(160);assert(!reel.classList.contains('show'));assert.equal(body.firstChild,chatChildren[0]);assert.equal(w.eval('appMpConversation'),'chat-a');assert.equal(input.value,'Keep my draft');assert(!errors.length,errors.join('\n'));
 console.log('PASS: recents reaches bottom, inbox preview has no centring transform, real shared-card click stays over chat, arrow/swipe restore same chat DOM/scroll/draft without Home navigation');w.close();
})().catch(e=>{console.error(e);w.close();process.exitCode=1});
