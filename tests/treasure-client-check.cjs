const fs=require('fs'),assert=require('assert'),{JSDOM,VirtualConsole}=require('jsdom'),policy=require('../findai-treasure-pilot.js');
const html=fs.readFileSync(__dirname+'/../findai-app.html','utf8').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'');
const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
const dom=new JSDOM(html,{url:'https://findai.test/?catalogue-test=1&treasure-test=1&country=US',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){w.eval(fs.readFileSync(__dirname+'/../findai-treasure-pilot.js','utf8'));w.matchMedia=()=>({matches:false,addEventListener(){},addListener(){}});w.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};w.ResizeObserver=class{observe(){}disconnect(){}};w.scrollTo=()=>{};w.HTMLElement.prototype.scrollTo=function(){};w.HTMLElement.prototype.scrollIntoView=function(){};w.fetch=async url=>String(url).includes('/recommendations/experiment')?{ok:true,json:async()=>({id:'shopping-v230',arm:'test'})}:{ok:true,json:async()=>({items:[],listings:[],version:208}),text:async()=>''};}});
(async()=>{
 await new Promise(r=>setTimeout(r,350));const w=dom.window;
 const lanes=w.featuredColdStart(1,'test');assert.equal(lanes.length,policy.previewTargets.length);assert(lanes.every(x=>x._treasureTargetId));
 assert(w.personalisedProfileSignature(lanes).includes('treasure-pilot-v238'));
 const query=policy.targets.find(x=>x.id==='FF359').query;
 const offer=title=>({title,itemId:title,source:'ebay',url:'https://www.ebay.com/itm/123',image:'https://i.ebayimg.com/123.jpg',price:60,currency:'USD'});
 assert(!w.wishwaveRecommendationCandidate(offer('LED Light Kit for LEGO 21345'),query));
 assert(w.wishwaveRecommendationCandidate(offer('LEGO Polaroid OneStep SX-70 Camera 21345 sealed'),query));
 let forwarded;w.fetch=async(url,options)=>{if(String(url).endsWith('/search'))forwarded=JSON.parse(options.body);return{ok:true,json:async()=>({listings:[],items:[]})};};
 await w.fetchProductResults(query,{skipResolve:true,passive:true});assert.equal(forwarded.country,'US','live fallback must use the selected pilot market');
 w.history.replaceState({},'','?catalogue-test=1&treasure-test=1&country=AU');assert(w.featuredColdStart(1,'test').every(x=>!x._treasureTargetId),'US pilot must not blank other markets');
 w.history.replaceState({},'','?catalogue-test=1&country=US');assert(w.featuredColdStart(1,'test').every(x=>!x._treasureTargetId),'normal production baseline retained');
 assert.equal(errors.length,0,JSON.stringify(errors));console.log('PASS: real client boot, opt-in US lanes, model filters, cache separation and other-market/production fallback');w.close();
})().catch(e=>{console.error(e);dom.window.close();process.exitCode=1});
