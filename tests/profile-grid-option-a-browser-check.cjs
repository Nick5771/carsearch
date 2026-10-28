const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
 const server=http.createServer((req,res)=>{const file=path.join(root,new URL(req.url,'http://test').pathname);if(!file.startsWith(root)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(fs.readFileSync(file));});await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage'],headless:true});const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
  await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:')?r.continue():r.request().resourceType()==='image'?r.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#dedbd4"/></svg>'}):r.fulfill({status:200,contentType:'application/json',body:'{"items":[],"people":[],"conversations":[],"profile":{}}'}));
  await page.goto('http://127.0.0.1:'+server.address().port+'/findai-app.html');await page.waitForFunction(()=>document.querySelector('.ww-search-cancel'));await page.waitForTimeout(1100);

  await page.evaluate(()=>{window.findaiEnsureUsernameOnboarding=async()=>{};document.getElementById('findaiUsernameOnboarding').style.setProperty('display','none','important');document.documentElement.style.setProperty('--safe-top','49px');document.documentElement.style.setProperty('--safe-bottom','34px');window.wishwaveWarmReelDiscovery=async()=>[];window.wishwaveDiscoverySurfaces={claim:items=>items};});

  await page.evaluate(()=>go('profile'));await page.waitForTimeout(600);
  await page.evaluate(()=>{ensureWishWavePublicProfilePage();wishwavePublicSellerData={seller:{id:'nick',username:'nick',displayName:'Nick',activeCount:6},viewer:{signedIn:true,isFollowing:true},listings:Array.from({length:6},(_,i)=>({id:'listing-'+i,title:'Profile item '+i,price:i===3?55000:249+i,currency:'USD',image:'https://fixtures.test/product.png',viewCount:[234,44,35,328,594,46][i],status:'active'}))};renderWishWavePublicProfile();document.getElementById('profileSignedIn').innerHTML='<div class="social-profile-grid">'+wishwavePublicSellerData.listings.map((item,i)=>socialProfileTile(item,i,'listings')).join('')+'</div>';document.getElementById('profileSignedIn').style.display='block';document.getElementById('wishwavePublicProfilePage').classList.add('show');});
  for(const width of [320,390,430])for(const theme of ['light','dark']){
   await page.setViewportSize({width,height:844});await page.evaluate(theme=>applyAppTheme(theme),theme);await page.waitForTimeout(350);
   for(const root of ['#profileSignedIn','#wishwavePublicProfileContent']){
    const g=await page.locator(root+' .social-profile-grid').evaluate(grid=>{const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};return {gap:getComputedStyle(grid).gap,cards:[...grid.children].map(e=>({rect:rect(e),radius:getComputedStyle(e).borderRadius,price:rect(e.querySelector('.social-profile-tile-price')),views:rect(e.querySelector('.social-profile-tile-stats')),bg:getComputedStyle(e.querySelector('.social-profile-tile-stat')).backgroundColor,icon:rect(e.querySelector('.social-profile-tile-stat svg'))}))};});
    assert.equal(g.gap,'2px');assert.equal(g.cards.length,6);
    for(let i=0;i<g.cards.length;i++){const c=g.cards[i];assert.equal(c.radius,'0px');assert(Math.abs(c.rect.width/c.rect.height-.75)<.01);assert.equal(c.bg,'rgba(0, 0, 0, 0)');assert.equal(c.icon.width,12);assert(c.price.right<=c.views.x+1,'long price and view count never overlap');assert(c.views.bottom<=c.rect.bottom);if(i%3)assert(Math.abs(c.rect.y-g.cards[i-i%3].rect.y)<1,'row tiles align');}
   }
   assert.equal(await page.locator('#wishwavePublicProfilePage').isVisible(),true);
   const buttons=await page.evaluate(()=>['wishwavePublicFollowButton','wishwavePublicMessageButton'].map(id=>{const s=getComputedStyle(document.getElementById(id));return {bg:s.backgroundColor,border:s.borderColor,colour:s.color};}));assert.deepEqual(buttons[0],buttons[1],'Following and Message colours match in '+theme);
   if(width===390)await page.screenshot({path:'/tmp/profile-option-a-'+theme+'.png'});
  }
  console.log('PASS: aligned 3-column profile grids, 2px gutters, unboxed small views, non-overlapping long prices and matching action colours in both themes at 320/390/430px');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
