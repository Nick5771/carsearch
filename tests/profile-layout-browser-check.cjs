const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert');
const {chromium:pw}=require('playwright');
const root=path.resolve(__dirname,'..');
const screenshots=process.env.WISHWAVE_SCREENSHOT_DIR;
if(screenshots)fs.mkdirSync(screenshots,{recursive:true});
(async()=>{
 const server=http.createServer((req,res)=>{const file=path.join(root,new URL(req.url,'http://test').pathname);if(!file.startsWith(root)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(fs.readFileSync(file));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await pw.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage'],headless:true});
  const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  await page.route('**/*',route=>{if(route.request().url().startsWith('http://127.0.0.1:'))return route.continue();return route.fulfill({status:200,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET, POST, OPTIONS, DELETE'},contentType:'application/json',body:JSON.stringify({items:[],listings:[],conversations:[],profile:{username:route.request().url().includes('/profile/public/')?'blockedfixture':'fixture',displayName:'Fixture'},sellerId:'fixture',viewer:{signedIn:true,canViewListings:true,blockedByViewer:route.request().url().includes('/profile/public/')},followers:0,following:0})});});
  await page.goto('http://127.0.0.1:'+server.address().port+'/findai-app.html?country=US');
  await page.waitForFunction(()=>typeof window.renderWishWavePublicProfile==='function'&&typeof window.wishwaveOpenConnections==='function');
  await page.evaluate(()=>{
   window.getAccountProfile=()=>({email:'fixture@test',username:'fixture'});window.marketplaceSession=()=> 'fixture-session';
   
   document.documentElement.classList.remove('findai-light');document.body.dataset.activeTab='profile';document.querySelectorAll('.screen').forEach(x=>x.classList.toggle('active',x.id==='profile'));
   document.getElementById('profileSignedIn').hidden=false;document.getElementById('profileSignedOut').hidden=true;
   document.getElementById('socialProfileHandle').textContent='fixture';document.getElementById('profileName').textContent='Fixture';
   window.renderSocialProfileContent();
  });
  const labels=await page.locator('#profileSignedIn .wishwave-profile-tab-label').allTextContents();assert.deepEqual(labels,['Listings','Sold','Saved']);
  for(const node of await page.locator('#profileSignedIn .wishwave-profile-tab-label').all())assert(await node.isVisible());
  const line=await page.locator('#profileSignedIn .social-profile-tabs').evaluate(el=>{const s=getComputedStyle(el,'::after');return {content:s.content,display:s.display,height:s.height,width:s.width,background:s.backgroundColor}});assert.notEqual(line.content,'none');assert.equal(line.height,'2px');assert.notEqual(line.display,'none');assert(parseFloat(line.width)>100);assert.equal(line.background,'rgb(241, 242, 244)');
  const spacing=await page.evaluate(()=>{const tabs=document.querySelector('#profileSignedIn .social-profile-tabs').getBoundingClientRect(),content=document.getElementById('socialProfileContent').getBoundingClientRect();return {tabBottom:tabs.bottom,contentTop:content.top,child:document.getElementById('socialProfileContent').firstElementChild.outerHTML.slice(0,100),margin:getComputedStyle(document.getElementById('socialProfileContent').firstElementChild).margin}});assert(spacing.contentTop>=spacing.tabBottom,'Listings content must not cover the labels or underline');
  if(screenshots)await page.screenshot({path:path.join(screenshots,'own-profile-v351.png')});
  await page.evaluate(async()=>{await window.openFindAIProfileByUsername('blockedfixture');document.body.dataset.activeTab='messages';});
  const follow=page.locator('#wishwavePublicFollowButton'),message=page.locator('#wishwavePublicMessageButton');
  const a=await follow.boundingBox(),b=await message.boundingBox();assert(a&&b);assert(Math.abs(a.width-b.width)<1,'public buttons have equal widths');assert(a.width>140);assert(Math.abs(a.y-b.y)<1);
  // A restored profile may retain its blocked DOM before its model is restored.
  await page.evaluate(()=>{wishwavePublicSellerData=null});
  await follow.click();await page.locator('#toast.show').waitFor({state:'visible'});assert.equal(await page.locator('#toast').innerText(),'Unblock user to follow them');
  const layers=await page.evaluate(()=>({toast:+getComputedStyle(document.getElementById('toast')).zIndex,profile:+getComputedStyle(document.getElementById('wishwavePublicProfilePage')).zIndex}));assert(layers.toast>layers.profile);
  if(screenshots)await page.screenshot({path:path.join(screenshots,'blocked-profile-v351.png')});
  console.log(JSON.stringify({result:'PASS',labels,underline:line,buttonWidths:[a.width,b.width],layers}));
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
