/* Tap a reel title to read it in place, without moving the photo. */
(function(){
 const saved=new WeakMap();
 window.wishwaveToggleReelTitle=function(button,event){
  event?.preventDefault();event?.stopPropagation();
  const title=button.closest('.title'),panel=button.closest('.product-panel');
  if(!title||!panel)return;
  if(button.getAttribute('aria-expanded')==='true'){
   const old=saved.get(panel);if(old){panel.style.cssText=old.panel;title.style.cssText=old.title;saved.delete(panel);}
   button.setAttribute('aria-expanded','false');panel.classList.remove('ww-title-expanded');
   return;
  }
  const rect=panel.getBoundingClientRect(),titleRect=title.getBoundingClientRect();
  const price=panel.querySelector('.price-action-row');
  const tail=price?price.getBoundingClientRect().bottom-titleRect.bottom:0;
  const nav=document.getElementById('wishwaveMainNav');
  const navRect=nav?.getBoundingClientRect();
  const bottom=navRect&&navRect.height>0?navRect.top:window.innerHeight-72;
  const room=Math.max(36,Math.floor(bottom-titleRect.top-tail-10));
  saved.set(panel,{panel:panel.style.cssText,title:title.style.cssText});
  // Hold the original panel box so expansion flows down and photo fitting stays stable.
  panel.style.setProperty('height',rect.height+'px','important');
  panel.style.setProperty('box-sizing','border-box','important');
  panel.style.setProperty('overflow','visible','important');
  title.style.setProperty('max-height',room+'px','important');
  button.setAttribute('aria-expanded','true');panel.classList.add('ww-title-expanded');
 };
})();