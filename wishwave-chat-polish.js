/* Account-scoped chat rendering, native-sized action sheets and safety controls. */
(function(){
 'use strict';
 const cache=new Map(),inflight=new Map();let owner=marketplaceSession(),menu=null;
 const icon=path=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+path+'</svg>';
 const icons={profile:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2Z"/>',mute:'<path d="M18 8a6 6 0 0 0-10-4M6 7v4c0 3-2 5-2 6h13M10 21h4M3 3l18 18"/>',block:'<circle cx="12" cy="12" r="9"/><path d="m6 18 12-12"/>',report:'<path d="M5 22V3c5-4 9 4 14 0v11c-5 4-9-4-14 0"/>'};
 function scope(){const next=marketplaceSession();if(next!==owner){owner=next;cache.clear();inflight.clear();menu=null;}return next;}
 function syncAuth(){scope();const guest=!getAccountProfile()||!marketplaceSession();document.body.classList.toggle('wishwave-chat-guest',guest);if(guest){const badge=document.getElementById('navMessagesBadge');if(badge){badge.textContent='';badge.classList.remove('show');}document.querySelectorAll('.wishwave-header-message,#homeMessageButton').forEach(b=>{b.classList.remove('has-unread');delete b.dataset.unreadCount;});}}
 const fetchBefore=window.marketplaceFetch;
 window.marketplaceFetch=function(path,options){
  const session=scope(),method=String(options?.method||'GET').toUpperCase(),eligible=path==='/marketplace/conversations'||/^\/marketplace\/conversations\/[^/]+\/messages$/.test(path);
  if(!eligible)return fetchBefore.apply(this,arguments);
  if(method!=='GET'){
   cache.delete(path);const pending=document.querySelector('#appMpMessages .app-mp-bubble.mine.pending:last-child');
   return Promise.resolve(fetchBefore.apply(this,arguments)).then(data=>{
    if(method==='POST'&&path.endsWith('/messages')&&data.message&&session===marketplaceSession()&&pending?.isConnected){pending.classList.remove('pending');pending.dataset.messageId=data.message.id;paintReceipt(pending,'Sent');}
    return data;
   });
  }
  const key=session+'|'+path;if(inflight.has(key))return inflight.get(key);
  const args=[path,options];if(path.endsWith('/messages')&&!chatVisible())args[0]+='?markRead=0';
  const request=Promise.resolve(fetchBefore.apply(this,args)).then(data=>{
   if(session&&session===marketplaceSession()){
    cache.set(path,{data,at:Date.now()});if(cache.size>30)cache.delete(cache.keys().next().value);
    if(path==='/marketplace/conversations'&&Array.isArray(data.conversations))appMpConversationList=data.conversations;
   }return data;
  }).finally(()=>{if(inflight.get(key)===request)inflight.delete(key);});inflight.set(key,request);return request;
 };
 function chatVisible(){const inbox=document.getElementById('appMpInbox');return document.visibilityState!=='hidden'&&!!inbox?.classList.contains('show')&&inbox.classList.contains('chat-open')&&!document.querySelector('#wishwavePublicProfilePage.show,#appMpSheetBg.show,#findaiSafetyOverlay.show,#searchDetailOverlay.show');}
 function paintReceipt(row,label){if(!row)return;row.querySelector('.ww-chat-receipt')?.remove();const node=document.createElement('span');node.className='ww-chat-receipt';node.setAttribute('role','status');node.textContent=label;row.appendChild(node);}
 const append=window.appMpAppendOptimisticMessage;
 if(append)window.appMpAppendOptimisticMessage=function(){const root=document.getElementById('appMpMessages');root?.querySelectorAll('.ww-chat-receipt').forEach(el=>el.remove());const bubble=append.apply(this,arguments);if(bubble)paintReceipt(bubble,'Sending…');return bubble;};
 const timeline=window.appMpMessageTimeline;
 window.appMpMessageTimeline=function(messages){
  const html=timeline.apply(this,arguments),rows=Array.isArray(messages)?messages:[],last=[...rows].reverse().find(m=>m.mine);
  if(!last)return html;const t=document.createElement('template');t.innerHTML=html;
  const bubble=[...t.content.querySelectorAll('[data-message-id]')].find(el=>String(el.dataset.messageId)===String(last.id));
  if(bubble)paintReceipt(bubble.closest('.findai-v173-message-row')||bubble,last.failed?'Not sent':last.pending?'Sending…':last.readAt?'Opened':'Sent');
  return t.innerHTML;
 };
 const load=window.appMpLoadMessages;
 if(load)window.appMpLoadMessages=function(){if(!chatVisible())return Promise.resolve();return load.apply(this,arguments);};
 const typing=window.appMpPollTyping;
 if(typing)window.appMpPollTyping=async function(){const out=await typing.apply(this,arguments);if(chatVisible()){
   const saved=cache.get('/marketplace/conversations/'+encodeURIComponent(appMpConversation)+'/messages'),last=[...(saved?.data.messages||[])].reverse().find(m=>m.mine);
   if(last&&!last.readAt&&!inflight.has(marketplaceSession()+'|/marketplace/conversations/'+encodeURIComponent(appMpConversation)+'/messages'))appMpLoadMessages();
  }return out;};
 const render=window.renderAppMpChat;
 window.renderAppMpChat=function(id){scope();const result=render.apply(this,arguments),saved=cache.get('/marketplace/conversations/'+encodeURIComponent(id)+'/messages'),root=document.getElementById('appMpMessages');
  if(root&&saved&&Date.now()-saved.at<300000){const data=saved.data;appMpCurrentConversation=data.conversation||appMpCurrentConversation;root.innerHTML=appMpMessageTimeline(data.messages||[]);root.dataset.loaded='1';appMpRenderMessageHeader(appMpCurrentConversation,data.presence);root.scrollTop=root.scrollHeight;}return result;
 };
 const header=window.appMpRenderMessageHeader;
 window.appMpRenderMessageHeader=function(c,presence){const out=header.apply(this,arguments),root=document.getElementById('appMpInboxTitle'),identity=root?.querySelector('.findai-chat-title-person');
  if(identity){identity.setAttribute('role','button');identity.tabIndex=0;identity.setAttribute('aria-label','View profile');identity.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();findaiOpenCurrentChatProfileV178();}};}
  const status=root?.querySelector('.wishwave-chat-presence');if(status&&(!presence||/private conversation/i.test(status.textContent)))status.remove();
  return out;
 };
 window.addEventListener('click',e=>{const identity=e.target.closest?.('#appMpInboxTitle .findai-chat-title-person');if(identity){e.preventDefault();e.stopImmediatePropagation();findaiOpenCurrentChatProfileV178();}},true);
 function row(action,label,danger=false){return '<button type="button" class="ww-chat-action'+(danger?' danger':'')+'" data-chat-action="'+action+'">'+icon(icons[action]||icons.profile)+'<span>'+label+'</span>'+icon('<path d="m9 5 7 7-7 7"/>')+'</button>';}
 function showSheet(context){
  menu=context;const avatar=context.avatar?'<img src="'+escapeAttr(context.avatar)+'" alt="">':icon(icons.profile);
  const rows=context.kind==='chat'?row('profile','View profile')+row('mute',context.muted?'Unmute conversation':'Mute conversation')+row('block','Block user',true)+row('report','Report conversation',true):row('mute',context.muted?'Unmute':'Mute')+row('block',context.blocked?'Unblock':'Block',true)+row('report','Report account',true);
  openAppMpSheet(context.kind==='chat'?'Conversation':'Profile options','<div class="ww-chat-sheet-handle"></div><div class="ww-chat-sheet-identity">'+(context.kind==='chat'?'<span class="ww-chat-sheet-avatar">'+avatar+'</span>':'')+'<div><b>'+escapeHTML(context.kind==='chat'?context.name:'Profile options')+'</b><span>'+escapeHTML(context.kind==='chat'?'Conversation':'@'+context.username)+'</span></div></div><div class="ww-chat-action-group">'+rows+'</div><button type="button" class="ww-chat-cancel" data-chat-action="cancel">Cancel</button>');
  document.getElementById('appMpSheetBg')?.classList.add('ww-chat-action-sheet');
 }
 const open=window.openAppMpSheet,close=window.closeAppMpSheet;
 window.openAppMpSheet=function(){document.getElementById('appMpSheetBg')?.classList.remove('ww-chat-action-sheet');return open.apply(this,arguments);};
 window.closeAppMpSheet=function(){document.getElementById('appMpSheetBg')?.classList.remove('ww-chat-action-sheet');return close.apply(this,arguments);};
 window.wishwaveChatMenu=function(){
  if(!marketplaceSession()){openLogin();return;}const c=appMpCurrentConversation;if(!c||!appMpConversation)return;
  document.getElementById('appMpMessageInput')?.blur();const context={kind:'chat',id:appMpConversation,username:c.otherPartyUsername||'',name:c.otherParty||'Conversation',avatar:c.otherPartyAvatar||'',muted:false,session:scope()};showSheet(context);
  marketplaceFetch('/marketplace/conversations/'+encodeURIComponent(context.id)+'/mute',{method:'GET'}).then(data=>{if(menu===context&&context.session===marketplaceSession()&&document.getElementById('appMpSheetBg')?.classList.contains('show')){context.muted=!!data.muted;const text=document.querySelector('.ww-chat-action[data-chat-action="mute"] span');if(text)text.textContent=context.muted?'Unmute conversation':'Mute conversation';}}).catch(()=>{});
 };
 window.openFindAIProfileActions=function(){
  if(!marketplaceSession()){openLogin();return;}const s=wishwavePublicSellerData?.seller;if(!s?.username)return;const context={kind:'profile',username:s.username,name:s.displayName||s.username,muted:false,blocked:false,session:scope()};showSheet(context);
  marketplaceFetch('/social/relationship?username='+encodeURIComponent(s.username),{method:'GET'}).then(data=>{if(menu===context&&context.session===marketplaceSession()&&document.getElementById('appMpSheetBg')?.classList.contains('show')){Object.assign(context,{muted:!!data.muted,blocked:!!data.blocked});showSheet(context);}}).catch(()=>{});
 };
 window.addEventListener('click',async e=>{
  const button=e.target.closest?.('#appMpSheetBg.ww-chat-action-sheet [data-chat-action]');if(!button)return;e.preventDefault();e.stopPropagation();const action=button.dataset.chatAction,context=menu;if(action==='cancel'){closeAppMpSheet();return;}if(!context||context.session!==marketplaceSession())return;
  if(action==='profile'){closeAppMpSheet();findaiOpenCurrentChatProfileV178();return;}
  if(action==='report'){closeAppMpSheet();openWishWaveSafetyReport(context.kind==='chat'?'conversation':'user',{id:context.kind==='chat'?context.id:context.username});return;}
  if(action==='block'&&!context.confirmingBlock){context.confirmingBlock=true;button.querySelector('span').textContent=context.blocked?'Confirm unblock':'Confirm block';return;}
  if(button.disabled)return;button.disabled=true;
  try{
   if(action==='mute'&&context.kind==='chat')await marketplaceFetch('/marketplace/conversations/'+encodeURIComponent(context.id)+'/mute',{method:context.muted?'DELETE':'POST'});
   else {if(!context.username)throw Error('Profile unavailable');await marketplaceFetch('/social/controls',{method:(action==='mute'?context.muted:context.blocked)?'DELETE':'POST',body:JSON.stringify({kind:action==='mute'?'muted':'blocked',username:context.username})});}
   if(context.session!==marketplaceSession())return;closeAppMpSheet();toast(action==='mute'?(context.muted?'Notifications unmuted':'Notifications muted'):(context.blocked?'Account unblocked':'Account blocked'));
   if(action==='block'&&!context.blocked){if(context.kind==='chat')appMpInboxBack();else closeWishWavePublicProfile();}
  }catch(error){if(context.session===marketplaceSession()){context.confirmingBlock=false;toast(error.message||'Could not update');}}finally{button.disabled=false;}
 },true);
 const update=window.updateAccountHeader;window.updateAccountHeader=function(){const result=update.apply(this,arguments);syncAuth();return result;};
 const signout=window.signOutAccount;window.signOutAccount=function(){const result=signout.apply(this,arguments);cache.clear();inflight.clear();syncAuth();return result;};
 window.addEventListener('storage',e=>{if(e.key==='fa_account_profile_v1'||e.key==='findai_user')syncAuth();});syncAuth();
})();
