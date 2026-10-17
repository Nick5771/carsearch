const fs=require('node:fs'),assert=require('node:assert/strict'),{JSDOM,VirtualConsole}=require('jsdom');
const source=process.env.WISHWAVE_TEST_HTML?fs.readFileSync(process.env.WISHWAVE_TEST_HTML,'utf8'):fs.readFileSync(__dirname+'/../findai-app.html','utf8');
const dom=new JSDOM(source.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,''),{url:'https://test/?country=US',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:new VirtualConsole(),beforeParse(w){w.matchMedia=()=>({matches:true,addEventListener(){},addListener(){}});w.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};w.ResizeObserver=class{observe(){}disconnect(){}};w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=function(){};w.fetch=async()=>({ok:true,json:async()=>({items:[],listings:[],comments:[]}),text:async()=>''});}});
const w=dom.window,wait=ms=>new Promise(r=>setTimeout(r,ms));
function touch(target,type,x,y=420){const e=new w.Event(type,{bubbles:true,cancelable:true});Object.defineProperties(e,{touches:{value:/end|cancel/.test(type)?[]:[{clientX:x,clientY:y}]},changedTouches:{value:[{clientX:x,clientY:y}]}});target.dispatchEvent(e);return e;}
(async()=>{
 await wait(350);w.document.body.dataset.activeTab='discover';w.setMainNavActive('discover');await wait(60);
 w.eval(fs.readFileSync(__dirname+'/../wishwave-navigation-origins.js','utf8'));
 w.openAppMpSheet('Comments','<div class="wishwave-comments-list"><div class="wishwave-comments-empty">No comments yet</div></div><form class="wishwave-comment-form"><input id="wishwaveCommentInput"></form>');
 const bg=w.document.getElementById('appMpSheetBg');bg.classList.add('wishwave-comments-mode');w.wishwaveSyncCommentViewport();await wait(60);
 const panel=bg.querySelector('.app-mp-sheet'),head=panel.querySelector('.app-mp-sheet-head'),list=panel.querySelector('.wishwave-comments-list'),input=bg.querySelector('input');input.value='Keep my draft';
 const y=()=>parseFloat(bg.style.getPropertyValue('--wishwave-comments-drag-y'));
 assert(bg.classList.contains('show'));
 touch(head,'touchstart',180,300);assert(touch(head,'touchmove',180,322).defaultPrevented);await wait(24);assert.equal(y(),22);await wait(110);touch(head,'touchend',180,322);assert(bg.classList.contains('comments-snapping'));await wait(380);assert(bg.classList.contains('show'));assert.equal(bg.querySelector('input'),input);assert.equal(input.value,'Keep my draft');
 touch(head,'touchstart',180,300);touch(head,'touchmove',180,510);touch(head,'touchcancel',180,510);await wait(380);assert(bg.classList.contains('show'));
 list.scrollTop=70;touch(list,'touchstart',180,400);assert(!touch(list,'touchmove',180,450).defaultPrevented);touch(list,'touchend',180,450);assert(!bg.classList.contains('comments-dragging'));list.scrollTop=0;
 touch(list,'touchstart',180,400);touch(list,'touchmove',250,402);touch(list,'touchend',250,402);assert(!bg.classList.contains('comments-dismissing'));
 touch(input,'touchstart',180,400);touch(input,'touchmove',180,600);touch(input,'touchend',180,600);assert(!bg.classList.contains('comments-dismissing'));
 touch(list,'touchstart',180,400);touch(list,'touchmove',180,445);await wait(24);assert.equal(y(),45);touch(list,'touchmove',180,620);await wait(24);assert.equal(y(),220);touch(list,'touchend',180,620);assert(bg.classList.contains('comments-dismissing'),JSON.stringify({classes:bg.className,y:y(),version:bg.dataset.motionVersion}));assert(bg.classList.contains('show'));await wait(120);assert(bg.classList.contains('show'),'sheet remains visible during closing transition');await wait(260);assert(!bg.classList.contains('show'));assert(!bg.classList.contains('comments-dismissing'));assert.equal(w.wishwaveNavigationOrigins().length,0,'downward dismissal unwinds the opener history');
 // Reopening during an old settle must not close or reset the new sheet.
 w.openAppMpSheet('Comments','<p>New comments</p>');bg.classList.add('wishwave-comments-mode');await wait(30);touch(head,'touchstart',180,300);touch(head,'touchmove',180,550);touch(head,'touchend',180,550);w.openAppMpSheet('Offers','<p>New sheet</p>');await wait(400);assert(bg.classList.contains('show'));assert.equal(w.document.getElementById('appMpSheetTitle').textContent,'Offers');
 console.log('PASS: comment header and empty/list-top finger tracking, short drag/cancel snapback and draft identity, scrolling/input/horizontal handoff, animated delayed dismissal, reopen race with navigation origins enabled');w.close();
})().catch(e=>{console.error(e);w.close();process.exitCode=1});
