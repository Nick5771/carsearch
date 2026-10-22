const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/../wishwave-push-client.js','utf8');
const swift=fs.readFileSync(__dirname+'/../ios/WishWave/WishWave/WishWaveApp.swift','utf8');
const foreground=swift.split('func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {')[1]?.split('func pruneDeliveredFollowRequests(')[0]||'';
assert(foreground,'native notification delegate handles foreground deliveries');
assert(foreground.includes('completionHandler([])'),'always suppress iOS banners/sounds in foreground, including inactive transitions');
assert(foreground.includes('NotificationCenter.default.post(name: Self.arrived'),'foreground delivery refreshes the in-app banner');
assert(!/applicationState|completionHandler\(\[\s*\.banner|completionHandler\(\[\s*\.sound|completionHandler\(\[\s*\.list/.test(foreground.replace(/\/\/[^\n]*/g,'')),'no native fallback may present a duplicate iPhone banner in foreground');

async function fixture(){
 let token='account-a',permission='granted',action=[],calls=[],toasts=[],failure=false,resolveRegistration;
 const events={},state={textContent:''};
 const context={console,URL,Uint8Array,atob,Promise,setInterval:()=>1,setTimeout,clearTimeout,Event:class{constructor(type){this.type=type}},document:{readyState:'loading',visibilityState:'visible',getElementById:()=>state,addEventListener:(name,fn)=>events[name]=fn},navigator:{},marketplaceSession:()=>token,WORKER_BASE:'https://api.test',showToast:text=>toasts.push(text),addEventListener:(name,fn)=>events[name]=fn,webkit:{messageHandlers:{wishwavePush:{postMessage:async body=>{action.push(body.action);return{permission,installationId:'installation-1234567890',token:'ab'.repeat(32),environment:'sandbox'};}}}},fetch:async(url,options)=>{calls.push({url,options});if(resolveRegistration&&url.endsWith('/register'))await new Promise(r=>resolveRegistration(r));return {ok:!failure,json:async()=>failure?{error:'Apple push credentials still need to be configured'}:{ok:true,configured:true,accepted:true}};}};context.window=context;vm.createContext(context);vm.runInContext(source,context);
 return {context,events,state,action,calls,toasts,setToken:x=>token=x,setPermission:x=>permission=x,setFailure:x=>failure=x,hold:fn=>resolveRegistration=fn};
}
(async()=>{
 let f=await fixture();await f.context.appSyncPush(false);assert.equal(f.action[0],'status');assert.equal(f.state.textContent,'On');assert.equal(f.calls[0].options.headers.Authorization,'Bearer account-a');
 await f.context.appTestPush();assert(f.calls.some(x=>x.url.endsWith('/test')));assert(f.toasts.some(x=>x.includes('Apple accepted')));
 const remove=f.context.appRemovePush();f.setToken('');await remove;assert.equal(f.calls.at(-1).options.headers.Authorization,'Bearer account-a','logout captures session before clearing it');assert(f.calls.at(-1).url.endsWith('/unregister'));
 f=await fixture();f.setPermission('denied');await f.context.appEnableNotifications();assert.equal(f.state.textContent,'Blocked');assert.equal(f.calls.length,0);assert(f.toasts[0].includes('iPhone Settings'));
 f=await fixture();f.setPermission('default');await f.context.appSyncPush(false);assert.deepEqual(f.action,['status']);assert.equal(f.calls.length,0,'automatic sync never prompts');
 f=await fixture();f.setFailure(true);await f.context.appTestPush();assert(!f.toasts.some(x=>x.includes('accepted')));assert(f.toasts.at(-1).includes('credentials'));
 f=await fixture();let resume;f.hold(r=>resume=r);const pending=f.context.appSyncPush(false);while(!resume)await new Promise(r=>setImmediate(r));f.setToken('account-b');resume();await pending;assert(f.calls.at(-1).url.endsWith('/unregister'),'stale account registration removed');assert.equal(f.calls.at(-1).options.headers.Authorization,'Bearer account-a');
 console.log('Native push client checks passed: permission, test outcomes, account changes and logout.');
})().catch(e=>{console.error(e);process.exit(1)});
