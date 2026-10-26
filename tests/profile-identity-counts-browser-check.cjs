const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
 const server=http.createServer((req,res)=>{const file=path.join(root,new URL(req.url,'http://test').pathname);if(!file.startsWith(root)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(fs.readFileSync(file));});await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage'],headless:true});const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
  await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:')?r.continue():r.fulfill({status:200,contentType:'application/json',body:'{"items":[],"conversations":[],"profile":{}}'}));
  await page.goto('http://127.0.0.1:'+server.address().port+'/findai-app.html');await page.waitForFunction(()=>document.getElementById('wwOffer'));
  await page.evaluate(()=>{
   window.testUser={email:'owner@test',username:'owner'};window.getAccountProfile=()=>testUser;window.marketplaceSession=()=>'session-'+testUser.email;window.findaiEnsureUsernameOnboarding=async()=>{};document.getElementById('findaiUsernameOnboarding').style.setProperty('display','none','important');
   window.profileCalls=[];window.testToasts=[];window.toast=t=>testToasts.push(t);window.legacyBlocked=false;window.findaiLoadRemoteProfile=async()=>testUser;saveAccountProfile(testUser);
   localStorage.setItem('wishwave-connection-counts-v375:'+encodeURIComponent(testUser.email),JSON.stringify({followers:2,following:3}));
   window.marketplaceFetch=async(path,options={})=>{const method=options.method||'GET',body=options.body?JSON.parse(options.body):null;profileCalls.push({path,method,body});
    if(path==='/social/connections/%40me?counts=1')return new Promise(resolve=>window.releaseOwnCounts=resolve);
    if(path.startsWith('/social/connections/'))return {followers:2,following:3};
    if(path.startsWith('/social/relationship?'))return {blockedByViewer:legacyBlocked};
    if(path.startsWith('/social/controls?'))return {accounts:legacyBlocked?[{username:'',controlKey:'seller:legacy-Nick',displayName:"Nick O'Connor"}]:[]};
    if(path==='/social/controls'){legacyBlocked=method==='POST';return {ok:true};}
    if(path.startsWith('/social/follow-user/'))return {isFollowing:method==='POST',pending:false};
    if(path.startsWith('/marketplace/sellers/'))return {seller:{id:'legacy-Nick',username:'',displayName:'Nick',followerCount:2},viewer:{signedIn:true,blockedByViewer:legacyBlocked},listings:[]};
    return {profile:{},items:[],conversations:[],listings:[]};
   };
   paintSocialProfileHeader();
  });
  const own=()=>page.evaluate(()=>({followers:document.getElementById('socialFollowersValue').textContent,following:document.getElementById('socialFollowingValue').textContent}));
  assert.deepEqual(await own(),{followers:'2',following:'3'},'both cached counts paint synchronously');assert.equal(await page.locator('#socialFollowersValue').evaluate(e=>e.classList.contains('findai-followers-pending')),false);
  await page.evaluate(()=>{window.warmRequest=__findaiWarmFollowerCountV160(true);});assert.equal(await page.evaluate(()=>profileCalls.filter(x=>x.path==='/social/connections/%40me?counts=1').length),1,'startup and profile share the request');
  await page.evaluate(async()=>{releaseOwnCounts({followers:2,following:4});await warmRequest;});await page.waitForFunction(()=>document.getElementById('socialFollowingValue').textContent==='4');assert.deepEqual(await own(),{followers:'2',following:'4'});assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('wishwave-connection-counts-v375:'+encodeURIComponent(testUser.email))).following),4);
  // Another account must never inherit this account's following count.
  await page.evaluate(()=>{testUser={email:'other@test',username:'other'};saveAccountProfile(testUser);paintSocialProfileHeader();});assert.notEqual((await own()).following,'4');await page.evaluate(()=>{testUser={email:'owner@test',username:'owner'};saveAccountProfile(testUser);paintSocialProfileHeader();});assert.deepEqual(await own(),{followers:'2',following:'4'});
  await page.evaluate(()=>{ensureWishWavePublicProfilePage();wishwavePublicSellerData={seller:{id:'legacy-Nick',username:'',displayName:'Nick',activeCount:0,soldCount:0,followerCount:2},viewer:{signedIn:true,isFollowing:true},listings:[]};renderWishWavePublicProfile();document.getElementById('wishwavePublicProfilePage').classList.add('show');});
  await page.waitForFunction(()=>document.querySelector('#wishwavePublicProfileBody [data-connection-kind="following"] b')?.textContent==='3');
  const labels=await page.locator('#wishwavePublicProfileBody .social-profile-stats button span').allTextContents();assert.deepEqual(labels,['Listings','Followers','Following']);
  await page.locator('#wishwavePublicProfilePage .findai-public-top-more').click();await page.waitForFunction(()=>document.querySelector('[data-chat-action="block"]')?.disabled===false);assert.equal(await page.evaluate(()=>testToasts.includes('Profile unavailable')),false);assert(!(await page.locator('#appMpSheetBody').textContent()).includes('seller:'));await page.waitForTimeout(350);await page.locator('[data-chat-action="cancel"]').click({timeout:5000});
  await page.locator('#wishwavePublicFollowButton').click();await page.locator('.findai-unfollow-confirm .danger').click();await page.waitForFunction(()=>document.getElementById('wishwavePublicFollowButton').textContent==='Follow');assert(await page.evaluate(()=>profileCalls.some(x=>x.path==='/social/follow-user/seller%3Alegacy-Nick'&&x.method==='DELETE')),'unfollow uses the stable ID');
  await page.locator('#wishwavePublicFollowButton').click();await page.waitForFunction(()=>document.getElementById('wishwavePublicFollowButton').textContent==='Following');
  await page.locator('#wishwavePublicProfilePage .findai-public-top-more').click();await page.waitForFunction(()=>document.querySelector('[data-chat-action="block"]')?.disabled===false);await page.locator('[data-chat-action="block"]').click();await page.locator('[data-chat-action="confirm-block"]').click();await page.waitForFunction(()=>legacyBlocked);assert.equal(await page.locator('#wishwavePublicProfilePage').evaluate(e=>e.classList.contains('show')),true);assert.equal(await page.locator('#wishwavePublicFollowButton').textContent(),'Follow');
  await page.locator('#wishwavePublicProfilePage .findai-public-top-more').click();await page.waitForFunction(()=>document.querySelector('[data-chat-action="block"] span')?.textContent==='Unblock');await page.locator('[data-chat-action="block"]').click();assert((await page.locator('.ww-unblock-dialog').textContent()).includes('Unblock Nick?'));assert(!(await page.locator('.ww-unblock-dialog').textContent()).includes('seller:'));await page.locator('.ww-unblock-dialog [data-confirm]').click();await page.waitForFunction(()=>!legacyBlocked);
  await page.evaluate(()=>{closeWishWavePublicProfile();legacyBlocked=true;openAppSettings();findaiOpenSettingsPane('blocked');});await page.locator('#findaiControlList button').waitFor();await page.locator('#findaiControlList button').click();assert((await page.locator('.ww-unblock-dialog').textContent()).includes("Unblock Nick O'Connor?"));await page.locator('.ww-unblock-dialog [data-confirm]').click();await page.waitForFunction(()=>!legacyBlocked);assert(await page.evaluate(()=>profileCalls.some(x=>x.path==='/social/controls'&&x.method==='DELETE'&&x.body.username==='seller:legacy-Nick')));
  console.log('PASS: paired persistent counts, shared startup request, account isolation, legacy profile layout/menu/follow/unfollow/block/unblock with stable seller identity');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
