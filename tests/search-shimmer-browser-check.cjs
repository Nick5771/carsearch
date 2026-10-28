const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
 const server=http.createServer((req,res)=>{const file=path.join(root,new URL(req.url,'http://test').pathname);if(!file.startsWith(root)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(fs.readFileSync(file));});await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage'],headless:true});const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
  await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:')?r.continue():r.fulfill({status:200,contentType:'application/json',body:'{"items":[],"people":[],"conversations":[],"profile":{}}'}));
  await page.goto('http://127.0.0.1:'+server.address().port+'/findai-app.html');await page.waitForFunction(()=>document.querySelector('.ww-search-cancel'));await page.waitForTimeout(1100);
  await page.evaluate(()=>{window.findaiEnsureUsernameOnboarding=async()=>{};document.getElementById('findaiUsernameOnboarding').style.setProperty('display','none','important');window.wishwaveDiscoverySurfaces={claim:items=>items};go('search');});
  for(const theme of ['dark','light']){
   await page.evaluate(theme=>{applyAppTheme(theme);window.searchDeliveries=[];window.fetchProductResults=query=>new Promise(resolve=>searchDeliveries.push(()=>resolve({data:{listings:[{itemId:'shimmer-'+query,title:query+' complete set',price:50,currency:'USD',source:'ebay',url:'https://www.ebay.com/itm/123456789',image:'https://fixture.test/lego.png',status:'active'}]},hasMore:false,nextCursor:null})));},theme);
   await page.locator('#q').fill('lego harry potter '+theme);await page.locator('#q').press('Enter');
   await page.waitForFunction(()=>searchDeliveries.length>0&&!document.getElementById('wwSearchLoading').hidden);
   const geometry=await page.locator('#wwSearchLoading').evaluate(e=>{const grid=e.firstChild,tile=grid.firstChild,r=e.getBoundingClientRect(),header=document.querySelector('.premium-search-home-header').getBoundingClientRect(),t=tile.getBoundingClientRect();return {top:r.top,header:header.bottom,width:r.width,height:r.height,columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length,count:grid.children.length,tileWidth:t.width,tileHeight:t.height,colour:getComputedStyle(tile).backgroundColor,animation:getComputedStyle(tile,'::after').animationName};});
   assert.equal(geometry.columns,3);assert.equal(geometry.count,12);assert(Math.abs(geometry.top-geometry.header)<1,'grid starts below category chips');assert(geometry.width>380&&geometry.height>300,'grid fills results canvas');assert(Math.abs(geometry.tileWidth/geometry.tileHeight-.75)<.01);assert.equal(geometry.animation,'wwSearchShimmer');assert.equal(geometry.colour,theme==='dark'?'rgb(32, 34, 37)':'rgb(238, 239, 241)');
   assert.equal(await page.locator('.ww-search-spinner').count(),0,'old standalone spinner removed');
   await page.screenshot({path:'/tmp/search-shimmer-'+theme+'.png'});
   await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.ww-search-shimmer-tile').first().evaluate(e=>getComputedStyle(e,'::after').animationName),'none');await page.emulateMedia({reducedMotion:'no-preference'});
   await page.evaluate(()=>searchDeliveries.forEach(deliver=>deliver()));await page.waitForFunction(()=>document.querySelector('.premium-explore-tile')&&document.getElementById('wwSearchLoading').hidden);
   assert.equal(await page.locator('.premium-explore-tile').first().isVisible(),true,'first returned product appears without waiting for a full grid');
  }
  console.log('PASS: real delayed search uses 3-column shimmer below chips in both themes; reduced motion; first result replaces loader immediately');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
