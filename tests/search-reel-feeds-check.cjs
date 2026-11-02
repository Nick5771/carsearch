const fs=require('fs'),vm=require('vm'),assert=require('assert');const html=fs.readFileSync('findai-app.html','utf8');
(async()=>{
 const requests=[],buttons=['following','for-you','trending','deals','auctions','collectibles'].map(mode=>({dataset:{reelFeed:mode},setAttribute(key,value){this[key]=value;}}));
 const feed={innerHTML:'original',scrollTop:120,querySelector:()=>null,insertAdjacentHTML(where,markup){this.innerHTML+=markup;}},count={};let opened=true,tracked=0;
 const original=[{id:'original'}];
 const ctx={console,AbortController,Map,Set,encodeURIComponent,document:{},WORKER_BASE:'https://test',currentFeedItems:original,currentFeedData:{personalised:true},feedState:{},activeReelIndex:2,reelSession:1,moreReels:null,
  overlay:()=>({dataset:{reelOwner:'search'},querySelectorAll:()=>buttons}),reelFeed:()=>feed,countNode:()=>count,isOpen:()=>opened,
  keyOf:item=>item.id,cleanList:items=>items,wishwaveAllowedListing:()=>true,marketplaceSession:()=>'',appShoppingRegion:()=> 'AU',marketplaceHeaders:()=>({}),
  renderReelCard:item=>'<article>'+item.id+'</article>',attachReelObserver(){},beginReelTracking(){tracked++;},finaliseReelTracking(){},preloadPersonalisedImages(){},
  setTimeout:fn=>fn(),appFetchJsonTimed:(url,options)=>new Promise((resolve,reject)=>requests.push({url,resolve,reject,options}))};ctx.window=ctx;vm.createContext(ctx);
 const a=html.indexOf('  // Search owns these feed selections;'),b=html.indexOf('  function cloneFeedState(value){',a);vm.runInContext(html.slice(a,b),ctx);
 vm.runInContext("searchFeedModes.set('for-you',{items:currentFeedItems,data:currentFeedData,scroll:120,active:2,more:()=>{}})",ctx);
 const deals=ctx.wishwaveSetSearchReelFeed('deals');assert(feed.innerHTML.includes('Loading Deals'));assert.equal(buttons[3]['aria-selected'],'true');
 const trending=ctx.wishwaveSetSearchReelFeed('trending');assert.equal(requests[0].options.signal.aborted,true);
 requests[1].resolve({items:[{id:'trend'}],hasMore:false});await trending;assert.equal(ctx.currentFeedItems[0].id,'trend');assert(feed.innerHTML.includes('trend'));
 requests[0].resolve({items:[{id:'stale-deal'}],hasMore:false});await deals;assert.equal(ctx.currentFeedItems[0].id,'trend','old response cannot overwrite newly chosen feed');
 await ctx.wishwaveSetSearchReelFeed('for-you');assert.equal(ctx.currentFeedItems,original);assert.equal(feed.scrollTop,120);assert.equal(ctx.activeReelIndex,2);assert.equal(buttons[1]['aria-selected'],'true');
 await ctx.wishwaveSetSearchReelFeed('following');assert(feed.innerHTML.includes('Sign in'));assert.equal(opened,true);
 const failure=ctx.wishwaveSetSearchReelFeed('deals');requests[2].reject(new Error('offline'));await failure;assert(feed.innerHTML.includes('Try again'));
 opened=false;await ctx.wishwaveSetSearchReelFeed('trending');assert.equal(requests.length,3);
 console.log('PASS: in-place feed selection, visible progress, stale response rejection, For You position restore, guest Following, retry and closed-view guard');
})().catch(error=>{console.error(error);process.exitCode=1;});
