const fs=require('fs'),vm=require('vm'),assert=require('assert');
const html=fs.readFileSync(__dirname+'/../findai-app.html','utf8'),source=html.match(/<script id="wishwave-interest-core">([\s\S]*?)<\/script>/)[1];
const ctx=vm.createContext({});vm.runInContext(source,ctx);const T=ctx.WishWaveInterestCore;
const item=(id,title,extra={})=>({id,itemId:id,title,source:'ebay',price:100,currency:'AUD',image:'https://images.test/'+id+'.jpg',url:'https://www.ebay.com/itm/'+id,...extra});
const fixtures=[
 ['LEGO Technic Lamborghini supercar 42115','building_sets','lego','lego:technic:vehicles'],
 ['LEGO Star Wars Millennium Falcon spaceship 75313','building_sets','lego','lego:star wars:spacecraft'],
 ['LEGO Harry Potter Hogwarts castle 76419','building_sets','lego','lego:harry potter:castles'],
 ['LEGO minifigure Darth Vader','lego_minifigures','lego','brand:lego'],
 ['Porsche 911 diecast model car 1:18','diecast_vehicles','collectibles','diecast:scale:1:18'],
 ['Hot Wheels Porsche 911','diecast_vehicles','collectibles','toy-brand:hot wheels'],
 ['Hot Wheels track set toy cars','toy_vehicles','collectibles','type:toy_vehicles'],
 ['Remote control RC car 1:18','toy_vehicles','collectibles','type:toy_vehicles'],
 ['Porsche 911 coupe 2020','fullsize_vehicles','cars','type:fullsize_vehicles'],
 ['Ferrari red t-shirt','apparel','fashion','type:apparel'],
 ['LEGO empty box only 42115','accessory','lego','type:accessories']
];for(const [title,type,category,tag] of fixtures){const result=T.classify({title});assert.equal(result.type,type,title);assert.equal(result.category,category,title);assert(result.tags.some(x=>x.key===tag),title);}
assert(!T.classify({title:'LEGO empty box only'}).tags.some(x=>x.key==='brand:lego'));
assert.equal(T.classify({title:'Unknown collectible'}).confidence,'unknown');
assert.equal(T.classify({title:'42115',product:{brand:{name:'LEGO'},theme:'Technic'}}).category,'lego');
assert.equal(T.classify({title:'LEGO 42115',productType:'packaging'}).type,'accessory');
assert.equal(T.classify({title:'Porsche diecast model car',scale:'1:18'}).scale,'1:18');
assert(!T.classify({title:'LEGO compatible Technic supercar'}).tags.some(x=>x.key==='brand:lego'));
assert(T.classify({title:'LEGO StarWars spaceship'}).tags.some(x=>x.key==='lego:theme:star wars'));
assert(T.classify({title:'Building kit 42115',brand:'LEGO',theme:'Technic'}).tags.some(x=>x.key==='lego:theme:technic'));
let state={profile:{},journal:{}},now=Date.now();const technic=item('t1','LEGO Technic Ferrari supercar 42143');
state=T.update(state,technic,'attention',{ms:4500,ratio:2},now,'technic1');assert(Object.values(state.profile).every(x=>T.stats(x,now).confidence<.2));assert.equal(T.lanes(state.profile,now).length,0,'one pause cannot establish a lasting interest');
const before=JSON.stringify(state);assert.equal(JSON.stringify(T.update(state,technic,'attention',{ms:0},now,'technic1')),before,'background or unloaded-image time supplies no evidence');
state=T.update(state,technic,'like',{},now,'technic1');state=T.update(state,technic,'like',{},now,'technic1');const single=state.profile['lego:technic:vehicles'];assert.equal(single.products.length,1);assert(single.positive<=1.001);
for(let i=2;i<=12;i++)state=T.update(state,item('t'+i,'LEGO Technic Ferrari supercar '+(42143+i)),'like',{},now+i,'technic'+i);
const detected=T.stats(state.profile['lego:technic:vehicles'],now+12);assert(detected.confidence>=.7);assert(detected.positiveProducts>=10);assert(T.lanes(state.profile,now+12).some(x=>x.key==='lego:technic:vehicles'));
const sw=item('sw','LEGO Star Wars spaceship');assert(T.boost(state.profile,technic,now+12)>T.boost(state.profile,sw,now+12)+3,'specific theme must outrank broad brand affinity');
for(let i=0;i<10;i++)state=T.update(state,item('sw'+i,'LEGO Star Wars spaceship '+(75313+i)),'attention',{ms:300,ratio:.1},now+i,'star-wars'+i);
assert(T.boost(state.profile,technic,now+15)>T.boost(state.profile,sw,now+15));
const oldScore=T.stats(state.profile['lego:technic:vehicles'],now+15).score;state=T.update(state,technic,'unlike',{},now+16,'technic1');assert(T.stats(state.profile['lego:technic:vehicles'],now+16).score<oldScore);
const rejecting=T.update(state,technic,'notInterested',{scope:'family'},now+17,'technic1');const restored=T.update(rejecting,technic,'undoRejection',{},now+18,'technic1');assert(T.stats(restored.profile['lego:technic:vehicles'],now+18).score>T.stats(rejecting.profile['lego:technic:vehicles'],now+18).score);
const independent=T.update(state,item('d','Porsche 911 diecast model car 1:18'),'like',{},now+19,'diecast1');assert(independent.profile['type:diecast_vehicles']);assert(!independent.profile['type:fullsize_vehicles']);
let repeated={profile:{},journal:{}};for(let day=0;day<20;day++)repeated=T.update(repeated,technic,'like',{},now+day*86400000,'one-product');assert(T.stats(repeated.profile['lego:technic:vehicles'],now+20*86400000).confidence<.4,'repeat visits to one product cannot produce high confidence');
console.log('PASS: hierarchical LEGO themes, toy/model/real-car separation, accessories and metadata, qualified evidence, unique-product confidence, duplicate signal control, theme-specific ranking, skip refinement, unlike/Undo and repeated-product limits');

const {JSDOM,VirtualConsole}=require(process.env.WISHWAVE_TEST_JSDOM||'jsdom');const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
const dom=new JSDOM(html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,''),{url:'https://wishwave.test',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){w.matchMedia=()=>({matches:false,addEventListener(){},addListener(){}});w.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};w.ResizeObserver=class{observe(){}disconnect(){}};w.fetch=async()=>({ok:true,json:async()=>({items:[],listings:[],scores:{},version:208}),text:async()=>''});w.scrollTo=()=>{};w.HTMLElement.prototype.scrollTo=function(){};w.HTMLElement.prototype.scrollIntoView=function(){};}});
const w=dom.window,wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{await wait(400);w.eval("fetchProductResults=async()=>({hasMore:false,data:{listings:[]}});marketplaceSession=()=>'';");
 w.active=item('a','Nike Dunk Low');w.target=technic;w.eval("feedState={source:'personalised',seen:new Set(),familyCounts:new Map(),interests:[]};currentFeedItems=[active];activeReelIndex=0;");
 await w.toggleGenericLikeItem(w.target);assert(w.wishwaveDetectedInterests().some(x=>x.key==='lego:technic:vehicles'));assert(!w.wishwaveDetectedInterests().some(x=>x.key==='type:sneakers'),'Search save must not train the active Reel');
 const journal=w.localStorage.getItem('ww_topic_evidence_v227');w.setTracked(w.getTracked());w.setTracked(w.getTracked());assert.equal(w.localStorage.getItem('ww_topic_evidence_v227'),journal,'saved-item reads must not amplify evidence');
 w.saveAccountProfile({email:'a@example.test',name:'A'});w.eval("recordInterest('LEGO Star Wars','search',7)");assert.equal(w.wishwaveDetectedInterests().length,0,'search affects session, not lasting topic evidence');
 for(let i=0;i<8;i++){const row=item('t'+i,'LEGO Technic Ferrari supercar '+(42143+i));w.recordInterest(row.title,'like',15,{item:row});}
 const interests=w.scoredInterests(6);assert(interests.some(x=>x._topicKey==='lego:technic:vehicles'),'specific learned topic supplies retrieval lane');
 const lane=w.newPersonalisedLane(interests.find(x=>x._topicKey==='lego:technic:vehicles'));assert.equal(lane._topicKey,'lego:technic:vehicles');
 w.eval("feedState={source:'personalised',seen:new Set(),familyCounts:new Map(),interests:[]}");const matched=w.preparePersonalisedLaneItems([technic,item('real','Ferrari coupe 2020')],lane);assert(matched.some(x=>x.itemId==='t1'));assert(!matched.some(x=>x.itemId==='real'));
 const saved=w.localStorage.getItem('ww_topic_evidence_v227');w.saveAccountProfile({email:'b@example.test',name:'B'});assert.equal(w.wishwaveDetectedInterests().length,0);w.saveAccountProfile({email:'a@example.test',name:'A'});assert.equal(w.localStorage.getItem('ww_topic_evidence_v227'),saved);
 w.localStorage.setItem('findai_app_preferences_v136',JSON.stringify({personalized:false}));w.wishwaveObserveProduct(technic,'like');assert.equal(w.localStorage.getItem('ww_topic_evidence_v227'),saved);assert.equal(w.wishwaveDetectedInterests().length,0);
 assert(!w.document.querySelector('.ww-recommendation-options'));assert.equal(errors.length,0,JSON.stringify(errors));w.close();console.log('PASS: actual-product action attribution, saved evidence idempotence, session-only Search, specific retrieval and semantic admission, account isolation/restoration, opt-out and no added buttons');
})().catch(e=>{console.error(e);w.close();process.exitCode=1});
