const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
 const server=http.createServer((req,res)=>{const file=path.join(root,new URL(req.url,'http://test').pathname);if(!file.startsWith(root)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(fs.readFileSync(file));});await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage'],headless:true});const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
  await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:')?r.continue():r.request().resourceType()==='image'?r.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#dedbd4"/></svg>'}):r.fulfill({status:200,contentType:'application/json',body:'{"items":[],"people":[],"conversations":[],"profile":{}}'}));
  await page.goto('http://127.0.0.1:'+server.address().port+'/findai-app.html');await page.waitForFunction(()=>document.querySelector('.ww-search-cancel'));await page.waitForTimeout(1100);

  await page.evaluate(()=>{window.findaiEnsureUsernameOnboarding=async()=>{};document.getElementById('findaiUsernameOnboarding').style.setProperty('display','none','important');document.documentElement.style.setProperty('--safe-top','49px');document.documentElement.style.setProperty('--safe-bottom','34px');window.wishwaveWarmReelDiscovery=async()=>[];window.wishwaveDiscoverySurfaces={claim:items=>items};});

  const categoryNames=['For You','People','Trading Cards','Gaming','Fashion','Sneakers','Watches','Toys','Comics','Music','Sports','Cameras','Tech','Jewellery','Bags','Art','Books','Home','Antiques'];
  for(const width of [320,390,430])for(const theme of ['light','dark']){
   await page.setViewportSize({width,height:844});
   await page.evaluate(theme=>{window.__wishwaveCloseSearchReelV186?.();applyAppTheme(theme);go('search');window.cardFixtures=Array.from({length:9},(_,i)=>({itemId:'card-'+i,id:'card-'+i,title:i===0?'Air Jordan 4 Pine Green complete listing title':'Product '+i,price:i===0?134.99:28+i,currency:'AUD',url:'https://www.ebay.com/itm/'+(123456789+i),source:'ebay',image:'https://fixtures.test/product.png',images:['https://fixtures.test/product.png'],status:'active'}));premiumDiscoverySections=[];const ok=wishwaveHydrateExploreCache({filter:'for-you',tasteSignature:wishwaveExploreTasteSignature(),items:cardFixtures});if(!ok)throw Error('Fixture hydrate failed');},theme);
   await page.waitForTimeout(350);
   assert.deepEqual(await page.locator('#premiumExploreChips button').allTextContents(),categoryNames,'fixed category order');
   assert.equal(await page.locator('.wishwave-discover-title,.ww-explore-info,.ww-explore-save').count(),0,'no trial heading, footers or card saves');
   const styles=await page.locator('.premium-explore-grid').evaluate(grid=>{const cards=[...grid.children],c=cards[0],price=c.querySelector('.premium-explore-price'),source=c.querySelector('.premium-explore-source'),rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom}};return{columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length,cards:cards.map(rect),price:rect(price),source:rect(source),priceColor:getComputedStyle(price).color,border:getComputedStyle(c).borderTopWidth,radius:getComputedStyle(c).borderRadius,glass:getComputedStyle(document.querySelector('.premium-search-glass')).color,headHeight:document.querySelector('.premium-search-home-header').getBoundingClientRect().height};});
   assert.equal(styles.columns,3);assert.equal(styles.cards.length,9);assert.equal(styles.cards[0].y,styles.cards[2].y);assert(styles.cards[3].y>styles.cards[0].y);assert(styles.price.bottom<=styles.cards[0].bottom);assert(styles.source.bottom<=styles.price.y+1);assert.equal(styles.priceColor,'rgb(255, 255, 255)');assert.equal(styles.border,'0px');assert.equal(styles.radius,'0px');assert(styles.headHeight<160,'compact header includes safe area');assert.equal(styles.glass,theme==='light'?'rgb(17, 18, 20)':'rgb(245, 246, 247)');
   await page.evaluate(()=>document.getElementById('search').classList.add('live-search-interpreting'));assert.equal(await page.locator('.premium-search-glass').evaluate(e=>getComputedStyle(e).color),styles.glass,'typing keeps icon visible');await page.evaluate(()=>document.getElementById('search').classList.remove('live-search-interpreting'));
   await page.locator('.premium-explore-tile>img').first().tap();await page.waitForTimeout(300);assert.equal(await page.locator('#searchDetailOverlay .reel-card .title').first().textContent(),await page.evaluate(()=>cardFixtures[0].title),'tile opens its correct reel');await page.evaluate(()=>window.__wishwaveCloseSearchReelV186());
   if(width===390)await page.screenshot({path:'/tmp/discover-grid-'+theme+'.png'});
  }

  // Warm native Search must show loading, and explicit categories bypass passive recommendation rejection.
  await page.evaluate(()=>{
   window.gamingRequests=[];window.gamingResolvers=[];window.gamingReleased=false;window.passiveCalls=0;
   document.getElementById('search').classList.add('findai-v133-warm');
   window.wishwaveFetchRecommendationResults=async()=>{passiveCalls++;return {data:{listings:[]},hasMore:false};};
   window.wishwaveRecommendationCandidate=()=>false;window.wishwaveRecommendationRejected=()=>true;
   window.wishwaveDiscoverySurfaces={allowed:()=>false,claim:()=>[]};window.wishwaveDiscoveryRotation={allowed:()=>false};
   window.fetchProductResults=(query,options)=>new Promise(resolve=>{gamingRequests.push({query,passive:options.passive});const deliver=()=>resolve({data:{listings:[{itemId:'gaming-'+query,title:query+' complete product',price:99,currency:'USD',source:'ebay',url:'https://www.ebay.com/itm/'+(123456700+gamingRequests.length),image:'https://fixtures.test/gaming.png',images:['https://fixtures.test/gaming.png'],status:'active'}]},hasMore:false,nextCursor:null});if(gamingReleased)deliver();else gamingResolvers.push(deliver);});
  });
  await page.locator('[data-explore-filter="gaming"]').scrollIntoViewIfNeeded();await page.locator('[data-explore-filter="gaming"]').click();
  await page.waitForTimeout(100);assert.equal(await page.locator('.premium-explore-skeleton-grid').isVisible(),true,'warm category visibly loads');
  assert.equal(await page.evaluate(()=>gamingRequests.length),3);assert.equal(await page.evaluate(()=>gamingRequests.every(r=>r.passive===false)),true,'category gets foreground search budget');
  await page.evaluate(()=>{gamingReleased=true;gamingResolvers.forEach(resolve=>resolve());});await page.waitForTimeout(350);
  assert((await page.locator('.premium-explore-tile').count())>=3,'valid Gaming products survive passive Home filters');assert.equal(await page.evaluate(()=>passiveCalls),0,'category does not use recommendation retrieval');

  // Generic emulator spam and accessory matches cannot fill recognised product lanes.
  await page.evaluate(()=>{
   window.productRequests=[];window.runningProducts=0;window.maxRunningProducts=0;
   window.fetchProductResults=async query=>{
    productRequests.push(query);maxRunningProducts=Math.max(maxRunningProducts,++runningProducts);await new Promise(r=>setTimeout(r,30));runningProducts--;
    const make=(title,source,suffix)=>({itemId:query+suffix,title,price:99,currency:'USD',source,url:source==='ebay'?'https://www.ebay.com/itm/'+encodeURIComponent(query+suffix):'https://www.aliexpress.com/item/'+encodeURIComponent(query+suffix),image:'https://fixtures.test/product.png',status:'active'});
    const title=query.replace('Sony PlayStation 5 console','Sony PS5 console');
    return {data:{listings:[make('500 in 1 retro handheld emulator console','aliexpress','spam'),make('Protective case for '+title,'ebay','case'),make(title+' genuine product','aliexpress','ali'),make(title+' genuine product','ebay','ebay')]},hasMore:false,nextCursor:null};
   };
  });
  await page.locator('[data-explore-filter="fashion"]').scrollIntoViewIfNeeded();await page.locator('[data-explore-filter="fashion"]').click();await page.waitForTimeout(400);
  await page.locator('[data-explore-filter="gaming"]').scrollIntoViewIfNeeded();await page.locator('[data-explore-filter="gaming"]').click();await page.waitForTimeout(800);
  const opening=await page.evaluate(()=>premiumDiscoverySections[0].items);
  assert(opening.length>=6,'recognisable Gaming families fill the category');assert(opening.every(item=>!/500 in 1|Protective case/.test(item.title)),'generic and accessory listings rejected');
  assert(new Set(opening.slice(0,6).map(x=>x._browseLane)).size>=4,'opening grid varies product families');assert(opening.slice(0,6).every(x=>x.source==='ebay'),'higher quality marketplace matches lead each family');assert((await page.evaluate(()=>maxRunningProducts))<=3,'provider concurrency stays bounded');
  // Every product chip must request its own inventory and never retain an unrelated grid.
  await page.evaluate(()=>{window.categoryRequests=[];window.peopleRequests=[];window.loadPremiumPeopleDiscovery=q=>peopleRequests.push(q);window.fetchProductResults=async query=>{categoryRequests.push(query);return {data:{listings:[]},hasMore:false,nextCursor:null};};});
  for(const label of categoryNames.slice(2)){
   await page.evaluate(()=>{categoryRequests=[];});
   const chip=page.locator('#premiumExploreChips button').filter({hasText:new RegExp('^'+label+'$')});await chip.scrollIntoViewIfNeeded();await chip.click();
   await page.waitForTimeout(250);
   assert.equal(await chip.evaluate(e=>e.classList.contains('active')),true,label+' stays selected');
   const requests=await page.evaluate(()=>categoryRequests);assert(requests.length>=3,label+' has specific inventory lanes');assert.equal(new Set(requests).size,requests.length,label+' does not refill with generic lanes after exhaustion');assert(!requests.includes('products'));
   assert.equal(await page.locator('#premiumDiscoverySections .premium-explore-tile').count(),0,label+' does not show previous category after no results');
   if(label==='Trading Cards')assert(requests.every(q=>/cards|deck|booster/.test(q)));
   if(label==='Comics')assert(requests.every(q=>/comic|manga/.test(q)));
   if(label==='Antiques')assert(requests.some(q=>/antique/.test(q)));
   assert.deepEqual(await page.locator('#premiumExploreChips button').allTextContents(),categoryNames,'category taps never reorder navigation');
  }

  assert.equal(await page.locator('.ww-category-retry').isVisible(),true,'empty category offers a visible retry');
  await page.evaluate(()=>{window.fetchProductResults=async query=>({data:{listings:[{itemId:'retry-'+query,title:query+' collectible',price:50,currency:'USD',source:'ebay',url:'https://www.ebay.com/itm/123456789',image:'https://fixtures.test/retry.png',status:'active'}]},hasMore:false,nextCursor:null});});
  await page.locator('.ww-category-retry').click();await page.waitForTimeout(350);assert((await page.locator('.premium-explore-tile').count())>0,'retry recovers the selected category');assert.equal(await page.locator('[data-explore-filter="antiques"]').evaluate(e=>e.classList.contains('active')),true,'retry preserves category');
  await page.locator('[data-explore-filter="people"]').scrollIntoViewIfNeeded();await page.locator('[data-explore-filter="people"]').click();assert.equal(await page.evaluate(()=>peopleRequests.length),1,'People retains its existing discovery');assert.equal(await page.locator('#q').getAttribute('placeholder'),'Search people');
  console.log('PASS: warm loading, foreground category retrieval despite passive rejection, image-led 3-column layout, both themes at 320/390/430px, contrast, correct reel opening, fixed 19-chip order, all category inventories, no unrelated fallback, People preserved');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
