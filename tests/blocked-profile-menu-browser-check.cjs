const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
 const server=http.createServer((req,res)=>{const file=path.join(root,new URL(req.url,'http://test').pathname);if(!file.startsWith(root)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(fs.readFileSync(file));});await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage'],headless:true});const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
  await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:')?r.continue():r.fulfill({status:200,contentType:'application/json',body:'{"items":[],"conversations":[],"profile":{}}'}));
  await page.goto('http://127.0.0.1:'+server.address().port+'/findai-app.html');await page.waitForFunction(()=>document.getElementById('wwOffer'));
  await page.evaluate(()=>{
   const user={email:'viewer@test',username:'viewer'};window.getAccountProfile=()=>user;window.marketplaceSession=()=>'viewer-session';window.findaiEnsureUsernameOnboarding=async()=>{};window.findaiLoadRemoteProfile=async()=>user;saveAccountProfile(user);document.getElementById('findaiUsernameOnboarding').style.setProperty('display','none','important');
   window.blockedBack=false;window.failRelationship=false;window.blockCalls=[];window.menuToasts=[];window.toast=text=>menuToasts.push(text);
   window.marketplaceFetch=async(path,options={})=>{
    if(path==='/profile/public/nick'||path==='/profile/public/other'){await new Promise(resolve=>setTimeout(resolve,60));return {profile:{username:path.split('/').pop(),displayName:'',avatarUrl:'',bio:''},sellerId:'',listings:[],viewer:{signedIn:true,blockedViewer:true,blockedByViewer:blockedBack,restricted:true,canViewListings:false}};}
    if(path.startsWith('/social/relationship?')){if(failRelationship)throw Error('lookup failed');return {blockedViewer:true,blockedByViewer:blockedBack};}
    if(path==='/social/controls'){blockCalls.push({method:options.method,body:JSON.parse(options.body)});blockedBack=options.method==='POST';return {ok:true};}
    return {profile:user,items:[],listings:[],conversations:[],followers:0,following:0};
   };
  });
  await page.evaluate(()=>openFindAIProfileByUsername('nick'));await page.waitForFunction(()=>document.querySelector('#wishwavePublicProfilePage.ww-restricted-profile.show'));
  assert.equal(await page.locator('#wishwavePublicProfileBody .social-profile').count(),0,'restricted profile data stays hidden');assert.equal(await page.locator('#wishwavePublicProfilePage .findai-public-top-more').isEnabled(),true);
  await page.evaluate(()=>openFindAIProfileByUsername('other'));await page.waitForFunction(()=>wishwavePublicSellerData?.seller?.username==='other');await page.evaluate(()=>__wishwaveOriginSurface(document.querySelector('#wishwavePublicProfilePage .findai-public-top-more')).back());assert.equal(await page.locator('#wishwavePublicProfilePage').getAttribute('data-ww-profile-key'),'nick','Back restores the correct menu target');
  // The menu must survive a restricted/missing profile model, using the tapped route identity.
  await page.evaluate(()=>wishwavePublicSellerData=null);
  await page.locator('#wishwavePublicProfilePage .findai-public-top-more').click();await page.waitForFunction(()=>document.querySelector('[data-chat-action="block"]')?.disabled===false);assert.equal(await page.locator('[data-chat-action="block"] span').textContent(),'Block');assert.equal(await page.evaluate(()=>menuToasts.includes('Profile unavailable')),false);
  await page.locator('[data-chat-action="block"]').click();await page.locator('[data-chat-action="confirm-block"]').click();await page.waitForFunction(()=>blockedBack);assert.equal(await page.evaluate(()=>blockCalls[0].body.username),'nick');assert.equal(await page.locator('#wishwavePublicProfilePage').evaluate(e=>e.classList.contains('ww-restricted-profile')),true);
  await page.locator('#wishwavePublicProfilePage .findai-public-top-more').click();await page.waitForFunction(()=>document.querySelector('[data-chat-action="block"] span')?.textContent==='Unblock');await page.locator('[data-chat-action="block"]').click();await page.locator('.ww-unblock-dialog [data-cancel]').click();assert.equal(await page.evaluate(()=>blockedBack),true);await page.locator('[data-chat-action="cancel"]').click();
  await page.evaluate(()=>failRelationship=true);await page.locator('#wishwavePublicProfilePage .findai-public-top-more').click();await page.locator('[data-chat-action="retry-profile"]').waitFor();assert.equal(await page.locator('[data-chat-action="block"]').isEnabled(),true,'known block status survives a failed lookup');await page.evaluate(()=>failRelationship=false);await page.locator('[data-chat-action="retry-profile"]').click();await page.waitForFunction(()=>!document.querySelector('[data-chat-action="retry-profile"]'));assert.equal(await page.evaluate(()=>menuToasts.includes('Profile unavailable')),false);
  console.log('PASS: blocked viewer can always open the menu and block back, missing profile model retains route identity, reciprocal block stays private, failed lookup can retry');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
