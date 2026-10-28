const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
 const server=http.createServer((req,res)=>{const file=path.join(root,new URL(req.url,'http://test').pathname);if(!file.startsWith(root)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(fs.readFileSync(file));});await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage'],headless:true});const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
  await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:')?r.continue():r.request().resourceType()==='image'?r.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#dedbd4"/></svg>'}):r.fulfill({status:200,contentType:'application/json',body:'{"items":[],"people":[],"conversations":[],"profile":{}}'}));
  await page.goto('http://127.0.0.1:'+server.address().port+'/findai-app.html');await page.waitForFunction(()=>document.querySelector('.ww-search-cancel'));await page.waitForTimeout(1100);

  await page.evaluate(()=>{window.findaiEnsureUsernameOnboarding=async()=>{};document.getElementById('findaiUsernameOnboarding').style.setProperty('display','none','important');document.documentElement.style.setProperty('--safe-top','49px');document.documentElement.style.setProperty('--safe-bottom','34px');window.wishwaveWarmReelDiscovery=async()=>[];window.wishwaveDiscoverySurfaces={claim:items=>items};});

  await page.evaluate(()=>{go('search');window.identityItems=Array.from({length:6},(_,i)=>({itemId:'identity-'+i,title:'Visible Lego set '+i,price:100+i,currency:'USD',source:'ebay',url:'https://www.ebay.com/itm/'+(123456789+i),image:'https://fixtures.test/product.png',status:'active'}));premiumDiscoverySections=[];wishwaveHydrateExploreCache({filter:'for-you',tasteSignature:wishwaveExploreTasteSignature(),items:identityItems});});
  await page.waitForFunction(()=>document.querySelectorAll('.premium-explore-tile').length===6);
  // A refresh can replace/reorder data while append-only tiles stay mounted.
  await page.evaluate(()=>{premiumDiscoverySections[0].items=identityItems.slice().reverse();});
  await page.locator('.premium-explore-tile>img').nth(1).tap();
  await page.waitForFunction(()=>document.getElementById('searchDetailOverlay').classList.contains('show'));
  assert.equal(await page.locator('#searchDetailOverlay .reel-card .title').first().textContent(),'Visible Lego set 1','tap opens the product painted on the card, despite reordered backing results');
  await page.evaluate(()=>window.__wishwaveCloseSearchReelV186());await page.waitForTimeout(700);
  // Keyboard activation must use the same painted identity, including a removed result.
  await page.evaluate(()=>{premiumDiscoverySections[0].items=identityItems.filter(x=>x.itemId!=='identity-3');});
  await page.locator('.premium-explore-tile').nth(3).focus();await page.locator('.premium-explore-tile').nth(3).press('Enter');
  await page.waitForFunction(()=>document.getElementById('searchDetailOverlay').classList.contains('show'));
  assert.equal(await page.locator('#searchDetailOverlay .reel-card .title').first().textContent(),'Visible Lego set 3');
  await page.evaluate(()=>window.__wishwaveCloseSearchReelV186());await page.waitForTimeout(700);
  // A provider update during a finger tap cannot change the selected item.
  await page.locator('.premium-explore-tile').nth(2).evaluate(host=>{
   const point={identifier:1,clientX:100,clientY:300};
   window.__wishwaveSearchListingTouch('touchstart',{target:host,touches:[point]});
   premiumDiscoverySections[0].items.splice(0,premiumDiscoverySections[0].items.length,...identityItems.slice().reverse());
   window.__wishwaveSearchListingTouch('touchend',{target:host,touches:[],preventDefault(){}});
  });
  await page.waitForFunction(()=>document.getElementById('searchDetailOverlay').classList.contains('show'));
  assert.equal(await page.locator('#searchDetailOverlay .reel-card .title').first().textContent(),'Visible Lego set 2');
  console.log('PASS: Search tap, keyboard and in-flight touch preserve the painted product despite reordered, removed or mutated backing results');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
