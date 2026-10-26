const fs=require('fs'),assert=require('assert'),vm=require('vm');
const source=fs.readFileSync('findai-worker.js','utf8');
const access=source.slice(source.indexOf('async function wishwaveRestrictedProfile('),source.indexOf('async function findaiSafetyBlockByEmail('));
const route=source.slice(source.indexOf('      const connectionsMatch=url.pathname.match('),source.indexOf('      // Header count does not need follower profiles'));
let viewerBlockedTarget=false,targetBlockedViewer=false,privateAccount=false;
const context=vm.createContext({URL,requireUser:async()=>({email:'viewer@test'}),mpEnsureSchema:async()=>{},findaiProfileEnsureSchema:async()=>{},findaiSocialControlsEnsureSchema:async()=>{},findaiUsernameNormalize:s=>s,findaiEmailForUsername:async(_env,name)=>name==='missing'?null:'target@test',findaiControlExists:async(_env,owner,target)=>owner==='viewer@test'&&target==='target@test'?viewerBlockedTarget:targetBlockedViewer,findaiAppPrefsRead:async()=>({privateAccount}),jsonResp:(body,status=200)=>({body,status})});
const identity=source.slice(source.indexOf('async function findaiEmailForSocialIdentity('),source.indexOf('async function findaiUsernameForEmail('));
vm.runInContext(identity+access+'\nasync function handle(request,env){const url=new URL(request.url);'+route+'}',context);
const env={DB:{prepare(sql){return {bind(){return this},async first(){return sql.includes('AS followers')?{followers:1,following:4}:null},async all(){return {results:[]}}};}}};
const get=(path='nick?counts=1')=>context.handle({method:'GET',url:'https://test/social/connections/'+path},env);
(async()=>{
 let r=await get();assert.equal(r.status,200);assert.equal(r.body.following,4);
 viewerBlockedTarget=true;r=await get();assert.equal(r.status,200,'blocker retains profile counts');assert.equal(r.body.following,4);assert.equal(r.body.followers,1);assert.equal((await get('nick')).status,403,'block does not grant access to connection lists');
 targetBlockedViewer=true;assert.equal((await get()).status,404,'blocked viewer cannot see counts');
 viewerBlockedTarget=false;assert.equal((await get()).status,404);targetBlockedViewer=false;privateAccount=true;assert.equal((await get('nick')).status,403,'private lists remain private');assert.equal((await get('missing?counts=1')).status,404);
 console.log('PASS: numeric profile counts remain visible to the blocker; reciprocal blocks, blocked viewers and private connection lists stay restricted');
})().catch(e=>{console.error(e);process.exitCode=1});
