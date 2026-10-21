/* Native APNs and browser push use the same notification settings and events. */
(function(){
'use strict';
const native=()=>!!window.webkit?.messageHandlers?.wishwavePush;
const session=()=>typeof marketplaceSession==='function'?marketplaceSession():'';
const headers=token=>({'Content-Type':'application/json',Authorization:'Bearer '+token});
let registered=null,flight=null,generation=0;
const statusText=text=>{const el=document.getElementById('appPushState');if(el)el.textContent=text;};
const tell=text=>{if(typeof window.toast==='function')window.toast(text);else if(typeof showToast==='function')showToast(text);else alert(text);};
async function api(path,body,token=session(),keepalive=false){
 const response=await fetch(WORKER_BASE+path,{method:'POST',headers:headers(token),body:JSON.stringify(body),keepalive});
 let data={};try{data=await response.json();}catch(_){}
 if(!response.ok)throw new Error(data.error||(data.reason?'Apple could not accept the notification ('+data.reason+').':'Could not update notifications. Please try again.'));
 return data;
}
async function nativeSync(prompt=false){
 if(flight){const result=await flight;return prompt&&result?.permission==='default'?nativeSync(true):result;}
 const token=session(),version=generation;if(!token){statusText('Off');return null;}
 flight=(async()=>{
 const device=await window.webkit.messageHandlers.wishwavePush.postMessage({action:prompt?'request':'status'});
 if(version!==generation||session()!==token)return null;
 if(device.permission!=='granted'){
 statusText(device.permission==='denied'?'Blocked':'Off');
 if(prompt)tell(device.permission==='denied'?'Allow notifications in iPhone Settings → Apps → WishWave → Notifications.':'Notifications are off.');
 return device;
 }
 const result=await api('/marketplace/push/native/register',device,token);
 if(version!==generation||session()!==token){await api('/marketplace/push/native/unregister',{installationId:device.installationId},token,true);return null;}
 registered={...device,session:token};statusText(result.configured?'On':'Setup needed');
 if(prompt)tell(result.configured?'WishWave notifications are on.':'Notifications are allowed. Apple push setup still needs to be completed.');
 return {...device,configured:result.configured};
 })();
 try{return await flight;}finally{flight=null;}
}
function browserSupported(){return 'Notification'in window&&'serviceWorker'in navigator&&'PushManager'in window;}
async function browserSync(prompt=false,test=false){
 if(!session())return null;
 if(!browserSupported()){if(prompt)tell('Use the WishWave iPhone app, or a browser that supports notifications.');return null;}
 let permission=Notification.permission;if(prompt&&permission==='default')permission=await Notification.requestPermission();
 if(permission!=='granted'){statusText(permission==='denied'?'Blocked':'Off');if(prompt&&permission==='denied')tell('Notifications are blocked in your browser settings.');return null;}
 const config=await(await fetch(WORKER_BASE+'/marketplace/push/config')).json();
 if(!config.supported)throw new Error('Notifications are temporarily unavailable.');
 const reg=await navigator.serviceWorker.register('/service-worker.js');await navigator.serviceWorker.ready;
 let subscription=await reg.pushManager.getSubscription();
 if(!subscription){const key=atob(config.publicKey.replace(/-/g,'+').replace(/_/g,'/'));subscription=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:Uint8Array.from(key,x=>x.charCodeAt(0))});}
 await api('/marketplace/push/subscribe',subscription.toJSON());statusText('On');
 if(test)await api('/marketplace/push/test',{});
 return {permission:'granted'};
}
window.appPushSupported=browserSupported;
window.appSetPushState=statusText;
window.appSyncPush=(prompt=false,test=false)=>native()?nativeSync(prompt):browserSync(prompt,test);
window.appEnableNotifications=async function(){
 if(!session()){if(typeof openLogin==='function')openLogin();return;}
 try{await window.appSyncPush(true,false);}catch(e){statusText('Setup needed');tell(e.message);}
};
window.appTestPush=async function(){
 if(!session()){if(typeof openLogin==='function')openLogin();return;}
 try{
 if(native()){
 const device=await nativeSync(true);if(device?.permission!=='granted')return;
 const result=await api('/marketplace/push/native/test',{installationId:device.installationId});
 tell(result.accepted?'Apple accepted your test notification. Check your notification banner.':'Apple could not accept the test.');
 }else{await browserSync(true,true);}
 }catch(e){tell(e.message);}
};
window.appRemovePush=async function(){
 const token=session();generation++;const device=registered;registered=null;statusText('Off');
 if(!token)return;
 if(native()){
 const info=device||await window.webkit.messageHandlers.wishwavePush.postMessage({action:'status'});
 if(info?.installationId)await api('/marketplace/push/native/unregister',{installationId:info.installationId},token,true);
 }else if(browserSupported()){
 const reg=await navigator.serviceWorker.getRegistration('/service-worker.js'),sub=await reg?.pushManager.getSubscription();
 if(sub){await api('/marketplace/push/unsubscribe',{endpoint:sub.endpoint},token,true);await sub.unsubscribe();}
 }
};
function sync(){if(native()&&session())nativeSync(false).catch(()=>statusText('Setup needed'));}
function boot(){
 const update=window.updateAccountHeader;
 if(typeof update==='function')window.updateAccountHeader=function(){const result=update.apply(this,arguments);queueMicrotask(sync);return result;};
 const start=window.appStartMarketplaceSync;
 if(typeof start==='function')window.appStartMarketplaceSync=function(){const result=start.apply(this,arguments);sync();return result;};
 sync();window.addEventListener('wishwave-push-resume',sync);window.addEventListener('pageshow',sync);
 setInterval(()=>{if(document.visibilityState==='visible')sync();},60000);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
