const fs=require('node:fs'),assert=require('node:assert/strict'),{JSDOM,VirtualConsole}=require('jsdom');
const html=fs.readFileSync('findai-app.html','utf8'),errors=[];
const vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!e.message.includes('CSS'))errors.push(e.message)});
const dom=new JSDOM(html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,''),{url:'https://test/',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){w.matchMedia=()=>({matches:true,addEventListener(){},addListener(){}});w.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};w.ResizeObserver=class{observe(){}disconnect(){}};w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=function(){};w.fetch=async()=>({ok:true,json:async()=>({items:[],listings:[],comments:[]}),text:async()=>''});w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};w.visualViewport=new w.EventTarget();Object.assign(w.visualViewport,{height:780,offsetTop:0});}});
const w=dom.window,tick=()=>new Promise(r=>setTimeout(r,80));
function touch(target,type,x,y=420){const e=new w.Event(type,{bubbles:true,cancelable:true});Object.defineProperties(e,{touches:{value:/end|cancel/.test(type)?[]:[{clientX:x,clientY:y}]},changedTouches:{value:[{clientX:x,clientY:y}]}});target.dispatchEvent(e);return e;}
async function swipe(target,right=false){touch(target,'touchstart',right?30:350);touch(target,'touchmove',right?330:30);touch(target,'touchend',right?330:30);await tick();}
(async()=>{
 await tick();Object.defineProperty(w.document.querySelector('.app'),'clientWidth',{value:390});
 w.getAccountProfile=()=>({email:'me@test',username:'me'});w.marketplaceSession=()=>'signed-in';
 const rows=[{id:'nick-chat',otherParty:'Nick',otherPartyUsername:'nick',lastMessage:'',lastMessageAt:'2026-11-03'}];let reads=0,listMode='slow',listRequests=0,pendingLists=[];
 w.marketplaceFetch=async path=>{
  if(path==='/marketplace/conversations'){listRequests++;if(listMode==='slow')return new Promise((resolve,reject)=>pendingLists.push({resolve,reject}));if(listMode==='malformed')return {};if(listMode==='empty')return {conversations:[]};return {conversations:rows.map(c=>({...c}))};}
  if(path.includes('/messages')){if(path.includes('markRead=0'))reads++;return {messages:[{id:'m1',body:'Hi',createdAt:'2026-11-02',mine:false}],conversation:rows[0],offers:[]};}
  if(path.startsWith('/social/send-suggestions'))return {people:[{username:'nick',displayName:'Nick',conversationId:'nick-chat'}]};
  return {items:[],listings:[],notifications:[],comments:[],people:[]};
 };
 w.findaiNotificationState.load=async()=>{};w.findaiNotificationState.getUnread=()=>0;w.appRefreshMarketplaceBadge=async()=>{};
 for(const file of ['wishwave-navigation-origins.js','wishwave-chat-polish.js','wishwave-connections.js','wishwave-inbox.js'])w.eval(fs.readFileSync(file,'utf8'));
 const inbox=w.document.getElementById('appMpInbox'),panel=()=>w.document.getElementById('findaiNotificationPanel');
 const assertList=()=>{assert.equal(w.document.body.dataset.activeTab,'notifications');assert.equal(inbox.parentNode.id,'wwInboxMessages');assert(inbox.classList.contains('ww-inbox-docked'));assert(inbox.classList.contains('show'));assert(!inbox.classList.contains('chat-open'));assert(w.document.querySelector('.app-mp-conversation-card'));assert(panel().classList.contains('show'));};
 const opening=w.openMessagesTab();await tick();assert(w.document.querySelector('.ww-inbox-loading'),'cold load has placeholders');assert(!w.document.querySelector('.app-mp-instagram-empty'),'pending request is not an empty Inbox');assert.equal(listRequests,1,'Messages entry starts one list request');listMode='normal';pendingLists.shift().resolve({conversations:rows.map(c=>({...c}))});await opening;await tick();assertList();assert.equal(w.document.querySelector('.app-mp-conversation-preview').textContent,'Hi');assert.equal(reads,1,'preview lookup does not mark messages read');
 assert.equal(w.wishwaveNavigationOrigins().filter(x=>x.view==='appMpInbox').length,0,'root list does not create child history');
 for(let i=0;i<3;i++){
  w.document.querySelector('.app-mp-conversation-card').click();await tick();assert(inbox.classList.contains('chat-open'));assert.equal(w.document.body.dataset.activeTab,'notifications');assert.equal(w.eval('appMpConversation'),'nick-chat');w.document.getElementById('appMpMessages').click();assert.equal(w.document.body.dataset.activeTab,'notifications','chat taps must not trigger legacy notification outside-dismiss');
  w.document.querySelector('#appMpInbox .app-mp-header > button[aria-label="Back"]').click();await new Promise(r=>setTimeout(r,550));assertList();
 }
 // Legacy entry points resolve to the same root Inbox.
 await w.openAppMarketplaceInbox();assertList();
 await swipe(w.document.querySelector('.app-mp-conversation-card'));assert.equal(panel().dataset.inboxSection,'activity');
 await swipe(panel(),true);assert.equal(panel().dataset.inboxSection,'messages');assertList();
 // Vertical movement stays native and does not switch section.
 const root=w.document.querySelector('.app-mp-conversation-list');touch(root,'touchstart',200,400);assert(!touch(root,'touchmove',202,190).defaultPrevented);touch(root,'touchend',202,190);assert.equal(panel().dataset.inboxSection,'messages');
 await swipe(root);assert.equal(panel().dataset.inboxSection,'activity');await swipe(panel());assert.equal(w.document.body.dataset.activeTab,'profile','Activity left swipe reaches Profile');
 await new Promise(r=>setTimeout(r,500));await w.openMessagesTab();await tick();w.document.getElementById('wwInboxCompose').click();await tick();const dialog=w.document.getElementById('wwComposeDialog');assert(dialog.open);assert(w.document.querySelector('#wwComposeTitle'));assert(w.document.querySelector('#wwComposeSearch'));
 w.visualViewport.height=340;w.visualViewport.offsetTop=25;w.visualViewport.dispatchEvent(new w.Event('resize'));assert.equal(dialog.style.getPropertyValue('--compose-height'),'316px');assert.equal(dialog.style.getPropertyValue('--compose-top'),'37px');
 w.document.querySelector('.ww-compose-person').click();await tick();assert(!dialog.open);assert(inbox.classList.contains('chat-open'));assert.equal(w.document.body.dataset.activeTab,'notifications');w.appMpInboxBack();await tick();assertList();

 // Refresh preserves actual rows through slow and failed responses.
 listMode='slow';let refresh=w.wishwaveInboxSection('messages');await tick();assertList();assert(!w.document.querySelector('.ww-inbox-loading'));pendingLists.shift().reject(Error('Offline'));await refresh;assertList();assert(w.document.querySelector('.ww-inbox-load-error'));
 listMode='normal';w.document.querySelector('.ww-inbox-load-error button').click();await tick();assertList();assert(!w.document.querySelector('.ww-inbox-load-error'));
 listMode='malformed';await w.wishwaveInboxSection('messages');assertList();assert(w.document.querySelector('.ww-inbox-load-error'),'invalid response never means no conversations');
 listMode='empty';await w.wishwaveInboxSection('messages');assert(w.document.querySelector('.app-mp-instagram-empty'),'successful empty response can show empty state');
 // A different account cannot inherit the previous account list, and a late response cannot repaint a chat.
 listMode='normal';await w.wishwaveInboxSection('messages');assertList();listMode='slow';w.marketplaceSession=()=>'other-account';const other=w.wishwaveInboxSection('messages');await tick();assert(w.document.querySelector('.ww-inbox-loading'));assert(!w.document.querySelector('.app-mp-conversation-card'));pendingLists.shift().resolve({conversations:[]});await other;
 w.marketplaceSession=()=>'signed-in';listMode='normal';await w.wishwaveInboxSection('messages');listMode='slow';refresh=w.wishwaveInboxSection('messages');await tick();w.document.querySelector('.app-mp-conversation-card').click();await tick();assert(inbox.classList.contains('chat-open'));pendingLists.shift().resolve({conversations:[]});await refresh;assert(inbox.classList.contains('chat-open'),'late list response cannot replace the open chat');
 assert.equal(errors.length,0,JSON.stringify(errors));
 console.log('PASS: cold and cached loading; offline retry; confirmed-empty handling; account isolation; late list responses; actual Inbox list/chat renderers; repeated header Back; legacy entry; non-reading Hi preview; Messages/Activity swipes; Profile swipe; vertical scroll; visual viewport keyboard resize; compose recipient/chat return');w.close();
})().catch(e=>{console.error(e);w.close();process.exitCode=1});
