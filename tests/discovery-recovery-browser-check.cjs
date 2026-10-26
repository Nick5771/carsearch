const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),policy=require('../findai-treasure-pilot.js'),surfaces=require('../wishwave-discovery-surfaces.js');
const make=(t,i)=>policy.annotate(t,{itemId:t.id+'-'+i,title:t.query,source:'ebay',price:40,currency:'USD',url:'https://www.ebay.com/itm/'+t.id+i,image:'https://fixtures.test/'+t.id+'.png',_ebayFetchedAt:Date.now(),_interestQuery:t.query,_interestCategory:t.category,_interestCluster:'treasure:'+t.id});
const two=['FF073','FF574'].map(id=>policy.targets.find(t=>t.id===id)),thin=Array.from({length:24},(_,i)=>make(two[i%2],i));
const spaced=policy.varied(thin,[],36,{allowSparse:true});assert.equal(spaced.items.length,2,'thin pools do not alternate the same two products');assert.equal(spaced.deferred.length,22,'other offers retained for later');
assert.equal(surfaces.create().repeatWindow('home'),20);
const targets=[];for(const group of policy.groups){const t=group.targets.find(t=>policy.match(t,make(t,0)));if(t)targets.push(t);if(targets.length===36)break;}assert(targets.length>=12);
const allocation=surfaces.create();for(const t of targets)allocation.claim([make(t,0)],'search');const homeReserved=targets.filter(t=>allocation.allowed(make(t,0),'home')).length;assert(homeReserved>=12,'one-item Search responses reserve a fair share for Home');
(async()=>{
 const server=http.createServer((req,res)=>{const file=path.join(root,new URL(req.url,'http://test').pathname);if(!file.startsWith(root)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(fs.readFileSync(file));});await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage'],headless:true});const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
 await page.route('**/*',r=>{const req=r.request();if(req.url().startsWith('http://127.0.0.1:'))return r.continue();if(req.resourceType()==='image')return r.fulfill({status:200,contentType:'image/png',body:pixel});return r.fulfill({status:200,contentType:'application/json',body:'{"items":[],"listings":[],"people":[],"conversations":[],"profile":{}}'});});
 await page.goto('http://127.0.0.1:'+server.address().port+'/findai-app.html?country=US&treasure-test=1&interaction-preview=1');await page.waitForFunction(()=>window.wishwaveReadyStarter);await page.waitForTimeout(1200);
 await page.evaluate(({thin,targets})=>{
  window.findaiEnsureUsernameOnboarding=async()=>{};document.getElementById('findaiUsernameOnboarding').style.setProperty('display','none','important');window.fixtureThin=thin;window.fixtureTargets=targets;window.fixtureCalls=[];window.fixtureGeneration=0;
  window.scoredInterests=()=>fixtureTargets.map(t=>({id:t.id,query:t.query,discoveryQuery:t.query,category:t.category,cluster:'treasure:'+t.id,featured:true,score:1,_treasureTargetId:t.id}));
  window.wishwaveStarterItems=async()=>fixtureThin;
  window.wishwaveFetchRecommendationResults=async(query,options={})=>{fixtureCalls.push({query,page:options.page});const t=fixtureTargets.find(t=>t.query===query);if(!t)return {data:{listings:[]},hasMore:false};const i=++fixtureGeneration;return {data:{listings:[{itemId:t.id+'-live-'+i,title:t.query,source:'ebay',price:40,currency:'USD',url:'https://www.ebay.com/itm/'+i,image:'https://fixtures.test/'+t.id+'.png',_ebayFetchedAt:Date.now()}]},hasMore:true};};
  window.wishwaveDiscoverySurfaces.invalidate();
  window.wishwaveInterestFocus=()=>null;window.wishwaveRecommendationRejected=()=>false;
 },{thin,targets});
 await page.evaluate(()=>{loadPersonalisedFeed({forceNetwork:true});});
 await page.waitForFunction(()=>currentFeedItems.length>=12,{},{timeout:15000}).catch(async e=>{console.log(await page.evaluate(()=>({home:currentFeedItems.map(x=>FindAITreasureHunt.identify(x)?.id),search:premiumDiscoverySections[0]?.items.map(x=>FindAITreasureHunt.identify(x)?.id),calls:fixtureCalls.slice(-12),loading:feedState.loading,topups:feedState.bufferTopups,retry:!!document.getElementById('wishwaveHomeMoreRetry')})));throw e;});
 assert(await page.evaluate(()=>fixtureCalls.length>0),'short starter triggers real lane refill');assert(await page.evaluate(()=>new Set(currentFeedItems.map(x=>FindAITreasureHunt.identify(x)?.id)).size>=12),'Home buffer contains different products');
 // An opening request can remain pending while pagination fetches other lanes.
 await page.evaluate(async()=>{if(feedState.morePool?.promise)await feedState.morePool.promise;feedState.initialPool={pending:1,opening:true};feedState.backlog=[];fixtureThin=[];fixtureCalls=[];});await page.evaluate(()=>loadMorePersonalisedListings());assert(await page.evaluate(()=>fixtureCalls.length>0),'pending opening pool does not gate all pagination');
 // Search must not abort Home merely because its tab is selected.
 await page.evaluate(()=>{window.savedHomeController=feedRequestController;openSearchHome(false);});assert.equal(await page.evaluate(()=>savedHomeController.signal.aborted),false);
 await page.waitForFunction(()=>document.body.dataset.activeTab==='search');
 await page.waitForFunction(()=>document.querySelectorAll('#premiumDiscoverySections .premium-explore-tile').length>=6,{},{timeout:15000});
 const search=await page.evaluate(()=>premiumDiscoverySections[0].items.map(x=>FindAITreasureHunt.identify(x)?.id));for(let i=0;i<search.length;i++)assert(!search.slice(Math.max(0,i-20),i).includes(search[i]),'Search does not repeat one product in its recent window');
 const home=await page.evaluate(()=>currentFeedItems.map(x=>FindAITreasureHunt.identify(x)?.id));assert(search.every(id=>!home.includes(id)),'Home and Search keep separate product ownership');
 // Simulate an interrupted horizontal swipe without touchend/pagehide.
 await page.evaluate(()=>{openForYou();});await page.waitForTimeout(250);
 await page.evaluate(()=>{const target=document.querySelector('#personalFeed .reel-card .product-panel')||document.getElementById('personalFeed');const event=(x,y)=>({target,touches:[{clientX:x,clientY:y}],preventDefault(){},stopImmediatePropagation(){}});__wishwaveTabTouch('touchstart',event(300,650));__wishwaveTabTouch('touchmove',event(180,650));});assert(await page.evaluate(()=>!!__wishwavePageMotion),'swipe owns motion before interruption');
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});assert.equal(await page.evaluate(()=>!!__wishwavePageMotion||!!__wishwaveTabSettling),false,'suspended drag releases locks');assert.equal(await page.locator('.findai-v132-swipe-surface').count(),0,'drag surfaces removed');
 await page.locator('#wishwaveMainNav button[data-tab="search"]').click();await page.waitForFunction(()=>document.body.dataset.activeTab==='search');
 console.log('PASS: thin-pool repetition deferred, short Home refills to 12 different products, pending pool pagination, Search variety, Home request ownership, interrupted swipe unlocks and navigation responds');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
