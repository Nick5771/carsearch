(function(){
 'use strict';
 let state=null,generation=0,countEpoch=0,searchTimer;const counts=new Map(),lastFollowing=new Map(),pending=new Map(),rootOwners=new WeakMap();
 const account=()=>String(getAccountProfile()?.email||'').toLowerCase()+'|'+marketplaceSession();
 const esc=s=>escapeHTML(String(s||''));
 const ownCacheKey=()=>{const email=String(getAccountProfile()?.email||'').trim().toLowerCase();return email?'wishwave-connection-counts-v375:'+encodeURIComponent(email):'';};
 const validCounts=data=>data&&['followers','following'].every(k=>data[k]!=null&&Number.isSafeInteger(Number(data[k]))&&Number(data[k])>=0);
 function cachedOwn(){const early=window.readOwnConnectionCounts?.();if(validCounts(early))return early;try{const key=ownCacheKey(),data=key?JSON.parse(localStorage.getItem(key)||'null'):null;return validCounts(data)?data:null;}catch(_){return null;}}
 function saveCounts(key,data,owner){
  if(!validCounts(data)||owner!==account())return;
  counts.set(owner+'|'+key,{data,at:Date.now()});lastFollowing.set(owner+'|'+key,Number(data.following));
  if(key==='@me'){const storage=ownCacheKey();if(storage)try{localStorage.setItem(storage,JSON.stringify({followers:Number(data.followers),following:Number(data.following)}));}catch(_){}window.wishwaveApplyOwnFollowerCount?.(data.followers);}
 }
 function fetchCounts(key,force=false){
  const owner=account(),epoch=countEpoch,cacheKey=owner+'|'+key,saved=counts.get(cacheKey);
  if(!marketplaceSession())return Promise.reject(Error('Sign in to view connections'));
  if(!force&&saved&&Date.now()-saved.at<15000)return Promise.resolve(saved.data);
  if(pending.has(cacheKey))return pending.get(cacheKey);
  const request=Promise.resolve(marketplaceFetch('/social/connections/'+encodeURIComponent(key)+'?counts=1',{method:'GET'})).then(data=>{if(epoch!==countEpoch||owner!==account())throw Error('The account or connections changed');if(!validCounts(data))throw Error('Could not load connection counts');saveCounts(key,data,owner);return data;}).finally(()=>{if(pending.get(cacheKey)===request)pending.delete(cacheKey);});
  pending.set(cacheKey,request);return request;
 }
 window.wishwaveOwnConnectionCounts=force=>fetchCounts('@me',!!force);
 function stats(root,key){
  if(!root)return;root.dataset.connectionsOwner=key;const buttons=[...root.querySelectorAll(':scope > button')];if(buttons.length!==3)return;
  const followers=buttons.find(b=>b.dataset.connectionKind==='followers'||b.querySelector('#socialFollowersValue,#wishwavePublicFollowerCount'))||buttons.find(b=>b.textContent.includes('Followers'));
  const following=buttons.find(b=>b.dataset.connectionKind==='following')||buttons.find(b=>b.textContent.includes('Sold'));
  if(!followers||!following)return;
  followers.dataset.connectionKind='followers';following.dataset.connectionKind='following';
  if(rootOwners.get(root)!==account()){rootOwners.set(root,account());delete following.dataset.connectionsReady;}
  const owner=account(),epoch=countEpoch,cacheKey=owner+'|'+key;
  const label=following.querySelector('span');if(label)label.textContent='Following';const number=following.querySelector('b');if(number){if(number.id==='socialSoldCount')number.id='socialFollowingValue';if(!following.dataset.connectionsReady)number.textContent=lastFollowing.has(cacheKey)?profileMetricCompact(lastFollowing.get(cacheKey)):marketplaceSession()?'…':'0';}
  root.append(followers,following);
  [followers,following].forEach(button=>{button.removeAttribute('onclick');button.onclick=()=>window.wishwaveOpenConnections(key,button.dataset.connectionKind);button.setAttribute('aria-label',button.dataset.connectionKind==='followers'?'View followers':'View following');});
  function paint(data){if(!validCounts(data)||epoch!==countEpoch||owner!==account()||!root.isConnected||root.dataset.connectionsOwner!==key)return;for(const kind of ['followers','following']){const button=root.querySelector('[data-connection-kind="'+kind+'"]');if(button){const value=button.querySelector('b');value.textContent=profileMetricCompact(Number(data[kind]));value.classList.remove('findai-followers-pending');value.removeAttribute('aria-label');button.dataset.connectionsReady='1';}}}
  const saved=counts.get(cacheKey);if(saved)paint(saved.data);else if(key==='@me'){const pair=cachedOwn();if(pair)paint(pair);else {let legacy=null;try{const email=String(getAccountProfile()?.email||'').trim().toLowerCase(),raw=JSON.parse(localStorage.getItem('findai-v160-follower-count:'+encodeURIComponent(email))||'null');if(raw?.count!=null&&Number.isSafeInteger(Number(raw.count))&&Number(raw.count)>=0)legacy=Number(raw.count);}catch(_){}for(const button of [followers,following]){const value=button.querySelector('b');if(button===followers&&legacy!=null)value.textContent=profileMetricCompact(legacy);else if(!button.dataset.connectionsReady)value.textContent=marketplaceSession()?'…':'0';value.classList.remove('findai-followers-pending');}}}
  if(marketplaceSession())fetchCounts(key).then(paint).catch(()=>{/* Preserve the saved pair during a temporary failure. */});
 }

 // Legacy profile swipe snapshots can reattach older tab nodes. Repair labels
 // deterministically after a restore; never overwrite fractional drag progress.
 const captions={listings:'Listings',sold:'Sold',saved:'Saved'};
 function repairProfileTabs(){
  for(const tabs of document.querySelectorAll('#profileSignedIn .social-profile-tabs,#profileSignedOut .social-profile-tabs,#wishwavePublicProfilePage .social-profile-tabs')){
   const buttons=[...tabs.querySelectorAll(':scope > button')];
   buttons.forEach((button,index)=>{
    const key=String(button.dataset.profileTab||button.dataset.publicProfileTab||['listings','sold','saved'][index]||'').toLowerCase();
    if(!captions[key])return;
    let label=button.querySelector('.wishwave-profile-tab-label');
    if(!label){label=document.createElement('span');label.className='wishwave-profile-tab-label';button.append(label);}
    if(label.textContent!==captions[key])label.textContent=captions[key];
   });
   if(!tabs.classList.contains('wishwave-profile-bar-drag')){
    const active=buttons.findIndex(b=>b.classList.contains('active'));
    if(active>=0&&tabs.style.getPropertyValue('--profile-tab-index')!==String(active))tabs.style.setProperty('--profile-tab-index',String(active));
   }
  }
 }
 let repairQueued=false;
 function scheduleRepair(){
  if(repairQueued)return;repairQueued=true;
  (window.requestAnimationFrame||window.setTimeout)(()=>{repairQueued=false;repairProfileTabs();},0);
 }
 function decorate(){stats(document.querySelector('#profileSignedIn .social-profile-stats'),'@me');const seller=wishwavePublicSellerData?.seller,key=seller?.username||(seller?.id?'seller:'+seller.id:'');if(key)stats(document.querySelector('#wishwavePublicProfileBody .social-profile-stats'),key);repairProfileTabs();}
 const profileRoot=document.getElementById('profile');
 if(profileRoot)new MutationObserver(records=>{
  if(records.some(record=>record.target===profileRoot||record.target.matches?.('#profileSignedIn,#profileSignedOut')||record.target.closest?.('.social-profile-tabs')||[...record.addedNodes].some(n=>n.nodeType===1&&(n.matches?.('.social-profile-tabs')||n.querySelector?.('.social-profile-tabs')))))scheduleRepair();
 }).observe(profileRoot,{childList:true,subtree:true,attributes:true,attributeFilter:['class','hidden']});

 const own=window.paintSocialProfileHeader;window.paintSocialProfileHeader=function(){const out=own.apply(this,arguments);decorate();return out;};
 const pub=window.renderWishWavePublicProfile;window.renderWishWavePublicProfile=function(){const out=pub.apply(this,arguments);decorate();return out;};
 const profile=window.renderProfileTab;window.renderProfileTab=function(){const out=profile.apply(this,arguments);decorate();return out;};
 const apply=window.applyFindaiUser;window.applyFindaiUser=function(){const out=apply.apply(this,arguments);decorate();return out;};
 function ensure(){let page=document.getElementById('wishwaveConnectionsPage');if(page)return page;page=document.createElement('section');page.id='wishwaveConnectionsPage';page.className='ww-connections-page';page.setAttribute('aria-label','Profile connections');page.innerHTML='<header><button type="button" data-close aria-label="Back">‹</button><h2>Followers</h2><span></span></header><label class="ww-connections-search"><input type="search" placeholder="Search people" aria-label="Search people"></label><div class="ww-connections-scroll"><div class="ww-connections-rows"></div><button type="button" class="ww-connections-more" hidden>Show more</button><p class="ww-connections-status" role="status"></p></div>';
  (document.querySelector('.app')||document.body).append(page);page.querySelector('[data-close]').onclick=()=>window.wishwaveCloseConnections();page.querySelector('input').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>load(false),180);};page.querySelector('.ww-connections-more').onclick=()=>load(true);
  page.addEventListener('click',e=>{const row=e.target.closest('[data-person]');if(!row||!state)return;if(e.target.closest('[data-follow]')){toggle(row.dataset.person,e.target.closest('button'));return;}window.openFindAIProfileByUsername(row.dataset.person);});return page;
 }
 function paint(){const page=ensure();page.querySelector('.ww-connections-rows').innerHTML=state.people.map(p=>'<div class="ww-connections-row" data-person="'+escapeAttr(p.username)+'"><button type="button" class="ww-connections-person" aria-label="Open '+escapeAttr(p.username)+' profile"><span class="ww-connections-avatar">'+(p.avatarUrl?'<img src="'+escapeAttr(p.avatarUrl)+'" alt="">':findaiDefaultAvatarSvg())+'</span><span><b>'+esc(p.username)+'</b><small>'+esc(p.displayName)+'</small></span></button>'+(!p.isSelf?'<button type="button" data-follow class="ww-connections-follow '+(p.isFollowing||p.pending?'following':'')+'" '+(p.busy?'disabled':'')+'>'+(p.isFollowing?'Following':p.pending?'Requested':'Follow')+'</button>':'')+'</div>').join('');page.querySelector('.ww-connections-more').hidden=!state.hasMore;}
 async function load(more){if(!state)return;const current=state,request=++generation,session=account(),page=ensure(),status=page.querySelector('.ww-connections-status'),q=page.querySelector('input').value.trim();
  status.textContent='Loading…';page.querySelector('.ww-connections-more').disabled=true;
  try{const data=await marketplaceFetch('/social/connections/'+encodeURIComponent(current.key)+'?type='+current.kind+'&offset='+(more?current.offset:0)+'&q='+encodeURIComponent(q),{method:'GET'});if(state!==current||request!==generation||account()!==session)return;
   current.people=more?[...current.people,...data.people]:data.people;current.offset=data.nextOffset;current.hasMore=!!data.hasMore;paint();status.textContent=current.people.length?'':q?'No matching people':current.kind==='following'?'No accounts followed yet':'No followers yet';
  }catch(e){if(state===current&&request===generation)status.textContent=e.message||'Could not load people';}finally{if(state===current&&request===generation)page.querySelector('.ww-connections-more').disabled=false;}
 }
 async function toggle(username,button,confirmed=false){const current=state,p=current?.people.find(p=>p.username===username);if(!p||p.busy)return;const was=!!p.isFollowing,requested=!!p.pending;if(was&&!confirmed){openAppMpSheet('Unfollow?',wishwaveUnfollowMarkup('@'+username,p.avatarUrl||'',{confirmId:'wwConnectionUnfollow',cancelId:'wwConnectionCancel'}));document.getElementById('wwConnectionUnfollow').onclick=()=>{closeAppMpSheet();if(state===current)toggle(username,button,true);};document.getElementById('wwConnectionCancel').onclick=()=>closeAppMpSheet();return;}
  const session=account();p.busy=true;p.isFollowing=!was&&!requested;p.pending=false;paint();try{haptic();}catch(_){}
  try{const data=await marketplaceFetch('/social/follow-user/'+encodeURIComponent(username),{method:was||requested?'DELETE':'POST'});if(account()!==session)return;p.isFollowing=!!data.isFollowing;p.pending=!!data.pending;decorate();}
  catch(e){if(account()===session){p.isFollowing=was;p.pending=requested;toast(e.message||'Could not update follow');}}finally{p.busy=false;if(state===current&&account()===session)paint();}
 }
 window.wishwaveOpenConnections=function(key,kind){if(!marketplaceSession()){openLogin();return;}const token=window.__wishwaveWillOpenView?.('wishwaveConnectionsPage'),page=ensure();state={key,kind:kind==='following'?'following':'followers',people:[],offset:0,hasMore:false};page.querySelector('h2').textContent=state.kind==='following'?'Following':'Followers';page.querySelector('input').value='';page.querySelector('.ww-connections-rows').replaceChildren();page.classList.add('show');window.__wishwaveDidOpenView?.(token);load(false);};
 window.wishwaveCloseConnections=function(){generation++;state=null;clearTimeout(searchTimer);document.getElementById('wishwaveConnectionsPage')?.classList.remove('show');};
 const fetchBefore=window.marketplaceFetch;
 window.marketplaceFetch=function(path,options){const session=account(),request=fetchBefore.apply(this,arguments);if(/\/(?:follow-user\/[^/]+|sellers\/[^/]+\/follow)$/.test(path)&&['POST','DELETE'].includes(options?.method))return Promise.resolve(request).then(data=>{if(account()===session){countEpoch++;counts.clear();pending.clear();decorate();}return data;});return request;};
 const logout=window.signOutAccount;window.signOutAccount=function(){window.wishwaveCloseConnections();countEpoch++;counts.clear();lastFollowing.clear();pending.clear();return logout.apply(this,arguments);};
 // Settings opens at the top, while its header remains below the system status bar.
 const settings=window.findaiOpenSettingsHome;window.findaiOpenSettingsHome=function(){const out=settings.apply(this,arguments);const scroll=document.querySelector('#appThemeOverlay .app-theme-sheet');if(scroll)scroll.scrollTop=0;return out;};
 document.querySelectorAll('#profileSignedOut .social-profile-stats button').forEach((button,i)=>{const label=button.querySelector('span');if(label)label.textContent=['Listings','Followers','Following'][i];});
 document.addEventListener('wishwave-social-block-changed',()=>{countEpoch++;counts.clear();pending.clear();decorate();});
 decorate();
})();


