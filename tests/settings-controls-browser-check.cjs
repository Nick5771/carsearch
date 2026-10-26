const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
 const server=http.createServer((req,res)=>{const file=path.join(root,new URL(req.url,'http://test').pathname);if(!file.startsWith(root)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(fs.readFileSync(file));});await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage'],headless:true});const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
  await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:')?r.continue():r.fulfill({status:200,contentType:'application/json',body:'{"items":[],"conversations":[],"profile":{}}'}));
  await page.goto('http://127.0.0.1:'+server.address().port+'/findai-app.html');await page.waitForFunction(()=>document.getElementById('wwOffer'));
  await page.evaluate(()=>{
   window.getAccountProfile=()=>({email:'fixture@test',username:'fixture'});window.marketplaceSession=()=>'fixture';window.findaiEnsureUsernameOnboarding=async()=>{};document.getElementById('findaiUsernameOnboarding').style.setProperty('display','none','important');
   window.controlDeletes=0;window.controlBlocked=true;window.controlFailure=false;window.delayControls=false;
   window.marketplaceFetch=async(path,options={})=>{
    if(path==='/social/controls'&&options.method==='DELETE'){window.controlDeletes++;if(window.controlFailure)throw Error('Offline');window.controlBlocked=false;return {ok:true};}
    if(path.startsWith('/social/relationship?'))return {blockedByViewer:true};
    if(path.startsWith('/social/controls?')){if(window.delayControls)await new Promise(resolve=>window.releaseControlList=resolve);return {accounts:window.controlBlocked?[{username:'nick',displayName:'Nick'}]:[]};}
    return {profile:{},accounts:[],conversations:[]};
   };
   document.documentElement.style.setProperty('--safe-top','49px');openAppSettings();
  });
  const heading=()=>page.locator('#appThemeOverlay h2').textContent();
  const openBlocked=async()=>{await page.locator('#appThemeOverlay .findai-settings-row').filter({hasText:'Privacy & recommendations'}).click();await page.locator('#appThemeOverlay .findai-settings-row').filter({hasText:'Blocked accounts'}).click();await page.locator('#findaiControlList button').waitFor();};
  const swipeBack=async()=>{
   await page.evaluate(()=>{const target=document.querySelector('#appThemeOverlay .findai-settings-detail')||document.querySelector('#appThemeOverlay .findai-settings-page');const event=x=>({target,touches:[{clientX:x,clientY:350}],changedTouches:[{clientX:x,clientY:350}],cancelable:true,preventDefault(){},stopPropagation(){}});__wishwavePageTouch('touchstart',event(10));__wishwavePageTouch('touchmove',event(200));const preview=document.querySelector('[data-origin-preview]');window.lastSettingsPreview=preview?.querySelector('.findai-settings-head h2')?.textContent;__wishwavePageTouch('touchend',event(280));});await page.waitForTimeout(650);
  };
  await openBlocked();const depth=await page.evaluate(()=>wishwaveNavigationOrigins().length);
  await page.locator('#findaiControlList button').click();assert((await page.locator('.ww-unblock-dialog').textContent()).includes('Unblock @nick?'));await page.locator('.ww-unblock-dialog [data-cancel]').click();assert.equal(await page.evaluate(()=>controlDeletes),0);assert.equal(await page.locator('#findaiControlList button').count(),1);
  await swipeBack();assert.equal(await heading(),'Privacy','swiping the untouched list returns to Privacy');assert.equal(await page.evaluate(()=>lastSettingsPreview),'Privacy','the swipe reveals Privacy throughout the transition');await page.locator('#appThemeOverlay .findai-settings-row').filter({hasText:'Blocked accounts'}).click();await page.locator('#findaiControlList button').waitFor();
  await page.evaluate(()=>controlFailure=true);await page.locator('#findaiControlList button').click();await page.locator('.ww-unblock-dialog [data-confirm]').click();await page.waitForFunction(()=>document.querySelector('#findaiControlList button')?.disabled===false);assert.equal(await page.locator('#findaiControlList button').count(),1,'failed unblock keeps the account');await page.evaluate(()=>controlFailure=false);
  await page.locator('#findaiControlList button').click();await page.locator('.ww-unblock-dialog [data-confirm]').click();await page.waitForFunction(()=>document.querySelector('#findaiControlList')?.textContent.includes('No blocked accounts.'));assert.equal(await page.evaluate(()=>controlDeletes),2);assert.equal(await page.evaluate(()=>wishwaveNavigationOrigins().length),depth,'refresh does not add another Blocked accounts history entry');
  await swipeBack();assert.equal(await heading(),'Privacy','one swipe leaves the refreshed blocked list');await page.waitForTimeout(500);assert.equal(await heading(),'Privacy','blocked list stays closed');
  await swipeBack();assert.equal(await heading(),'Settings');
  // A late list response must not populate a different Settings pane.
  await page.evaluate(()=>{controlBlocked=true;delayControls=true;findaiOpenSettingsPane('blocked');});await page.waitForFunction(()=>typeof releaseControlList==='function');await swipeBack();await page.evaluate(()=>{delayControls=false;releaseControlList();});await page.waitForTimeout(100);assert.equal(await heading(),'Settings');assert.equal(await page.locator('#findaiControlList').count(),0);
  await page.evaluate(()=>{wishwavePublicSellerData={seller:{username:'nick',displayName:'Nick'}};openFindAIProfileActions();});await page.waitForFunction(()=>document.querySelector('[data-chat-action="block"]')?.disabled===false);const deletesBefore=await page.evaluate(()=>controlDeletes);
  await page.locator('[data-chat-action="block"]').click();await page.locator('.ww-unblock-dialog [data-cancel]').click();assert.equal(await page.evaluate(()=>controlDeletes),deletesBefore,'profile menu Cancel does not unblock');
  await page.locator('[data-chat-action="block"]').click();await page.locator('.ww-unblock-dialog [data-confirm]').click();await page.waitForFunction(n=>controlDeletes===n+1,deletesBefore);assert.equal(await page.locator('.ww-unblock-dialog').count(),0);
  console.log('PASS: unblock confirmation/cancellation, failed unblock retry, in-place refresh, swipe back to Privacy then Settings, and late response isolation');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
