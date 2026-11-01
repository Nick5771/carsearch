/* Preserve the visible reel DOM while the main tab surfaces are moving. */
(function(){
 'use strict';
 let queued=[];
 const owner=()=>String(marketplaceSession()||'guest');
 for(const name of ['renderPersonalisedFeed','appendFeedItems']){
  const render=window[name];if(typeof render!=='function')continue;
  window[name]=function(...args){
   if(window.__wishwavePageMotion&&!window.__wishwaveNavigationHandoff&&document.querySelector('.findai-v132-swipe-surface')){
    if(name==='renderPersonalisedFeed')queued=[];
    queued.push({render,args,state:feedState,account:owner()});return;
   }
   return render.apply(this,args);
  };
 }
 window.__wishwaveFlushHomeRender=function(){
  if(window.__wishwavePageMotion)return;
  const jobs=queued;queued=[];
  for(const job of jobs)if(job.state===feedState&&job.account===owner())job.render.apply(window,job.args);
 };
 document.addEventListener('wishwave-recommendation-account-change',()=>{queued=[];});
})();
