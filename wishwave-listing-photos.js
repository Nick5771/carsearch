/* Hydrate real seller photos on visible reels without replacing the cover node. */
(function(){
 'use strict';
 const checked=new WeakSet(),watching=new WeakSet(),visible=new Set(),timers=new WeakMap();let active=0,requests=0,windowStart=Date.now();
 function budgetWait(){if(Date.now()-windowStart>=60000){windowStart=Date.now();requests=0;}return requests>=24?60000-(Date.now()-windowStart):0;}
 const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 function busy(stage){return window.__wishwavePageMotion||document.body.classList.contains('findai-premium-gallery-dragging')||window.__wishwaveGalleryInFlight?.(stage);}
 async function hydrate(stage){
  const card=stage?.closest('.reel-card'),source=card?.dataset.gallerySource;
  let id=card?.dataset.galleryItemId||'';if(source==='etsy')id=id.replace(/^etsy-/,'');
  if(!card||!stage.isConnected||checked.has(stage)||!['ebay','etsy'].includes(source)||!id||JSON.parse(stage.dataset.galleryImages||'[]').length!==1||budgetWait()>0)return;
  if(active||busy(stage))return;
  checked.add(stage);active++;requests++;
  try{
   const originalId=card.dataset.galleryItemId;
   const url=new URL('/recommendations/listing-images',WORKER_BASE);url.search=new URLSearchParams({source,id,country:appShoppingRegion()}).toString();
   const response=await fetch(url.toString());if(!response.ok)return;const data=await response.json();
   if(data.source!==source||data.itemId!==id||!Array.isArray(data.images))return;
   while(stage.isConnected&&busy(stage))await delay(80);
   if(!stage.isConnected||card.dataset.galleryItemId!==originalId)return;
   const existing=JSON.parse(stage.dataset.galleryImages||'[]'),images=[],keys=new Set();
   for(const raw of [...existing,...data.images]){const safe=safeUrl(raw);if(!safe)continue;const src=enhanceImageUrl(safe)||safe,key=reelGalleryImageKey(src);if(!keys.has(key)){keys.add(key);images.push(src);}if(images.length===6)break;}
   if(images.length<2)return;
   const track=stage.querySelector('.reel-gallery-track');if(!track)return;
   for(let i=existing.length;i<images.length;i++){
    const slide=document.createElement('div');slide.className='reel-gallery-slide';slide.dataset.gallerySlide=String(i);
    const img=document.createElement('img');img.className='hero-image fit-contain reel-gallery-image';img.dataset.src=images[i];img.alt=card.getAttribute('aria-label')||'Listing photo';img.loading='lazy';img.decoding='async';img.referrerPolicy='no-referrer';img.onload=()=>adaptListingImage(img);img.onerror=()=>imageFailed(img);slide.appendChild(img);track.appendChild(slide);
   }
   stage.dataset.galleryImages=JSON.stringify(images);card.dataset.hasGallery='1';
   if(!stage.querySelector('.reel-gallery-dots'))stage.insertAdjacentHTML('beforeend',reelGalleryDotsMarkup(images));
   for(const item of currentFeedItems)if(String(item.itemId||'')===card.dataset.galleryItemId&&getSource(item)===source)item.images=images;
   window.wishwaveWarmReelPhotos?.(stage,Number(stage.dataset.galleryIndex)||0);
  }catch(_){}finally{active--;}
 }
 window.wishwaveHydrateListingPhotos=hydrate;
 function schedule(stage){if(timers.has(stage)||checked.has(stage)||JSON.parse(stage.dataset.galleryImages||'[]').length!==1)return;timers.set(stage,setTimeout(async()=>{timers.delete(stage);if(!stage.isConnected||!visible.has(stage))return;await hydrate(stage);if(!checked.has(stage)&&['ebay','etsy'].includes(stage.closest('.reel-card')?.dataset.gallerySource))schedule(stage);},Math.max(350,budgetWait())));}
 const observer=new IntersectionObserver(entries=>{for(const entry of entries){const stage=entry.target;if(entry.isIntersecting&&entry.intersectionRatio>=.6){visible.add(stage);schedule(stage);}else visible.delete(stage);}},{threshold:[.6]});
 function bind(root){const stages=[...(root.matches?.('.reel-gallery-stage')?[root]:[]),...root.querySelectorAll('.reel-gallery-stage')];for(const stage of stages)if(!watching.has(stage)){watching.add(stage);observer.observe(stage);}}
 bind(document);
 new MutationObserver(records=>{for(const record of records){for(const node of record.addedNodes)if(node.nodeType===1)bind(node);for(const node of record.removedNodes)if(node.nodeType===1&&!node.isConnected)for(const stage of [...(node.matches('.reel-gallery-stage')?[node]:[]),...node.querySelectorAll('.reel-gallery-stage')]){observer.unobserve(stage);watching.delete(stage);visible.delete(stage);clearTimeout(timers.get(stage));timers.delete(stage);}}}).observe(document.body,{childList:true,subtree:true});
})();
