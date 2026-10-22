const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {DatabaseSync}=require('node:sqlite');
const {JSDOM}=require('jsdom');
const js=fs.readFileSync('wishwave-live-activity.js','utf8');
const worker=fs.readFileSync('findai-worker.js','utf8');
const html=fs.readFileSync('findai-app.html','utf8');
new Function(js);
assert(html.includes('wishwave-live-activity.js?v=355'));
assert(js.includes('background:linear-gradient(145deg,rgba(20,21,23,.985),rgba(13,14,16,.99))'), 'in-app notification matches selected near-black color');
assert(js.includes('rgba(255,255,255,.09)'), 'near-black banner retains a subtle edge rather than bright outline');
assert(html.includes('const snapshot=arguments[0];'));
assert(worker.includes('await findaiSocialControlsEnsureSchema(env);'));
assert(worker.includes('if(!await pendingStillExists())return;'));

(async()=>{
  const d=new JSDOM('<!DOCTYPE html><html><head></head><body><div id="appMpInbox"></div></body></html>',{
    url:'https://findai.ai/findai-app.html',runScripts:'outside-only',pretendToBeVisual:true
  });
  const w=d.window;
  let notifications=[],conversations=[],opened=[],snapshots=[];
  w.marketplaceSession=()=> 'session-1';
  w.marketplaceFetch=async path=>{
    if(path==='/marketplace/notifications/summary')return {notifications,unreadCount:notifications.length};
    if(path==='/marketplace/conversations')return {conversations,unreadCount:conversations.reduce((n,c)=>n+c.unreadCount,0)};
    throw Error('Unexpected request: '+path);
  };
  w.findaiNotificationState={
    load:async snapshot=>snapshots.push(snapshot),
    getCache:()=>notifications
  };
  w.openAppMarketplaceInbox=async id=>opened.push(id);
  w.setHomeNotificationState=()=>{};
  w.eval(js);
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  assert(w.wishwaveLiveActivity,'foreground activity booted');
  await w.wishwaveLiveActivity.refresh();
  assert.equal(w.document.querySelector('#wwLiveActivity').classList.contains('show'),false,'old notifications do not banner on boot');

  const now=Date.now();
  conversations=[{id:'chat1',otherParty:'Nicholas Fiani',otherPartyUsername:'nick1',
    otherPartyAvatar:'https://images.example.com/nick.jpg',lastMessage:"What's the best price?",
    lastMessageAt:new Date(now).toISOString(),unreadCount:1}];
  await w.wishwaveLiveActivity.refresh();
  const banner=w.document.querySelector('#wwLiveActivity');
  assert(banner.classList.contains('show'),'new message opens in-app banner');
  assert.equal(banner.querySelector('.ww-live-heading').textContent,'Nicholas Fiani','display name is the only heading');
  assert.equal(banner.querySelector('.ww-live-detail').textContent,"What's the best price?",'message preview is shown directly');
  assert.equal(banner.querySelector('.ww-live-icon img')?.src,'https://images.example.com/nick.jpg','uses the real sender avatar');
  assert.equal(banner.querySelector('.ww-live-time').textContent,'now','subtle timestamp is displayed');
  assert(banner.querySelector('.ww-live-chevron'),'navigation chevron remains');
  assert(!banner.textContent.includes('sent you a message'),'redundant message label is removed');
  assert(!banner.querySelector('.ww-live-unread'),'no blue dot on profile photo');
  assert.equal(banner.querySelector('#wwLiveActivityButton').getAttribute('aria-label'),
    "Open message from Nicholas Fiani. What's the best price?");
  w.document.querySelector('#wwLiveActivityButton').click();
  await new Promise(r=>setTimeout(r,10));
  assert.deepEqual(opened,['chat1'],'tapping message opens specific conversation');
  assert(!banner.classList.contains('show'));

  conversations.push({id:'chat2',otherParty:'Alex Smith',otherPartyUsername:'alex',otherPartyAvatar:'',
    lastMessage:'Hello',lastMessageAt:new Date(now+2).toISOString(),unreadCount:1});
  await w.wishwaveLiveActivity.refresh();
  assert.equal(banner.querySelector('.ww-live-icon').textContent,'AS','missing avatars use initials instead of generic chat icon');
  const swipeStart=new w.Event('touchstart',{bubbles:true});
  Object.defineProperty(swipeStart,'touches',{value:[{clientY:150}]});
  const swipeEnd=new w.Event('touchend',{bubbles:true});
  Object.defineProperty(swipeEnd,'changedTouches',{value:[{clientY:95}]});
  banner.querySelector('#wwLiveActivityButton').dispatchEvent(swipeStart);
  banner.querySelector('#wwLiveActivityButton').dispatchEvent(swipeEnd);
  assert(!banner.classList.contains('show'),'swiping upward dismisses the in-app banner');
  banner.querySelector('#wwLiveActivityButton').click();
  assert.deepEqual(opened,['chat1'],'swipe dismissal does not accidentally open the message');

  notifications=[{id:'offer1',notification_type:'offer',title:'New offer received',
     body:'A buyer offered $150 for your listing',created_at:new Date(now+1).toISOString(),
     target_url:'https://findai.ai/findai-app.html?conversation=offer-chat'}];
  await w.wishwaveLiveActivity.refresh();
  assert(banner.classList.contains('show'),'new offer opens in-app banner');
  assert(banner.textContent.includes('New offer received'));
  w.document.querySelector('#wwLiveActivityButton').click();
  await new Promise(r=>setTimeout(r,10));
  assert.deepEqual(opened,['chat1','offer-chat'],'tapping offer opens its conversation');
  assert(snapshots.length>=2,'only changed notification snapshots re-render the inbox');
  d.window.close();

  const i=worker.indexOf('function wishwaveVisibleNotificationSQL(');
  const end=worker.indexOf('async function wishwaveOwnFollowerCount(',i);
  assert(i>=0&&end>i);
  const fn=vm.runInNewContext(worker.slice(i,end)+';wishwaveVisibleNotificationSQL');
  const db=new DatabaseSync(':memory:');
  db.exec("CREATE TABLE findai_user_controls(owner_email TEXT,target_email TEXT,kind TEXT);"+
          "CREATE TABLE marketplace_sellers(id TEXT,user_email TEXT);"+
          "CREATE TABLE findai_follow_requests(seller_id TEXT,follower_email TEXT);"+
          "CREATE TABLE marketplace_notifications(id TEXT,user_email TEXT,actor_email TEXT,notification_type TEXT,created_at TEXT);"+
          "INSERT INTO marketplace_sellers VALUES('target','recipient@test');"+
          "INSERT INTO findai_follow_requests VALUES('target','sender@test');"+
          "INSERT INTO marketplace_notifications VALUES('n1','recipient@test','sender@test','follow_request','2026-10-22T00:00:00Z');");
  const sql="SELECT id FROM marketplace_notifications n WHERE "+fn('n');
  assert.equal(db.prepare(sql).all().length,1,'active follow request is visible');
  db.prepare('DELETE FROM findai_follow_requests WHERE seller_id=? AND follower_email=?').run('target','sender@test');
  assert.equal(db.prepare(sql).all().length,0,'withdrawn request disappears from notification queries and unread counts');
  console.log('PASS: live banner deep links, initial quiet baseline and withdrawn follow filtering');
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
