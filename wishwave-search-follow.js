/* Recent profile actions share the server relationship state with live search. */
(function(){
 'use strict';
 const states=new Map(),loads=new Map(),painted=new WeakMap();
 const owner=()=>String(getAccountProfile()?.email||'')+'|'+marketplaceSession();
 const clean=value=>String(value||'').replace(/^@+/,'').trim();
 const key=username=>owner()+'|'+clean(username).toLowerCase();
 window.wishwaveRecentProfileAction=function(row){
  const username=clean(row.username),self=clean(getAccountProfile()?.username).toLowerCase();
  if(row.type!=='profile'||!username||row.isSelf||username.toLowerCase()===self)return '';
  return '<button type="button" class="premium-seller-action ww-recent-follow" data-follow-username="'+escapeAttr(username)+'" disabled aria-label="Loading follow status for '+escapeAttr(username)+'">…</button>';
 };
 function paint(button,state){
  if(!button.isConnected)return;
  const signature=JSON.stringify([state.following,state.pending,state.busy,state.blocked,state.error,state.self]);if(painted.get(button)===signature)return;painted.set(button,signature);
  if(state.self){button.remove();return;}
  const label=state.following?'Following':state.pending?'Requested':'Follow';
  if(button.textContent!==label)button.textContent=label;
  const following=!!(state.following||state.pending);if(button.classList.contains('following')!==following)button.classList.toggle('following',following);
  button.disabled=!!(state.busy||state.blocked||state.error);
  button.setAttribute('aria-busy',String(!!state.busy));
  button.setAttribute('aria-label',state.error?'Follow status unavailable':button.textContent+' @'+button.dataset.followUsername);
 }
 function paintAll(username,state){document.querySelectorAll('.ww-recent-follow').forEach(button=>{if(clean(button.dataset.followUsername).toLowerCase()===clean(username).toLowerCase())paint(button,state);});}
 function load(username){
  const id=key(username),session=owner(),saved=states.get(id);
  if(saved&&Date.now()-saved.at<15000){paintAll(username,saved);return;}
  if(loads.has(id))return;
  const promise=marketplaceFetch('/profile/public/'+encodeURIComponent(username),{method:'GET'}).then(data=>{
   if(owner()!==session)return;
   const v=data.viewer||{},state={following:!!v.isFollowing,pending:!!v.pending,self:!!v.isSelf,blocked:!!(v.blockedByViewer||v.blockedViewer||v.blockedByTarget||v.blockedByUser),at:Date.now()};states.set(id,state);paintAll(username,state);
  }).catch(()=>{if(owner()===session)paintAll(username,{error:true});}).finally(()=>loads.delete(id));loads.set(id,promise);
 }
 function decorate(){document.querySelectorAll('#findaiSearchRecents.show .ww-recent-follow').forEach(button=>load(button.dataset.followUsername));}
 let queued=false;
 function schedule(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;decorate();});}
 const search=document.getElementById('search');if(search)new MutationObserver(schedule).observe(search,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
 async function toggle(button,confirmed=false){
  const username=button.dataset.followUsername,id=key(username),session=owner(),state=states.get(id);
  if(!marketplaceSession()){openLogin();return;}
  if(!state||state.busy||state.self||state.blocked)return;
  if(state.following&&!confirmed){
   openAppMpSheet('Unfollow?','<div class="app-mp-actions"><button type="button" class="app-mp-action tertiary danger" id="wwSearchUnfollow">Unfollow @'+escapeHTML(username)+'</button><button type="button" class="app-mp-action tertiary" id="wwSearchUnfollowCancel">Cancel</button></div>');
   document.getElementById('wwSearchUnfollow').onclick=()=>{closeAppMpSheet();if(owner()===session&&button.isConnected)toggle(button,true);};
   document.getElementById('wwSearchUnfollowCancel').onclick=()=>closeAppMpSheet();return;
  }
  const before={...state},removing=state.following||state.pending;
  Object.assign(state,{busy:true,following:false,pending:!removing,at:Date.now()});paintAll(username,state);try{haptic();}catch(_){}
  try{
   const data=await marketplaceFetch('/social/follow-user/'+encodeURIComponent(username),{method:removing?'DELETE':'POST'});
   if(owner()!==session)return;
   Object.assign(state,{following:!!data.isFollowing,pending:!!data.pending,at:Date.now()});
  }catch(error){if(owner()===session){Object.assign(state,before);toast(error.message||'Could not update follow');}}
  finally{state.busy=false;if(owner()===session){states.set(id,state);paintAll(username,state);}}
 }
 document.addEventListener('click',event=>{const button=event.target.closest?.('.ww-recent-follow');if(!button)return;event.preventDefault();event.stopImmediatePropagation();if(!button.disabled)toggle(button);},true);
 document.addEventListener('keydown',event=>{if(event.target.closest?.('.ww-recent-follow'))event.stopPropagation();},true);
 const fetchBefore=window.marketplaceFetch;
 window.marketplaceFetch=function(path,options){
  const session=owner(),out=fetchBefore.apply(this,arguments);
  if(/\/(?:follow-user\/[^/]+|sellers\/[^/]+\/follow)$/.test(path)&&['POST','DELETE'].includes(options?.method))return Promise.resolve(out).then(data=>{
   if(owner()===session){for(const [id,state] of states)if(!state.busy)states.delete(id);schedule();}return data;
  });return out;
 };
 document.addEventListener('wishwave-recommendation-account-change',()=>{states.clear();schedule();});
 document.addEventListener('wishwave-social-block-changed',()=>{states.clear();schedule();});
})();
