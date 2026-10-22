/* WishWave in-app activity: one quiet banner for actionable messages/offers,
   a live unread indicator for social events, and direct contextual navigation.
   No synthetic events; the authenticated API remains the source of truth. */
(function(){
'use strict';
const PERIOD=6000;
const DISPLAY_MS=4200;
const MAX_QUEUE=3;
let owner='',initialized=false,flight=null,sequence=0,seen=new Set(),messageState=new Map(),lastNotificationDigest='';
let queue=[],active=null,hideTimer=0,blurTimer=0,root=null,button=null,disposed=false;
const native=()=>!!window.webkit?.messageHandlers?.wishwavePush;
const visible=()=>!document.hidden&&document.visibilityState!=='hidden';
const session=()=>typeof marketplaceSession==='function'?marketplaceSession():'';
const isChatOpen=id=>{
  const inbox=document.getElementById('appMpInbox');
  return !!(inbox?.classList.contains('chat-open')&&typeof appMpConversation!=='undefined'&&String(appMpConversation)===String(id));
};
const safeText=x=>String(x==null?'':x).replace(/\s+/g,' ').trim();
const urlId=(item,key)=>{
  try{return new URL(item.target_url||item.targetUrl||'',location.href).searchParams.get(key)||'';}catch(_){return '';}
};
const haptic=()=>{
  try{
    if(window.webkit?.messageHandlers?.findaiHaptic)window.webkit.messageHandlers.findaiHaptic.postMessage('selection');
  }catch(_){}
};
function install(){
 if(root)return;
 const style=document.createElement('style');style.id='wishwave-live-activity-style';
 style.textContent=
  '#wwLiveActivity{position:fixed;top:calc(env(safe-area-inset-top,0px) + 9px);left:50%;width:min(calc(100% - 24px),440px);z-index:2147483000;transform:translate3d(-50%,-140%,0);opacity:0;pointer-events:none;transition:transform .32s cubic-bezier(.2,.8,.2,1),opacity .22s ease;contain:layout style;}' +
  '#wwLiveActivity.show{transform:translate3d(-50%,0,0);opacity:1;pointer-events:auto;}' +
  '#wwLiveActivityButton{appearance:none;display:flex;align-items:center;width:100%;min-height:64px;gap:11px;border:1px solid rgba(255,255,255,.13);border-radius:21px;padding:9px 13px;color:#f8f8f9;background:linear-gradient(135deg,rgba(33,34,38,.98),rgba(44,45,50,.97));box-shadow:0 12px 32px rgba(0,0,0,.29);-webkit-backdrop-filter:blur(18px);backdrop-filter:blur(18px);text-align:left;font:inherit;cursor:pointer;touch-action:pan-y;-webkit-tap-highlight-color:transparent;}' +
  '#wwLiveActivityButton:active{background:#36383d;}' +
  '.ww-live-icon{width:43px;height:43px;border-radius:50%;background:#45464b;display:grid;place-items:center;flex:none;color:#f7f7f8;font-size:13px;font-weight:650;letter-spacing:.2px;overflow:hidden;}' +
  '.ww-live-icon.has-avatar{background:#303136;}' +
  '.ww-live-icon img{display:block;width:100%;height:100%;object-fit:cover;border-radius:50%;}' +
  '.ww-live-icon svg{width:21px;height:21px;stroke:currentColor;stroke-width:1.8;fill:none;stroke-linecap:round;stroke-linejoin:round;}' +
  '.ww-live-copy{min-width:0;flex:1;display:block;}.ww-live-heading{display:block;font-size:15px;font-weight:660;line-height:1.27;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#fff;}' +
  '.ww-live-detail{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;font-size:13px;line-height:1.37;margin-top:3px;color:#c3c5cb;overflow-wrap:anywhere;}' +
  '.ww-live-right{flex:none;align-self:stretch;display:flex;flex-direction:column;justify-content:space-between;align-items:flex-end;padding:2px 0;min-width:25px;}' +
  '.ww-live-time{color:#a6a8af;font-size:11px;font-weight:480;line-height:1.15;}' +
  '.ww-live-chevron{color:#aaaeb5;font-size:21px;line-height:1;font-weight:400;padding-right:1px;}' +
  '@media(prefers-reduced-motion:reduce){#wwLiveActivity{transition:none!important;}}';
 document.head.appendChild(style);
 root=document.createElement('div');root.id='wwLiveActivity';root.setAttribute('role','status');root.setAttribute('aria-live','polite');
 button=document.createElement('button');button.type='button';button.id='wwLiveActivityButton';
 button.setAttribute('aria-label','Open notification');
 let fingerY=null,suppressClick=false;
 button.addEventListener('touchstart',e=>{fingerY=e.touches?.[0]?.clientY??null;suppressClick=false;},{passive:true});
 button.addEventListener('touchend',e=>{if(fingerY!==null&&(e.changedTouches?.[0]?.clientY??fingerY)-fingerY < -38){suppressClick=true;dismiss();}}, {passive:true});
 button.addEventListener('click',()=>{if(suppressClick){suppressClick=false;return;}const item=active;dismiss(true);if(item)open(item);});
 root.appendChild(button);document.body.appendChild(root);
}
function icon(kind){
 return kind==='message'
 ?'<svg viewBox="0 0 24 24"><path d="M20 16a3 3 0 0 1-3 3H9l-5 3V7a4 4 0 0 1 4-4h9a3 3 0 0 1 3 3z"/></svg>'
 :'<svg viewBox="0 0 24 24"><path d="M12 3H4a1 1 0 0 0-1 1v8l9 9 9-9-9-9z"/><circle cx="8" cy="8" r="1.5"/></svg>';
}
function draw(item){
 install();button.replaceChildren();
 const mark=document.createElement('span');mark.className='ww-live-icon';mark.setAttribute('aria-hidden','true');
 if(item.kind==='message'){
   const name=safeText(item.title).replace(/^@/,'');
   const initials=name.split(/\s+/).filter(Boolean).slice(0,2).map(part=>part[0].toUpperCase()).join('')||'?';
   let avatarUrl='';
   const avatarValue=String(item.avatar||'').trim();
   if(avatarValue)try{const url=new URL(avatarValue,location.href);if(url.protocol==='https:'||url.protocol==='http:')avatarUrl=url.href;}catch(_){}
   if(avatarUrl){
     mark.classList.add('has-avatar');
     const image=document.createElement('img');image.src=avatarUrl;image.alt='';image.decoding='async';
     image.addEventListener('error',()=>{if(image.parentNode===mark){mark.classList.remove('has-avatar');mark.textContent=initials;}},{once:true});
     mark.appendChild(image);
   }else mark.textContent=initials;
 }else mark.innerHTML=icon(item.kind);
 const copy=document.createElement('span');copy.className='ww-live-copy';
 const heading=document.createElement('span');heading.className='ww-live-heading';heading.textContent=item.title;
 const detail=document.createElement('span');detail.className='ww-live-detail';detail.textContent=item.body;
 const right=document.createElement('span');right.className='ww-live-right';right.setAttribute('aria-hidden','true');
 const time=document.createElement('span');time.className='ww-live-time';time.textContent='now';
 const chevron=document.createElement('span');chevron.className='ww-live-chevron';chevron.textContent='›';
 right.append(time,chevron);copy.append(heading,detail);button.append(mark,copy,right);
 button.setAttribute('aria-label',(item.kind==='message'?'Open message from ':'Open notification: ')+item.title+'. '+item.body);
 root.classList.add('show');clearTimeout(hideTimer);hideTimer=setTimeout(()=>dismiss(),DISPLAY_MS);
}
function dismiss(quiet=false){
 clearTimeout(hideTimer);hideTimer=0;
 if(root)root.classList.remove('show');
 active=null;
 clearTimeout(blurTimer);
 if(!quiet)blurTimer=setTimeout(showNext,340);
 else queue.length=0;
}
function showNext(){
 if(active||!queue.length||!visible())return;
 active=queue.shift();draw(active);
}
function enqueue(item){
 if(!item||!visible()||!initialized||!session())return;
 if(active?.key===item.key||queue.some(other=>other.key===item.key))return;
 queue.push(item);if(queue.length>MAX_QUEUE)queue.splice(0,queue.length-MAX_QUEUE);
 showNext();
}
async function open(item){
 try{
   if(item.conversation){
     if(typeof openAppMarketplaceInbox==='function'){await openAppMarketplaceInbox(item.conversation);return;}
   }
   if(item.listing&&typeof openAppMarketplaceListing==='function'){
     await openAppMarketplaceListing({marketplaceListingId:item.listing});return;
   }
   if(item.noticeId&&window.findaiNotificationState){
     const index=window.findaiNotificationState.getCache().findIndex(n=>String(n.id)===item.noticeId);
     if(index>=0&&typeof window.openFindAINotification==='function'){await window.openFindAINotification(index);return;}
   }
   if(typeof window.wishwaveOpenNotificationTab==='function'){
     await window.wishwaveOpenNotificationTab();
     window.wishwaveFilterNotifications?.('all');
   }
 }catch(error){try{window.toast?.(error?.message||'Unable to open notification');}catch(_){}}
}
function syncMessageUnread(result){
 const count=Math.max(0,Number(result?.unreadCount)||0),label=count>99?'99+':String(count);
 document.querySelectorAll('#navMessagesBadge,#appMpUnreadBadge,#appMpAvatarBadge').forEach(node=>{
   node.textContent=label;node.classList.toggle('show',count>0);
 });
 document.querySelectorAll('#homeMessageButton,.wishwave-header-message').forEach(node=>{
   node.classList.toggle('has-unread',count>0);
   node.setAttribute('aria-label',count?'Messages — '+count+' unread':'Messages');
 });
 const tab=document.querySelector('.premium-bottom-nav button[data-tab="messages"]');
 if(tab)tab.setAttribute('aria-label',count?'Messages — '+count+' unread':'Messages');
 try{localStorage.setItem('wishwave-v175-message-unread',String(count));}catch(_){}
}
function reset(newOwner){
 owner=newOwner;initialized=false;sequence++;seen.clear();messageState.clear();lastNotificationDigest='';queue=[];dismiss(true);
 if(window.setHomeNotificationState&&!owner)window.setHomeNotificationState(0);
}
function freshNotice(n){
 const type=String(n.notification_type||'').toLowerCase();
 if(!/offer|purchase|sale|order|payment/.test(type))return null;
 const conversation=urlId(n,'conversation'),listing=urlId(n,'listing');
 const key='notice:'+String(n.id||'')+':'+String(n.created_at||'');
 const oldTitle=safeText(n.title).replace(/FindAI/gi,'WishWave');
 const title=/^New WishWave offer$/i.test(oldTitle)?'New offer received':oldTitle||'Marketplace update';
 return {kind:'offer',key,noticeId:String(n.id||''),conversation,listing,
   title,body:safeText(n.body).replace(/FindAI/gi,'WishWave').slice(0,170)};
}
function refreshMessageBaseline(conversations,enableBanners){
 for(const c of conversations){
   const id=String(c.id||'');if(!id)continue;
   const stamp=Date.parse(c.lastMessageAt||'')||0;
   const count=Math.max(0,Number(c.unreadCount)||0);
   const text=safeText(c.lastMessage||'');
   const previous=messageState.get(id);
   // Only genuine *new* unread message events qualify, never an older inbox row
   // becoming visible after a refresh or an offer-only unread-count change.
   const newActivity=previous
     ? stamp>previous.stamp&&count>0&&!!text&&(text!==previous.text||count>previous.count)
     : stamp>0&&Date.now()-stamp<90000&&count>0&&!!text;
   if(enableBanners&&newActivity&&!isChatOpen(id)){
     const name=safeText(c.otherParty||c.otherPartyDisplayName)||
       (c.otherPartyUsername?'@'+String(c.otherPartyUsername).replace(/^@/,''):'Someone');
     enqueue({kind:'message',key:'message:'+id+':'+stamp,
       conversation:id,title:name,body:text.slice(0,170),
       avatar:safeText(c.otherPartyAvatar||c.otherPartyAvatarUrl||'')});
   }
   messageState.set(id,{stamp,count,text});
 }
}
function pruneDelivered(activeNotifications){
 if(!native())return;
 const activeActors=activeNotifications.filter(n=>String(n.notification_type||'').toLowerCase()==='follow_request')
 .map(n=>String(n.actor_username||'').replace(/^@/,'').toLowerCase()).filter(Boolean);
 try{window.webkit.messageHandlers.wishwavePush.postMessage({action:'prune',activeUsernames:JSON.stringify(activeActors)}).catch?.(()=>{});}catch(_){}
}
async function refresh(force=false){
 const token=session();
 if(token!==owner)reset(token);
 if(!token||!visible()||disposed)return;
 if(flight)return flight;
 const generation=sequence;
 flight=(async()=>{
   try{
     if(typeof marketplaceFetch!=='function')return;
     const [notices,chat]=await Promise.all([
       marketplaceFetch('/marketplace/notifications/summary',{method:'GET'}),
       marketplaceFetch('/marketplace/conversations',{method:'GET'})
     ]);
     if(generation!==sequence||session()!==token)return;
     const notifications=Array.isArray(notices?.notifications)?notices.notifications:[];
     const conversations=Array.isArray(chat?.conversations)?chat.conversations:[];
     const first=!initialized;
     // Update message indicators from the same authenticated snapshot.
     syncMessageUnread(chat);
     // Skip unnecessary complete list re-renders during the six-second poll.
     const digest=notifications.map(n=>[n.id,n.notification_type,n.created_at,n.read_at].join(':')).join('|');
     if(first||digest!==lastNotificationDigest){
       try{await window.findaiNotificationState?.load?.({server:notices,conversations:chat});}catch(_){}
       lastNotificationDigest=digest;
     }
     if(generation!==sequence||session()!==token)return;
     for(const n of notifications){
       const item=freshNotice(n);
       if(!item)continue;
       if(!seen.has(item.key)){
         if(!first&&Date.now()-(Date.parse(n.created_at||'')||0)<90000)enqueue(item);
         seen.add(item.key);
       }
     }
     refreshMessageBaseline(conversations,!first);
     initialized=true;
     pruneDelivered(notifications);
   }catch(_){/* transient network errors must not erase unread state */}
 })();
 try{return await flight;}finally{flight=null;}
}
function boot(){
 install();
 setInterval(()=>refresh(),PERIOD);
 setTimeout(()=>refresh(true),700);
 window.addEventListener('wishwave-push-arrived',()=>refresh(true));
 window.addEventListener('wishwave-push-resume',()=>refresh(true));
 window.addEventListener('pageshow',()=>refresh(true));
 window.addEventListener('focus',()=>refresh(true));
 document.addEventListener('visibilitychange',()=>{if(visible())refresh(true);else dismiss(true);});
 window.addEventListener('pagehide',()=>{dismiss(true);});
 if(navigator.serviceWorker?.addEventListener)navigator.serviceWorker.addEventListener('message',event=>{
   if(event.data?.kind==='wishwave-push-arrived')refresh(true);
 });
 window.wishwaveLiveActivity={refresh,reset,showTest:item=>enqueue(item)};
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();