const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
 const server=http.createServer((req,res)=>{const file=path.join(root,new URL(req.url,'http://test').pathname);if(!file.startsWith(root)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(fs.readFileSync(file));});await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage'],headless:true});const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
  const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
  await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:')?r.continue():r.request().resourceType()==='image'?r.fulfill({status:200,contentType:'image/png',body:pixel}):r.fulfill({status:200,contentType:r.request().resourceType()==='script'?'text/javascript':'application/json',body:r.request().resourceType()==='script'?'':'{"items":[],"people":[],"conversations":[],"profile":{}}'}));
  await page.goto('http://127.0.0.1:'+server.address().port+'/findai-app.html');await page.waitForFunction(()=>document.querySelector('.ww-search-cancel'));await page.waitForTimeout(1100);
  await page.evaluate(()=>{window.findaiEnsureUsernameOnboarding=async()=>{};document.getElementById('findaiUsernameOnboarding').style.setProperty('display','none','important');document.documentElement.style.setProperty('--safe-top','49px');document.documentElement.style.setProperty('--safe-bottom','34px');window.wishwaveWarmReelDiscovery=async()=>[];});
  const measure=async selector=>page.locator(selector).first().evaluate(card=>{let out={};for(let sel of ['&','.hero-stage','.hero-image','.reel-gallery-dots','.product-panel','.source-chip','.title','.price','.listing-meta','.reel-actions-rail','.price-action-row','.reel-social-action.like','.reel-social-action.comment','.reel-social-action.compare','.reel-social-action.share','.reel-social-action.more','.ww-native-reel-actions','.reel-seller-row']){let e=sel==='&'?card:card.querySelector(sel);if(!e)continue;let r=e.getBoundingClientRect(),s=getComputedStyle(e);out[sel]={x:r.x,y:r.y,w:r.width,h:r.height,bg:s.background,pad:s.padding,font:s.fontSize,line:s.lineHeight,gap:s.gap};}return out;});
  for(const width of [320,390,430])for(const theme of ['dark','light'])for(const source of ['ebay','findai']){
   await page.setViewportSize({width,height:width===320?667:844});
   await page.evaluate(({source,theme})=>{window.__wishwaveCloseSearchReelV186();applyAppTheme(theme);go('discover');window.fixture={itemId:'fixture',id:'fixture',title:'Lego SpongeBob 3826 complete set',price:250,currency:'AUD',url:'https://www.ebay.com/itm/123456789',source,seller:'Nick',sellerId:'other-seller',condition:'Used',image:'https://fixtures.test/listing.png',images:['https://fixtures.test/listing.png','https://fixtures.test/listing2.png'],status:'active'};currentFeedItems=[fixture];currentFeedData={personalised:true};feedState={source:'personalised',loading:false,hasMore:false};document.getElementById('personalFeed').innerHTML=renderReelCard(fixture,0,currentFeedData);},{source,theme});
   await page.waitForTimeout(450);const home=await measure('#personalFeed .reel-card');assert(home['.hero-image'],'fixture includes media');if(source==='findai')assert(home['.ww-native-reel-actions'],'native purchase controls present');
   if(process.env.WISHWAVE_SCREENSHOT_DIR&&width===390&&theme==='light'&&source==='ebay')await page.screenshot({path:path.join(process.env.WISHWAVE_SCREENSHOT_DIR,'home-header.png')});
   await page.evaluate(()=>go('searchResults'));await page.waitForTimeout(450);
   await page.evaluate(()=>{document.getElementById('premiumResultQuery').value='lego';premiumResultItems=[fixture];premiumResultData={personalised:true};document.getElementById('premiumResultQuery').focus();document.body.classList.add('wishwave-search-editing');openPremiumResultItem(0);});await page.waitForTimeout(650);
   assert.equal(await page.evaluate(()=>document.body.classList.contains('wishwave-search-editing')),false,'opening a listing ends Search editing');
   const navState=await page.locator('#wishwaveMainNav').evaluate(nav=>{const s=getComputedStyle(nav),r=nav.getBoundingClientRect();return {visible:s.visibility,opacity:s.opacity,bottom:r.bottom,top:r.top};});
   assert.equal(navState.visible,'visible');assert.equal(navState.opacity,'1');
   const baseline=await page.locator('#searchDetailOverlay').evaluate(view=>({view:view.getBoundingClientRect().bottom,app:view.closest('.app').getBoundingClientRect().bottom}));
   assert(Math.abs(baseline.view-baseline.app)<1,'Search reel fills the same app canvas as Home');
   const search=await measure('#searchDetailOverlay .reel-card');for(const part of ['.product-panel','.title','.price','.listing-meta','.reel-actions-rail','.ww-native-reel-actions'])assert.deepStrictEqual(search[part],home[part],`${width} ${theme} ${source}: shared caption and actions ${part}`);
   assert.equal(await page.locator('#searchDetailOverlay .discover-social-brand').count(),0,'Search has no Home wordmark');
   assert.equal(await page.locator('#searchDetailOverlay [data-reel-feed]').count(),6,'Search retains all swipeable feed shortcuts');
   assert.equal(await page.locator('#searchDetailOverlay .ww-search-listing-query span').textContent(),'lego');
   const topGeometry=await page.locator('#searchDetailOverlay .ww-search-listing-topbar').evaluate(bar=>{const r=bar.getBoundingClientRect(),q=bar.querySelector('.ww-search-listing-query').getBoundingClientRect(),b=bar.querySelector('.ww-search-listing-back').getBoundingClientRect(),style=getComputedStyle(bar);return {background:style.backgroundColor,image:style.backgroundImage,width:r.width,queryWidth:q.width,right:r.right-q.right,backLeft:b.left-r.left};});
   assert.equal(topGeometry.background,'rgba(0, 0, 0, 0)','header lets full-canvas photos show through');assert.equal(topGeometry.image,'none');
   assert(topGeometry.queryWidth/topGeometry.width>.79,'query occupies most of the row');assert(topGeometry.right<=13,'query extends to right inset');assert(topGeometry.backLeft<=5,'back arrow sits toward left edge');
   const headerHeight=await page.locator('#searchDetailOverlay .ww-search-listing-topbar').evaluate(e=>e.getBoundingClientRect().height);assert(headerHeight<=160,'two tidy rows including top safe area');

   if(process.env.WISHWAVE_SCREENSHOT_DIR&&width===390&&theme==='light'&&source==='ebay'){await page.evaluate(()=>document.elementFromPoint(350,70));await page.screenshot({path:path.join(process.env.WISHWAVE_SCREENSHOT_DIR,'search-listing-parity.png')});}
   assert.equal(await page.evaluate(()=>document.body.dataset.activeTab),'searchResults');
   await page.evaluate(()=>window.__wishwaveCloseSearchReelV186());assert.equal(await page.locator('#premiumResultQuery').inputValue(),'lego','Back preserves the search');
  }
  console.log('PASS: compact Search header, visible navigation, Home caption/action alignment at 320/390/430px in dark/light mode; Back preserves Search');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
