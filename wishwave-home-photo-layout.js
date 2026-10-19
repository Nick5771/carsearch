/* Home-only photo geometry. Never crop, stretch, or reorder a retailer's media. */
(function(root){
 'use strict';
 function immersivePhoto(width,height){return width>=600&&height>=800&&width/height<=.9;}
 if(typeof module==='object'&&module.exports)module.exports={immersivePhoto};
 if(!root?.document)return;
 const home=document.getElementById('discover');if(!home)return;
 let frame=0,dirty=true;const observed=new WeakSet();
 function flag(node,name,on){if(node.classList.contains(name)!==on)node.classList.toggle(name,on);}
 function setSize(node,key,value){if(node.style.getPropertyValue(key)!==value)node.style.setProperty(key,value);}
 function update(){
  frame=0;const header=home.querySelector('.discover-social-topbar'),homeRect=home.getBoundingClientRect();
  if(!homeRect.height||!homeRect.width)return;
  const headerHeight=Math.max(0,Math.ceil((header?.getBoundingClientRect().bottom||homeRect.top)-homeRect.top));
  setSize(home,'--ww-home-photo-header',headerHeight+'px');
  const cards=[...home.querySelectorAll('.reel-card.wishwave-quality-reel')];
  if(dirty){dirty=false;for(const card of cards){
   const stage=card.querySelector('.hero-stage'),slides=stage?.querySelectorAll('.reel-gallery-slide'),index=Number(stage?.dataset.galleryIndex)||0;
   const img=slides?.length?slides[index]?.querySelector('img.hero-image'):stage?.querySelector('img.hero-image');
   flag(card,'ww-home-photo-immersive',!!(img?.complete&&immersivePhoto(img.naturalWidth,img.naturalHeight)));
   const panel=card.querySelector('.product-panel');if(panel){if(!observed.has(panel)){observed.add(panel);resize?.observe(panel);}const height=Math.ceil(panel.getBoundingClientRect().height);if(height>0)setSize(card,'--ww-home-photo-caption',height+'px');}
  }
  }
  // Hit testing chooses the foreground feed, including a contextual Home reel.
  const hit=document.elementFromPoint?.(homeRect.left+homeRect.width*.45,homeRect.top+homeRect.height*.45)?.closest('.reel-card.wishwave-quality-reel');
  let current=hit&&home.contains(hit)?hit:null;
  if(!current){const middle=homeRect.top+homeRect.height*.45;current=cards.find(card=>{const r=card.getBoundingClientRect();return r.width>0&&r.top<=middle&&r.bottom>middle;});}
  flag(home,'ww-home-header-over-photo',!!current?.classList.contains('ww-home-photo-immersive'));
 }
 function schedule(measure=true){if(measure)dirty=true;if(!frame)frame=requestAnimationFrame(update);}
 const resize=typeof ResizeObserver==='function'?new ResizeObserver(schedule):null;
 resize?.observe(home);const header=home.querySelector('.discover-social-topbar');if(header)resize?.observe(header);
 new MutationObserver(schedule).observe(home,{subtree:true,childList:true,attributes:true,attributeFilter:['src','data-gallery-index']});
 home.addEventListener('load',schedule,true);home.addEventListener('error',schedule,true);home.addEventListener('scroll',()=>schedule(false),{capture:true,passive:true});
 root.addEventListener('resize',schedule,{passive:true});root.addEventListener('pageshow',schedule);schedule();
})(typeof window==='undefined'?null:window);
