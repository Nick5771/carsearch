// Exercise the actual client load/render/append pipeline with dated provider observations.
const fs=require('fs'),assert=require('assert'),{JSDOM,VirtualConsole}=require('jsdom');
const policy=require('../findai-treasure-pilot.js'),audit=require('../data/treasure-pilot-supply-audit.json');
const html=fs.readFileSync(__dirname+'/../findai-app.html','utf8').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'');
const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
const offers=q=>audit.results.find(x=>policy.forQuery(q)?.id===x.id)?.candidates||[];
let imageFailures=0;
const dom=new JSDOM(html,{url:'https://findai.test/?catalogue-test=1&treasure-test=1&country=US',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){
 w.eval(fs.readFileSync(__dirname+'/../findai-treasure-pilot.js','utf8'));w.matchMedia=()=>({matches:false,addEventListener(){},addListener(){}});w.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};w.ResizeObserver=class{observe(){}disconnect(){}};w.MutationObserver=class{observe(){}disconnect(){}};w.scrollTo=()=>{};w.HTMLElement.prototype.scrollTo=function(){};w.HTMLElement.prototype.scrollIntoView=function(){};
 w.fetch=async url=>String(url).includes('/recommendations/experiment')?{ok:true,json:async()=>({id:'shopping-v230',arm:'test'})}:{ok:true,json:async()=>({items:[],listings:[],version:208}),text:async()=>''};
}});
(async()=>{
 const w=dom.window;await new Promise(r=>setTimeout(r,350));
 w.Image=class{naturalWidth=0;set src(src){setTimeout(()=>{if(src.includes('broken-image')){imageFailures++;this.onerror?.();}else{this.naturalWidth=800;this.onload?.();}},0);}};
 let concurrent=0,peak=0,calls=0;w.fetch=async(url,options={})=>{
  let payload={};try{payload=JSON.parse(options.body||'{}');}catch{}
  const q=payload.query||new URL(url,'https://test').searchParams.get('q');
  if(String(url).endsWith('/search')){calls++;concurrent++;peak=Math.max(peak,concurrent);await new Promise(r=>setTimeout(r,5));concurrent--;assert.equal(payload.country,'US');return {ok:true,json:async()=>({listings:offers(q),country:'US',hasMore:false})};}
  return {ok:true,json:async()=>({items:[],listings:[],version:208}),text:async()=>''};
 };
 let watchdog;await Promise.race([w.loadPersonalisedFeed({forceNetwork:true}),new Promise((_,reject)=>{watchdog=setTimeout(()=>reject(new Error('load timeout; requests='+peak+' cards='+w.eval('currentFeedItems.length'))),45000);})]);clearTimeout(watchdog);
 for(let i=0;i<80;i++){await new Promise(r=>setTimeout(r,50));if(w.eval('currentFeedItems.length')>=20)break;}
 let items=w.eval('currentFeedItems.slice()');
 assert(items.length>=20,'opening plus queued lanes must supply twenty real distinct products, got '+items.length);
 assert.equal(new Set(items.slice(0,20).map(x=>policy.identify(x)?.id)).size,20,'first twenty contain twenty different targets');
 const polluted=[{title:'Nintendo Donkey Kong DK-52',source:'ebay',currency:'USD',price:100,image:'https://test/old.jpg',url:'https://ebay.com/itm/1'},...offers(policy.targets.find(x=>x.id==='FF322').query).map(x=>({...x,currency:'AUD'}))];
 w.appendFeedItems(polluted,{personalised:true});assert.equal(w.eval('currentFeedItems.length'),items.length,'direct append cannot leak old previews or wrong market');
 for(let round=0;round<2;round++){w.appendFeedItems(audit.results.flatMap(x=>x.candidates),{personalised:true});}
 items=w.eval('currentFeedItems.slice()');assert(items.length>=40,'test traverses beyond opening twenty');
 for(let i=0;i<items.length;i++){const id=policy.identify(items[i])?.id;assert(id);assert(!items.slice(Math.max(0,i-20),i).some(x=>policy.identify(x)?.id===id),'no seller/size repeat in last twenty at '+i);assert.equal(items[i].currency,'USD');}
 assert.equal(w.document.querySelectorAll('#personalFeed .reel-card').length,items.length,'render and append retain the validated sequence');
 const target=policy.targets.find(x=>x.id==='FF118'),good=offers(target.query)[0];assert(good);
 w.fetch=async()=>({ok:true,json:async()=>({listings:[{...good,itemId:'broken',image:'https://test/broken-image.jpg',images:[]}],country:'US'}),text:async()=>''});
 const lane=w.newPersonalisedLane({query:target.query,featured:true,category:target.category,cluster:'image-test'});
 w.eval('feedState.seen=new Set();');const checked=await w.fetchPersonalisedLanePage(lane);
 assert(imageFailures>0);assert(!checked.items.some(x=>x.itemId==='broken'),'decoded image failure is excluded');
 w.fetch=async()=>({ok:true,json:async()=>({listings:[{...good,itemId:'good-photo'}],country:'US'}),text:async()=>''});
 const working=await w.fetchPersonalisedLanePage(w.newPersonalisedLane({query:target.query,featured:true,category:target.category,cluster:'image-test-good'}));assert(working.items.some(x=>x.itemId==='good-photo'),'a working seller alternative remains available');
 // A stalled first photo must not serialize every seller alternative behind it.
 w.Image=class{naturalWidth=0;set src(src){if(src.includes('stalled-photo'))return;setTimeout(()=>{this.naturalWidth=800;this.onload?.();},0);}};
 w.fetch=async()=>({ok:true,json:async()=>({listings:[{...good,itemId:'stalled-alternative',image:'https://test/stalled-photo.jpg',images:[]},{...good,itemId:'fast-alternative',image:'https://test/fast-photo.jpg',images:[]}],country:'US',hasMore:false}),text:async()=>''});
 let photoWatchdog;const fast=await Promise.race([w.fetchPersonalisedLanePage(w.newPersonalisedLane({query:target.query,featured:true,category:target.category,cluster:'image-parallel'})),new Promise((_,reject)=>{photoWatchdog=setTimeout(()=>reject(new Error('Working alternative waited for stalled image')),500);})]);clearTimeout(photoWatchdog);assert(fast.items.some(x=>x.itemId==='fast-alternative'));
 // Curated Search must replenish even when its first rows cannot yet scroll.
 let browseCalls=0;w.wishwaveFetchRecommendationResults=async q=>{browseCalls++;return {data:{listings:offers(q)},nextCursor:null,hasMore:false};};
 w.go('search');await w.resetPremiumExploreHome(true);assert(browseCalls>=12,'curated Search starts a larger target buffer');
 for(let n=0;n<40 && w.document.querySelectorAll('.premium-explore-tile').length<20;n++)await new Promise(r=>setTimeout(r,50));
 assert(w.document.querySelectorAll('.premium-explore-tile').length>=20,'underfilled Search replenishes without a scroll event');
 assert(peak<=4,'bounded live request concurrency');assert.equal(errors.length,0,JSON.stringify(errors));
 console.log('PASS: '+items.length+' rendered reels, twenty unique opening products, twenty-product repeat gap across pages, polluted fallback rejection, USD, image failure and provider concurrency');w.close();
})().catch(e=>{console.error(e);dom.window.close();process.exitCode=1});
