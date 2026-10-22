const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {webcrypto}=require('node:crypto'),{DatabaseSync}=require('node:sqlite');
const push=require('../wishwave-native-push.js');
class D1{constructor(){this.db=new DatabaseSync(':memory:');}prepare(sql){let args=[];const db=this.db;const p={bind(...a){args=a;return p},async run(){return db.prepare(sql).run(...args)},async first(){return db.prepare(sql).get(...args)||null},async all(){return{results:db.prepare(sql).all(...args)}}};return p;}async batch(statements){this.db.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());this.db.exec('COMMIT');return results;}catch(e){this.db.exec('ROLLBACK');throw e;}}}
(async()=>{
 const pair=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const der=await webcrypto.subtle.exportKey('pkcs8',pair.privateKey);
 const env={DB:new D1(),APNS_TEAM_ID:'TEAM123456',APNS_KEY_ID:'KEY1234567',APNS_PRIVATE_KEY:'-----BEGIN PRIVATE KEY-----\n'+Buffer.from(der).toString('base64')+'\n-----END PRIVATE KEY-----'};
 const base='/marketplace/push/native/',id='installation-1234567890',token='ab'.repeat(32);let sent=[],accepted=true;
 const d={auth:async r=>r.headers.get('X-User')?{email:r.headers.get('X-User')}:{fail:Response.json({error:'Sign in'},{status:401})},json:(data,status=200)=>Response.json(data,{status}),rate:async()=>false,transport:async(url,options)=>{sent.push({url,options});return accepted?new Response(null,{status:200,headers:{'apns-id':'request-123'}}):Response.json({reason:'Unregistered'},{status:410});}};
 const call=(action,body={},email='a@test',method='POST',environment=env)=>push.route(new Request('https://test'+base+action,{method,headers:email?{'X-User':email}:{},...(method==='POST'?{body:JSON.stringify(body)}:{})}),environment,d);
 assert.equal((await call('register',{},'')).status,401);
 assert.equal((await call('register',{installationId:id,token:'bad',environment:'sandbox'})).status,400);
 assert.equal((await call('register',{installationId:id,token,environment:'invalid'})).status,400);
 assert.equal((await call('register',{installationId:id,token,environment:'sandbox'})).status,200);
 assert.equal((await call('test',{installationId:id},'b@test')).status,409,'cannot test another account device');
 let result=await(await call('test',{installationId:id})).json();assert(result.accepted);assert.equal(result.requestId,'request-123');
 assert(sent[0].url.startsWith('https://api.sandbox.push.apple.com/3/device/'));
 const opts=sent[0].options,payload=JSON.parse(opts.body);assert.equal(opts.headers['apns-topic'],'com.nickfiani.wishwave');assert.equal(opts.headers['apns-push-type'],'alert');assert.equal(payload.aps.sound,'default');assert.equal(payload.type,'test');assert(!opts.body.includes(token));assert(!opts.body.includes(env.APNS_PRIVATE_KEY));
 const messageNotice=push.presentation({type:'message',body:'A buyer: Meet at 7:30?',url:'https://findai.ai/findai-app.html?conversation=chat-1'},{name:'Darcy Moffet',username:'darcy'});
 assert.equal(messageNotice.title,'Darcy Moffet');assert.equal(messageNotice.body,'Meet at 7:30?');
 await push.send(env,{environment:'sandbox',device_token:token,installation_id:id},messageNotice,d.transport);
 const messagePayload=JSON.parse(sent.at(-1).options.body);assert.equal(messagePayload.aps.alert.title,'Darcy Moffet');assert.equal(messagePayload.aps.alert.body,'Meet at 7:30?');assert(messagePayload.url.includes('conversation=chat-1'));assert(!messagePayload.aps.alert.body.includes('sent you a message'));
 assert.equal(push.presentation({type:'message',messagePreview:'Question: is it available?',url:messageNotice.url},{username:'sender'}).body,'Question: is it available?');
 const jwt=opts.headers.authorization.slice(7),parts=jwt.split('.');assert.equal(JSON.parse(Buffer.from(parts[0],'base64url')).alg,'ES256');assert.equal(JSON.parse(Buffer.from(parts[1],'base64url')).iss,'TEAM123456');
 assert(await webcrypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},pair.publicKey,Buffer.from(parts[2],'base64url'),new TextEncoder().encode(parts[0]+'.'+parts[1])));
 assert.equal(await push.authorization(env),jwt,'provider token reused');
 assert.equal((await call('test',{installationId:id},'a@test','POST',{...env,APNS_PRIVATE_KEY:''})).status,503,'missing Apple credentials are not success');
 assert.equal((await call('test',{installationId:id},'a@test','POST',env)).status,200);
 d.rate=async()=>true;assert.equal((await call('test',{installationId:id})).status,429);d.rate=async()=>false;
 await call('register',{installationId:id,token:'cd'.repeat(32),environment:'production'},'b@test');
 assert.equal(env.DB.db.prepare('SELECT COUNT(*) n FROM marketplace_native_push').get().n,1,'rotated token replaces old token');
 assert.equal((await call('test',{installationId:id},'a@test')).status,409);
 await call('unregister',{installationId:id},'a@test');assert.equal(env.DB.db.prepare('SELECT COUNT(*) n FROM marketplace_native_push').get().n,1,'old account cannot unregister new account');
 accepted=false;result=await call('test',{installationId:id},'b@test');assert.equal(result.status,502);assert(sent.at(-1).url.includes('https://api.push.apple.com/'));assert(env.DB.db.prepare('SELECT disabled_at FROM marketplace_native_push').get().disabled_at);
 assert.equal((await call('test',{installationId:id},'b@test')).status,409,'invalid device disabled');
 await call('register',{installationId:id,token:'ef'.repeat(32),environment:'sandbox'},'b@test');
 await call('register',{installationId:'replacement-install-123456',token:'ef'.repeat(32),environment:'sandbox'},'a@test');assert.equal(env.DB.db.prepare('SELECT COUNT(*) n FROM marketplace_native_push').get().n,1,'same APNs token has one owner');
 const device=env.DB.db.prepare('SELECT * FROM marketplace_native_push').get();const failure=await push.send(env,device,{title:'Test'},async()=>{throw new Error('network')});assert.equal(failure.reason,'TransportError');
 await call('unregister',{installationId:'replacement-install-123456'},'a@test');assert.equal(env.DB.db.prepare('SELECT COUNT(*) n FROM marketplace_native_push').get().n,0);
 assert.equal(push.targetURL('https://evil.test/findai-app.html'),'https://findai.ai/findai-app.html');assert.equal(push.targetURL('https://findai.ai.evil.test/findai-app.html'),'https://findai.ai/findai-app.html');assert.equal(push.targetURL('https://findai.ai/findai-app.html?conversation=abc'),'https://findai.ai/findai-app.html?conversation=abc');
 // Real notification dispatch must apply account preferences and block/mute
 // checks before invoking the native transport, including push-only messages.
 const source=fs.readFileSync(__dirname+'/../findai-worker.js','utf8');let deliveries=0,blocked=false,muted=false,allowed=true;
 const context=vm.createContext({console,crypto:webcrypto,TextEncoder,Uint8Array,btoa,Date,Promise,mpEnsureSchema:async()=>{},mpCleanText:x=>String(x),mpId:()=> 'notice',findaiControlExists:async(_e,_a,_b,kind)=>kind==='blocked'?blocked:muted,findaiEitherBlocked:async()=>blocked,findaiNotificationPrefs:async()=>({}),findaiNotificationPushAllowed:()=>allowed,findaiAppPrefsRead:async()=>({}),findaiAppPushAllowed:()=>true,logErr:()=>{},WishWaveNativePush:{notify:async()=>{deliveries++;}},env:{DB:{prepare:()=>({bind(){return this},run:async()=>{},all:async()=>({results:[]})})}}});
 vm.runInContext(source.slice(source.indexOf('async function mpNotifyUser('),source.indexOf('async function findaiNotificationActor(')),context);
 async function dispatch(type='message'){await context.mpNotifyUser(context.env,'recipient@test',{actorEmail:'sender@test',type,title:'Test',skipInbox:true});}
 await dispatch();assert.equal(deliveries,1,'native push works without browser subscription');
 blocked=true;await dispatch();assert.equal(deliveries,1);blocked=false;muted=true;await dispatch();assert.equal(deliveries,1);muted=false;allowed=false;await dispatch();assert.equal(deliveries,1);allowed=true;await dispatch('follow');assert.equal(deliveries,2);
 console.log('Native push checks passed: signed APNs transport, account ownership, rotation, errors, preferences and blocks.');
})().catch(e=>{console.error(e);process.exit(1)});
