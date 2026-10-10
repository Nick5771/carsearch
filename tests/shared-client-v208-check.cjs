const fs=require('fs'),vm=require('vm'),assert=require('assert');
const html=fs.readFileSync(__dirname+'/../findai-app.html','utf8');const script=html.match(/<script id="wishwave-v208-shared-ranking">([\s\S]*?)<\/script>/)[1];
let timers=[],calls=[],enabled=true,fail=false,reranks=0;
const store=new Map();const w={findaiAppPreferences:()=>({personalized:enabled}),addEventListener(){},wishwaveScheduleRankingRefresh(){reranks++}};
const c={window:w,document:{addEventListener(){}},Map,Set,Date,Math,Number,String,crypto:{randomUUID:()=> 'abcdefghijklmnop'},localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)},
 listingKey:item=>item.key,WORKER_BASE:'https://api.test',marketplaceHeaders:()=>({'Content-Type':'application/json'}),finaliseReelTracking(){},
 setTimeout(fn){timers.push(fn);return timers.length},clearTimeout(){},fetch:async(url,opts)=>{calls.push({url,body:JSON.parse(opts.body)});return {ok:!fail,json:async()=>({version:208,scores:{'ebay:42':{boost:999}}})}}};
vm.createContext(c);vm.runInContext(script,c);
async function next(){const fn=timers.shift();if(fn)await fn();}
(async()=>{
 const item={key:'ebay:42'};w.wishwaveFetchSharedScores([item,item]);await next();assert.equal(calls[0].body.keys.length,1);assert.equal(w.wishwaveSharedBoost(item),12);assert.equal(reranks,1);
 w.wishwaveSharedExposure(item,4000);w.wishwaveSharedSignal(item,'like');w.wishwaveSharedSignal(item,'share');await next();
 assert.equal(calls[1].body.events.length,1,'batch merges same listing');assert.equal(calls[1].body.events[0].dwellMs,4000);assert(calls[1].body.events[0].liked&&calls[1].body.events[0].shared);
 enabled=false;assert.equal(w.wishwaveSharedBoost(item),0);const n=calls.length;w.wishwaveSharedSignal(item,'like');await next();assert.equal(calls.length,n,'opt out stops telemetry');
 enabled=true;fail=true;w.wishwaveFetchSharedScores([{key:'ebay:43'}]);await next();assert.equal(w.wishwaveSharedRankingStatus().available,false);w.wishwaveSharedExposure(item,3000);assert.equal(w.wishwaveSharedRankingStatus().queued,0,'unavailable service stops telemetry without affecting feed');
 console.log('PASS: batched score lookup, bounded boosts, merged exposure/actions, opt-out, missing-worker fallback');
})().catch(e=>{console.error(e);process.exitCode=1});
