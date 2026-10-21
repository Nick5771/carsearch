const fs=require('fs'),vm=require('vm'),assert=require('assert');
const worker=fs.readFileSync('findai-worker.js','utf8');
const start=worker.indexOf('async function wishwaveRestrictedProfile(');
const end=worker.indexOf('async function findaiSafetyBlockByEmail(',start);
assert(start>=0&&end>start,'block relation helper exists');
const blocks=new Set();
const ctx=vm.createContext({findaiControlExists:async(_env,owner,target,kind)=>blocks.has(owner+'>'+target+':'+kind)});
vm.runInContext(worker.slice(start,end),ctx);
const relation=(a,b)=>ctx.wishwaveRestrictedProfile({},a,b);
(async()=>{
 let r=await relation('a','b');assert.equal(r.restricted,false);assert.equal(r.blockedByViewer,false);
 blocks.add('a>b:blocked');
 r=await relation('a','b');assert.equal(r.blockedByViewer,true);assert.equal(r.restricted,false,'block initiator must still see profile');
 r=await relation('b','a');assert.equal(r.blockedViewer,true);assert.equal(r.restricted,true,'blocked user sees restricted shell');
 blocks.add('b>a:blocked');
 r=await relation('a','b');assert.equal(r.restricted,true,'mutual blocks restrict both');
 assert(worker.includes('const access=await wishwaveRestrictedProfile(env,viewerEmailForRestricted,targetEmailForRestricted);'),'seller profile respects relationship');
 assert(worker.includes("if(access.restricted)return jsonResp({\n            seller:"),'restricted seller profile returns empty shell');
 assert(worker.includes('const access=await wishwaveRestrictedProfile(env,viewerEmailForRestricted,String(row.user_email'),'public username profile respects relationship');
 assert(worker.includes("if(access.restricted)return jsonResp({\n            profile:"),'restricted username profile returns empty shell');
 assert(worker.includes("if(await findaiEitherBlocked(env,auth.email,targetEmail))return jsonResp({error:'Profile not found'},404"),'blocked follow by username is rejected');
 assert(worker.includes("if (await findaiEitherBlocked(env,auth.email,sellerEmail)) return jsonResp({error:'Profile not found'},404"),'blocked follow by seller is rejected');
 assert(worker.includes("DELETE FROM marketplace_follows WHERE seller_id=? AND lower(follower_email)=lower(?)"),'blocking removes follows');
 assert(worker.includes("DELETE FROM findai_follow_requests WHERE seller_id=? AND lower(follower_email)=lower(?)"),'blocking removes pending requests');
 // Exercise the full username endpoint. A helper-only test missed the later
 // symmetric guard that undid the directional access decision.
 const routeStart=worker.indexOf('      const publicFindAIProfileMatch =');
 const routeEnd=worker.indexOf("      if (url.pathname === '/profile/me'",routeStart);
 let viewer='a';
 Object.assign(ctx,{
  mpEnsureSchema:async()=>{},findaiProfileEnsureSchema:async()=>{},findaiSocialControlsEnsureSchema:async()=>{},
  emailFromSession:async()=>viewer,findaiUsernameNormalize:s=>s,
  findaiEitherBlocked:async(_env,a,b)=>blocks.has(a+'>'+b+':blocked')||blocks.has(b+'>'+a+':blocked'),
  findaiAppPrefsRead:async()=>({privateAccount:false}),findaiProfileJson:row=>({username:row.username,displayName:row.display_name}),
  jsonResp:(body,status=200)=>({body,status})
 });
 vm.runInContext('async function getProfile(request,env,url){'+worker.slice(routeStart,routeEnd)+'}',ctx);
 const env={DB:{prepare(){return {bind(){return this},first:async()=>({user_email:'b',username:'target',display_name:'Visible seller'})}}}};
 const get=()=>ctx.getProfile({method:'GET'},env,new URL('https://test/profile/public/target'));
 blocks.clear();blocks.add('a>b:blocked');
 r=await get();assert.equal(r.status,200);assert.equal(r.body.profile.displayName,'Visible seller','blocker can reopen the full profile endpoint');assert.equal(r.body.viewer.blockedByViewer,true);assert.equal(r.body.viewer.restricted,false);
 blocks.clear();blocks.add('b>a:blocked');
 r=await get();assert.equal(r.status,200);assert.equal(r.body.viewer.restricted,true);assert.equal(r.body.profile.displayName,'');assert.equal(r.body.listings.length,0,'blocked viewer receives no private profile details');
 console.log('PASS: blocker retains profile, blocked viewer sees restricted shell, mutual block restricted, blocked follow not found and existing follows removed');
})().catch(e=>{console.error(e);process.exitCode=1});
