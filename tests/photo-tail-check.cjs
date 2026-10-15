const fs=require('fs'),vm=require('vm'),assert=require('assert'),{JSDOM}=require('jsdom');
const html=fs.readFileSync(__dirname+'/../findai-app.html','utf8');
const fn=html.slice(html.indexOf('function wishwaveUpdateCaptionFade('),html.indexOf('function adaptListingImage('));
const dom=new JSDOM('<div id="discover"><article class="reel-card"><div class="hero-stage"><div class="reel-gallery-slide"><img class="hero-image" src="https://i.ebayimg.com/one.jpg"></div><div class="reel-gallery-dots"><i class="active"></i></div></div><div class="product-panel"></div></article></div>',{runScripts:'outside-only'});
const w=dom.window,d=w.document;w.eval(fn);
const image=d.querySelector('img'),slide=d.querySelector('.reel-gallery-slide');
let nw=1600,nh=1600,width=520,height=936;
Object.defineProperties(image,{naturalWidth:{get:()=>nw},naturalHeight:{get:()=>nh}});
image.getBoundingClientRect=()=>({top:0,left:0,width,height});
assert(!html.includes('transform:scaleY(-1);filter:blur('),'no mirrored image effect');
const initialSrc=image.src,initialStyle=image.getAttribute('style'),dots=d.querySelector('.reel-gallery-dots').outerHTML;
for(const shape of [[1600,1600],[1600,900],[900,1600]]){
 [nw,nh]=shape;w.wishwaveUpdateCaptionFade(image);
 const tail=slide.querySelector('.wishwave-photo-tail');assert(tail);
 const bottom=(height+Math.min(height,width*nh/nw))/2;
 assert.equal(parseFloat(tail.style.top),bottom,'extension starts exactly after the contained photo');
 assert(parseFloat(tail.style.height)<=96);assert(parseFloat(tail.style.top)+parseFloat(tail.style.height)<=height+.001);
 const size=tail.firstElementChild.style.backgroundSize.split(' ').map(parseFloat);
 assert(size[1]>=Math.min(height,width*nh/nw)*32,'use only an edge-colour strip, never a full product reflection');
 assert.equal(image.src,initialSrc);assert.equal(image.getAttribute('style'),initialStyle,'original photo must remain untouched');
 assert.equal(d.querySelector('.reel-gallery-dots').outerHTML,dots,'pagination must remain intact');
 w.wishwaveUpdateCaptionFade(image);assert.equal(slide.querySelectorAll('.wishwave-photo-tail').length,1);
}
image.src='https://i.ebayimg.com/two.jpg';w.wishwaveUpdateCaptionFade(image);assert(slide.querySelector('.wishwave-photo-tail-texture').style.backgroundImage.includes('two.jpg'),'fallback source replaces edge-colour source');
nh=2400;nw=900;w.wishwaveUpdateCaptionFade(image);assert.equal(slide.querySelector('.wishwave-photo-tail'),null,'full-height photos need no extension');
width=0;w.wishwaveUpdateCaptionFade(image);assert.equal(slide.querySelector('.wishwave-photo-tail'),null,'hidden galleries do not allocate textures');
assert(html.includes("querySelector('.wishwave-photo-tail')?.remove();img.removeAttribute('src')"),'sleeping galleries release edge-colour source references');
console.log('PASS: below-photo transition for square/landscape/portrait, full-height/hidden safety, intact photo/dots, bounded texture, source replacement and gallery release');w.close();
