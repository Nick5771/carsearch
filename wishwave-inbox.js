function wishwaveInboxDestination(messages,activity,last){return messages>0?'messages':activity>0?'activity':last==='activity'?'activity':'messages';}
if(typeof module==='object'&&module.exports)module.exports={destination:wishwaveInboxDestination};
(function(){
 'use strict';
 if(typeof document==='undefined')return;
 const el=id=>document.getElementById(id),inbox=el('appMpInbox'),home=inbox?.parentNode;
 if(!inbox)return;
 const baseOpen=window.openAppMarketplaceInbox,baseConversation=window.appMpOpenConversation,baseBack=window.appMpInboxBack;
 let selection='messages',entry=0,fromInbox=false,composeToken=0,composeTimer,composeReturn;
 function closeCompose(){composeToken++;clearTimeout(composeTimer);el('wwComposeDialog')?.close();composeReturn?.focus();}
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
      if(!result?.conversationId)throw Error('Could not start conversation');closeCompose();entry++;fromInbox=true;restore();inbox.classList.add('show');await window.appMpOpenConversation(String(result.conversationId));
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
  el('wwComposeSearch').value='';el('wwComposeStatus').textContent='';dialog.showModal();el('wwComposeSearch').focus();loadPeople('');
 }
 const owner=()=>String(marketplaceSession()||'guest');
 const key=()=> 'ww_inbox_section_v1:'+owner();
 const unreadMessages=()=>{const badges=[el('navMessagesBadge'),el('appMpUnreadBadge')].filter(Boolean);return badges.length?Math.max(0,...badges.filter(b=>b.classList.contains('show')).map(b=>Number(b.textContent)||1)):(appMpConversationList||[]).reduce((n,c)=>n+(Number(c.unreadCount)||0),0);};
 const unreadActivity=()=>Number(window.findaiNotificationState?.getUnread()||0);
 function sync(){
  const search=inbox.querySelector('.app-mp-instagram-search input');if(search)search.placeholder='Search messages';
  const m=unreadMessages(),a=unreadActivity();
  document.querySelectorAll('[data-inbox-section]').forEach(b=>{const section=b.dataset.inboxSection,count=section==='messages'?m:a;b.setAttribute('aria-selected',String(section===selection));b.querySelector('.ww-inbox-count').textContent=count?String(Math.min(99,count)):'';});
  const button=document.querySelector('#wishwaveMainNav [data-tab="notifications"]'),dot=el('navNotificationsBadge');
  button?.setAttribute('aria-label','Inbox'+(m+a?' — '+(m+a)+' unread':''));button?.classList.toggle('has-unread',m+a>0);if(dot){dot.classList.toggle('show',m+a>0);dot.style.display=m+a?'block':'none';}
 }
 function restore(){if(inbox.parentNode!==home)home.appendChild(inbox);inbox.classList.remove('ww-inbox-docked');}
 function ensure(){
  window.findaiNotificationState?.ensureUI();const panel=el('findaiNotificationPanel');if(!panel)return;
  panel.classList.add('ww-unified-inbox');panel.setAttribute('aria-label','Inbox');const title=panel.querySelector('.findai-notification-panel-head b');if(title)title.textContent='Inbox';panel.querySelector('.wishwave-notification-back')?.remove();
  if(!el('wwInboxCompose')){const compose=document.createElement('button');compose.id='wwInboxCompose';compose.type='button';compose.setAttribute('aria-label','New message');compose.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-7M16 3l5 5M10 14l1-5 7-7 5 5-7 7-6 1Z"/></svg>';compose.onclick=openCompose;panel.querySelector('.findai-notification-panel-head').appendChild(compose);}
  if(!el('wwInboxTabs')){const tabs=document.createElement('div');tabs.id='wwInboxTabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Inbox sections');tabs.innerHTML=['messages','activity'].map(s=>'<button type="button" role="tab" data-inbox-section="'+s+'">'+'<span class="ww-inbox-label">'+(s==='messages'?'Messages':'Activity')+'</span><span class="ww-inbox-count"></span></button>').join('');tabs.onclick=e=>{const b=e.target.closest('[data-inbox-section]');if(b){entry++;window.wishwaveInboxSection(b.dataset.inboxSection);}};panel.querySelector('.findai-notification-panel-head').after(tabs);const host=document.createElement('div');host.id='wwInboxMessages';panel.appendChild(host);}
  return panel;
 }
 window.wishwaveInboxSection=async function(section){
  selection=section==='activity'?'activity':'messages';try{localStorage.setItem(key(),selection);}catch(_){}
  const panel=ensure();if(!panel)return;panel.dataset.inboxSection=selection;sync();
  if(selection==='messages'){
   if(!marketplaceSession()){el('wwInboxMessages').innerHTML='<div class="findai-notification-empty"><b>Your messages</b><button type="button" onclick="openLogin()">Sign in to see your conversations</button></div>';return;}
   fromInbox=true;inbox.classList.remove('chat-open');el('wwInboxMessages').appendChild(inbox);inbox.classList.add('ww-inbox-docked');await baseOpen.call(window);sync();
  }else{inbox.classList.remove('show');await window.findaiNotificationState?.load();sync();}
 };
 window.wishwaveOpenNotificationTab=window.openHomeNotifications=async function(){
  const token=++entry,account=owner();restore();inbox.classList.remove('show','chat-open');go('notifications');document.body.dataset.activeTab='notifications';setMainNavActive('notifications');const panel=ensure();panel?.classList.add('show');
  let last='messages';try{last=localStorage.getItem(key())||last;}catch(_){}
  const choose=()=>wishwaveInboxDestination(unreadMessages(),unreadActivity(),last);
  await window.wishwaveInboxSection(choose());
  // Refresh both unread sources; never move tabs after the user interacts.
  if(token===entry&&account===owner()){await Promise.allSettled([window.appRefreshMarketplaceBadge?.(),window.findaiNotificationState?.load()]);if(token===entry&&account===owner()&&el('notifications')?.classList.contains('active')){const next=choose();if(next!==selection)await window.wishwaveInboxSection(next);sync();}}
 };
 const chat=window.renderAppMpChat;window.renderAppMpChat=function(){restore();return chat.apply(this,arguments);};
 // Keep notification deep links and profile Message buttons on their existing paths.
 window.openMessagesTab=function(){return wishwaveOpenNotificationTab().then(()=>wishwaveInboxSection('messages'));};
 window.openAppMarketplaceInbox=function(){restore();fromInbox=false;return baseOpen.apply(this,arguments);};
 window.appMpOpenConversation=function(){restore();return baseConversation.apply(this,arguments);};
 window.appMpInboxBack=function(){if(fromInbox){inbox.classList.remove('show','chat-open');appMpConversation='';clearInterval(appMpMessageTimer);clearInterval(appMpTypingTimer);return wishwaveOpenNotificationTab().then(()=>wishwaveInboxSection('messages'));}return baseBack.apply(this,arguments);};
 const badge=window.appRefreshMarketplaceBadge;if(badge)window.appRefreshMarketplaceBadge=async function(){try{return await badge.apply(this,arguments);}finally{sync();}};
 const notice=window.setHomeNotificationState;window.setHomeNotificationState=function(){const out=notice?.apply(this,arguments);sync();return out;};
 document.addEventListener('wishwave-recommendation-account-change',()=>{closeCompose();entry++;fromInbox=false;restore();inbox.classList.remove('show','chat-open');selection='messages';sync();});
 sync();
})();
