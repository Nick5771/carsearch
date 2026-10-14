/* Likes retain their existing account store. Bookmarks have a separate, owner-scoped store. */
(function(){
  'use strict';
  const mark='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M6 3h12v18l-6-4-6 4Z"/></svg>';
  const owner=()=>String(getAccountProfile()?.email||'guest').trim().toLowerCase();
  const storage=(who=owner())=>'wishwave_bookmarks_v1:'+who;
  const pendingKey=who=>storage(who)+':pending';
  function read(key){try{const value=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(value)?value:[];}catch(_){return [];}}
  function write(key,value){localStorage.setItem(key,JSON.stringify(value));}
  window.wishwaveBookmarks=()=>read(storage()).filter(wishwaveAllowedListing);
  window.wishwaveIsBookmarked=item=>wishwaveBookmarks().some(x=>trackedKey(x)===trackedKey(item));
  function paint(){
    document.querySelectorAll('[data-bookmark-key]').forEach(button=>{const active=wishwaveBookmarks().some(x=>trackedKey(x)===button.dataset.bookmarkKey);button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));button.setAttribute('aria-label',active?'Remove from saved products':'Save product');button.querySelector('svg')?.setAttribute('fill',active?'currentColor':'none');});
    if(document.body.dataset.activeTab==='profile'){if(getAccountProfile())renderSocialProfileContent();else window.wishwaveRenderGuestCollection?.();}
  }
  const jobs=new Map();
  window.wishwaveSyncBookmarks=function(){
    const who=owner(),session=marketplaceSession();if(who==='guest'||!session)return Promise.resolve();if(jobs.has(who))return jobs.get(who);
    const valid=()=>owner()===who&&marketplaceSession()===session;
    let completed=false;const job=(async()=>{
      while(valid()){
        const entry=read(pendingKey(who))[0];if(!entry)break;
        await marketplaceFetch('/bookmarks/toggle',{method:'POST',body:JSON.stringify(entry)});
        // A newer toggle of the same item must survive an older response.
        write(pendingKey(who),read(pendingKey(who)).filter(x=>x.token!==entry.token));
      }
      if(!valid())return;
      const data=await marketplaceFetch('/bookmarks/list',{method:'GET'});
      completed=true;if(!valid()||read(pendingKey(who)).length)return;
      write(storage(who),Array.isArray(data.items)?data.items:[]);paint();
    })().catch(()=>{}).finally(()=>{jobs.delete(who);if(completed&&valid()&&read(pendingKey(who)).length)wishwaveSyncBookmarks();});
    jobs.set(who,job);return job;
  };
  window.wishwaveToggleBookmarkItem=function(item){
    if(!item)return false;const who=owner(),key=trackedKey(item),items=wishwaveBookmarks(),index=items.findIndex(x=>trackedKey(x)===key),active=index<0;
    const saved={...item,key,image:getImage(item),fallbackImage:getImageFallback(item),source:getSource(item),url:getListingUrl(item),currency:currencyOf(item,currentFeedData),savedAt:Date.now()};
    if(active)items.unshift(saved);else items.splice(index,1);
    try{
      write(storage(who),items.slice(0,250));
      if(who!=='guest'){const pending=read(pendingKey(who)).filter(x=>x.key!==key);pending.push({key,item:saved,active,token:Date.now()+':'+Math.random()});write(pendingKey(who),pending);}
    }catch(_){toast('Could not save this product');return !active;}
    if(active)recordInterest(item._interestQuery||deriveDiscoveryQuery(item.title)||item.title,'save',6,{item});haptic();paint();wishwaveSyncBookmarks();return active;
  };
  window.wishwaveToggleBookmark=function(index,event){event?.preventDefault();event?.stopPropagation();wishwaveToggleBookmarkItem(currentFeedItems[index]);};
  window.wishwaveBookmarkMarkup=(item,index)=>'<button type="button" class="reel-social-action bookmark '+(wishwaveIsBookmarked(item)?'active':'')+'" data-bookmark-key="'+escapeAttr(trackedKey(item))+'" aria-pressed="'+wishwaveIsBookmarked(item)+'" aria-label="Save product" onclick="wishwaveToggleBookmark('+index+',event)"><span class="reel-social-icon">'+mark.replace('fill="none"','fill="'+(wishwaveIsBookmarked(item)?'currentColor':'none')+'"')+'</span></button>';
  window.wishwaveSaveDetailListing=function(button){if(!appMpListing)return;const active=wishwaveToggleBookmarkItem(appMpListing);button.setAttribute('aria-pressed',String(active));button.querySelector('span').textContent=active?'Saved':'Save';};
  const render=window.renderSocialProfileContent;
  window.renderSocialProfileContent=function(){if(socialProfileTab!=='saved')return render.apply(this,arguments);const items=wishwaveBookmarks(),root=document.getElementById('socialProfileContent');if(root)root.innerHTML=items.length?'<div class="social-profile-grid">'+items.map((x,i)=>socialProfileTile(x,i,'saved')).join('')+'</div>':'<div class="social-profile-empty"><b>No saved products yet</b>Bookmark products to keep them here.</div>';};
  let guestTab='liked';
  window.wishwaveRenderGuestCollection=function(){
    const root=document.querySelector('#profileSignedOut .guest-profile-posts'),tabs=document.querySelector('#profileSignedOut .social-profile-tabs');if(!root||!tabs||getAccountProfile())return;
    tabs.classList.remove('guest-profile-tabs');tabs.setAttribute('aria-hidden','false');tabs.style.setProperty('--profile-tab-index',String(['listings','sold','liked','saved'].indexOf(guestTab)));
    [...tabs.querySelectorAll('button')].forEach((button,i)=>{const tab=['listings','sold','liked','saved'][i];button.disabled=false;button.tabIndex=0;button.classList.toggle('active',tab===guestTab);button.setAttribute('aria-selected',String(tab===guestTab));button.setAttribute('aria-label',tab==='liked'?'Liked products':tab==='saved'?'Saved products':tab==='sold'?'Sold':'Listings');button.onclick=()=>{guestTab=tab;wishwaveRenderGuestCollection();};});
    if(guestTab==='liked'||guestTab==='saved'){const items=guestTab==='liked'?getTracked():wishwaveBookmarks();root.innerHTML=items.length?'<div class="social-profile-grid">'+items.map((x,i)=>socialProfileTile(x,i,guestTab)).join('')+'</div>':'<div class="social-profile-empty"><b>No '+(guestTab==='liked'?'liked':'saved')+' products yet</b>'+(guestTab==='liked'?'Heart':'Bookmark')+' products to keep them here.</div>';}
    else root.innerHTML='<div class="guest-profile-signin"><b>Sign in to your profile</b><span>Sign in for your listings, messages and account activity.</span><button type="button" onclick="openLogin()">Sign in</button></div>';
  };
  document.querySelector('#profileSignedOut .social-profile-handle').textContent='Profile';
  document.querySelectorAll('#profileSignedIn .social-profile-tabs,#profileSignedOut .social-profile-tabs').forEach(tabs=>{const button=document.createElement('button');button.type='button';button.dataset.profileTab='saved';button.setAttribute('aria-label','Saved products');button.innerHTML=mark;button.onclick=()=>setProfileTab('saved');tabs.append(button);});
  const profile=window.renderProfileTab;window.renderProfileTab=function(){const result=profile.apply(this,arguments);wishwaveRenderGuestCollection();wishwaveSyncBookmarks();return result;};
  const tracked=window.setTracked;window.setTracked=function(){const result=tracked.apply(this,arguments);wishwaveRenderGuestCollection();return result;};
  const filter=window.wishwaveFilterNotifications;window.wishwaveFilterNotifications=function(value){const root=document.getElementById('findaiNotificationList');root?.getAnimations?.().forEach(x=>x.cancel());filter(value);document.querySelector('.wishwave-notification-tabs')?.style.setProperty('--notice-index',String(Math.max(0,['all','orders','social'].indexOf(value))));if(!matchMedia('(prefers-reduced-motion: reduce)').matches)root?.animate?.([{opacity:.15,transform:'translateY(3px)'},{opacity:1,transform:'translateY(0)'}],{duration:200,easing:'ease-out'});};
  function searchFocus(){const field=document.activeElement;document.body.classList.toggle('wishwave-search-editing',!!field?.closest?.('#search,#searchResults')&&field.matches('input,textarea,[contenteditable="true"]'));}
  document.addEventListener('focusin',searchFocus);document.addEventListener('focusout',()=>requestAnimationFrame(searchFocus));
  document.addEventListener('wishwave-recommendation-account-change',()=>{guestTab='liked';paint();wishwaveSyncBookmarks();});
  window.addEventListener('online',wishwaveSyncBookmarks);
  document.querySelectorAll('.reel-card[data-index]').forEach(card=>{const rail=card.querySelector('.reel-actions-rail'),index=Number(card.dataset.index),item=currentFeedItems[index];if(rail&&item&&!rail.querySelector('.bookmark'))rail.insertAdjacentHTML('beforeend',wishwaveBookmarkMarkup(item,index));});
  paint();wishwaveRenderGuestCollection();wishwaveSyncBookmarks();
})();
