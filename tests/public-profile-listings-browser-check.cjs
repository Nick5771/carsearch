const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
 const server=http.createServer((req,res)=>{const file=path.join(root,new URL(req.url,'http://test').pathname);if(!file.startsWith(root)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(fs.readFileSync(file));});await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage'],headless:true});const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
  await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:')?r.continue():r.request().resourceType()==='image'?r.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#dedbd4"/></svg>'}):r.fulfill({status:200,contentType:'application/json',body:'{"items":[],"people":[],"conversations":[],"profile":{}}'}));
  await page.goto('http://127.0.0.1:'+server.address().port+'/findai-app.html');await page.waitForFunction(()=>document.querySelector('.ww-search-cancel'));await page.waitForTimeout(1100);

  await page.evaluate(()=>{window.findaiEnsureUsernameOnboarding=async()=>{};document.getElementById('findaiUsernameOnboarding').style.setProperty('display','none','important');document.documentElement.style.setProperty('--safe-top','49px');document.documentElement.style.setProperty('--safe-bottom','34px');window.wishwaveWarmReelDiscovery=async()=>[];window.wishwaveDiscoverySurfaces={claim:items=>items};});

  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.evaluate(()=>{
   const user={email:'viewer@test',username:'viewer'};window.getAccountProfile=()=>user;window.marketplaceSession=()=>'viewer-session';window.findaiLoadRemoteProfile=async()=>user;saveAccountProfile(user);
   window.marketplaceFetch=async path=>{
    if(path==='/profile/public/nick')return {profile:{username:'nick',displayName:'Nick',bio:'I like to sell',location:'Syd'},sellerId:'nick-seller',activeCount:6,listings:Array.from({length:6},(_,i)=>({id:'real-route-'+i,title:'Monitor '+i,price:249,currency:'AUD',images:['https://fixtures.test/item.png'],status:'active',viewCount:234})),viewer:{signedIn:true,isFollowing:true,canViewListings:true}};
    return {items:[],listings:[],followers:2,following:3,viewer:{isFollowing:true},profile:user};
   };
  });
  await page.evaluate(()=>openFindAIProfileByUsername('nick'));await page.waitForTimeout(500);

  assert.equal(await page.locator('#wishwavePublicProfileContent .social-profile-tile').count(),6);
  assert.equal(await page.locator('#wishwavePublicProfileContent .social-profile-tile').first().isVisible(),true);
  // The grid remains sized with every image out of flow and no aspect-ratio support.
  await page.addStyleTag({content:'html body #wishwavePublicProfilePage#wishwavePublicProfilePage#wishwavePublicProfilePage .social-profile-tile{aspect-ratio:auto!important}'});
  const tileHeight=await page.locator('#wishwavePublicProfileContent .social-profile-tile').first().evaluate(e=>e.getBoundingClientRect().height);assert(tileHeight>100,'photo frame has intrinsic height even before the image loads');
  for(const theme of ['light','dark']){
   await page.evaluate(theme=>{applyAppTheme(theme);wishwavePublicSellerData.listings=[];wishwavePublicSellerData.seller.activeCount=0;renderWishWavePublicProfile();},theme);
   assert.equal(await page.locator('#wishwavePublicProfileContent').innerText(),'No listings yet\n\nThis user doesn’t have any listings yet.');assert.equal(await page.locator('#wishwavePublicProfileContent .social-profile-empty').isVisible(),true);
  }
  await page.evaluate(()=>{window.recoveryRequests=0;window.recoveryItems=Array.from({length:6},(_,i)=>({id:'recovered-'+i,title:'Recovered item '+i,price:100+i,currency:'AUD',image:'https://fixtures.test/recovered.png',status:'active'}));wishwavePublicSellerData.seller.activeCount=6;delete wishwavePublicSellerData._listingsRecovery;window.marketplaceFetch=path=>{recoveryRequests++;return new Promise(resolve=>window.finishRecovery=()=>resolve({seller:{...wishwavePublicSellerData.seller},listings:recoveryItems,viewer:{canViewListings:true}}));};renderWishWavePublicProfile();});
  await page.waitForFunction(()=>typeof finishRecovery==='function');assert.equal(await page.evaluate(()=>recoveryRequests),1);assert((await page.locator('#wishwavePublicProfileContent').innerText()).includes('Loading listings'));
  await page.evaluate(()=>finishRecovery());await page.waitForFunction(()=>document.querySelectorAll('#wishwavePublicProfileContent .social-profile-tile').length===6);
  await page.evaluate(()=>{wishwavePublicSellerData.listings=[];delete wishwavePublicSellerData._listingsRecovery;window.marketplaceFetch=async()=>{throw Error('offline');};renderWishWavePublicProfile();});
  await page.locator('.wishwave-public-listings-retry').waitFor();assert((await page.locator('#wishwavePublicProfileContent').innerText()).includes('Couldn’t load listings'));assert(!(await page.locator('#wishwavePublicProfileContent').innerText()).includes('No listings yet'));
  await page.evaluate(()=>{window.marketplaceFetch=async()=>({seller:{...wishwavePublicSellerData.seller},listings:recoveryItems,viewer:{canViewListings:true}});});await page.locator('.wishwave-public-listings-retry').click();await page.waitForFunction(()=>document.querySelectorAll('#wishwavePublicProfileContent .social-profile-tile').length===6);
  await page.evaluate(()=>{window.recoveryRequests=0;window.marketplaceFetch=async()=>{recoveryRequests++;return {};};wishwavePublicSellerData.listings=[];wishwavePublicSellerData.viewer.canViewListings=false;delete wishwavePublicSellerData._listingsRecovery;renderWishWavePublicProfile();});assert((await page.locator('#wishwavePublicProfileContent').innerText()).includes('This account is private'));assert.equal(await page.evaluate(()=>recoveryRequests),0,'private profiles do not trigger recovery or disclose listings');
  await page.evaluate(()=>{wishwavePublicSellerData.viewer.canViewListings=true;delete wishwavePublicSellerData._listingsRecovery;window.marketplaceFetch=()=>new Promise(resolve=>window.finishOldRecovery=()=>resolve({seller:{id:'nick-seller',activeCount:6},listings:recoveryItems}));renderWishWavePublicProfile();});await page.waitForFunction(()=>typeof finishOldRecovery==='function');
  await page.evaluate(()=>{wishwavePublicSellerData={seller:{id:'other',username:'other',displayName:'Other',activeCount:0},listings:[],viewer:{canViewListings:true}};renderWishWavePublicProfile();finishOldRecovery();});await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>wishwavePublicSellerData.seller.id),'other');assert((await page.locator('#wishwavePublicProfileContent').innerText()).includes('No listings yet'));
  console.log('PASS: full profile route, intrinsic photo-frame height, empty messages in both themes, missing listings recovery, visible failure and retry, private profile access, stale response protection');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
