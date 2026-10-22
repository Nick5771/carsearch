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
assert(html.includes('async function loadHomeNotifications(snapshot)'));
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
  conversations=[{id:'chat1',otherPartyUsername:'nick1',lastMessage:'Is the item available?',lastMessageAt:new Date(now).toISOString(),unreadCount:1}];
  await w.wishwaveLiveActivity.refresh();
  const banner=w.document.querySelector('#wwLiveActivity');
  assert(banner.classList.contains('show'),'new message opens in-app banner');
  assert(banner.textContent.includes('@nick1 sent you a message'));
  w.document.querySelector('#wwLiveActivityButton').click();
  await new Promise(r=>setTimeout(r,10));
  assert.deepEqual(opened,['chat1'],'tapping message opens specific conversation');
  assert(!banner.classList.contains('show'));

  notifications=[{id:'offer1',notification_type:'offer',title:'New offer received',
     body:'A buyer offered $150 for your listing',created_at:new Date(now+1).toISOString(),
     target_url:'https://findai.ai/findai-app.html?conversation=offer-chat'}];
  await w.wishwaveLiveActivity.refresh();
  assert(banner.classList.contains('show'),'new offer opens in-app banner');
  assert(banner.textContent.includes('New offer received'));
  w.document.querySelector('#wwLiveActivityButton').click();
  await new Promise(r=>setTimeout(r,10));
  assert.deepEqual(opened,['chat1','offer-chat'],'tapping offer opens its conversation');
  assert(snapshots.length>=3,'live updates share notification snapshots with existing inbox UI');
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
