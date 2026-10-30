const fs=require('fs'),vm=require('vm'),assert=require('assert');const worker=fs.readFileSync('findai-worker.js','utf8');const a=worker.indexOf('function wishwaveFilterSearchWindow('),b=worker.indexOf('const FX_FALLBACK',a),ctx={};vm.createContext(ctx);vm.runInContext(worker.slice(a,b),ctx);const filter=ctx.wishwaveFilterSearchWindow;
const rows=[{id:'us',price:20,currency:'USD',itemLocationCountry:'US',itemCreationDate:'2026-10-29'},{id:'au',price:25,currency:'AUD',itemLocationCountry:'AU',itemCreationDate:'2026-10-28'},{id:'unknown',price:10,currency:'AUD'},{id:'nz',price:50,currency:'NZD',itemLocationCountry:'NZ',itemCreationDate:'2026-10-30'}];const rates={USD:1,AUD:1.5,NZD:2};const ids=x=>Array.from(x,r=>r.id);
assert.deepEqual(ids(filter(rows,{sort:'price_asc',min:'',max:''},rates)),['unknown','au','us','nz']);assert.deepEqual(ids(filter(rows,{sort:'price_desc',min:'',max:''},rates)),['nz','us','au','unknown']);assert.deepEqual(ids(filter(rows,{location:'AU',min:'',max:''},rates)),['au']);assert.deepEqual(ids(filter(rows,{min:26,max:35},rates)),['us']);assert.deepEqual(ids(filter(rows,{sort:'newest',min:'',max:''},rates)),['nz','us','au','unknown']);assert.deepEqual(ids(filter(rows,{sort:'best',min:'',max:''},rates)),ids(rows));assert.deepEqual(rows.map(x=>x.id),['us','au','unknown','nz']);assert.equal(filter(rows,{location:'AU',min:100,max:200},rates).length,0);
const html=fs.readFileSync('findai-app.html','utf8');assert.equal((html.match(/searchFilters:window.wishwaveSearchFilterState\?\.\(\)/g)||[]).length,2,'Initial and paged requests share filters');assert(worker.includes('const listings=filtered.slice(windowOffset,windowOffset+limit)'));assert(html.includes('if(useTracker||searchFilters)throw error;'),'Unfiltered fallback must not leak');console.log('PASS: mixed-currency ordering/ranges, explicit AU location, dates, stable best match, empty results, nonmutating cache and paged request integration');

assert(worker.includes("const country=filters?.location==='AU'?'AU':explicit||requestedCountry(request,url);"));
assert(worker.includes("filters.push('itemLocationCountry:AU')"));
assert(worker.includes("sourceOffset,opts.locationCountry||''"));
assert(html.includes("const recovering=!constrained&&"));
console.log('PASS: AU catalogue selection and provider-side location constraint; no automatic empty filtered retry loop');
// Exercise result readiness without a browser: typing alone, stale responses,
// editing, empty filtered results, People, and clearing back to browsing.
{
 const listeners={},span={textContent:''},classes=new Set();
 let button;
 const chips={querySelector:()=>people?{}:null,parentNode:{classList:{toggle:(name,on)=>on?classes.add(name):classes.delete(name)}}};
 let people=false;
 const query={value:''};
 const document={getElementById:id=>id==='q'?query:id==='premiumExploreChips'?chips:id==='wwSearchFilterButton'?button:null,
  createElement:tag=>tag==='button'?(button={setAttribute(){},querySelector:()=>span}):{classList:chips.parentNode.classList,append(){},},
  addEventListener:(event,fn)=>listeners[event]=fn,querySelector:()=>({})};
 chips.before=()=>{};
 const context={window:{},document,MutationObserver:class{observe(){}},setTimeout:fn=>fn()};
 vm.runInNewContext(fs.readFileSync('wishwave-search-filters.js','utf8'),context);
 const input=value=>{query.value=value;listeners.input({target:{id:'q'}});};
 assert.equal(button.hidden,true);
 input('g');assert.equal(button.hidden,true);
 context.window.wishwaveSearchFiltersResultsReady('old query',4);assert.equal(button.hidden,true);
 context.window.wishwaveSearchFiltersResultsReady('g',0);assert.equal(button.hidden,true);
 context.window.wishwaveSearchFiltersResultsReady('g',4);assert.equal(button.hidden,false);
 input('gaming');assert.equal(button.hidden,false);
 context.window.wishwaveSearchFiltersResultsReady('gaming',0);assert.equal(button.hidden,false);
 people=true;listeners.click({target:{closest:()=>true}});assert.equal(button.hidden,true);
 people=false;listeners.click({target:{closest:()=>true}});assert.equal(button.hidden,false);
 input('');assert.equal(button.hidden,true);
 input('lego');assert.equal(button.hidden,true);
 const html=fs.readFileSync('findai-app.html','utf8');
 assert(!html.includes('<div class="wishwave-notification-tabs" role="tablist"'));
 assert(html.includes("notificationFilter='all';"));
 assert(html.includes('window.wishwaveSearchFiltersResultsReady?.(exploreLiveSearchQuery,items.length)'));
 console.log('PASS: result-gated filter, stale responses, editing/zero-results retention, People/clear reset and unified Activity');
}
