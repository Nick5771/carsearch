/* Search-owned feed strip: content-sized tabs and one sliding selection indicator. */
(function(){
 let motion=null;
 const reduced=()=>matchMedia('(prefers-reduced-motion:reduce)').matches;
 window.wishwaveAnimateSearchFeed=function(direction=1){
  const feed=document.getElementById('searchDetailFeed');if(!feed||reduced()||!feed.animate)return;
  motion?.cancel();
  motion=feed.animate([{opacity:.35,transform:'translate3d('+(direction*14)+'px,0,0)'},{opacity:1,transform:'translate3d(0,0,0)'}],{duration:240,easing:'cubic-bezier(.22,.8,.22,1)'});
 };
 window.wishwaveSyncSearchTabs=function(mode,animate=true){
  const tabs=document.querySelector('#searchDetailOverlay[data-reel-owner="search"] .ww-search-feed-tabs');
  if(!tabs)return;
  const buttons=Array.from(tabs.querySelectorAll('[data-reel-feed]'));
  const button=buttons.find(b=>b.dataset.reelFeed===mode)||buttons.find(b=>b.getAttribute('aria-selected')==='true');
  if(!button)return;
  const label=button.querySelector('span');if(!label)return;
  let indicator=tabs.querySelector('.ww-search-tab-indicator'),fresh=!indicator;
  if(fresh){indicator=document.createElement('i');indicator.className='ww-search-tab-indicator';indicator.setAttribute('aria-hidden','true');tabs.appendChild(indicator);}
  const before=buttons.findIndex(b=>b.dataset.reelFeed===tabs.dataset.selectedFeed),after=buttons.indexOf(button);
  const rect=tabs.getBoundingClientRect(),text=label.getBoundingClientRect();
  indicator.style.transition=animate&&!fresh&&!reduced()?'transform 240ms cubic-bezier(.22,.8,.22,1),width 240ms cubic-bezier(.22,.8,.22,1)':'none';
  indicator.style.width=text.width+'px';
  indicator.style.transform='translate3d('+(text.left-rect.left+tabs.scrollLeft)+'px,'+(text.bottom-rect.top-3)+'px,0)';
  const left=Math.max(0,Math.min(tabs.scrollWidth-tabs.clientWidth,button.offsetLeft+button.offsetWidth/2-tabs.clientWidth/2));
  tabs.scrollTo({left,behavior:animate&&!reduced()?'smooth':'instant'});
  tabs.dataset.selectedFeed=button.dataset.reelFeed;
  if(animate&&before>=0&&before!==after)window.wishwaveAnimateSearchFeed(after>before?1:-1);
 };
 window.addEventListener('resize',()=>{
  const tabs=document.querySelector('#searchDetailOverlay .ww-search-feed-tabs');
  if(tabs)window.wishwaveSyncSearchTabs(tabs.dataset.selectedFeed,false);
 });
})();
