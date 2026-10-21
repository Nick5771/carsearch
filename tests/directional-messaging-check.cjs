const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync('findai-worker.js','utf8');
const blocks=new Set(),writes=[],notifications=[],tasks=[];
let viewer='a@test',permission='everyone',following=false;
const conversation={id:'c',listing_id:'l',seller_email:'b@test',buyer_email:'a@test',seller_username:'b',buyer_username:'a'};
const env={DB:{prepare(sql){let args=[];return {bind(...values){args=values;return this},async first(){
 if(sql.includes('FROM marketplace_conversations c'))return conversation;
 if(sql.includes('FROM marketplace_follows'))return following?{yes:1}:null;
 if(sql.includes('FROM marketplace_sellers'))return {id:'s'};
 if(sql.includes('FROM findai_profiles p'))return {user_email:'b@test',username:'b'};
 return null;
},async all(){return {results:[]}},async run(){writes.push({sql,args});return {}}}}}};
const context=vm.createContext({URL,Date,Promise,JSON,Number,String,
 findaiControlExists:async(_env,owner,target,kind)=>kind==='blocked'&&blocks.has(owner+'>'+target),
 findaiAppPrefsRead:async()=>({messagePermission:permission}),mpEnsureSchema:async()=>{},findaiProfileEnsureSchema:async()=>{},
 requireUser:async()=>({email:viewer}),jsonResp:(body,status=200)=>({body,status}),
 rateLimited:async()=>false,tooManyResp:()=>({status:429}),mpTouchPresence:async()=>{},
 mpCleanText:(s,n)=>String(s||'').slice(0,n),findaiSafetyAssertText:()=>{},mpMessageHasExternalContact:()=>false,
 mpId:()=>String(writes.length),mpPublicFirstName:()=> 'Person',wishwaveConversationMuted:async()=>false,
 mpNotifyUser:async(_env,email,notice)=>notifications.push({email,notice}),mpPresenceItem:async()=>null,
 mpConversationItem:()=>({id:'c'}),mpMessageItem:row=>row,mpOfferItem:row=>row,
 ctx:{waitUntil:p=>tasks.push(p)}
});
let start=source.indexOf('async function findaiMessageAllowed('),end=source.indexOf('// ── FindAI social profiles',start);
vm.runInContext(source.slice(start,end),context);
start=source.indexOf('async function wishwaveRestrictedProfile(');end=source.indexOf('async function findaiSafetyBlockByEmail(',start);
vm.runInContext(source.slice(start,end),context);
start=source.indexOf('      const mpMessagesMatch =');end=source.indexOf("      if (url.pathname === '/marketplace/push/config'",start);
vm.runInContext('async function messages(request,env,url){'+source.slice(start,end)+'}',context);
start=source.indexOf('      const socialMessageUserMatch=');end=source.indexOf('      // ── Marketplace conversations and messages',start);
vm.runInContext('async function openChat(request,env,url){'+source.slice(start,end)+'}',context);
const url=new URL('https://test/marketplace/conversations/c/messages');
const send=body=>context.messages({method:'POST',json:async()=>body},env,url);
const allowed=(a,b)=>context.findaiMessageAllowed(env,a,b);
(async()=>{
 blocks.add('a@test>b@test');
 assert(await allowed('a@test','b@test'),'blocker may send');
 assert(!await allowed('b@test','a@test'),'blocked person cannot send replies');
 let result=await send({body:'Hello'});assert.equal(result.status,201);await Promise.all(tasks);assert.equal(notifications.length,1);
 const before=writes.length;viewer='b@test';
 for(const body of [{body:'Reply'},{imageUrl:'https://test/image.jpg'},{sharedItem:{title:'Listing'}}]){
  result=await send(body);assert.equal(result.status,403);assert.equal(writes.length,before,'rejected replies must not create messages or Sent receipts');
 }
 result=await context.messages({method:'GET'},env,url);assert.equal(result.body.conversation.messaging.canSend,false);
 viewer='a@test';result=await context.messages({method:'GET'},env,url);assert.equal(result.body.conversation.messaging.canSend,true);assert.equal(result.body.conversation.messaging.blockedByViewer,true);
 blocks.add('b@test>a@test');assert(!await allowed('a@test','b@test'));assert.equal((await send({body:'Mutual block'})).status,403);
 result=await context.openChat({method:'POST'},env,new URL('https://test/social/message-user/b'));assert.equal(result.status,403,'profile-message opener cannot bypass recipient block');
 blocks.clear();permission='no_one';assert(!await allowed('a@test','b@test'),'recipient privacy is preserved');
 permission='followers';assert(!await allowed('a@test','b@test'));following=true;assert(await allowed('a@test','b@test'));
 permission='everyone';assert(await allowed('a@test','b@test'));assert(await allowed('b@test','a@test'),'unblocking restores both directions');
 // Use the real notification gate: accepted one-way messages may notify their
 // recipient, while messages addressed to the blocker cannot produce alerts.
 let prefsRead=0;
 Object.assign(context,{findaiEitherBlocked:async(_env,a,b)=>blocks.has(a+'>'+b)||blocks.has(b+'>'+a),findaiNotificationPrefs:async()=>{prefsRead++;return{}},findaiNotificationPushAllowed:()=>false});
 const notifyStart=source.indexOf('async function mpNotifyUser('),notifyEnd=source.indexOf('async function findaiNotificationActor(',notifyStart);
 vm.runInContext(source.slice(notifyStart,notifyEnd),context);
 blocks.add('a@test>b@test');
 await context.mpNotifyUser(env,'b@test',{actorEmail:'a@test',type:'message',skipInbox:true});assert.equal(prefsRead,1,'recipient of blocker message passes notification block gate');
 await context.mpNotifyUser(env,'a@test',{actorEmail:'b@test',type:'message',skipInbox:true});assert.equal(prefsRead,1,'incoming blocked message cannot produce an alert');

 console.log('PASS: directional block sends, rejected text/photo/listing replies without writes, mutual blocks, composer state, profile-entry guard, privacy and unblock');
})().catch(error=>{console.error(error);process.exitCode=1});
