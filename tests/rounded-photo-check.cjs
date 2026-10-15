const fs=require('fs'),assert=require('assert'),{JSDOM}=require('jsdom');
const html=fs.readFileSync(__dirname+'/../findai-app.html','utf8');
const dom=new JSDOM('<section id="discover"><article class="reel-card"><div class="hero-stage" data-gallery-index="0"><div class="reel-gallery-slide" data-gallery-slide="0"><img src="https://i.ebayimg.com/photo.jpg"></div><div class="reel-gallery-slide" data-gallery-slide="1"><img src="https://i.ebayimg.com/next.jpg"></div></div></article></section>',{runScripts:'outside-only'});
const w=dom.window,d=w.document;w.eval(html.slice(html.indexOf('function wishwavePlaceRoundedPhoto('),html.indexOf('function adaptListingImage(')));
const img=d.querySelector('img'),stage=d.querySelector('.hero-stage');let nw=1600,nh=1600,width=520,height=590;
Object.defineProperties(img,{naturalWidth:{get:()=>nw},naturalHeight:{get:()=>nh}});img.getBoundingClientRect=()=>({width,height});
for(const size of [[1600,1600],[1600,900],[900,1600]]){
 [nw,nh]=size;const src=img.src;w.wishwavePlaceRoundedPhoto(img);
 const scale=Math.min(width/nw,height/nh),y=(height-nh*scale)/2,x=(width-nw*scale)/2;
 assert.equal(img.style.clipPath,`inset(${y}px ${x}px round 16px)`,'round only the actual photo bounds, preserving the whole image');
 const bottom=parseFloat(stage.style.getPropertyValue('--wishwave-photo-dots-bottom'));
 assert.equal(bottom,y+12,'dots sit inside the actual photo, not in letterbox space');assert.equal(img.src,src);
}
const before=stage.style.cssText;stage.dataset.galleryIndex='1';w.wishwavePlaceRoundedPhoto(img);assert.equal(stage.style.cssText,before,'inactive slides cannot reposition active pagination');
width=0;const clip=img.style.clipPath;w.wishwavePlaceRoundedPhoto(img);assert.equal(img.style.clipPath,clip,'hidden galleries keep their geometry');
assert(!html.includes('wishwave-photo-tail'),'no reflected or generated image extension');
console.log('PASS: square/landscape/portrait rounded photo bounds, dots inside photo, unchanged source and inactive/hidden gallery safety');w.close();
