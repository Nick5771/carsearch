const fs=require('fs'),assert=require('assert'),{JSDOM,VirtualConsole}=require('jsdom');
const source=fs.readFileSync(__dirname+'/../findai-app.html','utf8');
const errors=[],observers=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
const dom=new JSDOM(source.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,''),{url:'https://wishwave.test/?country=US',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){
 w.matchMedia=()=>({matches:false,addEventListener(){},addListener(){}});
 w.IntersectionObserver=class{constructor(callback){this.callback=callback;this.targets=new Set();observers.push(this);}observe(node){this.targets.add(node);}unobserve(node){this.targets.delete(node);}disconnect(){this.targets.clear();}};
 w.ResizeObserver=class{observe(){}disconnect(){}};w.scrollTo=()=>{};w.HTMLElement.prototype.scrollTo=function(){};w.HTMLElement.prototype.scrollIntoView=function(){};
 w.fetch=async()=>({ok:true,json:async()=>({items:[],listings:[],conversations:[]}),text:async()=>''});
}});
const w=dom.window,wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 await wait(400);
 const card=w.document.createElement('article');card.className='reel-card';
 card.innerHTML='<div class="reel-gallery-stage" data-gallery-images=\'["https://images.test/a.jpg","https://images.test/b.jpg"]\' data-gallery-index="1"><div class="reel-gallery-track"><div class="reel-gallery-slide"><img class="reel-gallery-image" src="https://images.test/a.jpg"></div><div class="reel-gallery-slide"><img class="reel-gallery-image" src="https://images.test/b.jpg"></div></div></div>';
 w.document.getElementById('personalFeed').append(card);await wait(20);
 const stage=card.firstElementChild,observer=observers.find(o=>o.targets.has(stage));assert(observer,'gallery registered');
 observer.callback([{target:stage,isIntersecting:true}]);
 observer.callback([{target:stage,isIntersecting:false}]);
 assert([...stage.querySelectorAll('img')].every(img=>!img.hasAttribute('src')),'distant reel releases image sources');assert.equal(stage.dataset.galleryIndex,'1','photo selection preserved');
 observer.callback([{target:stage,isIntersecting:true}]);
 assert([...stage.querySelectorAll('img')].every(img=>img.getAttribute('src')===img.dataset.src),'return restores current and adjacent images');
 card.remove();await wait(20);assert(!observer.targets.has(stage),'removed gallery unobserved');assert(!stage.dataset.v149Observed,'reinsert can register again');
 w.document.getElementById('personalFeed').append(card);await wait(20);assert(observer.targets.has(stage),'reinserted gallery observed');
 w.eval('getAccountProfile=()=>null;');w.renderProfileTab();
 const likes=w.document.querySelector('[data-guest-likes]');assert(likes&&likes.hidden,'empty guest likes section hidden');
 assert(!w.document.getElementById('profileSignedOut').textContent.includes('Liked on this device'));assert(!w.document.getElementById('profileSignedOut').textContent.includes('Tap a product'));
 const tabs=w.document.querySelector('#profileSignedOut .social-profile-tabs');assert.equal(tabs.style.getPropertyValue('--profile-tab-index'),'2');assert(tabs.children[2].classList.contains('active'));
 assert.equal(errors.length,0,JSON.stringify(errors));w.close();console.log('PASS: distant image release, return hydration, retained photo selection, detached observer cleanup/reinsert and clean guest likes');
})().catch(error=>{console.error(error);w.close();process.exitCode=1;});
