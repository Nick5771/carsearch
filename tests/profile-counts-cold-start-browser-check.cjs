const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
 const server=http.createServer((req,res)=>{const file=path.join(root,new URL(req.url,'http://test').pathname);if(!file.startsWith(root)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(fs.readFileSync(file));});await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage'],headless:true});const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
  await page.addInitScript(()=>{
   if(!localStorage.getItem('startup-counts-seeded')){
    const user={email:'startup@test',username:'startup',name:'Startup User',session:'startup-session',provider:'email'};
    localStorage.setItem('fa_account_profile_v1',JSON.stringify(user));localStorage.setItem('findai_user',JSON.stringify(user));
    localStorage.setItem('wishwave-connection-counts-v375:'+encodeURIComponent(user.email),JSON.stringify({followers:1,following:3}));localStorage.setItem('startup-counts-seeded','1');
   }
  });
  let releaseScript=null,releases=[],countRequests=0;
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.origin==='http://127.0.0.1:'+server.address().port){if(url.pathname==='/wishwave-connections.js')await new Promise(resolve=>releaseScript=resolve);return route.continue();}
   if(url.pathname.startsWith('/social/connections/')){countRequests++;await new Promise(resolve=>releases.push(resolve));return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({followers:1,following:4})});}
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({profile:{username:'startup',displayName:'Startup User'},items:[],listings:[],conversations:[]})});
  });
  const appUrl='http://127.0.0.1:'+server.address().port+'/findai-app.html';
  const own=()=>page.evaluate(()=>({followers:document.getElementById('socialFollowersValue').textContent,following:document.getElementById('socialFollowingValue').textContent,pending:document.getElementById('socialFollowersValue').classList.contains('findai-followers-pending')}));
  for(const expectedFollowing of ['3','4']){
   releaseScript=null;releases=[];await page.goto(appUrl,{waitUntil:'commit'});await page.waitForFunction(()=>typeof paintSocialProfileHeader==='function'&&document.getElementById('socialFollowingValue'));
   await page.evaluate(()=>{openProfile();paintSocialProfileHeader();});
   assert.equal(await page.evaluate(()=>typeof wishwaveOwnConnectionCounts),'undefined','test checks the first renderer before the late connections script is available');
   assert.deepEqual(await own(),{followers:'1',following:expectedFollowing,pending:false},'saved numbers are visible before the connections script and server response');
   while(!releaseScript)await new Promise(resolve=>setTimeout(resolve,10));releaseScript();await page.waitForFunction(()=>typeof wishwaveOwnConnectionCounts==='function');
   assert.deepEqual(await own(),{followers:'1',following:expectedFollowing,pending:false},'loading the script does not replace the saved numbers with dots');
   await page.waitForTimeout(350);for(const release of releases)release();await page.waitForFunction(()=>document.getElementById('socialFollowingValue').textContent==='4');
   assert.deepEqual(await own(),{followers:'1',following:'4',pending:false});
  }
  assert(countRequests>=2);console.log('PASS: two real cold loads show saved counts before the late script and delayed network; refresh updates silently and persists for the next launch');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
