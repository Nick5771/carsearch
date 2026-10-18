const fs=require('node:fs'),assert=require('node:assert/strict'),{JSDOM,VirtualConsole}=require('jsdom');
const source=process.env.WISHWAVE_TEST_HTML?fs.readFileSync(process.env.WISHWAVE_TEST_HTML,'utf8'):fs.readFileSync(__dirname+'/../findai-app.html','utf8');
const dom=new JSDOM(source.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,''),{url:'https://test/?country=US',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:new VirtualConsole(),beforeParse(w){w.matchMedia=()=>({matches:false,addEventListener(){},addListener(){}});w.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};w.ResizeObserver=class{observe(){}disconnect(){}};w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=function(){};w.fetch=async()=>({ok:true,json:async()=>({items:[],listings:[],comments:[]}),text:async()=>''});}});
const w=dom.window,wait=ms=>new Promise(r=>setTimeout(r,ms));
function touch(target,type,x,y=420){const e=new w.Event(type,{bubbles:true,cancelable:true});Object.defineProperties(e,{touches:{value:/end|cancel/.test(type)?[]:[{clientX:x,clientY:y}]},changedTouches:{value:[{clientX:x,clientY:y}]}});target.dispatchEvent(e);return e;}
(async()=>{
 await wait(300);w.document.body.dataset.activeTab='discover';w.setMainNavActive('discover');await wait(40);
 const feed=w.document.getElementById('personalFeed'),card=w.document.createElement('article');card.className='reel-card';card.dataset.hasGallery='1';
 const urls=[1,2,3,4,5,6].map(i=>'https://example.com/photo-'+i+'.jpg');
 card.innerHTML='<div class="reel-gallery-stage" data-gallery-index="0"><div class="reel-gallery-track">'+urls.map((src,i)=>'<div class="reel-gallery-slide" data-gallery-slide="'+i+'"><img class="reel-gallery-image" data-src="'+src+'"></div>').join('')+'</div></div>';feed.appendChild(card);const stage=card.firstChild;stage.dataset.galleryImages=JSON.stringify(urls);const imgs=[...stage.querySelectorAll('img')],decoders=new Map();
 for(const img of imgs)img.decode=()=>new Promise(resolve=>decoders.set(img,resolve));
 w.wishwaveWarmReelPhotos(stage,0);
 assert.equal(imgs[2].getAttribute('src'),urls[2],'third photo starts loading with the cover, before any swipe');assert.equal(imgs[3].getAttribute('src'),null,'bounded lookahead avoids loading the entire gallery');
 function loaded(img){Object.defineProperty(img,'complete',{value:true,configurable:true});Object.defineProperty(img,'naturalWidth',{value:640,configurable:true});img.dispatchEvent(new w.Event('load'));}
 loaded(imgs[0]);assert(!imgs[0].parentNode.classList.contains('wishwave-photo-ready'),'load is not the same as decoded');decoders.get(imgs[0])();await wait(0);assert(imgs[0].parentNode.classList.contains('wishwave-photo-ready'));assert(stage.style.getPropertyValue('--wishwave-ready-photo').includes(urls[0]));
 stage.dataset.galleryIndex='1';w.wishwaveWarmReelPhotos(stage,1);assert.equal(imgs[3].getAttribute('src'),urls[3],'fourth photo starts loading while the second is selected');assert.equal(imgs[5].getAttribute('src'),null);
 stage.dataset.galleryIndex='2';w.wishwaveWarmReelPhotos(stage,2);loaded(imgs[2]);assert(imgs[2].parentNode.classList.contains('wishwave-photo-pending'));assert(stage.style.getPropertyValue('--wishwave-ready-photo').includes(urls[0]),'loaded cover remains behind a slow third photo until decode');decoders.get(imgs[2])();await wait(0);assert(imgs[2].parentNode.classList.contains('wishwave-photo-ready'));assert(!imgs[2].parentNode.classList.contains('wishwave-photo-pending'));assert(stage.style.getPropertyValue('--wishwave-ready-photo').includes(urls[2]));
 // A provider fallback URL must not leave the image permanently pending.
 imgs[1].src='https://example.com/recovered.jpg';loaded(imgs[1]);decoders.get(imgs[1])();await wait(0);assert(imgs[1].parentNode.classList.contains('wishwave-photo-ready'));
 loaded(imgs[3]);const stale=decoders.get(imgs[3]);w.wishwaveSleepReelGalleries(feed);stale();await wait(0);assert.equal(stage.style.getPropertyValue('--wishwave-ready-photo'),'');assert(imgs.every(img=>!img.getAttribute('src')));assert(!stage.querySelector('.wishwave-photo-ready'),'late decode cannot revive a released gallery');
 assert(source.includes('.reel-gallery-slide.wishwave-photo-pending .reel-gallery-image{opacity:0!important;}'));
 console.log('PASS: third-photo preload before swiping, bounded lookahead, decoded-only reveal, loaded-photo continuity, provider fallback recovery, and stale-decode cleanup');w.close();
})().catch(e=>{console.error(e);w.close();process.exitCode=1});
