const fs=require('fs'),vm=require('vm'),assert=require('assert');
const html=fs.readFileSync('findai-app.html','utf8');
const begin=html.indexOf('<script id="findai-treasure-variety-v240">');
const slice=(a,b)=>html.slice(html.indexOf(a,begin),html.indexOf(b,html.indexOf(a,begin)));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const tick=()=>new Promise(r=>setImmediate(r));
async function images(){
 const requests=new Map();const ctx={Promise,Map,FindAITreasureHunt:{varied:items=>({items})},imageReady:item=>{const d=deferred();requests.set(item.id,d);return d.promise;}};ctx.window=ctx;vm.createContext(ctx);
 vm.runInContext(slice(' window.wishwaveReadyStarter=function(items){',' async function imageReady(item){'),ctx);
 let painted=null;ctx.wishwaveReadyStarter([{id:1},{id:2},{id:3},{id:4},{id:5}]).then(x=>painted=x);
 requests.get(2).resolve(false);await tick();assert.equal(painted,null,'Failed image cannot paint');
 requests.get(3).resolve(true);await tick();assert.equal(painted.length,1,'One valid image unlocks first paint');assert.equal(painted[0].id,3);
 for(const [id,r] of requests)if(id!==2&&id!==3)r.resolve(true);await tick();
 const full=await painted.completion;assert.deepEqual(Array.from(full,x=>x.id),[1,3,4,5]);
}
async function reservoir(){
 const request=deferred();let now=Date.now(),calls=0;const row={at:now,items:[{id:'cached',_catalogueObservedAt:now}]};
 const ctx={Date,Promise,Set,URLSearchParams,location:{search:'?treasure-test=1'},appShoppingRegion:()=> 'US',FindAITreasureHunt:{groups:[{}]},personalisedSeenInfo:()=>({count:0}),seededUnit:()=>0,personalisedSessionSeed:'x',listingKey:i=>i.id,wishwaveRecommendationCandidate:()=>true,localStorage:{getItem:()=>JSON.stringify(row),setItem(){}},WORKER_BASE:'fixture',appFetchJsonTimed:()=>{calls++;return request.promise;},setTimeout};ctx.window=ctx;vm.createContext(ctx);
 vm.runInContext("const active=()=>true;let starterCache=null,starterFlight=null;"+slice(' window.wishwaveStarterItems=async function(surface){',' window.wishwaveReadyStarter=function(items){'),ctx);
 let ready=null;ctx.wishwaveStarterItems('home').then(x=>ready=x);await tick();assert.equal(ready[0].id,'cached');assert.equal(calls,1,'Cache paints while refresh is pending');
 await ctx.wishwaveStarterItems('home');assert.equal(calls,1,'Refresh request is shared');
 request.resolve({items:[{id:'fresh',_catalogueObservedAt:now}]});await tick();assert.equal((await ctx.wishwaveStarterItems('home'))[0].id,'fresh');
}
async function lanes(){
 const a=html.indexOf('async function loadPersonalisedFeed('),b=html.indexOf('function schedulePersonalisedBackgroundRefresh',a),slow=deferred();let rendered=null;
 const ctx={AbortController,Set,Map,Promise,Date,setTimeout,clearTimeout,document:{querySelector:()=>null},wishwaveCancelStartupRecovery:null,feedRequestController:null,feedState:{},scoredInterests:()=>[{query:'fast'},{query:'slow'}],newPersonalisedLane:x=>x,personalisedProfileSignature:()=> 'fixture',readPersonalisedCache:()=>null,marketplaceSession:()=>null,go(){},renderLoading(){},markPersonalisedRefreshNow(){},fetchPersonalisedLane:lane=>lane.query==='fast'?Promise.resolve({lane,items:[{id:'first'}]}):slow.promise,sequencePersonalisedBatch:x=>x,interleavePersonalised:rows=>rows.flatMap(x=>x.items),renderPersonalisedFeed:items=>rendered=items,appendFeedItems(){},writePersonalisedCache(){},currentFeedItems:Array(24).fill({}),activeReelIndex:0,currentFeedData:{},wishwaveInterestFocus:()=>({strong:true})};ctx.window=ctx;vm.createContext(ctx);vm.runInContext(html.slice(a,b),ctx);
 let done=false;ctx.loadPersonalisedFeed().then(()=>done=true);await tick();assert(done,'Slow interest must not delay first paint');assert.equal(rendered[0].id,'first');
 slow.resolve({lane:{query:'slow'},items:[]});await tick();
}
(async()=>{await images();await reservoir();await lanes();console.log('PASS: first verified image paints immediately, recent cache paints during shared refresh, slow categories do not block first listing');})().catch(e=>{console.error(e);process.exitCode=1;});
