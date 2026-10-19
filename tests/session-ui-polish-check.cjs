const fs=require('fs'),assert=require('assert'),{JSDOM}=require('jsdom');
const html=fs.readFileSync('findai-app.html','utf8');
const dom=new JSDOM('<div id="navProfileAvatar" class="has-image"><img src="https://old.test/photo"><span></span></div><div id="profileAvatar" class="has-image"><img src="https://old.test/photo"></div><div id="socialProfileContent">saved account content</div><div id="findaiNotificationList"></div><div id="appMpInboxBody"></div><div id="appMpInbox" class="show chat-open"></div><button id="follow">Follow</button>',{url:'https://test',runScripts:'outside-only'}),w=dom.window;
let signedIn=true,session='owner',calls=[],login=0,buzz=0;
w.getAccountProfile=()=>signedIn?{email:'owner@test'}:null;w.marketplaceSession=()=>session;w.openLogin=()=>login++;w.haptic=()=>buzz++;w.toast=()=>{};w.renderHomeNotifications=()=>{};w.marketplaceFetch=(url,opts)=>new Promise((resolve,reject)=>calls.push({url,opts,resolve,reject}));
let a=html.indexOf('  let notificationFollowVersion='),b=html.indexOf('  window.findaiNotificationFollowRequestAction=',a);w.eval(html.slice(a,b).replace('let notificationFollowVersion','var notificationFollowVersion'));
a=html.indexOf('  async function loadHomeNotifications(){');b=html.indexOf('  window.openHomeNotifications=',a);w.eval(html.slice(a,b));
w.ensureNotificationUI=()=>{};w.listingMilestoneNotifications=()=>[];w.setHomeNotificationState=()=>{};
const tick=()=>new Promise(r=>setImmediate(r));
(async()=>{
 w.eval('appNotificationCache=[{actor_username:"actor",viewer_is_following:false}]');
 const button=w.document.getElementById('follow');
 const load=w.loadHomeNotifications();const stale=calls.at(-1);
 const follow=w.findaiNotificationFollowBack(null,0,button);assert.equal(buzz,1);assert.equal(button.textContent,'Following');assert(w.eval('appNotificationCache[0].viewer_is_following'));
 const action=calls.at(-1);stale.resolve({notifications:[{actor_username:'actor',viewer_is_following:false}]});await tick();calls.at(-1).resolve({});await load;assert(w.eval('appNotificationCache[0].viewer_is_following'),'stale refresh cannot undo optimistic follow');
 action.resolve({isFollowing:true});await follow;assert(!button.disabled);
 w.eval('appNotificationCache[0].viewer_is_following=false');
 const failure=w.findaiNotificationFollowBack(null,0,button);calls.at(-1).reject(new Error('offline'));await failure;assert(!w.eval('appNotificationCache[0].viewer_is_following'),'failed request rolls back');
 session='';signedIn=false;const count=calls.length;await w.findaiNotificationFollowBack(null,0,button);assert.equal(login,1);assert.equal(calls.length,count,'guest never sends follow request');
 // Signed-out rendering cannot expose saved or sold contents.
 a=html.indexOf('function renderSocialProfileContent(');b=html.indexOf("  if(tab==='listings'){",a);w.$=selector=>w.document.querySelector(selector);w.eval(html.slice(a,b)+'}');w.renderSocialProfileContent(w.document.getElementById('socialProfileContent'),'saved');assert.equal(w.document.getElementById('socialProfileContent').textContent,'');
 // A late owned-listing response after logout must never be saved.
 signedIn=true;session='owner';w.getMarketplaceListings=()=>[];let saves=0;w.saveMarketplaceListings=()=>saves++;a=html.indexOf('async function loadMarketplaceListings(){');b=html.indexOf('function resetCreateListingForm()',a);w.eval(html.slice(a,b));const listings=w.loadMarketplaceListings();signedIn=false;session='';calls.at(-1).resolve({listings:[{id:'private'}]});assert.equal((await listings).length,0);assert.equal(saves,0);
 // Avatar synchronisation must consult the active account before the old DOM.
 a=html.indexOf('  function authoritativeAvatar(){');b=html.indexOf('  function syncNavAvatar(){',a);w.eval(html.slice(a,b));assert.equal(w.authoritativeAvatar(),'');
 // Logout clears every DOM avatar source and private collection surface.
 w.signOutAccount=()=>{};w.socialProfileListings=[{}];w.socialProfileSeller={};w.appMpConversationList=[{}];w.appMpCurrentConversation={};w.appMpConversation='chat';let reset=0;w.findaiNotificationState={reset:()=>reset++};w.wishwaveSyncNavAvatar=()=>{};w.appRefreshMarketplaceBadge=()=>{};w.updateAccountHeader=()=>{};
 w.eval(html.match(/<script id="wishwave-session-cleanup-v319">([\s\S]*?)<\/script>/)[1]);w.signOutAccount();assert.equal(reset,1);assert(!w.document.querySelector('#navProfileAvatar img').hasAttribute('src'));assert(!w.document.getElementById('profileAvatar').classList.contains('has-image'));assert.equal(w.socialProfileListings.length,0);assert(!w.document.getElementById('appMpInbox').classList.contains('show'));
 console.log('PASS: notification follow optimism, refresh race, rollback, guest auth guard, private render guard, stale listings response, logout avatar and private DOM cleanup');
})().catch(e=>{console.error(e);process.exitCode=1;});
