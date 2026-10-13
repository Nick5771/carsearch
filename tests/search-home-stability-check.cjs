const fs=require('fs'),assert=require('assert'),{JSDOM,VirtualConsole}=require('jsdom');
const html=fs.readFileSync(__dirname+'/../findai-app.html','utf8').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'');
const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
const dom=new JSDOM(html,{url:'https://wishwave.test/?country=US&catalogue-test=1',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){w.matchMedia=()=>({matches:false,addEventListener(){},addListener(){}});w.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};w.ResizeObserver=class{observe(){}disconnect(){}};w.scrollTo=()=>{};w.HTMLElement.prototype.scrollTo=function(){};w.HTMLElement.prototype.scrollIntoView=function(){};w.fetch=async url=>String(url).includes('/recommendations/experiment')?{ok:true,json:async()=>({id:'shopping-v230',arm:'test'})}:{ok:true,json:async()=>({items:[],listings:[],version:208}),text:async()=>''};}});
const w=dom.window,wait=ms=>new Promise(r=>setTimeout(r,ms));
const item=(id,title='Nintendo Game Boy Color console')=>({itemId:id,title,price:95,currency:'USD',source:'ebay',url:'https://www.ebay.com/itm/'+id,image:'https://images.test/'+id+'.jpg'});
(async()=>{
 await wait(400);w.go('search');const q=w.document.getElementById('q');
 // A fast lane paints before a slow lane; entering Search or taste changes cannot replace it.
 let browseRequests=[];w.browseFetch=(_query,options)=>new Promise(resolve=>browseRequests.push({resolve,options}));
 w.eval("v116GetPreviewPool=async()=>[];wishwaveRecommendationCandidate=()=>true;wishwaveFetchRecommendationResults=browseFetch;");
 const browse=w.resetPremiumExploreHome(true);await wait(20);assert(browseRequests.length>1);
 const fast=item('fast-browse','Vintage leather jacket');browseRequests[0].resolve({data:{listings:[fast]},hasMore:false});await wait(20);
 const fastNode=w.document.querySelector('#premiumDiscoverySections .premium-explore-tile');assert(fastNode,'first finished lane paints before remaining requests finish');
 assert.equal(fastNode.querySelector('img').getAttribute('loading'),'eager','first viewport images load eagerly');assert.equal(fastNode.querySelector('img').getAttribute('fetchpriority'),'high');
 const count=browseRequests.length;const repeat=w.resetPremiumExploreHome(false);await wait(20);assert.equal(browseRequests.length,count,'navigation shares the existing browse request');
 browseRequests.slice(1).forEach((r,i)=>r.resolve({data:{listings:[item('late-browse-'+i,'Rare collectible model '+i)]},hasMore:false}));await Promise.all([browse,repeat]);
 assert.strictEqual(w.document.querySelector('#premiumDiscoverySections .premium-explore-tile'),fastNode,'late lanes append without replacing first tile');
 w.eval("scoredInterests=()=>[{query:'LEGO Star Wars',featured:false}]");await w.renderPremiumDiscoverySections(false);await w.resetPremiumExploreHome(false);
 assert.strictEqual(w.document.querySelector('#premiumDiscoverySections .premium-explore-tile'),fastNode,'taste change does not refresh the painted browse session');assert.equal(browseRequests.length,count);
 q.focus();await wait(50);assert.strictEqual(w.document.querySelector('#premiumDiscoverySections .premium-explore-tile'),fastNode,'focusing search does not repaint products');

 const offers=Array.from({length:36},(_,i)=>item('gb'+i,'Nintendo Game Boy Color console seller '+i));
 w.offers=offers;w.eval('fetchProductResults=async()=>({data:{listings:offers},hasMore:false});');q.value='Nintendo Game Boy Color';await w.runPremiumLiveSearch(q.value,true);
 assert.equal(w.document.querySelectorAll('#premiumDiscoverySections .premium-explore-tile').length,36,'typed searches retain all seller/size offers without server ranking metadata');
 assert.deepEqual(Array.from(w.eval('premiumDiscoverySections[0].items'),x=>x.itemId),offers.map(x=>x.itemId),'preserve response order');
 let requests=[];w.searchFetch=async(_q,o)=>{requests.push(o);return o.page===1?{data:{listings:[item('ps0','PS5 console'),item('ps1','PS5 console'),item('ps2','PS5 console')]},nextCursor:'next',hasMore:true}:{data:{listings:Array.from({length:17},(_,i)=>item('ps'+(i+2),'PS5 console'))},hasMore:false};};w.eval('fetchProductResults=searchFetch');q.value='PS5';await w.runPremiumLiveSearch('PS5',true);await wait(100);
 assert.equal(w.document.querySelectorAll('#premiumDiscoverySections .premium-explore-tile').length,19,'short first page loads next available page and deduplicates');assert.equal(requests.length,2);assert.equal(requests[1].cursor,'next');
 w.eval('fetchProductResults=async()=>({data:{listings:[]},hasMore:false});');q.value='No matches';await w.runPremiumLiveSearch(q.value,true);assert.equal(w.document.querySelectorAll('#premiumDiscoverySections .premium-explore-tile').length,0,'empty typed search clears unrelated previous results');assert(w.document.querySelector('.premium-explore-empty'));
 let finish;w.holdFetch=()=>new Promise(r=>finish=r);w.eval('fetchProductResults=holdFetch');q.value='Old query';const abandoned=w.runPremiumLiveSearch(q.value,true);w.go('discover');finish({data:{listings:[item('stale')]},hasMore:false});await abandoned;assert(!w.eval('premiumDiscoverySections[0].items').some(x=>x.itemId==='stale'),'leaving Search cancels late paints even when transport ignores abort');
 assert.equal(w.document.getElementById('search').getAttribute('aria-busy'),'false');
 w.go('search');let resolveOld;w.directFetch=()=>new Promise(r=>resolveOld=r);w.eval('fetchProductResults=directFetch');const old=w.launchPremiumSearch('old');w.directFetch=async()=>({data:{listings:[item('new')]},hasMore:false});w.eval('fetchProductResults=directFetch');await w.launchPremiumSearch('new');resolveOld({data:{listings:[item('old')]},hasMore:false});await old;assert.equal(w.eval('premiumResultItems[0].itemId'),'new','separate results screen also rejects superseded responses');
 let finishMore,moreCalls=0;w.eval('premiumResultHasMore=true');w.moreFetch=()=>{moreCalls++;return new Promise(r=>finishMore=r);};w.eval('fetchProductResults=moreFetch');const more=w.loadMorePremiumResults();await w.loadMorePremiumResults();assert.equal(moreCalls,1,'duplicate load-more taps share one request');w.directFetch=async()=>({data:{listings:[item('newer')]},hasMore:false});w.eval('fetchProductResults=directFetch');await w.launchPremiumSearch('newer');finishMore({data:{listings:[item('old-page')]},hasMore:false});await more;assert.deepEqual(Array.from(w.eval('premiumResultItems'),x=>x.itemId),['newer'],'old pagination cannot append to a newer query');
 assert.equal(errors.length,0,JSON.stringify(errors));w.close();console.log('PASS: progressive first paint, eager first images, focus/taste/navigation stability, 36 same-family results, stable order, short-page recovery, pagination dedupe, tab-departure cancellation, busy cleanup and direct-search races');
})().catch(e=>{console.error(e);w.close();process.exitCode=1});
