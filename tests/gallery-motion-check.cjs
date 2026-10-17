const fs=require('node:fs'),assert=require('node:assert/strict'),{JSDOM,VirtualConsole}=require('jsdom');
const source=process.env.WISHWAVE_TEST_HTML?fs.readFileSync(process.env.WISHWAVE_TEST_HTML,'utf8'):fs.readFileSync(__dirname+'/../findai-app.html','utf8');
const dom=new JSDOM(source.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,''),{url:'https://test/?country=US',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:new VirtualConsole(),beforeParse(w){w.matchMedia=()=>({matches:false,addEventListener(){},addListener(){}});w.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};w.ResizeObserver=class{observe(){}disconnect(){}};w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=function(){};w.fetch=async()=>({ok:true,json:async()=>({items:[],listings:[],comments:[]}),text:async()=>''});}});
const w=dom.window,wait=ms=>new Promise(r=>setTimeout(r,ms));
function touch(target,type,x,y=420){const e=new w.Event(type,{bubbles:true,cancelable:true});Object.defineProperties(e,{touches:{value:/end|cancel/.test(type)?[]:[{clientX:x,clientY:y}]},changedTouches:{value:[{clientX:x,clientY:y}]}});target.dispatchEvent(e);return e;}
(async()=>{
 await wait(350);w.document.body.dataset.activeTab='discover';w.setMainNavActive('discover');await wait(40);
 Object.defineProperty(w.document.querySelector('.app'),'clientWidth',{value:390,configurable:true});
 const computed=w.getComputedStyle.bind(w),animations=[];
 w.getComputedStyle=el=>el.__sampleX!==undefined?{transform:'matrix(1,0,0,1,'+el.__sampleX+',0)'}:computed(el);
 function gallery(host){
  const card=w.document.createElement('article');card.className='reel-card';card.dataset.hasGallery='1';
  card.innerHTML='<div class="reel-gallery-stage" data-gallery-index="0"><div class="reel-gallery-track">'+[0,1,2].map(i=>'<div class="reel-gallery-slide" data-gallery-slide="'+i+'"><img class="reel-gallery-image" data-src="https://example.com/'+(i+1)+'.jpg"></div>').join('')+'</div><div class="reel-gallery-dots"><i></i><i></i><i></i></div></div><div class="product-panel"><b class="title">Camera</b></div>';
  host.appendChild(card);const stage=card.firstChild,track=stage.firstChild;stage.dataset.galleryImages=JSON.stringify([1,2,3].map(i=>'https://example.com/'+i+'.jpg'));Object.defineProperty(stage,'clientWidth',{value:390,configurable:true});
  track.animate=(keys,options)=>{const a={keys,options,cancelled:false,onfinish:null,cancel(){this.cancelled=true;}};animations.push(a);return a;};
  return {card,stage,track};
 }
 const {card,stage,track}=gallery(w.document.getElementById('personalFeed'));
 const x=()=>Number(track.style.transform.match(/translate3d\(([-.\d]+)/)?.[1]);
 // A deliberately held short drag snaps back; a quick flick advances.
 touch(stage,'touchstart',280,120);touch(stage,'touchmove',250,120);await wait(130);touch(stage,'touchend',250,120);assert.equal(stage.dataset.galleryIndex,'0');assert(animations.at(-1).keys.every(k=>Number.isFinite(Number(k.transform.match(/translate3d\(([-.\d]+)/)[1]))));animations.at(-1).onfinish();
 touch(stage,'touchstart',280,120);touch(stage,'touchmove',255,120);touch(stage,'touchend',255,120);assert.equal(stage.dataset.galleryIndex,'1');assert(w.__wishwaveGalleryInFlight(stage));
 const old=animations.at(-1),staleFinish=old.onfinish;track.__sampleX=-180;
 touch(stage,'touchstart',180,120);assert(old.cancelled);assert.equal(x(),-180,'catch the composited position');delete track.__sampleX;
 touch(stage,'touchmove',210,120);await wait(24);assert.equal(x(),-150,'one-to-one tracking after regrab');staleFinish();assert.equal(x(),-150,'stale settle cannot overwrite the new drag');
 touch(stage,'touchmove',360,120);await wait(24);assert(Math.abs(x())<.01);await wait(120);touch(stage,'touchend',360,120);assert.equal(stage.dataset.galleryIndex,'0','reverse an in-flight swipe back to the first photo');animations.at(-1).onfinish?.();
 // Edge resistance depends on the actual strip position, never a rounded index.
 touch(stage,'touchstart',120,120);touch(stage,'touchmove',220,120);await wait(24);assert(x()>0&&x()<40);touch(stage,'touchcancel',220,120);assert.equal(stage.dataset.galleryIndex,'0');animations.at(-1).onfinish?.();
 stage.dataset.galleryIndex='2';track.__sampleX=-780;touch(stage,'touchstart',220,120);delete track.__sampleX;touch(stage,'touchmove',120,120);await wait(24);assert(x()< -780&&x()> -820);touch(stage,'touchcancel',120,120);assert.equal(stage.dataset.galleryIndex,'2');animations.at(-1).onfinish?.();
 stage.dataset.galleryIndex='0';track.style.transform='translate3d(0px,0,0)';const animate=track.animate;track.animate=undefined;
 touch(stage,'touchstart',300,120);touch(stage,'touchmove',100,120);touch(stage,'touchend',100,120);assert(track.style.transition.includes('transform'));track.__sampleX=-100;touch(stage,'touchstart',180,120);delete track.__sampleX;assert.equal(x(),-100);touch(stage,'touchmove',220,120);await wait(24);assert.equal(x(),-60);touch(stage,'touchcancel',220,120);await wait(330);assert.equal(stage.dataset.galleryIndex,'0');assert.equal(x(),0,'fallback transition timer cannot jump to a cancelled destination');track.animate=animate;
 touch(stage,'touchstart',180,260);const vertical=touch(stage,'touchmove',184,120);assert(!vertical.defaultPrevented);touch(stage,'touchend',184,120);assert.equal(stage.dataset.galleryIndex,'0');assert(!w.document.body.classList.contains('findai-premium-gallery-dragging'));
 // Child pages must route a caught photo before treating the first-photo edge as back.
 const child=w.document.createElement('section');child.id='motionPhotoChild';child.className='show';w.document.querySelector('.app').appendChild(child);let backs=0;
 const prior=w.__wishwaveOriginSurface;w.__wishwaveOriginSurface=target=>child.contains(target)?{root:child,kind:'searchReel',originBound:true,open:()=>child.classList.contains('show'),back:()=>backs++}:prior?.(target);
 const nested=gallery(child);nested.stage.dataset.galleryIndex='1';nested.track.style.transform='translate3d(-390px,0,0)';nested.track.__sampleX=-390;
 touch(nested.stage,'touchstart',100,120);delete nested.track.__sampleX;touch(nested.stage,'touchmove',310,120);touch(nested.stage,'touchend',310,120);assert.equal(nested.stage.dataset.galleryIndex,'0');assert(w.__wishwaveGalleryInFlight(nested.stage));nested.track.__sampleX=-150;
 touch(nested.stage,'touchstart',110,120);delete nested.track.__sampleX;touch(nested.stage,'touchmove',180,120);await wait(24);assert.equal(Number(nested.track.style.transform.match(/translate3d\(([-.\d]+)/)[1]),-80);touch(nested.stage,'touchcancel',180,120);assert.equal(backs,0,'catching a photo cannot navigate back');
 // Resize finishes at a coherent selected photo.
 animations.at(-1).onfinish?.();Object.defineProperty(nested.stage,'clientWidth',{value:430,configurable:true});w.dispatchEvent(new w.Event('resize'));assert.equal(nested.track.style.transform,'translate3d(0px,0,0)');assert(!w.__wishwaveGalleryInFlight(nested.stage));
 w.matchMedia=()=>({matches:true});touch(nested.stage,'touchstart',300,120);touch(nested.stage,'touchmove',70,120);touch(nested.stage,'touchend',70,120);assert.equal(nested.stage.dataset.galleryIndex,'1');assert(!w.__wishwaveGalleryInFlight(nested.stage),'reduced motion settles immediately');
 console.log('PASS: width-aware held swipes and flicks, composited regrab and reversal, stale-animation rejection, physical edge resistance, vertical scroll handoff, child gallery/back priority and width-change cleanup');w.close();
})().catch(e=>{console.error(e);w.close();process.exitCode=1});
