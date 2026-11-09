/* Shared motion for controls and panels that have no gesture/transition owner. */
(function(){
 'use strict';
 const duration=280,easing='cubic-bezier(.22,.8,.22,1)',running=new WeakMap();
 const reduced=()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
 function cancel(node){const previous=running.get(node);if(!previous)return;running.delete(node);previous.animation.cancel();previous.finish(false);}
 function animate(node,frames,complete){
  cancel(node);if(!node||reduced()||typeof node.animate!=='function'){complete?.();return Promise.resolve(true);}
  return new Promise(resolve=>{let done=false;const animation=node.animate(frames,{duration,easing});const finish=ok=>{if(done)return;done=true;if(running.get(node)?.animation===animation)running.delete(node);if(ok)complete?.();resolve(ok);};running.set(node,{animation,finish});animation.finished.then(()=>finish(true),()=>finish(false));});
 }
 window.wishwaveMotion={duration,easing,cancel,
  enter:(node,kind='panel')=>{if(node)node.inert=false;return animate(node,[{opacity:0,translate:kind==='sheet'?'0 32px':'20px 0'},{opacity:1,translate:'0 0'}]);},
  leave:(node,complete,kind='panel')=>{if(node)node.inert=true;return animate(node,[{opacity:1,translate:'0 0'},{opacity:0,translate:kind==='sheet'?'0 32px':'20px 0'}],()=>{if(node)node.inert=false;complete?.();}).then(ok=>{if(!ok&&node&&!running.has(node))node.inert=false;return ok;});}
 };
 const selector='#wwCheckout,#wwOffer,#appMpProduct,#searchDetailOverlay,#findaiContextualReelV168,#createListingScreen,#wishwavePublicProfilePage,#wishwaveConnectionsPage,#wwDashboard,#wwPromotion,#wwSearchFilterOverlay>section,#wwDiscoveryPreferences,#wwHomeFilters,#appThemeOverlay .app-theme-sheet,#loginOverlay .auth-card,#appMpSheetBg>.app-mp-sheet';
 const shown=new WeakMap();let queued=new Set(),frame=0;
 function inspect(node,initial=false){
  if(!node.isConnected)return;const visible=node.getClientRects().length>0&&getComputedStyle(node).visibility!=='hidden',before=shown.get(node)||false;shown.set(node,visible);
  if(initial||!visible||before||running.has(node)||window.__wishwavePageMotion||window.__wishwaveCommentsMotion||node.closest('.wishwave-comments-mode,.findai-v132-swipe-surface,.wishwave-page-return-drag'))return;
  const css=getComputedStyle(node),hasMotion=value=>String(value).split(',').some(v=>parseFloat(v)>0);
  if(hasMotion(css.animationDuration)||hasMotion(css.transitionDuration)||node.getAnimations?.().some(a=>a.playState==='running'))return;
  window.wishwaveMotion.enter(node,node.matches('dialog,#wwSearchFilterOverlay>section,.app-mp-sheet,.app-theme-sheet')?'sheet':'panel');
 }
 function collect(node){if(node.nodeType!==1)return;if(node.matches(selector))queued.add(node);node.querySelectorAll(selector).forEach(n=>queued.add(n));if(!frame)frame=requestAnimationFrame(()=>{frame=0;const nodes=queued;queued=new Set();for(const n of nodes)inspect(n);});}
 document.querySelectorAll(selector).forEach(n=>inspect(n,true));
 new MutationObserver(records=>{for(const record of records){if(record.type==='attributes')collect(record.target);else for(const node of record.addedNodes)collect(node);}}).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','hidden','open']});
})();
