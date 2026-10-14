const fs=require('fs'),assert=require('assert'),{JSDOM,VirtualConsole}=require('jsdom');
const source=fs.readFileSync(__dirname+'/../findai-app.html','utf8'),errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
const dom=new JSDOM(source.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,''),{url:'https://wishwave.test/?country=US',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){
 w.matchMedia=()=>({matches:false,addEventListener(){},addListener(){}});w.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};w.ResizeObserver=class{observe(){}disconnect(){}};w.scrollTo=()=>{};w.HTMLElement.prototype.scrollTo=function(){};w.HTMLElement.prototype.scrollIntoView=function(){};
 w.fetch=async()=>({ok:true,json:async()=>({items:[],listings:[],conversations:[],version:208}),text:async()=>''});
}});
const w=dom.window,wait=ms=>new Promise(r=>setTimeout(r,ms));
const item=(id,kind)=>({itemId:id,title:kind+' product '+id,kind,price:95,currency:'USD',source:'ebay',url:'https://www.ebay.com/itm/'+id,image:'https://images.test/'+id+'.jpg'});
(async()=>{
 await wait(400);
 w.eval("wishwaveRecommendationCandidate=()=>true;wishwaveProductCategory=item=>item.kind;wishwaveProductIdentity=item=>({family:item.itemId});wishwaveAdmitRecommendations=(items,history,max)=>({items:items.filter(x=>!history.some(y=>y.itemId===x.itemId)).slice(0,max),deferred:[]});sequencePersonalisedBatch=(items,history,max)=>wishwaveAdmitRecommendations(items,history,max).items;surfaceLikedListingInFeed=items=>items;surfaceOwnedListingInFeed=items=>items;");
 // A slow fourth lane cannot hold back the third completed lane after first paint.
 const kinds=['watches','gaming','audio','fashion'];w.lanes=kinds.map((category,i)=>({query:category,category,cluster:'test-'+i,featured:true}));
 let home=[];w.homeFetch=lane=>new Promise(resolve=>home.push({lane,resolve}));w.eval('scoredInterests=()=>lanes;fetchPersonalisedLane=homeFetch;');
 const opening=w.loadPersonalisedFeed({forceNetwork:true});await wait(20);assert.equal(home.length,4);
 home[0].resolve({lane:home[0].lane,items:Array.from({length:7},(_,i)=>item('watch-'+i,'watches'))});
 home[1].resolve({lane:home[1].lane,items:[item('game-0','gaming'),item('game-1','gaming')]});
 await opening;assert(w.eval('currentFeedItems.length')>=7,'opening must not artificially stop at two cards');
 assert.equal(w.eval('feedState.initialPool.pending'),2);
 await w.loadMorePersonalisedListings();assert.equal(home.length,4,'pagination does not race pending opening lanes');
 const first=w.document.querySelector('#personalFeed .reel-card');
 home[2].resolve({lane:home[2].lane,items:[item('audio-0','audio')]});await wait(40);
 assert(w.eval('currentFeedItems.some(x=>x.itemId==="audio-0")'),'completed third lane appears while fourth is unresolved');assert.strictEqual(w.document.querySelector('#personalFeed .reel-card'),first,'background append retains visible card');
 home[3].resolve({lane:home[3].lane,items:[item('fashion-0','fashion')]});await wait(40);assert.equal(w.eval('feedState.initialPool.pending'),0);
 // For You gets cross-category mixing with a stable first tile and no late reshuffle.
 w.go('search');let browse=[];w.browseFetch=()=>new Promise(resolve=>browse.push(resolve));w.eval('v116GetPreviewPool=async()=>[];wishwaveFetchRecommendationResults=browseFetch;');
 const search=w.resetPremiumExploreHome(true);await wait(20);assert(browse.length>=4);
 browse[0]({data:{listings:Array.from({length:3},(_,i)=>item('s-watch-'+i,'watches'))},hasMore:false});await wait(30);
 assert.equal(w.document.querySelectorAll('.premium-explore-grid .premium-explore-tile').length,1,'one fast category cannot occupy the opening grid');
 const tile=w.document.querySelector('.premium-explore-grid .premium-explore-tile');
 browse[1]({data:{listings:Array.from({length:3},(_,i)=>item('s-game-'+i,'gaming'))},hasMore:false});
 browse[2]({data:{listings:Array.from({length:3},(_,i)=>item('s-audio-'+i,'audio'))},hasMore:false});
 browse[3]({data:{listings:Array.from({length:3},(_,i)=>item('s-fashion-'+i,'fashion'))},hasMore:false});
 browse.slice(4).forEach(resolve=>resolve({data:{listings:[]},hasMore:false}));await search;
 const shown=w.eval('premiumDiscoverySections[0].items.slice()');assert.equal(shown.length,12);for(let i=1;i<6;i++)assert.notEqual(shown[i].kind,shown[i-1].kind,'opening category spacing');
 assert.strictEqual(w.document.querySelector('.premium-explore-grid .premium-explore-tile'),tile,'first tile preserved after late lane results');
 assert.equal(errors.length,0,JSON.stringify(errors));w.close();console.log('PASS: opening inventory buffer, progressive late Home lane, pending-lane pagination guard, stable reel/tile nodes and Search category spacing');
})().catch(error=>{console.error(error);w.close();process.exitCode=1;});
