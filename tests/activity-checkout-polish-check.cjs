const fs=require('fs'),vm=require('vm'),assert=require('assert'),{JSDOM}=require('jsdom');
(async()=>{
 const html=fs.readFileSync('findai-app.html','utf8');let session='account-a',read={},calls=[],count=2,renders=0;
 const notices=[{id:'seller-badge:a',local:true,read_at:''},{id:'remote-a',read_at:''}];
 const ctx={Date,JSON,marketplaceSession:()=>session,readLocalNoticeState:()=>read,writeLocalNoticeState:v=>read=v,appNotificationCache:notices,appNotificationUnread:2,setHomeNotificationState:v=>count=v,renderHomeNotifications:()=>renders++,marketplaceFetch:(path,opt)=>{calls.push(JSON.parse(opt.body));return Promise.reject(Error('offline'));}};vm.createContext(ctx);
 const mark=html.slice(html.indexOf('    markViewed:()=>{'),html.indexOf('    removeActor:username=>{'));
 vm.runInContext('const api={'+mark+'};api.markViewed();',ctx);
 assert.equal(count,0,'seen activity clears immediately despite offline read acknowledgement');assert(notices.every(n=>n.read_at));assert(read['seller-badge:a']);assert(read['activity-seen:account-a:remote-a']);assert.equal(calls.length,1);assert.deepEqual(calls[0],{id:'remote-a'});assert.equal(renders,1);
 const css=fs.readFileSync('wishwave-purchase-ui.css','utf8');
 const dom=new JSDOM('<style>'+css+'</style><div class="app"><section id="wwCheckout" class="show"><div class="wwc-scroll"><form class="wwc-location-form"><input id="address"></form></div><footer class="wwc-footer">Total and pay</footer></section></div>',{runScripts:'outside-only',pretendToBeVisual:true});const w=dom.window,doc=w.document,checkout=doc.getElementById('wwCheckout'),field=doc.getElementById('address'),scroll=checkout.querySelector('.wwc-scroll'),footer=checkout.querySelector('footer');
 doc.querySelector('.app').getBoundingClientRect=()=>({height:852,top:0});scroll.getBoundingClientRect=()=>({top:50,bottom:350});field.getBoundingClientRect=()=>({top:390,bottom:430});w.visualViewport={height:400,offsetTop:0};
 assert.equal(w.getComputedStyle(footer).display,'none','manual address form never competes with checkout footer, including between fields');
 const offer=fs.readFileSync('wishwave-offer.js','utf8'),resize=offer.slice(offer.indexOf(' function resize(){'),offer.indexOf(" document.addEventListener('focusin'"));w.eval('let state=null,root=null;'+resize);field.focus();w.resize();assert(checkout.classList.contains('wwc-editing'));assert.equal(checkout.style.height,'400px');assert(scroll.scrollTop>0,'focused field scrolls above keyboard');
 field.blur();checkout.querySelector('form').remove();w.resize();assert(!checkout.classList.contains('wwc-editing'));assert.equal(checkout.style.height,'');assert.notEqual(w.getComputedStyle(footer).display,'none','footer returns after saving/cancelling');dom.window.close();await new Promise(setImmediate);
 console.log('PASS: Activity seen state, scoped remote reads, offline persistence, full address editing area, keyboard scrolling and restored footer');
})().catch(e=>{console.error(e);process.exitCode=1});
