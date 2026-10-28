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
  // Every product chip must request its own inventory and never retain an unrelated grid.
  await page.evaluate(()=>{window.categoryRequests=[];window.peopleRequests=[];window.loadPremiumPeopleDiscovery=q=>peopleRequests.push(q);window.wishwaveFetchRecommendationResults=async query=>{categoryRequests.push(query);return {data:{listings:[]},hasMore:false,nextCursor:null};};});
  for(const label of categoryNames.slice(2)){
   await page.evaluate(()=>{categoryRequests=[];});
   const chip=page.locator('#premiumExploreChips button').filter({hasText:new RegExp('^'+label+'$')});await chip.scrollIntoViewIfNeeded();await chip.click();
   await page.waitForTimeout(250);
   assert.equal(await chip.evaluate(e=>e.classList.contains('active')),true,label+' stays selected');
   const requests=await page.evaluate(()=>categoryRequests);assert(requests.length>=3,label+' has specific inventory lanes');assert.equal(new Set(requests).size,requests.length,label+' does not refill with generic lanes after exhaustion');assert(!requests.includes('products'));
   assert.equal(await page.locator('#premiumDiscoverySections .premium-explore-tile').count(),0,label+' does not show previous category after no results');
   if(label==='Trading Cards')assert(requests.every(q=>/cards/.test(q)));
   if(label==='Comics')assert(requests.every(q=>/comic|manga/.test(q)));
   if(label==='Antiques')assert(requests.every(q=>/antique/.test(q)));
   assert.deepEqual(await page.locator('#premiumExploreChips button').allTextContents(),categoryNames,'category taps never reorder navigation');
  }
  await page.locator('[data-explore-filter="people"]').scrollIntoViewIfNeeded();await page.locator('[data-explore-filter="people"]').click();assert.equal(await page.evaluate(()=>peopleRequests.length),1,'People retains its existing discovery');assert.equal(await page.locator('#q').getAttribute('placeholder'),'Search people');
  console.log('PASS: image-led 3-column layout, both themes at 320/390/430px, contrast, correct reel opening, fixed 19-chip order, all category inventories, no unrelated fallback, People preserved');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
