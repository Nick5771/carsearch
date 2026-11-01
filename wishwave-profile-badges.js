/* Visual profile badge rollout. This does not assert identity or completed sales. */
(function(){
 'use strict';
 const names='#socialProfileHandle,#wishwavePublicHandle,#search .premium-seller-copy>b,#searchResults .premium-seller-copy>b,#findaiLiveProfileMatches .premium-seller-copy>b,.findai-recent-row:has(.findai-recent-thumb.profile) .findai-recent-copy>b';
 const points=Array.from({length:24},(_,i)=>{const angle=(i*15-90)*Math.PI/180,r=i%2?9.7:11;return (12+Math.cos(angle)*r).toFixed(2)+','+(12+Math.sin(angle)*r).toFixed(2);}).join(' ');
 function decorate(name){
  if(!name?.matches?.(names)||name.querySelector(':scope>.ww-profile-badge')||!name.textContent.trim())return;
  const text=document.createElement('span');text.className='ww-badged-name';
  while(name.firstChild)text.appendChild(name.firstChild);
  const badge=document.createElement('span');badge.className='ww-profile-badge';badge.setAttribute('role','img');badge.setAttribute('aria-label','WishWave badge');badge.title='WishWave badge';
  badge.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><polygon points="'+points+'" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="m7.2 12 3.1 3.1 6.5-6.4" fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  name.classList.add('ww-has-profile-badge');name.append(text,badge);
 }
 function scan(root){if(root.nodeType!==1)return;decorate(root);root.querySelectorAll(names).forEach(decorate);}
 scan(document.body);
 // Only inspect changed subtrees; never rescan the app on image/style updates.
 new MutationObserver(records=>{for(const record of records){decorate(record.target.nodeType===1?record.target:record.target.parentElement);for(const node of record.addedNodes)scan(node);}}).observe(document.body,{childList:true,subtree:true,characterData:true});
})();
