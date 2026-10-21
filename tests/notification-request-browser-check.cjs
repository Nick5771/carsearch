const fs=require('fs'),path=require('path'),http=require('http'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),root=path.resolve(__dirname,'..');
(async()=>{
 const server=http.createServer((req,res)=>{const file=path.join(root,new URL(req.url,'http://test').pathname);if(!file.startsWith(root)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));});await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox'],headless:true});
 const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
 await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:')?r.continue():r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({items:[],listings:[],conversations:[],notifications:[]})}));
 await page.goto('http://127.0.0.1:'+server.address().port+'/findai-app.html?country=US');await page.waitForFunction(()=>!!window.findaiNotificationState);
 await page.evaluate(async()=>{
 window.marketplaceSession=()=> 'fixture';window.getAccountProfile=()=>({email:'fixture@test'});window.marketplaceFetch=async()=>({notifications:[],items:[]});
 document.documentElement.classList.remove('findai-light');await window.wishwaveOpenNotificationTab();
 const state=window.findaiNotificationState;state.ensureUI();state.getCache().splice(0);state.getCache().push({id:'follow-request-fixture',notification_type:'follow_request',actor_username:'nicholas.fiani',actor_display_name:'Nicholas Fiani',created_at:new Date().toISOString(),read_at:null});state.render();document.getElementById('findaiNotificationPanel').classList.add('show');
 });
 for(const width of [390,320]){
 await page.setViewportSize({width,height:844});
 const bounds=await page.evaluate(()=>{const row=document.querySelector('.ww-follow-request'),copy=row.querySelector('.findai-notification-copy'),side=row.querySelector('.findai-notification-side'),avatar=row.querySelector('.findai-notification-avatar-wrap');const rect=x=>{const r=x.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height,bottom:r.bottom,right:r.right}};return{row:rect(row),copy:rect(copy),side:rect(side),avatar:rect(avatar),text:copy.textContent};});
 assert(bounds.copy.w>190,JSON.stringify(bounds));assert(bounds.copy.h<90,JSON.stringify(bounds));assert(bounds.side.y>=bounds.copy.bottom-1,JSON.stringify(bounds));assert(bounds.row.right<=width+1,JSON.stringify(bounds));assert(bounds.text.includes('@nicholas.fiani requested to follow you'));
 if(width===390&&process.env.WISHWAVE_SCREENSHOT_DIR){fs.mkdirSync(process.env.WISHWAVE_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.WISHWAVE_SCREENSHOT_DIR,'follow-request.png')});}
 }
 for(const query of ['notifications=social','settings=follow-requests']){
 await page.goto('http://127.0.0.1:'+server.address().port+'/findai-app.html?country=US&'+query);
 await page.waitForFunction(()=>document.getElementById('notifications')?.classList.contains('active')&&document.getElementById('findaiNotificationPanel')?.classList.contains('show')&&document.querySelector('[data-notice-filter="social"]')?.getAttribute('aria-selected')==='true');
 assert.equal(await page.evaluate(()=>document.body.dataset.activeTab),'notifications');
 }
 console.log('Browser request layout passed at 390px and 320px; new and legacy push URLs open the real Social notification tab.');
 }finally{await browser?.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
