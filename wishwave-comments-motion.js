/* One owner for comment sheet motion; native scrolling keeps the comment list. */
(function(){
 'use strict';
 const layer=document.getElementById('appMpSheetBg');
 if(!layer)return;
 const panel=()=>layer.querySelector('.app-mp-sheet');
 const visible=()=>layer.classList.contains('show')&&layer.classList.contains('wishwave-comments-mode');
 const version=()=>layer.dataset.motionVersion;
 const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
 let drag=null,settle=null,frame=0,queued=null,locked=false,previousMotion=false,blockClickUntil=0,blockVersion=null;
 function lock(){if(locked)return;locked=true;previousMotion=!!window.__wishwavePageMotion;window.__wishwaveCommentsMotion=true;window.__wishwavePageMotion=true;}
 function unlock(flush=true){
  if(!locked)return;locked=false;window.__wishwaveCommentsMotion=false;window.__wishwavePageMotion=previousMotion;
  const job=queued;queued=null;
  if(flush&&visible()){
   window.wishwaveSyncCommentViewport?.();
   if(job&&job.version===version()&&job.item===wishwaveCommentsItem)render.apply(window,job.args);
  }
 }
 function height(){return panel()?.getBoundingClientRect().height||parseFloat(layer.style.getPropertyValue('--wishwave-comment-sheet-height'))||innerHeight*.64;}
 function paint(y,h,opacity){
  layer.style.setProperty('--wishwave-comments-drag-y',Math.max(0,y)+'px');
  layer.style.setProperty('--wishwave-comments-preview-opacity',String(opacity??clamp(1-y/h,0,1)));
 }
 function opacity(g){return clamp(g.baseOpacity-(g.y-g.baseY)/g.height,0,1);}
 function paintFrame(){frame=0;if(drag?.active)paint(drag.y,drag.height,opacity(drag));}
 function stopSettle(){if(!settle)return;clearTimeout(settle.timer);settle.panel.removeEventListener('transitionend',settle.ended);settle=null;}
 function reset(flush=false){
  cancelAnimationFrame(frame);frame=0;drag=null;stopSettle();
  layer.classList.remove('comments-dragging','comments-snapping','comments-dismissing');
  for(const name of ['--wishwave-comments-drag-y','--wishwave-comments-preview-opacity','--wishwave-comments-duration'])layer.style.removeProperty(name);
  unlock(flush);if(!flush)queued=null;
 }
 function displayedY(el){
  const rect=el.getBoundingClientRect(),bounds=layer.getBoundingClientRect();
  if(rect.height>0&&bounds.height>0)return Math.max(0,rect.bottom-bounds.bottom);
  const transform=getComputedStyle(el).transform;
  if(transform&&transform!=='none'){
   try{return Math.max(0,new DOMMatrixReadOnly(transform).m42);}catch(_){}
   const parts=transform.match(/^matrix(3d)?\((.+)\)$/);
   if(parts){const values=parts[2].split(',').map(Number);return Math.max(0,values[parts[1]?13:5]||0);}
  }
  return parseFloat(layer.style.getPropertyValue('--wishwave-comments-drag-y'))||0;
 }
 function finish(cancelled){
  const g=drag;drag=null;cancelAnimationFrame(frame);frame=0;
  if(!g?.active)return false;
  const el=panel();if(!el||!visible()||g.version!==version()){reset();return true;}
  paint(g.y,g.height,opacity(g));void el.offsetWidth;
  const velocity=performance.now()-g.lastT<90?g.velocity:0;
  const projected=g.y+velocity*160;
  const dismiss=!cancelled&&g.y>24&&projected>Math.min(160,g.height*.3);
  const destination=dismiss?Math.max(g.height+24,g.y+24):0;
  const distance=Math.abs(destination-g.y);
  const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const duration=reduced?1:Math.round(dismiss?clamp(distance/Math.max(.9,velocity)+90,180,340):clamp(220+distance*.25,240,340));
  layer.style.setProperty('--wishwave-comments-duration',duration+'ms');
  layer.classList.remove('comments-dragging');layer.classList.add(dismiss?'comments-dismissing':'comments-snapping');
  const state={panel:el,version:g.version,timer:0,ended:null};settle=state;
  const complete=()=>{
   if(settle!==state)return;
   stopSettle();
   if(state.version!==version()||!visible()){reset();return;}
   if(dismiss){reset(false);if(!window.__wishwaveCompleteSheetDismiss?.())window.closeAppMpSheet();}
   else reset(true);
  };
  state.ended=e=>{if(e.target===el&&e.propertyName==='transform')complete();};
  el.addEventListener('transitionend',state.ended);state.timer=setTimeout(complete,duration+45);
  paint(destination,g.height,dismiss?0:1);blockClickUntil=Date.now()+400;blockVersion=version();
  return true;
 }
 window.__wishwaveCommentsTouch=function(type,event){
  if(type==='touchstart'){
   if(!visible()||!panel()?.contains(event.target)||event.touches.length!==1)return false;
   if(event.target.closest('input,textarea,button,a,select,[contenteditable],.wishwave-comment-composer,.wishwave-comment-form,.wishwave-comment-reactions'))return false;
   const el=panel(),t=event.touches[0],h=height(),list=el.querySelector('.wishwave-comments-list');
   let y=0,active=false,baseOpacity=1;
   if(settle||layer.classList.contains('wishwave-sheet-entering')){
    // Sample the composited position once, then freeze it before cancelling.
    y=displayedY(el);const preview=layer.querySelector('.wishwave-comment-listing-preview');
    const sampledOpacity=preview?Number(getComputedStyle(preview).opacity):clamp(1-y/h,0,1);
    baseOpacity=Number.isFinite(sampledOpacity)?sampledOpacity:clamp(1-y/h,0,1);
    stopSettle();layer.classList.add('comments-dragging');layer.classList.remove('comments-snapping','comments-dismissing');
    paint(y,h,baseOpacity);void el.offsetWidth;active=true;lock();
   }
   layer.classList.remove('wishwave-sheet-entering');
   drag={x:t.clientX,startY:t.clientY,baseY:y,baseOpacity,y,height:h,lastY:t.clientY,lastT:performance.now(),velocity:0,active,version:version(),list,fromHead:!!event.target.closest('.app-mp-sheet-head')};
   return active;
  }
  if(!drag)return false;
  if(!visible()||drag.version!==version()){reset();return false;}
  if(type==='touchmove'){
   if(event.touches.length!==1)return finish(true);
   const t=event.touches[0],dx=t.clientX-drag.x,dy=t.clientY-drag.startY;
   if(!drag.active){
    if(!drag.fromHead&&((drag.list?.scrollTop||0)>1||(document.getElementById('appMpSheetBody')?.scrollTop||0)>1)){
     drag.startY=t.clientY;drag.x=t.clientX;drag.lastY=t.clientY;drag.lastT=performance.now();return false;
    }
    if(Math.max(Math.abs(dx),Math.abs(dy))<5)return false;
    if(dy<0||Math.abs(dx)>Math.abs(dy)){drag=null;return false;}
    drag.active=true;lock();layer.classList.add('comments-dragging');
   }
   if(event.cancelable)event.preventDefault();
   const now=performance.now(),dt=Math.max(8,now-drag.lastT);
   const speed=(t.clientY-drag.lastY)/dt;
   drag.velocity=dt>90?speed:drag.velocity*.35+speed*.65;
   drag.lastT=now;drag.lastY=t.clientY;drag.y=Math.max(0,drag.baseY+dy);
   if(!frame)frame=requestAnimationFrame(paintFrame);return true;
  }
  if(type==='touchend'||type==='touchcancel')return finish(type==='touchcancel');
  return false;
 };
 // Preserve fresh server data without replacing rows underneath an active drag.
 const render=window.renderWishWaveComments;
 window.renderWishWaveComments=function(...args){
  if(locked&&visible()){queued={args,version:version(),item:wishwaveCommentsItem};return;}
  return render.apply(this,args);
 };
 const open=window.openAppMpSheet,close=window.closeAppMpSheet;
 window.openAppMpSheet=function(){reset();return open.apply(this,arguments);};
 window.closeAppMpSheet=function(){reset();return close.apply(this,arguments);};
 new MutationObserver(()=>{if((drag||settle||locked)&&(!visible()||(drag||settle)?.version!==version()))reset();}).observe(layer,{attributes:true,attributeFilter:['class','data-motion-version']});
 window.addEventListener('pagehide',()=>reset());
 window.addEventListener('resize',()=>{if(drag?.active)finish(true);},{passive:true});
 window.addEventListener('click',e=>{if(Date.now()<blockClickUntil&&blockVersion===version()&&layer.contains(e.target)){e.preventDefault();e.stopImmediatePropagation();}},true);
})();
