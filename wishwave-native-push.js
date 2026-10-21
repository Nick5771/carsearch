/* Apple push transport. Credentials stay in Worker secrets, never in the app. */
(function(root){
'use strict';
const topic='com.nickfiani.wishwave';
const fields=['APNS_TEAM_ID','APNS_KEY_ID','APNS_PRIVATE_KEY'];
const b64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
const enc=x=>new TextEncoder().encode(JSON.stringify(x));
let cached;
function configuration(env){return {configured:fields.every(k=>!!env[k]),missing:fields.filter(k=>!env[k]),topic};}
async function ensure(env){
 await env.DB.prepare(`CREATE TABLE IF NOT EXISTS marketplace_native_push (
 installation_id TEXT PRIMARY KEY,user_email TEXT NOT NULL,device_token TEXT NOT NULL,
 environment TEXT NOT NULL,updated_at TEXT NOT NULL,disabled_at TEXT,last_success_at TEXT,last_error TEXT,
 UNIQUE(device_token,environment))`).run();
}
async function authorization(env){
 const keyText=String(env.APNS_PRIVATE_KEY||'').replace(/\\n/g,'\n');
 const cacheKey=String(env.APNS_TEAM_ID)+'|'+String(env.APNS_KEY_ID)+'|'+keyText;
 const now=Math.floor(Date.now()/1000);
 if(cached&&cached.key===cacheKey&&now-cached.at<3000)return cached.token;
 const der=Uint8Array.from(atob(keyText.replace(/-----[^-]+-----|\s/g,'')),x=>x.charCodeAt(0));
 const key=await crypto.subtle.importKey('pkcs8',der,{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
 const text=b64(enc({alg:'ES256',kid:String(env.APNS_KEY_ID)}))+'.'+b64(enc({iss:String(env.APNS_TEAM_ID),iat:now}));
 const signature=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,new TextEncoder().encode(text));
 const token=text+'.'+b64(signature);cached={key:cacheKey,at:now,token};return token;
}
function targetURL(value){
 try{const u=new URL(value);if(u.protocol==='https:'&&['findai.ai','www.findai.ai'].includes(u.hostname)&&u.pathname==='/findai-app.html'&&!u.username&&!u.password)return u.href;}catch(_){}
 return 'https://findai.ai/findai-app.html';
}
function presentation(notice,actor){
 const type=String(notice.type||''),username=String(actor?.username||'').replace(/^@+/,''),name=username?'@'+username:String(actor?.name||'Someone');
 const social={follow_request:name+' requested to follow you',follow:name+' started following you',follow_mutual:'You and '+name+' started following each other',follow_accepted:name+' accepted your follow request',like:name+' liked your listing',comment:name+' commented on your listing',followed_seller_listing:name+' listed something new'};
 let body=social[type]||[notice.title,notice.body].filter(Boolean).join(' — ');
 if(type==='message')body=name+' sent you a message'+(notice.body?' — '+String(notice.body).replace(/^[^:]{1,100}:\s*/, ''):'');
 const url=social[type]?'https://findai.ai/findai-app.html?notifications=social':targetURL(notice.url);
 return {...notice,title:'WishWave',body,url};
}
async function send(env,device,notice,transport=fetch){
 if(!configuration(env).configured)return {accepted:false,reason:'NotConfigured'};
 const payload={aps:{alert:{title:'WishWave',body:String(notice.body||'').slice(0,240)},sound:'default'},url:targetURL(notice.url),type:String(notice.type||'activity'),actor_username:String(notice.actorUsername||'').replace(/^@+/,'').slice(0,40)};
 // The app uses an unread dot, so do not publish a misleading app-icon count.
 const host=device.environment==='sandbox'?'api.sandbox.push.apple.com':'api.push.apple.com';
 let response;
 try{response=await transport('https://'+host+'/3/device/'+device.device_token,{method:'POST',headers:{authorization:'bearer '+await authorization(env),'apns-topic':topic,'apns-push-type':'alert','apns-priority':'10','apns-expiration':String(Math.floor(Date.now()/1000)+300),'content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(10000)});}
 catch(_){return {accepted:false,reason:'TransportError'};}
 const now=new Date().toISOString();let reason='';
 if(!response.ok){try{reason=String((await response.json()).reason||'Rejected');}catch(_){reason='Rejected';}}
 if(response.ok)await env.DB.prepare('UPDATE marketplace_native_push SET last_success_at=?,last_error=NULL WHERE installation_id=? AND device_token=?').bind(now,device.installation_id,device.device_token).run();
 else {
 const invalid=response.status===410||['BadDeviceToken','DeviceTokenNotForTopic','Unregistered'].includes(reason);
 await env.DB.prepare('UPDATE marketplace_native_push SET last_error=?,disabled_at=CASE WHEN ? THEN ? ELSE disabled_at END WHERE installation_id=? AND device_token=?').bind(reason,invalid?1:0,now,device.installation_id,device.device_token).run();
 }
 return {accepted:response.ok,status:response.status,reason,requestId:response.headers.get('apns-id')||''};
}
async function notify(env,email,notice){
 if(!configuration(env).configured)return [];
 await ensure(env);
 const rows=await env.DB.prepare('SELECT * FROM marketplace_native_push WHERE user_email=? AND disabled_at IS NULL ORDER BY updated_at DESC LIMIT 8').bind(email).all();
 return Promise.allSettled((rows.results||[]).map(device=>send(env,device,notice)));
}
async function route(request,env,d){
 const path=new URL(request.url).pathname;
 const auth=await d.auth(request,env);if(auth.fail)return auth.fail;
 const json=(x,status=200)=>d.json(x,status,{'Cache-Control':'no-store'});
 if(!env.DB)return json({error:'Notifications are temporarily unavailable'},503);
 await ensure(env);
 if(path==='/marketplace/push/native/status'&&request.method==='GET')return json(configuration(env));
 if(request.method!=='POST')return json({error:'Not found'},404);
 if(!['register','unregister','test'].some(x=>path==='/marketplace/push/native/'+x))return json({error:'Not found'},404);
 if(d.rate&&await d.rate(env,request,'native-push',30,60))return json({error:'Please wait before trying again'},429);
 let body;try{body=await request.json();}catch(_){return json({error:'Invalid request'},400);}
 const installation=String(body.installationId||'');if(!/^[a-zA-Z0-9-]{20,80}$/.test(installation))return json({error:'Invalid installation'},400);
 if(path.endsWith('/unregister')){
 await env.DB.prepare('DELETE FROM marketplace_native_push WHERE installation_id=? AND user_email=?').bind(installation,auth.email).run();return json({ok:true});
 }
 if(path.endsWith('/register')){
 const token=String(body.token||'').toLowerCase(),environment=body.environment;
 if(!/^[a-f0-9]{32,512}$/.test(token)||!['sandbox','production'].includes(environment))return json({error:'Invalid Apple device registration'},400);
 // A refreshed token replaces the previous token for this installation. Rebinding
 // the same device after account changes removes the previous recipient.
 await env.DB.batch([
 env.DB.prepare('DELETE FROM marketplace_native_push WHERE device_token=? AND environment=? AND installation_id<>?').bind(token,environment,installation),
 env.DB.prepare(`INSERT INTO marketplace_native_push(installation_id,user_email,device_token,environment,updated_at) VALUES(?,?,?,?,?)
 ON CONFLICT(installation_id) DO UPDATE SET user_email=excluded.user_email,device_token=excluded.device_token,environment=excluded.environment,updated_at=excluded.updated_at,disabled_at=NULL,last_error=NULL`).bind(installation,auth.email,token,environment,new Date().toISOString())]);
 return json({ok:true,...configuration(env)});
 }
 const device=await env.DB.prepare('SELECT * FROM marketplace_native_push WHERE installation_id=? AND user_email=? AND disabled_at IS NULL').bind(installation,auth.email).first();
 if(!device)return json({error:'Enable notifications on this iPhone first'},409);
 if(!configuration(env).configured)return json({error:'Apple push credentials still need to be configured',...configuration(env)},503);
 const result=await send(env,device,{title:'WishWave notifications are on',body:'This is a real push notification sent through Apple.',type:'test',url:'https://findai.ai/findai-app.html'},d.transport);
 return json(result,result.accepted?200:502);
}
const api={configuration,ensure,authorization,targetURL,presentation,send,notify,route};root.WishWaveNativePush=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
