/* Reveal the full reel title downwards, without changing its text or the photo. */
(function(){
 const saved=new WeakMap();
 window.wishwaveToggleReelTitle=function(button,event){
  event?.preventDefault();event?.stopPropagation();
  const title=button.closest('.title'),panel=button.closest('.product-panel');
  if(!title||!panel)return;
  if(button.getAttribute('aria-expanded')==='true'){
   const old=saved.get(panel);
   if(old){panel.style.cssText=old.panel;title.style.cssText=old.title;saved.delete(panel);}
   button.setAttribute('aria-expanded','false');panel.classList.remove('ww-title-expanded');
   panel.scrollTop=0;return;
  }
  const rect=panel.getBoundingClientRect(),top=panel.offsetTop;
  const nav=document.getElementById('wishwaveMainNav'),navRect=nav?.getBoundingClientRect();
  const bottom=navRect&&navRect.height>0?navRect.top:window.innerHeight-72;
  saved.set(panel,{panel:panel.style.cssText,title:title.style.cssText});
  // Anchor the caption's top, rather than limiting the title to the old two-line space.
  panel.style.setProperty('top',top+'px','important');
  panel.style.setProperty('bottom','auto','important');
  panel.style.setProperty('height','auto','important');
  panel.style.setProperty('max-height',Math.max(80,bottom-rect.top-6)+'px','important');
  panel.style.setProperty('min-height','0','important');
  panel.style.setProperty('padding-bottom','6px','important');
  panel.style.setProperty('box-sizing','border-box','important');
  panel.style.setProperty('overflow-y','auto','important');
  panel.style.setProperty('overflow-x','hidden','important');
  title.style.setProperty('height','auto','important');
  title.style.setProperty('min-height','0','important');
  title.style.setProperty('max-height','none','important');
  button.setAttribute('aria-expanded','true');panel.classList.add('ww-title-expanded');
 };
})();