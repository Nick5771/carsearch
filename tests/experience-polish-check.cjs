const fs=require('node:fs'),assert=require('node:assert/strict'),{JSDOM,VirtualConsole}=require('jsdom');
const source=fs.readFileSync('findai-app.html','utf8'),errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
for(const match of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))new Function(match[1]);
const dom=new JSDOM(source.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,''),{url:'https://test/?country=US',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){
 Object.defineProperty(w,'innerHeight',{value:844,writable:true});const viewport=new w.EventTarget();Object.assign(viewport,{height:844,width:390,offsetTop:0,scale:1});w.visualViewport=viewport;
 w.matchMedia=()=>({matches:true,addEventListener(){},addListener(){}});w.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};w.ResizeObserver=class{observe(){}disconnect(){}};w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=function(){};
 w.fetch=async()=>({ok:true,json:async()=>({items:[],listings:[],comments:[]}),text:async()=>''});
}});
const w=dom.window,wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 await wait(650);w.eval(fs.readFileSync('wishwave-experience.js','utf8'));
 const search=w.document.getElementById('search'),q=w.document.getElementById('q'),back=w.document.querySelector('.ww-search-cancel');
 w.document.body.dataset.activeTab='search';search.classList.add('active');
 q.focus();w.closeCreateListing({navigation:true});assert.equal(w.document.activeElement,q,'closing a hidden composer preserves Search focus');assert(search.classList.contains('ww-search-session'));assert.equal(back.getAttribute('aria-label'),'Back to discovery');assert.equal(q.getAttribute('autocapitalize'),'none');assert.equal(q.getAttribute('enterkeyhint'),'search');
 let recent=w.document.getElementById('findaiSearchRecents');if(!recent){recent=w.document.createElement('div');recent.id='findaiSearchRecents';search.appendChild(recent);}recent.getBoundingClientRect=()=>({top:150});
 w.visualViewport.height=400;w.visualViewport.dispatchEvent(new w.Event('resize'));await wait(30);assert(search.classList.contains('ww-search-keyboard'));assert.equal(search.style.getPropertyValue('--ww-recents-height'),'250px');
 q.blur();await wait(30);assert(search.classList.contains('ww-search-keyboard'),'retain coverage during keyboard dismissal');w.visualViewport.height=844;w.visualViewport.dispatchEvent(new w.Event('resize'));await wait(30);assert(!search.classList.contains('ww-search-keyboard'));
 let restored=0;w.resetPremiumExploreHome=force=>{assert.equal(force,false);restored++;};back.click();assert.equal(restored,1);assert(!search.classList.contains('ww-search-session'));assert.equal(w.document.activeElement,w.document.body);
 // Refresh retains interactive results and restores them on error; a different query cannot inherit them.
 const grid=w.document.getElementById('premiumResultsGrid'),scroll=w.document.querySelector('.premium-results-scroll');
 w.go=()=>{};w.setSearchNavActive=()=>{};w.recordInterest=()=>{};w.setLastSearch=()=>{};
 w.eval("premiumCompareContext=null;premiumResultQuery='camera';premiumResultItems=[{itemId:'old',price:150}];premiumResultData={currency:'USD'};premiumResultHasMore=true;premiumResultCursor='old-cursor';premiumResultPage=2;");
 grid.innerHTML='<button id="retained-tile">Existing camera</button>';const tile=grid.firstChild;scroll.scrollTop=240;
 let pending=[];w.fetchProductResults=()=>new Promise((resolve,reject)=>pending.push({resolve,reject}));
 const refresh=w.launchPremiumSearch('camera');assert.equal(grid.firstChild,tile);assert.equal(grid.getAttribute('aria-busy'),'true');assert.equal(w.eval('premiumResultItems[0].itemId'),'old');pending.at(-1).reject(new Error('offline'));await refresh;
 assert.equal(grid.firstChild,tile);assert.equal(scroll.scrollTop,240);assert.equal(w.eval('premiumResultCursor'),'old-cursor');assert.equal(grid.getAttribute('aria-busy'),'false');assert(w.document.getElementById('premiumResultsMeta').textContent.includes('previous results'));
 const next=w.launchPremiumSearch('jacket');assert(!grid.contains(tile));const newer=w.launchPremiumSearch('shoes');pending.at(-2).resolve({data:{listings:[{itemId:'stale',price:100}]}});await next;assert.equal(grid.getAttribute('aria-busy'),'true','stale search cannot clear a newer loading state');
 w.paintPremiumResults=()=>{grid.textContent=w.eval('premiumResultItems[0].itemId');};pending.at(-1).resolve({data:{listings:[{itemId:'current',price:200}]},hasMore:false});await newer;assert.equal(grid.textContent,'current');assert.equal(grid.getAttribute('aria-busy'),'false');
 // Warming is bounded, respects Data Saver, and failed resources may be retried.
 const probes=[];w.Image=class{set src(value){this.url=value;probes.push(this);}decode(){return Promise.resolve();}};w.appImagePlan=item=>({src:item.image});w.eval("feedState.source='personalised';currentFeedItems=Array.from({length:9},(_,i)=>({image:'https://images.test/'+i+'.jpg'}));personalisedImageWarmSet.clear()");
 w.preloadPersonalisedImages(0,12);await wait(20);assert.equal(probes.length,6);probes[0].onerror();w.preloadPersonalisedImages(0,6);await wait(20);assert.equal(probes.length,7,'failed image can warm again');
 Object.defineProperty(w.navigator,'connection',{value:{saveData:true}});w.eval('personalisedImageWarmSet.clear()');probes.length=0;w.preloadPersonalisedImages(0,12);await wait(20);assert.equal(probes.length,2);
 // Saving/liking cannot pay for a full navigation snapshot.
 w.eval(fs.readFileSync('wishwave-navigation-origins.js','utf8'));const like=w.document.createElement('button');like.className='reel-social-action like';like.setAttribute('onclick','toggleLike(0,event)');w.document.body.appendChild(like);
 const select=w.document.querySelectorAll.bind(w.document);let scans=0;w.document.querySelectorAll=function(selector){if(selector==='.app *')scans++;return select(selector);};w.__wishwaveOriginClick({target:like});assert.equal(scans,0);
 assert.deepEqual(errors,[]);console.log('PASS: Search back/session/viewport dismissal, retained offline refresh, query races, image warming/retry/Data Saver, ordinary action snapshot isolation; all inline scripts parse');
 w.close();
})().catch(error=>{console.error(error);w.close();process.exitCode=1;});
