/* Measure only this listing's gallery. Bounded work, no crop and no borrowed photos. */
(function(root){
 'use strict';
 function candidateScore(width,height){
  if(!(width>0&&height>0))return null;
  const clear=width>=600&&height>=800,ratio=width/height;
  const resolution=Math.min(width*height,16000000);
  // Adequate resolution first; then tall framing, capped at a phone-shaped ratio.
  if(clear&&ratio<=.9)return 1e12+Math.min(height/width,16/9)*1e8+resolution;
  if(Math.min(width,height)>=600)return 1e9+resolution;
  return Math.min(resolution,999999);
 }
 if(typeof module==='object'&&module.exports)module.exports={candidateScore};
 if(!root?.document)return;
 const dimensions=new Map(),pending=new Map(),prepared=new WeakMap();let active=0;
 const key=url=>{try{return reelGalleryImageKey(url);}catch(_){return String(url);}};
 function remember(url,width,height){if(!(width>0&&height>0))return;const id=key(url),old=dimensions.get(id);if(!old||width*height>old.width*old.height){dimensions.delete(id);dimensions.set(id,{width,height});}if(dimensions.size>256)dimensions.delete(dimensions.keys().next().value);}
 async function measure(url,deadline){
  const id=key(url);if(dimensions.has(id))return Promise.resolve(dimensions.get(id));if(pending.has(id))return pending.get(id);
  while(active>=3&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
  if(dimensions.has(id))return dimensions.get(id);if(pending.has(id))return pending.get(id);
  if(Date.now()>=deadline)return null;
  active++;const request=new Promise(resolve=>{const img=new Image();let done=false;const finish=ok=>{if(done)return;done=true;clearTimeout(timer);if(ok)remember(url,img.naturalWidth,img.naturalHeight);img.onload=img.onerror=null;img.removeAttribute('src');resolve(dimensions.get(id)||null);};const timer=setTimeout(()=>finish(false),Math.max(1,Math.min(900,deadline-Date.now())));img.referrerPolicy='no-referrer';img.decoding='async';img.onload=()=>finish(true);img.onerror=()=>finish(false);img.src=url;}).finally(()=>{active--;pending.delete(id);});pending.set(id,request);return request;
 }
 root.wishwavePhotoCandidateScore=function(candidate){const size=dimensions.get(key(candidate.url))||candidate;return candidateScore(Number(size.width),Number(size.height));};
 root.wishwavePreparePortrait=function(item){
  if(!item||typeof item!=='object')return Promise.resolve();if(prepared.has(item))return prepared.get(item);
  const request=(async()=>{
   const seen=new Set(),candidates=collectImageCandidates(item,false).filter(c=>{const id=key(c.url);if(seen.has(id))return false;seen.add(id);return true;}).slice(0,6);
   if(candidates.length<2)return;
   // Existing dimensions need no download; inspect the other gallery candidates too.
   for(const c of candidates)if(c.width&&c.height)remember(c.url,c.width,c.height);
   const deadline=Date.now()+900;
   for(let offset=0;offset<candidates.length&&Date.now()<deadline;offset+=3){
    await Promise.all(candidates.slice(offset,offset+3).map(c=>measure(enhanceImageUrl(c.url)||c.url,deadline)));
   }
  })().catch(()=>{});prepared.set(item,request);return request;
 };
 // Cached feeds and galleries hydrated later use the same selection ahead of viewing.
 // A card already seen or touched is never reordered underneath the user.
 const home=document.getElementById('discover'),seenCards=new WeakSet(),nearCards=new WeakSet(),signatures=new WeakMap();
 if(home&&typeof IntersectionObserver==='function'){
  const seenObserver=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting)seenCards.add(e.target);}),{threshold:.05});
  const nearObserver=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){nearCards.add(e.target);prepareCard(e.target);}else nearCards.delete(e.target);}),{rootMargin:'120% 0px',threshold:0});
  const observed=new WeakSet();
  async function prepareCard(card){
   const stage=card.querySelector('.reel-gallery-stage'),track=stage?.querySelector('.reel-gallery-track');if(!track)return;
   const slides=[...track.querySelectorAll('.reel-gallery-slide')],urls=slides.map(s=>{const img=s.querySelector('img');return img?.getAttribute('src')||img?.dataset.src||'';});
   if(urls.length<2||urls.some(u=>!u))return;const signature=urls.join('|');if(signatures.get(stage)===signature)return;signatures.set(stage,signature);
   await root.wishwavePreparePortrait({images:urls.map(url=>({url}))});
   if(!card.isConnected||seenCards.has(card)||Number(stage.dataset.galleryIndex)!==0)return;
   const rect=card.getBoundingClientRect(),bounds=home.getBoundingClientRect();if(rect.bottom>bounds.top&&rect.top<bounds.bottom)return;
   if(slides.some((s,i)=>{const img=s.querySelector('img');return !s.isConnected||(img?.getAttribute('src')||img?.dataset.src||'')!==urls[i];}))return;
   let best=0;for(let i=1;i<urls.length;i++)if((root.wishwavePhotoCandidateScore({url:urls[i]})||0)>(root.wishwavePhotoCandidateScore({url:urls[best]})||0))best=i;
   if(!best)return;
   const ordered=[slides[best],...slides.filter((_,i)=>i!==best)],orderedUrls=[urls[best],...urls.filter((_,i)=>i!==best)];
   track.prepend(slides[best]);ordered.forEach((slide,i)=>slide.dataset.gallerySlide=String(i));stage.dataset.galleryImages=JSON.stringify(orderedUrls);signatures.set(stage,orderedUrls.join('|'));stage.style.removeProperty('--wishwave-ready-photo');root.wishwaveWarmReelPhotos?.(stage,0);
  }
  function bind(){home.querySelectorAll('.reel-card.wishwave-quality-reel').forEach(card=>{if(!observed.has(card)){observed.add(card);seenObserver.observe(card);nearObserver.observe(card);}else if(nearCards.has(card)&&!seenCards.has(card))prepareCard(card);});}
  new MutationObserver(bind).observe(home,{childList:true,subtree:true,attributes:true,attributeFilter:['data-gallery-images']});
  home.addEventListener('pointerdown',e=>{const card=e.target.closest?.('.reel-card');if(card)seenCards.add(card);},true);bind();
 }
 // Loaded photos also supply dimensions without another request.
 document.addEventListener('load',event=>{const img=event.target;if(img?.matches?.('img.hero-image'))remember(img.currentSrc||img.src,img.naturalWidth,img.naturalHeight);},true);
})(typeof window==='undefined'?null:window);
