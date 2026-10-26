/* Search owns one editing session, including the keyboard's dismissal frames. */
(function(){
 'use strict';
 const search=document.getElementById('search'),field=document.getElementById('q'),form=field?.form;
 if(!search||!form)return;
 const row=document.createElement('div');row.className='ww-search-entry';form.before(row);
 const back=document.createElement('button');back.type='button';back.className='ww-search-cancel';back.setAttribute('aria-label','Back to discovery');
 back.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg>';
 row.append(back,form);
 const backing=document.createElement('div');backing.id='wwSearchKeyboardBacking';backing.hidden=true;backing.setAttribute('aria-hidden','true');document.body.appendChild(backing);
 function clearBacking(){backing.hidden=true;backing.style.removeProperty('top');backing.style.removeProperty('height');document.documentElement.classList.remove('ww-search-keyboard-canvas');}
 const loader=document.createElement('div');loader.id='wwSearchLoading';loader.hidden=true;loader.setAttribute('role','status');loader.setAttribute('aria-label','Searching');loader.innerHTML='<span class="ww-search-spinner" aria-hidden="true"></span>';search.appendChild(loader);
 let frame=0,baseline=0;
 function syncLoading(){
  const visible=document.body.dataset.activeTab==='search'&&search.classList.contains('active');
  const hasResults=!!search.querySelector('.premium-explore-tile,.premium-seller-row');
  const busy=visible&&!!field.value.trim()&&search.classList.contains('live-search-interpreting')&&!hasResults;
  loader.hidden=!busy;if(search.classList.contains('ww-search-loading-empty')!==busy)search.classList.toggle('ww-search-loading-empty',busy);
  if(!busy)return;
  const rect=search.getBoundingClientRect(),header=search.querySelector('.premium-search-home-header').getBoundingClientRect();
  let bottom=Math.min(rect.bottom||innerHeight,window.visualViewport?window.visualViewport.height+window.visualViewport.offsetTop:innerHeight);
  const nav=document.getElementById('wishwaveMainNav'),navBox=nav?.getBoundingClientRect();
  if(navBox?.height&&getComputedStyle(nav).visibility!=='hidden'&&getComputedStyle(nav).display!=='none')bottom=Math.min(bottom,navBox.top);
  loader.style.top=Math.max(0,header.bottom-rect.top+(Math.max(0,bottom-header.bottom)/2))+'px';
 }
 function close(){
  field.blur();search.dataset.v201NavReset='1';search.classList.remove('ww-search-session','ww-search-submitted','search-recents-visible');
  const recent=document.getElementById('findaiSearchRecents');recent?.classList.remove('show','findai-recents-lock','findai-recents-dragging','findai-recents-leaving');
  window.wishwavePauseSearchRequests?.();window.resetPremiumExploreHome?.(false);
  schedule();
 }
 back.addEventListener('click',close);
 field.addEventListener('focus',()=>{delete search.dataset.v201NavReset;search.classList.add('ww-search-session');schedule();});
 field.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.isComposing){event.preventDefault();close();}});
 form.addEventListener('submit',()=>{search.classList.remove('ww-search-session');schedule();});
 // The search field handles Enter before the form's implicit submission on iOS.
 field.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.isComposing&&event.keyCode!==229)search.classList.remove('ww-search-session');},true);
 function sync(){
  frame=0;syncLoading();const viewport=window.visualViewport;
  if(!viewport||(viewport.scale||1)>1.05){search.classList.remove('ww-search-keyboard');clearBacking();return;}
  const focused=!!document.activeElement?.matches('#q,#premiumResultQuery'),bottom=viewport.height+viewport.offsetTop;
  const full=Math.max(innerHeight,document.documentElement.clientHeight,document.querySelector('.app')?.getBoundingClientRect().bottom||0);
  if(!focused&&!search.classList.contains('ww-search-keyboard'))baseline=full;
  baseline=Math.max(baseline,full,bottom);
  const open=['search','searchResults'].includes(document.body.dataset.activeTab)&&baseline-bottom>120&&(focused||search.classList.contains('ww-search-keyboard'));
  search.classList.toggle('ww-search-keyboard',open);
  if(open){backing.style.top=Math.floor(bottom)+'px';backing.style.height=Math.ceil(baseline-bottom)+'px';backing.hidden=false;document.documentElement.classList.add('ww-search-keyboard-canvas');}
  else clearBacking();
  const recent=document.getElementById('findaiSearchRecents');
  if(open&&recent){const height=Math.max(0,bottom-recent.getBoundingClientRect().top);search.style.setProperty('--ww-recents-height',height+'px');}
  else search.style.removeProperty('--ww-recents-height');
 }
 function schedule(){if(!frame)frame=requestAnimationFrame(sync);}
 window.visualViewport?.addEventListener('resize',schedule,{passive:true});
 window.visualViewport?.addEventListener('scroll',schedule,{passive:true});
 window.addEventListener('resize',schedule,{passive:true});
 window.addEventListener('orientationchange',()=>{baseline=0;schedule();},{passive:true});
 document.addEventListener('focusin',event=>{if(event.target.matches?.('#q,#premiumResultQuery'))schedule();});
 document.addEventListener('focusout',schedule);
 new MutationObserver(schedule).observe(search,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
 new MutationObserver(()=>{if(!['search','searchResults'].includes(document.body.dataset.activeTab)){search.classList.remove('ww-search-session','ww-search-submitted','ww-search-keyboard');search.style.removeProperty('--ww-recents-height');clearBacking();}schedule();}).observe(document.body,{attributes:true,attributeFilter:['data-active-tab']});
 window.addEventListener('pagehide',()=>{cancelAnimationFrame(frame);frame=0;baseline=0;loader.hidden=true;search.classList.remove('ww-search-loading-empty');clearBacking();search.classList.remove('ww-search-keyboard');search.style.removeProperty('--ww-recents-height');},{passive:true});
 sync();
})();

