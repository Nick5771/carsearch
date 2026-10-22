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
 let frame=0,baseline=0;
 function close(){
  field.blur();search.dataset.v201NavReset='1';search.classList.remove('ww-search-session','search-recents-visible');
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
  frame=0;const viewport=window.visualViewport;
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
 new MutationObserver(()=>{if(!['search','searchResults'].includes(document.body.dataset.activeTab)){search.classList.remove('ww-search-session','ww-search-keyboard');search.style.removeProperty('--ww-recents-height');clearBacking();}schedule();}).observe(document.body,{attributes:true,attributeFilter:['data-active-tab']});
 window.addEventListener('pagehide',()=>{cancelAnimationFrame(frame);frame=0;baseline=0;clearBacking();search.classList.remove('ww-search-keyboard');search.style.removeProperty('--ww-recents-height');},{passive:true});
 sync();
})();
