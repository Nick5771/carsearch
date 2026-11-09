function wishwaveInboxDestination(messages,activity,last){return messages>0?'messages':activity>0?'activity':last==='activity'?'activity':'messages';}
if(typeof module==='object'&&module.exports)module.exports={destination:wishwaveInboxDestination};
(function(){
 'use strict';
 if(typeof document==='undefined')return;
 const el=id=>document.getElementById(id),inbox=el('appMpInbox'),home=inbox?.parentNode;
 if(!inbox)return;
 const baseConversation=window.appMpOpenConversation,baseBack=window.appMpInboxBack;
 let sectionGeneration=0;
 let listAccount='',listConfirmed=false,listSnapshot=[],listAt=0;
 let inboxProgress=0,sectionMotion=null,chatMotion=null;
 const reduced=()=>matchMedia('(prefers-reduced-motion:reduce)').matches;
 function paintProgress(value){inboxProgress=Math.max(0,Math.min(1,value));const messages=el('wwInboxMessages'),activity=el('wwInboxActivity');if(!messages||!activity)return;messages.style.transform='translate3d('+(-inboxProgress*100)+'%,0,0)';activity.style.transform='translate3d('+((1-inboxProgress)*100)+'%,0,0)';const tabs=el('wwInboxTabs'),line=el('wwInboxIndicator'),labels=tabs?.querySelectorAll('.ww-inbox-label');if(line&&labels?.length===2){const a=labels[0].getBoundingClientRect(),b=labels[1].getBoundingClientRect(),r=tabs.getBoundingClientRect();line.style.width=(a.width+(b.width-a.width)*inboxProgress)+'px';line.style.transform='translate3d('+(a.left-r.left+(b.left-a.left)*inboxProgress)+'px,0,0)';}}
 function stopSectionMotion(){sectionMotion?.();sectionMotion=null;el('wwInboxViewport')?.classList.remove('ww-inbox-moving');}
 function moveSection(value,animate=true){stopSectionMotion();if(!animate||reduced()){paintProgress(value);return;}const from=inboxProgress,start=performance.now();let frame=0,cancelled=false;el('wwInboxViewport')?.classList.add('ww-inbox-moving');sectionMotion=()=>{cancelled=true;cancelAnimationFrame(frame);};function step(now){if(cancelled)return;const t=Math.min(1,(now-start)/260),eased=1-Math.pow(1-t,3);paintProgress(from+(value-from)*eased);if(t<1)frame=requestAnimationFrame(step);else{sectionMotion=null;el('wwInboxViewport')?.classList.remove('ww-inbox-moving');}}frame=requestAnimationFrame(step);}
 function stopChatMotion(){chatMotion?.cancel();chatMotion=null;}
 function enterChat(){stopChatMotion();if(reduced()||!inbox.animate)return;chatMotion=inbox.animate([{translate:'100% 0'},{translate:'0 0'}],{duration:280,easing:'cubic-bezier(.22,.8,.22,1)'});chatMotion.finished?.then(()=>{chatMotion=null;}).catch(()=>{});}
 function listScope(){const account=owner();if(account!==listAccount){listAccount=account;listConfirmed=false;listSnapshot=[];listAt=0;}return account;}
 function paintInboxLoading(){el('appMpInboxBody').innerHTML='<div class="ww-inbox-loading" role="status" aria-label="Loading messages">'+Array.from({length:3},()=>'<div class="ww-inbox-placeholder" aria-hidden="true"><i></i><span><b></b><small></small></span></div>').join('')+'</div>';}
 function paintInboxError(cached){const body=el('appMpInboxBody');if(!cached)body.replaceChildren();body.querySelector('.ww-inbox-load-error')?.remove();const error=document.createElement('div');error.className='ww-inbox-load-error';error.setAttribute('role','status');const text=document.createElement('span');text.textContent=cached?'Could not refresh messages.':'Could not load messages.';const retry=document.createElement('button');retry.type='button';retry.textContent='Retry';retry.onclick=()=>window.wishwaveInboxSection('messages',{refresh:true});error.append(text,retry);body.appendChild(error);}
 async function loadInboxList(force=false){
  const account=listScope(),request=(window.__wishwaveInboxRequest||0)+1;window.__wishwaveInboxRequest=request;
  clearInterval(appMpMessageTimer);clearInterval(appMpTypingTimer);appMpInboxMode='global';appMpConversation='';appMpCurrentConversation=null;inbox.classList.add('show');
  const rows=listSnapshot;
  if(rows.length||listConfirmed){if(!inbox.querySelector('.app-mp-conversation-list')||inbox.querySelector('.ww-inbox-load-error'))window.renderAppMpConversationList({conversations:rows},false,'');}else paintInboxLoading();sync();
  if(!force&&listConfirmed&&Date.now()-listAt<15000)return;
  const current=()=>account===owner()&&request===window.__wishwaveInboxRequest&&inbox.classList.contains('show')&&!inbox.classList.contains('chat-open');
  try{const data=await marketplaceFetch('/marketplace/conversations',{method:'GET'});if(!current())return;if(!Array.isArray(data?.conversations))throw Error('Missing conversations');listConfirmed=true;listAt=Date.now();listSnapshot=data.conversations.map(c=>({...c}));window.renderAppMpConversationList(data,false,'');sync();}
  catch(error){if(current())paintInboxError(rows.length>0);}
 }
 let selection='messages',entry=0,fromInbox=false,composeToken=0,composeTimer,composeReturn;
 function closeCompose(){composeToken++;clearTimeout(composeTimer);el('wwComposeSearch')?.blur();el('wwComposeDialog')?.close();composeReturn?.focus({preventScroll:true});}
 function composeViewport(){const dialog=el('wwComposeDialog');if(!dialog?.open)return;const v=window.visualViewport;dialog.style.setProperty('--compose-top',Math.max(12,(v?.offsetTop||0)+12)+'px');dialog.style.setProperty('--compose-height',Math.max(120,(v?.height||innerHeight)-24)+'px');}
 window.visualViewport?.addEventListener('resize',composeViewport);window.visualViewport?.addEventListener('scroll',composeViewport);
 async function loadPeople(query){
  const token=++composeToken,account=owner(),root=el('wwComposePeople');root.textContent='Loading people…';
  try{const data=await marketplaceFetch('/social/send-suggestions'+(query?'?q='+encodeURIComponent(query):''),{method:'GET'});
   if(token!==composeToken||account!==owner()||!el('wwComposeDialog').open)return;
   root.replaceChildren();const people=Array.isArray(data?.people)?data.people:[];
   if(!people.length){root.textContent='No people found';return;}
   people.forEach(person=>{const username=String(person.username||'').replace(/^@+/,'').trim();if(!username)return;
    const button=document.createElement('button');button.type='button';button.className='ww-compose-person';
    const avatar=document.createElement('span');avatar.className='ww-compose-avatar';avatar.textContent=String(person.displayName||username).slice(0,1).toUpperCase();
    if(/^https?:\/\//i.test(person.avatarUrl||'')){const img=document.createElement('img');img.src=person.avatarUrl;img.alt='';avatar.replaceChildren(img);}
    const name=document.createElement('span');name.textContent=person.displayName||username;const handle=document.createElement('small');handle.textContent='@'+username;name.appendChild(handle);button.append(avatar,name);
    button.onclick=async()=>{const attempt=++composeToken;root.querySelectorAll('button').forEach(b=>b.disabled=true);el('wwComposeStatus').textContent='Opening conversation…';
     try{const result=person.conversationId?person:await marketplaceFetch('/social/message-user/'+encodeURIComponent(username),{method:'POST'});
      if(attempt!==composeToken||account!==owner()||!el('wwComposeDialog').open)return;
      if(!result?.conversationId)throw Error('Could not start conversation');closeCompose();entry++;fromInbox=true;appMpCurrentConversation=(appMpConversationList||[]).find(c=>String(c.id)===String(result.conversationId))||{id:String(result.conversationId),otherParty:person.displayName||username,otherPartyUsername:username,otherPartyAvatar:person.avatarUrl||''};await window.appMpOpenConversation(String(result.conversationId));
     }catch(error){if(attempt!==composeToken||account!==owner())return;el('wwComposeStatus').textContent='Could not open conversation. Please try again.';root.querySelectorAll('button').forEach(b=>b.disabled=false);}
    };root.appendChild(button);
   });
  }catch(error){if(token===composeToken&&account===owner())root.textContent='Could not load people. Search again to retry.';}
 }
 function openCompose(){
  if(!marketplaceSession()){openLogin();return;}entry++;composeReturn=document.activeElement;
  let dialog=el('wwComposeDialog');if(!dialog){dialog=document.createElement('dialog');dialog.id='wwComposeDialog';dialog.setAttribute('aria-labelledby','wwComposeTitle');
   dialog.innerHTML='<header><h2 id="wwComposeTitle">New message</h2><button type="button" aria-label="Close new message">×</button></header><input id="wwComposeSearch" type="search" placeholder="Search people" aria-label="Search people" autocomplete="off"><p id="wwComposeStatus" role="status"></p><div id="wwComposePeople" aria-live="polite"></div>';
   document.body.appendChild(dialog);dialog.querySelector('header button').onclick=closeCompose;dialog.addEventListener('cancel',e=>{e.preventDefault();closeCompose();});dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeCompose();}});
   el('wwComposeSearch').oninput=e=>{composeToken++;clearTimeout(composeTimer);const q=e.target.value.trim();composeTimer=setTimeout(()=>loadPeople(q),200);};
  }
  el('wwComposeSearch').value='';el('wwComposeStatus').textContent='';dialog.showModal();composeViewport();el('wwComposeSearch').focus({preventScroll:true});loadPeople('');
 }
 const owner=()=>String(marketplaceSession()||'guest');
 const key=()=> 'ww_inbox_section_v1:'+owner();
 const unreadMessages=()=>{const badges=[el('navMessagesBadge'),el('appMpUnreadBadge')].filter(Boolean);return badges.length?Math.max(0,...badges.filter(b=>b.classList.contains('show')).map(b=>Number(b.textContent)||1)):(appMpConversationList||[]).reduce((n,c)=>n+(Number(c.unreadCount)||0),0);};
 const unreadActivity=()=>Number(window.findaiNotificationState?.getUnread()||0);
 function sync(){
  const search=inbox.querySelector('.app-mp-instagram-search input');if(search)search.placeholder='Search messages';
  const m=unreadMessages(),a=unreadActivity();
  document.querySelectorAll('#wwInboxTabs button[data-inbox-section]').forEach(b=>{const section=b.dataset.inboxSection,count=section==='messages'?m:a;b.setAttribute('aria-selected',String(section===selection));b.querySelector('.ww-inbox-count').textContent=count?String(Math.min(99,count)):'';});
  const button=document.querySelector('#wishwaveMainNav [data-tab="notifications"]'),dot=el('navNotificationsBadge');
  button?.setAttribute('aria-label','Inbox'+(m+a?' — '+(m+a)+' unread':''));button?.classList.toggle('has-unread',m+a>0);if(dot){dot.classList.toggle('show',m+a>0);dot.style.display=m+a?'block':'none';}
 }
 function restore(){if(inbox.parentNode!==home)home.appendChild(inbox);inbox.classList.remove('ww-inbox-docked');}
 function ensure(){
  window.findaiNotificationState?.ensureUI();const panel=el('findaiNotificationPanel');if(!panel)return;
  panel.classList.add('ww-unified-inbox');panel.setAttribute('aria-label','Inbox');const title=panel.querySelector('.findai-notification-panel-head b');if(title)title.textContent='Inbox';panel.querySelector('.wishwave-notification-back')?.remove();
  if(!el('wwInboxCompose')){const compose=document.createElement('button');compose.id='wwInboxCompose';compose.type='button';compose.setAttribute('aria-label','New message');compose.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-7M16 3l5 5M10 14l1-5 7-7 5 5-7 7-6 1Z"/></svg>';compose.onclick=openCompose;panel.querySelector('.findai-notification-panel-head').appendChild(compose);}
  if(!el('wwInboxTabs')){const tabs=document.createElement('div');tabs.id='wwInboxTabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Inbox sections');tabs.innerHTML=['messages','activity'].map(s=>'<button type="button" role="tab" data-inbox-section="'+s+'">'+'<span class="ww-inbox-label">'+(s==='messages'?'Messages':'Activity')+'<span class="ww-inbox-count"></span></span></button>').join('');tabs.onclick=e=>{const b=e.target.closest('[data-inbox-section]');if(b){entry++;window.wishwaveInboxSection(b.dataset.inboxSection);}};panel.querySelector('.findai-notification-panel-head').after(tabs);const host=document.createElement('div');host.id='wwInboxMessages';panel.appendChild(host);}
  let viewport=el('wwInboxViewport');if(!viewport){viewport=document.createElement('div');viewport.id='wwInboxViewport';const activity=document.createElement('div');activity.id='wwInboxActivity';viewport.append(el('wwInboxMessages'),activity);panel.appendChild(viewport);const line=document.createElement('i');line.id='wwInboxIndicator';line.setAttribute('aria-hidden','true');el('wwInboxTabs').appendChild(line);}
  const activity=el('wwInboxActivity');for(const node of [panel.querySelector('.wishwave-notification-tabs'),el('findaiNotificationList')])if(node&&node.parentNode!==activity)activity.appendChild(node);
  return panel;
 }
 window.wishwaveInboxSection=async function(section,options={}){
  selection=section==='activity'?'activity':'messages';try{localStorage.setItem(key(),selection);}catch(_){}
  const sectionRequest=++sectionGeneration,account=owner();const panel=ensure();if(!panel)return;panel.dataset.inboxSection=selection;sync();moveSection(selection==='activity'?1:0,options.animate!==false);
  el('wwInboxMessages').inert=selection!=='messages';el('wwInboxActivity').inert=selection!=='activity';el('wwInboxMessages').setAttribute('aria-hidden',String(selection!=='messages'));el('wwInboxActivity').setAttribute('aria-hidden',String(selection!=='activity'));
  const guest=!marketplaceSession();panel.classList.toggle('ww-inbox-guest',guest);
  if(guest){
   restore();inbox.classList.remove('show','chat-open');
   el('wwInboxMessages').innerHTML='<div class="ww-guest-inbox-a"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z"/><path d="M10 21h4"/></svg><b>'+(selection==='activity'?'Your activity':'Your messages')+'</b><p>'+(selection==='activity'?'Sign in to see your account activity.':'Sign in to see your conversations.')+'</p><button type="button" onclick="openLogin()">Sign in</button></div>';
   el('wwInboxActivity').querySelector('.ww-guest-inbox-a')?.remove();const guestActivity=el('wwInboxMessages').firstElementChild.cloneNode(true);guestActivity.querySelector('b').textContent='Your activity';guestActivity.querySelector('p').textContent='Sign in to see your account activity.';el('wwInboxActivity').appendChild(guestActivity);return;
  }
  panel.querySelectorAll('.ww-guest-inbox-a').forEach(node=>node.remove());
  if(selection==='messages'){
   fromInbox=true;inbox.classList.remove('chat-open');el('wwInboxMessages').appendChild(inbox);inbox.classList.add('ww-inbox-docked');await loadInboxList(!!options.refresh);if(sectionRequest!==sectionGeneration||account!==owner())return;sync();
  }else{window.findaiNotificationState?.refreshSellerProgress?.();await window.findaiNotificationState?.load();if(sectionRequest!==sectionGeneration||account!==owner()||selection!=='activity')return;window.findaiNotificationState?.markViewed?.();sync();}
 };
 window.wishwaveOpenNotificationTab=window.openHomeNotifications=async function(preferred){
  const token=++entry,account=owner();restore();inbox.classList.remove('show','chat-open');go('notifications');document.body.dataset.activeTab='notifications';setMainNavActive('notifications');const panel=ensure();panel?.classList.add('show');
  let last='messages';try{last=localStorage.getItem(key())||last;}catch(_){}
  const choose=()=>preferred==='messages'?'messages':wishwaveInboxDestination(unreadMessages(),unreadActivity(),last);
  await window.wishwaveInboxSection(choose(),{animate:false});
  // Refresh both unread sources; never move tabs after the user interacts.
  if(token===entry&&account===owner())Promise.allSettled([window.appRefreshMarketplaceBadge?.(),window.findaiNotificationState?.load()]).then(()=>{if(token===entry&&account===owner())sync();});
 };
 const chat=window.renderAppMpChat;window.renderAppMpChat=function(){
  restore();const out=chat.apply(this,arguments),cached=previewThreads.get(owner()+'|'+String(arguments[0]||'')),root=el('appMpMessages');
  if(root&&!root.dataset.loaded&&cached&&Date.now()-cached.at<300000&&cached.data.messages?.length){const data=cached.data;appMpCurrentOffers=data.offers||[];appMpCurrentConversation=data.conversation||appMpCurrentConversation;root.innerHTML=appMpMessageTimeline(data.messages);root.dataset.loaded='1';appMpRenderMessageHeader(appMpCurrentConversation,data.presence);root.scrollTop=root.scrollHeight;}
  return out;
 };
 // Keep notification deep links and profile Message buttons on their existing paths.
 window.openMessagesTab=function(){return wishwaveOpenNotificationTab('messages');};
 window.openAppMarketplaceInbox=function(preselect){if(preselect)return (window.openMessagesTab(),window.appMpOpenConversation(String(preselect)));return window.openMessagesTab();};
 window.appMpOpenConversation=function(){
  const docked=inbox.classList.contains('ww-inbox-docked'),args=arguments;
  const token=docked?window.__wishwaveWillOpenView?.('appMpInbox'):null;
  const open=()=>{stopSectionMotion();if(docked)fromInbox=true;sectionGeneration++;entry++;window.__wishwaveInboxRequest=(window.__wishwaveInboxRequest||0)+1;restore();inbox.classList.add('show');const result=baseConversation.apply(window,args);const messages=el('appMpMessages');if(messages&&!messages.dataset.loaded&&!messages.querySelector('.app-mp-bubble'))messages.innerHTML='<div class="ww-chat-loading" role="status" aria-label="Loading conversation"><i></i><i></i><i></i></div>';enterChat();return result;};
  return token&&window.__wishwaveOpenChildView?window.__wishwaveOpenChildView(token,open):open();
 };
 window.appMpInboxBack=function(){if(fromInbox){inbox.classList.remove('show','chat-open');appMpConversation='';clearInterval(appMpMessageTimer);clearInterval(appMpTypingTimer);return wishwaveOpenNotificationTab('messages');}return baseBack.apply(this,arguments);};
 // A profile Message tap is one child conversation, never an intermediate
 // Messages root tab. Keep the profile until the chat has painted synchronously.
 let profileMessageRequest=0;
 window.messageWishWavePublicSeller=async function(){
  const profile=wishwavePublicSellerData,page=el('wishwavePublicProfilePage');if(!profile)return;
  if(!marketplaceSession()){openLogin();return;}
  if(profile.viewer?.isSeller)return window.openMessagesTab();
  const seller=profile.seller||{},username=String(seller.username||'').replace(/^@+/,'').trim();
  if(!username){toast('This profile cannot be messaged yet');return;}
  const button=el('wishwavePublicMessageButton');if(button?.disabled)return;
  const attempt=++profileMessageRequest,account=owner(),token=window.__wishwaveWillOpenView?.('appMpInbox');
  if(button){button.disabled=true;button.setAttribute('aria-busy','true');}
  try{
   const data=await marketplaceFetch('/social/message-user/'+encodeURIComponent(username),{method:'POST'});
   if(attempt!==profileMessageRequest||account!==owner()||wishwavePublicSellerData!==profile||!page?.classList.contains('show')||(token&&window.__wishwaveViewRequestCurrent&&!window.__wishwaveViewRequestCurrent(token)))return;
   const id=String(data?.conversationId||'');if(!id)throw Error('Could not open conversation');
   const open=()=>{
    entry++;fromInbox=false;restore();window.__wishwaveInboxRequest=(window.__wishwaveInboxRequest||0)+1;
    clearInterval(appMpMessageTimer);clearInterval(appMpTypingTimer);
    appMpInboxMode='global';appMpCurrentOffers=[];
    appMpCurrentConversation=(appMpConversationList||[]).find(c=>String(c.id)===id)||{id,otherParty:seller.displayName||username,otherPartyUsername:username,otherPartyAvatarUrl:seller.avatarUrl||''};
    inbox.classList.add('show');
    const result=window.appMpOpenConversation(id);
    page.classList.remove('show');return result;
   };
   if(token&&window.__wishwaveOpenChildView)await window.__wishwaveOpenChildView(token,open);else await open();
  }catch(error){if(account===owner()&&attempt===profileMessageRequest)toast(error.message||'Could not open messages');}
  finally{if(button?.isConnected){button.disabled=false;button.removeAttribute('aria-busy');}}
 };

 // Session changes and history restoration must reconcile the guest UI with
 // the live session, rather than leave a captured sign-in card on screen.
 let sessionOwner=owner(),authQueued=false;
 function reconcileSession(){
  authQueued=false;const next=owner(),changed=next!==sessionOwner;sessionOwner=next;
  const panel=el('findaiNotificationPanel'),host=el('wwInboxMessages');
  const stale=!!marketplaceSession()&&!!(panel?.classList.contains('ww-inbox-guest')||host?.querySelector('.ww-guest-inbox-a'));
  const missing=panel?.classList.contains('show')&&panel.dataset.inboxSection==='messages'&&!inbox.classList.contains('chat-open')&&inbox.parentNode!==host;
  if(changed){previewCache.clear();previewThreads.clear();profileMessageRequest++;entry++;fromInbox=false;restore();inbox.classList.remove('show','chat-open');}
  if(changed||stale||missing){
   if(marketplaceSession()){host?.querySelectorAll('.ww-guest-inbox-a').forEach(node=>node.remove());panel?.classList.remove('ww-inbox-guest');}
   if(el('notifications')?.classList.contains('active')&&panel?.classList.contains('show'))window.wishwaveInboxSection(selection).catch(()=>{});
  }
  sync();
 }
 function queueSessionSync(){if(!authQueued){authQueued=true;queueMicrotask(reconcileSession);}}
 for(const name of ['applyFindaiUser','signOutAccount','updateAccountHeader']){
  const before=window[name];if(typeof before==='function')window[name]=function(){try{return before.apply(this,arguments);}finally{queueSessionSync();}};
 }
 document.addEventListener('wishwave-origin-restored',queueSessionSync);
 window.addEventListener('storage',event=>{if(event.key==='findai_user'||event.key==='fa_account_profile_v1')queueSessionSync();});

 const previewCache=new Map(),previewPending=new Set(),previewThreads=new Map();
 function previewOf(message){return String(message?.body||'').trim()||(message?.sharedItem?'Shared a listing':message?.imageUrl?'Photo':message?.attachments?.length?'Attachment':'');}
 const listRender=window.renderAppMpConversationList;
 window.renderAppMpConversationList=function(data,...args){
  const account=owner(),rows=Array.isArray(data?.conversations)?data.conversations:[];
  const prepared=rows.map(c=>{const saved=previewCache.get(account+'|'+c.id);return !String(c.lastMessage||'').trim()&&saved?{...c,...saved}:c;});
  const out=listRender.call(this,{...data,conversations:prepared},...args);
  listScope();if(prepared.length||listConfirmed)listSnapshot=prepared.map(c=>({...c}));sync();
  prepared.filter(c=>!String(c.lastMessage||'').trim()).slice(0,12).forEach(c=>{
   const key=account+'|'+c.id;if(previewPending.has(key)||previewCache.has(key))return;previewPending.add(key);
   marketplaceFetch('/marketplace/conversations/'+encodeURIComponent(c.id)+'/messages?markRead=0',{method:'GET'}).then(result=>{
    if(account!==owner())return;if(Array.isArray(result.messages)){previewThreads.set(key,{data:result,at:Date.now()});if(previewThreads.size>20)previewThreads.delete(previewThreads.keys().next().value);}const message=[...(result.messages||[])].reverse().find(m=>previewOf(m));
    const saved={lastMessage:message?previewOf(message):'Start a conversation',lastMessageAt:message?.createdAt||c.lastMessageAt};previewCache.set(key,saved);
    const current=(appMpConversationList||[]).find(row=>String(row.id)===String(c.id));if(current&&!String(current.lastMessage||'').trim())Object.assign(current,saved);
    const snapshot=listSnapshot.find(row=>String(row.id)===String(c.id));if(snapshot&&!String(snapshot.lastMessage||'').trim())Object.assign(snapshot,saved);
    if(inbox.classList.contains('show')&&!inbox.classList.contains('chat-open'))listRender.call(window,{conversations:appMpConversationList},false,'');
   }).catch(()=>{}).finally(()=>previewPending.delete(key));
  });return out;
 };
 // Root Inbox gestures take priority over child-page return handlers.
 let gesture=null,suppressInboxClick=0;
 window.__wishwaveInboxBlockClick=event=>Date.now()<suppressInboxClick&&!!el('findaiNotificationPanel')?.contains(event.target);
 window.addEventListener('pointerdown',()=>{suppressInboxClick=0;},true);
 window.__wishwaveInboxTouch=function(type,event){
  const panel=el('findaiNotificationPanel');
  if(type==='touchstart'){
   gesture=null;suppressInboxClick=0;if(inbox.classList.contains('chat-open')&&inbox.contains(event.target)){stopChatMotion();window.__wishwaveStopChatAutoPin?.();}if(!panel?.classList.contains('show')||document.body.dataset.activeTab!=='notifications'||inbox.classList.contains('chat-open')||!panel.contains(event.target)||event.touches.length!==1||(event.target.closest('input,textarea,select,[contenteditable],button:not(.app-mp-conversation-card):not([data-inbox-section])')&&!event.target.closest('.findai-notification-item')))return false;
   stopSectionMotion();const p=event.touches[0];gesture={width:el('wwInboxViewport')?.clientWidth||document.querySelector('.app').clientWidth||innerWidth,progress:inboxProgress,x:p.clientX,y:p.clientY,start:event,section:selection,axis:''};return true;
  }
  const g=gesture;if(!g)return false;
  if(type==='touchmove'){
   const p=event.touches[0];if(!p||event.touches.length!==1){gesture=null;moveSection(selection==='activity'?1:0);return false;}const dx=p.clientX-g.x,dy=p.clientY-g.y;
   if(!g.axis){if(Math.max(Math.abs(dx),Math.abs(dy))<8)return true;if(Math.abs(dy)>Math.abs(dx)*.8){gesture=null;moveSection(selection==='activity'?1:0);return false;}
    g.internal=g.section==='messages'&&dx<0||g.section==='activity'&&dx>0;g.axis='horizontal';
    if(g.internal){el('wwInboxViewport')?.classList.add('ww-inbox-moving');}else window.__wishwaveTabTouch?.('touchstart',g.start);
   }
   g.dx=dx;if(g.internal)paintProgress(g.progress-dx/g.width);else window.__wishwaveTabTouch?.(type,event);if(event.cancelable)event.preventDefault();return true;
  }
  if(type==='touchend'||type==='touchcancel'){
   gesture=null;if(g.axis==='horizontal'){suppressInboxClick=Date.now()+350;
    if(g.internal){el('wwInboxViewport')?.classList.remove('ww-inbox-moving');if(type==='touchend'&&Math.abs(g.dx)>g.width*.22){entry++;window.wishwaveInboxSection(g.section==='messages'?'activity':'messages');try{haptic();}catch(_){}}else moveSection(g.section==='messages'?0:1);}
    else window.__wishwaveTabTouch?.(type,event);
   }else moveSection(selection==='activity'?1:0);return true;
  }return false;
 };

 window.addEventListener('resize',()=>{if(!gesture)paintProgress(selection==='activity'?1:0);});
 const badge=window.appRefreshMarketplaceBadge;if(badge)window.appRefreshMarketplaceBadge=async function(){try{return await badge.apply(this,arguments);}finally{sync();}};
 const notice=window.setHomeNotificationState;window.setHomeNotificationState=function(){const out=notice?.apply(this,arguments);sync();return out;};
 document.addEventListener('wishwave-recommendation-account-change',()=>{stopChatMotion();stopSectionMotion();closeCompose();entry++;fromInbox=false;restore();inbox.classList.remove('show','chat-open');selection='messages';queueSessionSync();});
 sync();
})();
