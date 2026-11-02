/* Fit the complete title inside its original box; surrounding reel content never moves. */
(function(){
 const saved=new WeakMap();
 function fit(button,height){
  const text=button.firstElementChild;if(!text)return;
  const available=Math.max(1,height-2);
  function fits(size){
   button.style.setProperty('font-size',size+'px','important');
   button.style.setProperty('line-height','1.2','important');
   return text.scrollHeight<=available&&text.scrollWidth<=button.clientWidth+1;
  }
  let low=4,high=14;
  if(fits(high))return;
  for(let i=0;i<10;i++){const middle=(low+high)/2;if(fits(middle))low=middle;else high=middle;}
  fits(Math.floor(low*100)/100);
 }
 window.wishwaveToggleReelTitle=function(button,event){
  event?.preventDefault();event?.stopPropagation();
  const title=button.closest('.title');if(!title)return;
  if(button.getAttribute('aria-expanded')==='true'){
   const old=saved.get(button);
   if(old){title.style.cssText=old.title;button.style.cssText=old.button;saved.delete(button);}
   button.setAttribute('aria-expanded','false');title.classList.remove('ww-title-fitted');return;
  }
  const height=title.getBoundingClientRect().height;
  if(!height)return;
  saved.set(button,{title:title.style.cssText,button:button.style.cssText,height});
  title.style.setProperty('height',height+'px','important');
  title.style.setProperty('min-height',height+'px','important');
  title.style.setProperty('max-height',height+'px','important');
  title.classList.add('ww-title-fitted');button.setAttribute('aria-expanded','true');
  fit(button,height);
 };
 window.addEventListener('resize',()=>{
  document.querySelectorAll('.ww-title-fitted .ww-reel-title-toggle').forEach(button=>{
   const old=saved.get(button);if(old)fit(button,old.height);
  });
 });
})();