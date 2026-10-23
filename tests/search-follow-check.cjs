const fs=require('fs'),assert=require('assert'),{JSDOM}=require('jsdom');
(async()=>{
 const dom=new JSDOM('<div id="search"><div id="findaiSearchRecents" class="show"></div></div>',{runScripts:'outside-only',pretendToBeVisual:true,url:'https://wishwave.test'}),w=dom.window;
 let session='test',fail=false,requests=[],opened=0;
 Object.assign(w,{getAccountProfile:()=>({email:'test@example.com',username:'me'}),marketplaceSession:()=>session,escapeAttr:s=>s,escapeHTML:s=>s,haptic(){},toast(){},openLogin(){opened++},closeAppMpSheet(){},openAppMpSheet(title,html){w.document.body.insertAdjacentHTML('beforeend',html)}});
 w.marketplaceFetch=async(path,options)=>{requests.push([path,options.method]);if(path.startsWith('/profile/public/'))return {viewer:{isFollowing:path.endsWith('/alice'),pending:false}};if(fail)throw Error('Failed');return {isFollowing:false,pending:options.method==='POST'};};
 w.eval(fs.readFileSync(require('path').join(__dirname,'../wishwave-search-follow.js'),'utf8'));
 const root=w.document.getElementById('findaiSearchRecents');root.innerHTML=['alice','private'].map(username=>'<div class="findai-recent-row" onclick="window.opened=true">'+w.wishwaveRecentProfileAction({type:'profile',username})+'</div>').join('');
 const pause=()=>new Promise(r=>setTimeout(r,60)),button=name=>root.querySelector('[data-follow-username="'+name+'"]');await pause();
 assert.equal(button('alice').textContent,'Following');assert.equal(button('private').textContent,'Follow');
 button('private').click();await pause();assert.equal(button('private').textContent,'Requested');assert.equal(button('private').disabled,false);
 button('private').click();await pause();assert.equal(button('private').textContent,'Follow');assert.equal(requests.filter(r=>r[0].startsWith('/social/')).at(-1)[1],'DELETE');
 fail=true;button('private').click();await pause();assert.equal(button('private').textContent,'Follow');assert.equal(button('private').disabled,false);fail=false;
 button('alice').click();assert(w.document.getElementById('wwSearchUnfollow'));w.document.getElementById('wwSearchUnfollow').click();await pause();assert.equal(button('alice').textContent,'Follow');
 assert.equal(w.wishwaveRecentProfileAction({type:'profile',username:'me'}),'');assert.equal(w.wishwaveRecentProfileAction({type:'query',username:'nick'}),'');assert.equal(w.opened,undefined);
 session='';button('private').click();assert.equal(opened,1);
 dom.window.close();console.log('PASS: search recent follow hydration, pending/cancel, unfollow confirmation, rollback, self exclusion, login guard and click isolation');
})().catch(e=>{console.error(e);process.exitCode=1});
