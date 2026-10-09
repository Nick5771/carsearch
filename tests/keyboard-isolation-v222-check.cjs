const fs=require('fs'),assert=require('assert'),{JSDOM,VirtualConsole}=require('./test-runtime/node_modules/jsdom');
const src=fs.readFileSync(__dirname+'/findai-app.html','utf8'),errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!e.message.includes('Could not parse CSS'))errors.push(e.message)});
for(const m of src.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))new Function(m[1]);
const dom=new JSDOM(src,{url:'https://wishwave.test',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){Object.defineProperty(w,'innerHeight',{value:844,writable:true,configurable:true});const vv=new w.EventTarget();Object.assign(vv,{height:844,width:390,offsetTop:0,scale:1});Object.defineProperty(w,'visualViewport',{value:vv});w.matchMedia=()=>({matches:false,addEventListener(){},addListener(){}});w.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};w.ResizeObserver=class{observe(){}disconnect(){}};w.fetch=async()=>({ok:true,json:async()=>({items:[],listings:[],conversations:[]}),text:async()=>''});w.scrollTo=()=>{};w.HTMLElement.prototype.scrollTo=function(){};w.HTMLElement.prototype.scrollIntoView=function(){};}});
const w=dom.window,wait=ms=>new Promise(r=>setTimeout(r,ms));
function touch(target,type,x,y=410){const e=new w.Event(type,{bubbles:true,cancelable:true});Object.defineProperties(e,{touches:{value:/end|cancel/.test(type)?[]:[{clientX:x,clientY:y}]},changedTouches:{value:[{clientX:x,clientY:y}]}});target.dispatchEvent(e);}
(async()=>{await wait(400);
const vv=w.visualViewport,mask=w.document.getElementById('wishwaveKeyboardBackdrop'),app=w.document.querySelector('.app');
app.getBoundingClientRect=()=>({top:0,bottom:w.innerHeight,height:w.innerHeight,width:390});
w.eval("marketplaceSession=()=> 'test';getAccountProfile=()=>({name:'Nick'})");
w.wishwaveOpenCreateTab();const root=w.document.getElementById('createListingScreen'),field=w.document.getElementById('listingItemName'),scroll=root.querySelector('.marketplace-scroll');
w.document.documentElement.classList.remove('findai-light');assert(mask.hidden);let documentScrolls=0;field.scrollIntoView=()=>documentScrolls++;
scroll.getBoundingClientRect=()=>({top:110,bottom:290,height:180});field.getBoundingClientRect=()=>({top:305-scroll.scrollTop,bottom:332-scroll.scrollTop,height:27});
field.value='Porsche details';field.focus();vv.height=360;vv.dispatchEvent(new w.Event('resize'));await wait(180);
assert(!mask.hidden,'keyboard must have an opaque web backing');assert.equal(mask.style.top,'360px');assert.equal(mask.style.height,'484px');assert.equal(w.getComputedStyle(mask).pointerEvents,'none');assert(Number(w.getComputedStyle(mask).zIndex)>Number(w.getComputedStyle(root).zIndex));assert.equal(w.getComputedStyle(mask).backgroundColor,'rgb(8, 9, 11)');assert.equal(scroll.scrollTop,58,'only the form scroller moves to reveal the field');assert.equal(documentScrolls,0);assert.equal(field.value,'Porsche details');w.document.documentElement.classList.add('findai-light');assert.equal(w.getComputedStyle(mask).backgroundColor,'rgb(247, 247, 248)');w.document.documentElement.classList.remove('findai-light');
// Safari may pan the visual viewport during focus. The mask follows its bottom.
vv.offsetTop=30;vv.height=330;vv.dispatchEvent(new w.Event('scroll'));await wait(30);assert.equal(mask.style.top,'360px');assert.equal(mask.style.height,'484px');
field.blur();await wait(30);assert(!mask.hidden,'blur must retain coverage while keyboard dismisses');vv.height=844;vv.offsetTop=0;vv.dispatchEvent(new w.Event('resize'));await wait(30);assert(mask.hidden);assert.equal(w.getComputedStyle(root).position,'absolute');
// The same isolation applies to other inputs and textareas, including overlay forms.
w.closeCreateListing();const other=w.document.createElement('textarea');w.document.body.appendChild(other);other.focus();vv.height=400;vv.dispatchEvent(new w.Event('resize'));await wait(30);assert(!mask.hidden);assert.equal(mask.style.top,'400px');assert.equal(mask.style.height,'444px');
// Pinching must not be mistaken for a keyboard; keyboard closing clears the mask.
vv.scale=2;vv.dispatchEvent(new w.Event('resize'));await wait(30);assert(mask.hidden);vv.scale=1;vv.height=844;vv.dispatchEvent(new w.Event('resize'));await wait(30);assert(mask.hidden);other.blur();other.remove();
// Rotation without a focused input must not leave a stale mask or old baseline.
w.innerHeight=390;vv.height=390;w.dispatchEvent(new w.Event('orientationchange'));vv.dispatchEvent(new w.Event('resize'));await wait(180);assert(mask.hidden);
assert.equal(errors.length,0,JSON.stringify(errors));console.log('PASS: opaque keyboard backing for Create and other text fields, follows visual viewport pan, survives blur/dismissal, form-only scroll, no draft changes, ignores pinch zoom, closes cleanly and resets on rotation; all inline scripts compile');w.close();})().catch(e=>{console.error(e);w.close();process.exitCode=1});
