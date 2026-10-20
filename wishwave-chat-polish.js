/* Account-scoped chat rendering, native-sized action sheets and safety controls. */
(function(){
 'use strict';
 const cache=new Map(),inflight=new Map(),profileAccess=new Map();let owner=marketplaceSession(),menu=null;
 const profileKey=u=>String(u||'').replace(/^@+/,'').toLowerCase().trim();
 function accessFor(u){return profileAccess.get(profileKey(u));}
 function rememberAccess(data){
  const username=profileKey(data?.seller?.username||data?.profile?.username);
  if(username&&data?.viewer){
   const v=data.viewer;
   profileAccess.set(username,{restricted:!!v.restricted,blockedByViewer:!!(v.blockedByViewer??v.blocked),blockedViewer:!!v.blockedViewer});
  }
 }

 const icon=path=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+path+'</svg>';
 const icons={profile:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2Z"/>',mute:'<path d="M18 8a6 6 0 0 0-10-4M6 7v4c0 3-2 5-2 6h13M10 21h4M3 3l18 18"/>',block:'<circle cx="12" cy="12" r="9"/><path d="m6 18 12-12"/>',report:'<path d="M5 22V3c5-4 9 4 14 0v11c-5 4-9-4-14 0"/>'};
 function scope(){const next=marketplaceSession();if(next!==owner){owner=next;cache.clear();inflight.clear();profileAccess.clear();menu=null;}return next;}
 function syncAuth(){scope();const guest=!getAccountProfile()||!marketplaceSession();document.body.classList.toggle('wishwave-chat-guest',guest);if(guest){const badge=document.getElementById('navMessagesBadge');if(badge){badge.textContent='';badge.classList.remove('show');}document.querySelectorAll('.wishwave-header-message,#homeMessageButton').forEach(b=>{b.classList.remove('has-unread');delete b.dataset.unreadCount;});}}
 const fetchBefore=window.marketplaceFetch;
 window.marketplaceFetch=function(path,options){
  const session=scope(),method=String(options?.method||'GET').toUpperCase(),eligible=path==='/marketplace/conversations'||/^\/marketplace\/conversations\/[^/]+\/messages$/.test(path);
  if(!eligible){
   // Keep restricted-profile status even when legacy profile loaders only copy
   // a subset of the server's viewer fields into their rendering model.
   if(method==='GET'&&(/^\/profile\/public\/[^/]+$/.test(path)||/^\/marketplace\/sellers\/[^/]+\/profile$/.test(path)))
    return Promise.resolve(fetchBefore.apply(this,arguments)).then(data=>{if(session===marketplaceSession())rememberAccess(data);return data;});
   return fetchBefore.apply(this,arguments);
  }
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
 function row(action,label,danger=false,disabled=false){return '<button type="button" class="ww-chat-action'+(danger?' danger':'')+'" data-chat-action="'+action+'"'+(disabled?' disabled':'')+'>'+icon(icons[action]||icons.profile)+'<span>'+label+'</span>'+icon('<path d="m9 5 7 7-7 7"/>')+'</button>';}
 function showSheet(context){
  menu=context;context.confirmingBlock=false;const avatar=context.avatar?'<img src="'+escapeAttr(context.avatar)+'" alt="">':findaiDefaultAvatarSvg();
  const rows=context.kind==='chat'?row('profile','View profile')+row('mute',context.muted?'Unmute conversation':'Mute conversation')+row('block',!context.blockReady?'Checking block status…':context.blocked?'Unblock user':'Block user',true,!context.blockReady)+row('report','Report conversation',true):row('mute',context.muted?'Unmute':'Mute')+row('block',!context.blockReady?'Checking block status…':context.blocked?'Unblock':'Block',true,!context.blockReady)+row('report','Report account',true);
  openAppMpSheet(context.kind==='chat'?'Conversation':'Profile options','<div class="ww-chat-sheet-handle"></div><div class="ww-chat-sheet-identity">'+(context.kind==='chat'?'<span class="ww-chat-sheet-avatar">'+avatar+'</span>':'')+'<div><b>'+escapeHTML(context.kind==='chat'?context.name:'Profile options')+'</b><span>'+escapeHTML(context.kind==='chat'?'Conversation':'@'+context.username)+'</span></div></div><div class="ww-chat-action-group">'+rows+'</div><button type="button" class="ww-chat-cancel" data-chat-action="cancel">Cancel</button>');
  document.getElementById('appMpSheetBg')?.classList.add('ww-chat-action-sheet');
 }
 function showBlockConfirmation(context){
  openAppMpSheet('Confirm block','<div class="ww-chat-block-confirm" role="alertdialog" aria-modal="true" aria-labelledby="wwBlockTitle" aria-describedby="wwBlockDescription"><h2 id="wwBlockTitle">'+(context.blocked?'Unblock ':'Block ')+escapeHTML(context.name||context.username)+'?</h2><p id="wwBlockDescription">'+(context.blocked?'They will be able to follow and message you again.':'Are you sure you want to block this user? They won’t be able to follow or message you.')+'</p><div class="ww-chat-confirm-actions"><button type="button" data-chat-action="cancel-block">Cancel</button><button type="button" class="danger" data-chat-action="confirm-block">'+(context.blocked?'Unblock':'Block')+'</button></div></div>');
  context.confirmingBlock=true;document.getElementById('appMpSheetBg')?.classList.add('ww-chat-action-sheet','ww-chat-confirm-sheet');
  document.querySelector('[data-chat-action="cancel-block"]')?.focus();
 }
 window.addEventListener('keydown',e=>{if(!document.getElementById('appMpSheetBg')?.classList.contains('ww-chat-confirm-sheet'))return;if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();if(menu)showSheet(menu);}else if(e.key==='Tab'){const buttons=[...document.querySelectorAll('.ww-chat-confirm-actions button')];if(e.shiftKey&&document.activeElement===buttons[0]){e.preventDefault();buttons.at(-1)?.focus();}else if(!e.shiftKey&&document.activeElement===buttons.at(-1)){e.preventDefault();buttons[0]?.focus();}}},true);
 const open=window.openAppMpSheet,close=window.closeAppMpSheet;
 window.openAppMpSheet=function(){document.getElementById('appMpSheetBg')?.classList.remove('ww-chat-action-sheet','ww-chat-confirm-sheet');return open.apply(this,arguments);};
 window.closeAppMpSheet=function(){document.getElementById('appMpSheetBg')?.classList.remove('ww-chat-action-sheet','ww-chat-confirm-sheet');return close.apply(this,arguments);};
 window.wishwaveChatMenu=function(){
  if(!marketplaceSession()){openLogin();return;}const c=appMpCurrentConversation;if(!c||!appMpConversation)return;
  document.getElementById('appMpMessageInput')?.blur();
  const username=c.otherPartyUsername||'';
  const context={kind:'chat',id:appMpConversation,username,name:c.otherParty||'Conversation',avatar:c.otherPartyAvatar||'',muted:false,blocked:!!accessFor(username)?.blockedByViewer,blockReady:false,session:scope()};
  showSheet(context);
  if(username)marketplaceFetch('/social/relationship?username='+encodeURIComponent(username),{method:'GET'}).then(data=>{
   if(menu!==context||context.session!==marketplaceSession())return;
   context.blocked=!!data.blockedByViewer||!!data.blocked;
   context.blockReady=true;
   profileAccess.set(profileKey(username),{...accessFor(username),blockedByViewer:context.blocked,blockedViewer:!!data.blockedViewer,restricted:context.blocked||!!data.blockedViewer});
   if(!context.confirmingBlock&&document.getElementById('appMpSheetBg')?.classList.contains('show'))showSheet(context);
  }).catch(()=>{});
  marketplaceFetch('/marketplace/conversations/'+encodeURIComponent(context.id)+'/mute',{method:'GET'}).then(data=>{if(menu===context&&context.session===marketplaceSession()&&!context.confirmingBlock&&document.getElementById('appMpSheetBg')?.classList.contains('show')){context.muted=!!data.muted;const label=document.querySelector('.ww-chat-action[data-chat-action="mute"] span');if(label)label.textContent=context.muted?'Unmute conversation':'Mute conversation';}}).catch(()=>{});
 };
 window.openFindAIProfileActions=function(){
  if(!marketplaceSession()){openLogin();return;}const s=wishwavePublicSellerData?.seller;if(!s?.username)return;const context={kind:'profile',username:s.username,name:s.displayName||s.username,muted:false,blocked:!!accessFor(s.username)?.blockedByViewer,blockReady:false,session:scope()};showSheet(context);
  marketplaceFetch('/social/relationship?username='+encodeURIComponent(s.username),{method:'GET'}).then(data=>{if(menu===context&&context.session===marketplaceSession()&&!context.confirmingBlock&&document.getElementById('appMpSheetBg')?.classList.contains('show')){Object.assign(context,{muted:!!data.muted,blocked:!!data.blocked,blockReady:true});showSheet(context);}}).catch(()=>{});
 };
 window.addEventListener('click',async e=>{
  const button=e.target.closest?.('#appMpSheetBg.ww-chat-action-sheet [data-chat-action]');if(!button)return;e.preventDefault();e.stopPropagation();let action=button.dataset.chatAction;const context=menu;if(action==='cancel'){closeAppMpSheet();return;}if(!context||context.session!==marketplaceSession())return;
  if(action==='profile'){closeAppMpSheet();findaiOpenCurrentChatProfileV178();return;}
  if(action==='report'){closeAppMpSheet();openWishWaveSafetyReport(context.kind==='chat'?'conversation':'user',{id:context.kind==='chat'?context.id:context.username});return;}
  if(action==='cancel-block'){showSheet(context);return;}
  if(action==='block'){if(!context.blockReady)return;showBlockConfirmation(context);return;}
  if(action==='confirm-block'){if(!context.confirmingBlock)return;action='block';}
  if(button.disabled)return;button.disabled=true;
  try{
   if(action==='mute'&&context.kind==='chat')await marketplaceFetch('/marketplace/conversations/'+encodeURIComponent(context.id)+'/mute',{method:context.muted?'DELETE':'POST'});
   else {if(!context.username)throw Error('Profile unavailable');await marketplaceFetch('/social/controls',{method:(action==='mute'?context.muted:context.blocked)?'DELETE':'POST',body:JSON.stringify({kind:action==='mute'?'muted':'blocked',username:context.username})});}
   if(context.session!==marketplaceSession())return;
   if(action==='block'){
    const newlyBlocked=!context.blocked,prev=accessFor(context.username)||{};
    profileAccess.set(profileKey(context.username),{...prev,blockedByViewer:newlyBlocked,restricted:newlyBlocked||!!prev.blockedViewer});
    window.wishwaveBlockedProfileUpdated?.(context.username,newlyBlocked);
    if(newlyBlocked)window.findaiNotificationState?.removeActor?.(context.username);
   }
   closeAppMpSheet();
   toast(action==='mute'?(context.muted?'Notifications unmuted':'Notifications muted'):(context.blocked?'Account unblocked':'Account blocked'));
  }catch(error){if(context.session===marketplaceSession()){toast(error.message||'Could not update');}}finally{button.disabled=false;}
 },true);

 // A blocked relationship retains a minimal profile shell so either user
 // can open its top-right options, but cannot view photos, posts or follow.
 const renderPublic=window.renderWishWavePublicProfile;
 window.renderWishWavePublicProfile=function(){
  const data=wishwavePublicSellerData,username=data?.seller?.username||'';
  const access=accessFor(username)||data?.viewer||{};
  const restricted=!!access.restricted;
  const page=document.getElementById('wishwavePublicProfilePage');
  page?.classList.toggle('ww-restricted-profile',restricted);
  if(!restricted)return renderPublic.apply(this,arguments);
  const handle=document.getElementById('wishwavePublicHandle');
  if(handle)handle.textContent=username;
  const root=document.getElementById('wishwavePublicProfileBody');
  if(root)root.innerHTML='<div class="ww-restricted-profile-message" role="status">Profile not found</div>';
 };
 window.wishwaveBlockedProfileUpdated=async function(username,blocked){
  const current=wishwavePublicSellerData;
  if(!current||profileKey(current.seller?.username)!==profileKey(username))return;
  if(blocked){window.renderWishWavePublicProfile();return;}
  // A later reciprocal block may still exist; always refresh from the server.
  const session=marketplaceSession(),key=profileKey(username);
  try{
   const response=await marketplaceFetch('/profile/public/'+encodeURIComponent(username),{method:'GET'});
   if(session!==marketplaceSession()||wishwavePublicSellerData!==current)return;
   const profile=response.profile||{},v=response.viewer||{};
   current.seller={...current.seller,id:String(response.sellerId||current.seller.id||''),displayName:String(profile.displayName||username),avatarUrl:String(profile.avatarUrl||''),bio:String(profile.bio||''),location:String(profile.location||''),activeCount:Number(response.activeCount||0),soldCount:Number(response.soldCount||0),followerCount:Number(response.followerCount||0)};
   current.listings=Array.isArray(response.listings)?response.listings:[];
   current.viewer={...current.viewer,...v};
   if(!accessFor(key))profileAccess.set(key,{restricted:!!v.restricted,blockedByViewer:!!v.blockedByViewer,blockedViewer:!!v.blockedViewer});
   window.renderWishWavePublicProfile();
  }catch(_){window.renderWishWavePublicProfile();}
 };
 const update=window.updateAccountHeader;window.updateAccountHeader=function(){const result=update.apply(this,arguments);syncAuth();return result;};
 const signout=window.signOutAccount;window.signOutAccount=function(){const result=signout.apply(this,arguments);cache.clear();inflight.clear();syncAuth();return result;};
 window.addEventListener('storage',e=>{if(e.key==='fa_account_profile_v1'||e.key==='findai_user')syncAuth();});syncAuth();
})();
