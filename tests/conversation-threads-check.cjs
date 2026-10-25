const fs=require('fs'),vm=require('vm'),assert=require('assert'),{DatabaseSync}=require('node:sqlite');
const source=fs.readFileSync('findai-worker.js','utf8'),db=new DatabaseSync(':memory:');
db.exec(`CREATE TABLE marketplace_sellers(id TEXT,user_email TEXT,display_name TEXT);
CREATE TABLE marketplace_listings(id TEXT,title TEXT,image_urls_json TEXT,item_price_minor INTEGER,currency TEXT);
CREATE TABLE marketplace_conversations(id TEXT,listing_id TEXT,buyer_email TEXT,seller_id TEXT,created_at TEXT,updated_at TEXT,last_message_at TEXT);
CREATE TABLE findai_profiles(user_email TEXT,display_name TEXT,username TEXT,avatar_url TEXT);
CREATE TABLE users(email TEXT,name TEXT);
CREATE TABLE marketplace_messages(id TEXT,conversation_id TEXT,sender_email TEXT,body TEXT,image_url TEXT,shared_item_json TEXT,read_at TEXT,created_at TEXT);
CREATE TABLE marketplace_message_reactions(message_id TEXT,user_email TEXT,emoji TEXT);
CREATE TABLE marketplace_notifications(user_email TEXT,read_at TEXT,notification_type TEXT,target_url TEXT);
CREATE TABLE marketplace_offers(id TEXT,listing_id TEXT,buyer_email TEXT,seller_id TEXT,updated_at TEXT);
CREATE TABLE marketplace_conversation_mutes(conversation_id TEXT,user_email TEXT,created_at TEXT,UNIQUE(conversation_id,user_email));
INSERT INTO marketplace_sellers VALUES('sa','a@test','Nick'),('sb','b@test','Nick'),('sc','c@test','Nick');
INSERT INTO marketplace_listings VALUES('l1','Monitor','[]',24900,'AUD'),('l2','Shoes','[]',9900,'AUD'),('l3','Desk','[]',10000,'AUD');
INSERT INTO marketplace_conversations VALUES('c1','l1','a@test','sb','1','1','2026-01-01'),('c2','l2','a@test','sb','2','2','2026-01-02'),('c3','l3','b@test','sa','3','3','2026-01-03'),('c4','l1','a@test','sc','4','4','2026-01-04');
INSERT INTO marketplace_messages VALUES('m1','c1','b@test','first','','',NULL,'2026-01-01'),('m2','c2','a@test','second','','',NULL,'2026-01-02'),('m3','c3','b@test','reverse','','',NULL,'2026-01-03'),('m4','c4','c@test','private','','',NULL,'2026-01-04');
INSERT INTO marketplace_offers VALUES('o1','l1','a@test','sb','2026-01-01'),('o2','l2','a@test','sb','2026-01-02'),('o3','l3','b@test','sa','2026-01-03'),('o4','l1','a@test','sc','2026-01-04');
INSERT INTO marketplace_notifications VALUES('a@test',NULL,'offer','https://test/?conversation=c1'),('a@test',NULL,'offer','https://test/?conversation=c2'),('a@test',NULL,'offer','https://test/?conversation=c4');`);
const env={DB:{prepare(sql){const statement=db.prepare(sql);let args=[];return {bind(...v){args=v;return this},async first(){return statement.get(...args)||null},async all(){return {results:statement.all(...args)}},async run(){return statement.run(...args)}}}}};
let viewer='a@test';
const context=vm.createContext({URL,Date,Promise,JSON,Number,String,Map,
 requireUser:async()=>({email:viewer}),mpEnsureSchema:async()=>{},jsonResp:(body,status=200)=>({body,status}),mpTouchPresence:async()=>{},mpPresenceItem:async()=>null,wishwaveRestrictedProfile:async()=>({}),findaiMessageAllowed:async()=>true,
 mpSafeCurrency:(s,f)=>s||f,mpImageArray:s=>JSON.parse(s),mpPublicFirstName:s=>s,mpMaskEmail:s=>s,mpMessageItem:r=>r,mpOfferItem:r=>r,
});
function load(start,end,name){vm.runInContext(`async function ${name}(request,env,url){${source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)))}}`,context);}
vm.runInContext(source.slice(source.indexOf('function mpConversationThreadSQL()'),source.indexOf('function mpSharedItemFromRow(')),context);
vm.runInContext(source.slice(source.indexOf('async function wishwaveConversationMember('),source.indexOf('async function findaiSafetyTarget(')),context);
load('      const mpMessagesMatch =',"      if (url.pathname === '/marketplace/push/config'",'messages');
load("      if (url.pathname === '/marketplace/conversations' && request.method === 'GET')",'      const mpTypingMatch =','inbox');
load('      const conversationMuteMatch=','      const mpMessagesMatch =','mute');
const url=id=>new URL('https://test/marketplace/conversations/'+id+'/messages');
(async()=>{
 const list=await context.inbox({method:'GET'},env,new URL('https://test/marketplace/conversations'));
 assert.equal(list.status,200,JSON.stringify(list));assert.equal(list.body.conversations.length,2,'same names are distinct people, both listing directions collapse');
 assert.equal(list.body.conversations.find(c=>c.id==='c3').unreadCount,4,'aggregate unread messages and offers');
 for(const id of ['c1','c2','c3']){
  const result=await context.messages({method:'GET'},env,url(id));assert.equal(result.status,200,JSON.stringify(result));
  assert.deepEqual(Array.from(result.body.messages,m=>m.id),['m1','m2','m3']);assert.deepEqual(Array.from(result.body.offers,o=>o.id),['o1','o2','o3']);
 }
 assert(db.prepare("SELECT read_at FROM marketplace_messages WHERE id='m1'").get().read_at);assert.equal(db.prepare("SELECT read_at FROM marketplace_messages WHERE id='m4'").get().read_at,null);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM marketplace_notifications WHERE read_at IS NULL").get().n,1);
 viewer='outsider@test';assert.equal((await context.messages({method:'GET'},env,url('c1'))).status,403);
 viewer='b@test';const reverse=await context.messages({method:'GET'},env,url('c2'));assert.equal(reverse.body.messages.length,3);
 viewer='a@test';let result=await context.mute({method:'POST'},env,new URL('https://test/marketplace/conversations/c1/mute'));assert.equal(result.status,200,JSON.stringify(result));assert(await context.wishwaveConversationMuted(env,'c3',viewer));assert(!await context.wishwaveConversationMuted(env,'c4',viewer));
 result=await context.mute({method:'DELETE'},env,new URL('https://test/marketplace/conversations/c2/mute'));assert.equal(result.status,200);assert(!await context.wishwaveConversationMuted(env,'c1',viewer));
 db.close();console.log('PASS: one inbox conversation per account pair, both directions, complete history/offers, aggregated unread/read, old links, access isolation and pair mute/unmute');
})().catch(e=>{console.error(e);process.exitCode=1});
