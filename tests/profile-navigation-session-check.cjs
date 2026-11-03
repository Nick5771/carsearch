const fs=require('node:fs'),assert=require('node:assert/strict'),{JSDOM,VirtualConsole}=require('jsdom');
const html=fs.readFileSync('findai-app.html','utf8');
const dom=new JSDOM(html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,''),{url:'https://test/',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:new VirtualConsole(),beforeParse(w){w.matchMedia=()=>({matches:true,addEventListener(){},addListener(){}});w.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};w.ResizeObserver=class{observe(){}disconnect(){}};w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=function(){};w.fetch=async()=>({ok:true,json:async()=>({items:[],listings:[],comments:[]}),text:async()=>''});}});
const w=dom.window,tick=()=>new Promise(r=>setTimeout(r,25)),assertShown=(id,value)=>assert.equal(w.document.getElementById(id)?.classList.contains('show'),value,id);
function main(tab){w.document.querySelectorAll('.screen').forEach(el=>el.classList.toggle('active',el.id===tab));w.document.body.dataset.activeTab=tab;w.setMainNavActive(tab);}
(async()=>{
 await new Promise(r=>setTimeout(r,200));
 let session='',signed=null,messageResolve,conversationOpens=0,listLoads=0;
 const realConversation=w.appMpOpenConversation;
 w.getAccountProfile=()=>signed;w.marketplaceSession=()=>session;
 w.applyFindaiUser=user=>{session=user.session;signed={email:user.email,username:'me'};};
 w.signOutAccount=()=>{session='';signed=null;};w.updateAccountHeader=()=>{};
 w.marketplaceFetch=async path=>{
  if(path.startsWith('/social/message-user/'))return new Promise(resolve=>messageResolve=resolve);
  if(path.includes('counts=1'))return {followers:2,following:3};
  if(path.startsWith('/social/connections/'))return {people:[{username:'alice',displayName:'Alice'}],nextOffset:1,hasMore:false};
  if(path.startsWith('/profile/public/')){const username=decodeURIComponent(path.split('/').at(-1));return {profile:{username,displayName:username},sellerId:username,activeCount:0,followerCount:2,viewer:{signedIn:!!session}};}
  return {items:[],listings:[],comments:[],conversations:[],messages:[]};
 };
 w.openAppMarketplaceInbox=async()=>{listLoads++;w.document.getElementById('appMpInbox').classList.add('show');w.document.getElementById('appMpInboxBody').textContent='Conversation list';};
 w.appMpOpenConversation=async id=>{conversationOpens++;w.eval('appMpConversation='+JSON.stringify(id));const root=w.document.getElementById('appMpInbox');root.classList.add('show','chat-open');root.querySelector('#appMpInboxBody').innerHTML='<div class="chat-fixture">Chat '+id+'</div>';};
 // Use actual notification panel construction, but keep badge requests deterministic.
 w.appRefreshMarketplaceBadge=async()=>{};
 if(w.findaiNotificationState){w.findaiNotificationState.load=async()=>{};w.findaiNotificationState.getUnread=()=>0;}
 w.eval(fs.readFileSync('wishwave-navigation-origins.js','utf8'));
 w.eval(fs.readFileSync('wishwave-connections.js','utf8'));
 w.eval(fs.readFileSync('wishwave-inbox.js','utf8'));
 await w.wishwaveOpenNotificationTab();
 assert(w.document.querySelector('.ww-guest-inbox-a'),'guest receives sign-in content');
 w.applyFindaiUser({email:'me@test',session:'signed-in'});await tick();
 assert(!w.document.querySelector('.ww-guest-inbox-a'),'sign-in removes stale guest content');
 assert(!w.document.getElementById('findaiNotificationPanel').classList.contains('ww-inbox-guest'));
 assert(w.document.getElementById('wwInboxMessages').contains(w.document.getElementById('appMpInbox')),'authenticated inbox is docked');
 // History can restore old guest markup; reconcile from the live session.
 w.document.getElementById('wwInboxMessages').insertAdjacentHTML('beforeend','<div class="ww-guest-inbox-a">Sign in</div>');
 w.document.dispatchEvent(new w.CustomEvent('wishwave-origin-restored'));await tick();assert(!w.document.querySelector('.ww-guest-inbox-a'));
 // Profile stats remain tappable after their direct onclick handler is lost.
 main('search');await tick();await w.openFindAIProfileByUsername('nick');await tick();
 const profile=w.document.getElementById('wishwavePublicProfilePage');assertShown(profile.id,true);
 for(const kind of ['followers','following']){
  w.__wishwaveResetPageReturn();
  const button=profile.querySelector('[data-connection-kind="'+kind+'"]');assert(button);button.onclick=null;
  button.click();await tick();assertShown('wishwaveConnectionsPage',true);assertShown(profile.id,false);
  assert.equal(w.document.querySelector('#wishwaveConnectionsPage h2').textContent,kind==='followers'?'Followers':'Following');
  assert(w.document.querySelector('.ww-connections-person').textContent.includes('alice'));
  w.__wishwaveResetPageReturn();w.document.querySelector('#wishwaveConnectionsPage [data-close]').click();await tick();assertShown(profile.id,true);assertShown('wishwaveConnectionsPage',false);
 }
 // Another still-visible layer must not become the swipe preview merely because
 // it appears last in the route registry.
 const notice=w.document.getElementById('findaiNotificationPanel');notice.classList.add('show');
 const message=profile.querySelector('#wishwavePublicMessageButton');w.__wishwaveResetPageReturn();message.click();await tick();
 assertShown(profile.id,true);assert.equal(w.document.body.dataset.activeTab,'search');
 const loadsBefore=listLoads;messageResolve({conversationId:'nick-chat'});await tick();
 assert.equal(conversationOpens,1);assert.equal(listLoads,loadsBefore,'profile Message bypasses inbox-list loading');
 assert.equal(w.document.body.dataset.activeTab,'search','child chat does not switch main tabs');assertShown(profile.id,false);assertShown('appMpInbox',true);
 assert.equal(w.wishwaveNavigationOrigins().at(-1).view,'appMpInbox');
 const surface=w.__wishwaveOriginSurface(w.document.querySelector('.chat-fixture'));
 assert.equal(surface.prepareUnder(),profile,'swipe reveals actual profile opener, not Notifications');surface.releaseUnder(false);
 surface.back();await tick();assertShown(profile.id,true);assert.equal(w.document.body.dataset.activeTab,'search');assert.equal(profile.querySelector('#wishwavePublicMessageButton'),message,'Back retains profile controls');
 // Leaving via bottom navigation invalidates a pending profile Message request.
 message.click();await tick();w.__wishwaveOriginNav({target:w.document.querySelector('.premium-bottom-nav button[data-tab="discover"]')});main('discover');messageResolve({conversationId:'late-chat'});await tick();assert.equal(conversationOpens,1,'late Message request cannot reopen another screen');
 // Sign-out/sign-in in the same Inbox also repairs the guest state in both directions.
 main('notifications');notice.classList.add('show');w.signOutAccount();await tick();assert(w.document.querySelector('.ww-guest-inbox-a'));
 w.applyFindaiUser({email:'second@test',session:'second'});await tick();assert(!w.document.querySelector('.ww-guest-inbox-a'));
 // The actual conversation renderer also works without loading the inbox first.
 w.appMpOpenConversation=realConversation;w.appMpLoadMessages=async()=>{};
 main('search');await tick();await w.openFindAIProfileByUsername('real-seller');await tick();
 const realMessage=w.document.getElementById('wishwavePublicMessageButton');w.__wishwaveResetPageReturn();realMessage.click();await tick();messageResolve({conversationId:'real-chat'});await tick();
 assertShown('appMpInbox',true);assert(w.document.getElementById('appMpInbox').classList.contains('chat-open'));assert.equal(w.eval('appMpConversation'),'real-chat');assert.equal(w.eval('appMpCurrentConversation.otherPartyUsername'),'real-seller');
 // A slow profile lookup cannot replace a newer selected identity.
 const fetch=w.marketplaceFetch;let resolveSlow;
 w.marketplaceFetch=(path,...args)=>path==='/profile/public/slow-seller'?new Promise(resolve=>resolveSlow=resolve):fetch(path,...args);
 const slow=w.openFindAIProfileByUsername('slow-seller');await tick();await w.openFindAIProfileByUsername('latest-seller');
 resolveSlow({profile:{username:'slow-seller'},sellerId:'slow-seller',viewer:{signedIn:true}});await slow;
 assert.equal(w.eval('wishwavePublicSellerData.seller.username'),'latest-seller','ignore stale profile response');
 // Legacy chats must not open an unrelated fuzzy search result or guess among
 // multiple people with the same display name.
 const a=html.indexOf('  async function openCurrentChatProfile(explicitUsername){'),b=html.indexOf('  window.findaiOpenCurrentChatProfileV178=',a);
 w.eval(html.slice(a,b));w.eval('appMpCurrentConversation={otherParty:"Shared name"}');let sellerOpens=0;w.openPremiumSellerProfileById=()=>sellerOpens++;
 w.marketplaceFetch=async()=>({sellers:[{id:'unrelated',displayName:'Different name'}]});await w.openCurrentChatProfile();assert.equal(sellerOpens,0);
 w.marketplaceFetch=async()=>({sellers:[{id:'a',displayName:'Shared name'},{id:'b',displayName:'Shared name'}]});await w.openCurrentChatProfile();assert.equal(sellerOpens,0);
 console.log('PASS: guest-to-signed-in Inbox reconciliation; restored guest repair; Followers/Following open above profile; profile Message opens one direct chat without a tab detour; Back reveals exact opener; late requests are discarded');
 w.close();
})().catch(error=>{console.error(error);w.close();process.exitCode=1;});
