/* Display-only cleanup for retailer photos that contain an embedded phone viewer.
   Never crop ordinary photos or infer product boundaries. Fail open on CORS/errors. */
(function(root){
  'use strict';
  function screenshotPhotoBounds(pixels,width,height){
    const ratio=height/width;
    if(ratio<1.9||ratio>2.5)return null;
    const rows=[];
    for(let y=0;y<height;y++){
      let black=0,white=0;
      for(let x=0;x<width;x++){
        const i=(y*width+x)*4,r=pixels[i],g=pixels[i+1],b=pixels[i+2];
        if(Math.max(r,g,b)<24)black++;
        if(Math.min(r,g,b)>175)white++;
      }
      rows.push({black:black/width,white});
    }
    // A screenshot has two broad, nearly pure black bars with a sharp,
    // full-width transition into a photo. A naturally dark portrait is not enough.
    let top=-1,bottom=-1;
    for(let y=Math.ceil(height*.1);y<height*.35;y++){
      if(rows.slice(y,y+3).every(row=>row.black<.65)) {top=y;break;}
    }
    for(let y=Math.floor(height*.9);y>height*.65;y--){
      if(rows.slice(y-2,y+1).every(row=>row.black<.65)){bottom=y+1;break;}
    }
    if(top<0||bottom<0||bottom-top<height*.4)return null;
    const header=rows.slice(0,top-1),footer=rows.slice(bottom+1);
    if(!header.length||!footer.length)return null;
    if(header.reduce((sum,row)=>sum+row.black,0)/header.length<.94)return null;
    if(footer.some(row=>row.black<.98))return null;
    // Sparse bright phone/viewer controls must exist in the upper bar.
    const marks=header.reduce((sum,row)=>sum+row.white,0);
    const markedRows=header.filter(row=>row.white>=2).length;
    if(marks<width*.04||marks>width*top*.035||markedRows<2)return null;
    // Keep a one-row guard on each edge so no product pixels are trimmed.
    return {top:Math.max(0,top-1),bottom:Math.min(height,bottom+1)};
  }
  if(typeof module==='object'&&module.exports)module.exports={screenshotPhotoBounds};
  if(!root||!root.document)return;
  const cache=new Map();
  function inspect(src){
    return new Promise(resolve=>{
      const probe=new Image();probe.crossOrigin='anonymous';probe.referrerPolicy='no-referrer';
      probe.onerror=()=>resolve(null);
      probe.onload=()=>{
        try{
          const w=96,h=Math.round(probe.naturalHeight*w/probe.naturalWidth);
          if(h<183||h>240){resolve(null);return;}
          const sample=document.createElement('canvas');sample.width=w;sample.height=h;
          const context=sample.getContext('2d',{willReadFrequently:true});context.drawImage(probe,0,0,w,h);
          const bounds=screenshotPhotoBounds(context.getImageData(0,0,w,h).data,w,h);
          if(!bounds){resolve(null);return;}
          const top=Math.floor(bounds.top*probe.naturalHeight/h),bottom=Math.ceil(bounds.bottom*probe.naturalHeight/h);
          const clean=document.createElement('canvas');clean.width=probe.naturalWidth;clean.height=bottom-top;
          clean.getContext('2d').drawImage(probe,0,top,probe.naturalWidth,bottom-top,0,0,clean.width,clean.height);
          resolve(clean.toDataURL('image/jpeg',.94));
        }catch(_){resolve(null);}
      };
      probe.src=src;
    });
  }
  root.wishwaveCleanListingPhoto=function(img){
    if(!img||!img.closest('.wishwave-quality-reel'))return;
    const src=img.currentSrc||img.src;
    try{if(new URL(src).hostname!=='i.ebayimg.com')return;}catch(_){return;}
    if(!cache.has(src)){
      if(cache.size>=12)cache.delete(cache.keys().next().value);
      cache.set(src,inspect(src));
    }
    cache.get(src).then(clean=>{
      // A sleeping gallery, failed-image fallback or recycled card may now use another photo.
      if(!clean||!img.isConnected||img.getAttribute('src')!==src)return;
      img.dataset.photoHygiene='phone-frame-removed';img.src=clean;
    });
  };
})(typeof window==='undefined'?null:window);
