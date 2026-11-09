/* Leave navigation reachable while giving vertically browsed listings more room. */
(function(){
 'use strict';
 const nav=document.getElementById('wishwaveMainNav');if(!nav)return;
 const scrollers='#personalFeed,#search .premium-search-home-scroll,#search .premium-search-scroll,#searchResults .premium-results-scroll,#searchDetailFeed';
 const overlays=new Set(['wishwavePublicProfilePage','appMpInbox','appMpSheetBg','loginOverlay','appThemeOverlay','createListingScreen','wwCheckout','wwOffer','wwDashboard']);
 let positions=new WeakMap(),direction=0,distance=0,compact=false,pausedUntil=0,resetFrame=0;
 function browsing(){
  const tab=document.body.dataset.activeTab;
  if(!['discover','search','searchResults'].includes(tab)||document.body.classList.contains('keyboard-open'))return false;
  if(document.querySelector('#wishwavePublicProfilePage.show,#appMpInbox.show:not(.ww-inbox-docked),#appMpSheetBg.show,#loginOverlay.show,#appThemeOverlay.show,#createListingScreen.show,#wwCheckout.show,#wwOffer.show,#wwDashboard:not([hidden])'))return false;
  return true;
 }
 function setCompact(value,immediate=false){
  if(compact===value)return;compact=value;
  if(immediate){cancelAnimationFrame(resetFrame);nav.style.setProperty('--ww-nav-compact-motion','0ms');resetFrame=requestAnimationFrame(()=>{resetFrame=0;nav.style.removeProperty('--ww-nav-compact-motion');});}
  nav.classList.toggle('ww-nav-compact',compact);
 }
 function reset(immediate=false){direction=0;distance=0;positions=new WeakMap();pausedUntil=performance.now()+300;setCompact(false,immediate);}
 document.addEventListener('scroll',event=>{
  const root=event.target;if(!root.matches?.(scrollers))return;
  if(root.id==='searchDetailFeed'&&root.closest('#searchDetailOverlay')?.dataset.reelOwner!=='search')return;
  const top=Math.max(0,root.scrollTop||0),previous=positions.get(root)||0;positions.set(root,top);
  if(!browsing()){setCompact(false);return;}
  if(window.__wishwavePageMotion||window.__wishwaveTabSettling||document.body.classList.contains('wishwave-photo-zooming')||performance.now()<pausedUntil)return;
  if(top<=8){direction=0;distance=0;setCompact(false);return;}
  const delta=top-previous;if(Math.abs(delta)<1)return;
  const next=delta>0?1:-1;if(next!==direction){direction=next;distance=0;}distance+=Math.abs(delta);
  if(direction>0&&distance>=28)setCompact(true);
  if(direction<0&&distance>=12)setCompact(false);
 },{capture:true,passive:true});
 // Expand before the tab indicator measures slots for a press or horizontal drag.
 for(const name of ['wishwaveNavPress','wishwaveNavSwipeProgress']){
  const before=window[name];if(typeof before==='function')window[name]=function(){reset(true);return before.apply(this,arguments);};
 }
 nav.addEventListener('pointerdown',()=>reset(true),{passive:true});
 new MutationObserver(records=>{
  if(records.some(r=>r.attributeName==='data-active-tab')||!browsing())reset();
 }).observe(document.body,{attributes:true,attributeFilter:['data-active-tab','class']});
 const app=document.querySelector('.app');if(app)new MutationObserver(records=>{
  if(records.some(r=>overlays.has(r.target.id)||Array.from(r.addedNodes||[]).some(node=>overlays.has(node.id)))&&!browsing())reset();
 }).observe(app,{subtree:true,childList:true,attributes:true,attributeFilter:['class','hidden']});
 window.addEventListener('pagehide',()=>reset(true));
 document.addEventListener('visibilitychange',()=>{if(document.hidden)reset(true);});
 window.addEventListener('resize',()=>reset(true),{passive:true});
})();
