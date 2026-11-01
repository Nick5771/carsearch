const fs=require('fs'),assert=require('assert'),{webkit}=require('playwright');
(async()=>{
 const browser=await webkit.launch();try{
 const html=fs.readFileSync('findai-app.html','utf8');const styles=[...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(x=>x[1]).join('\n')+'\n'+fs.readFileSync('wishwave-tab-motion.css','utf8');
 const page=await browser.newPage({viewport:{width:390,height:844}});
 await page.setContent('<style>'+styles+'</style><div class="app"><section id="search" class="screen"><div id="testHeader" style="height:100px;flex-shrink:0">Search</div><div id="testGrid" style="display:grid;grid-template-columns:repeat(3,1fr);width:100%;flex:1"><div>One</div><div>Two</div><div>Three</div></div></section></div>');
 for(const width of [320,390,430]){
 await page.setViewportSize({width,height:844});
 const measure=active=>page.evaluate(active=>{const root=document.getElementById('search');root.className='screen '+(active?'active':'findai-v132-swipe-surface findai-v132-target');const head=document.getElementById('testHeader').getBoundingClientRect(),grid=document.getElementById('testGrid').getBoundingClientRect();return {direction:getComputedStyle(root).flexDirection,headerWidth:head.width,gridWidth:grid.width,gridTop:grid.top};},active);
 const preview=await measure(false),active=await measure(true);assert.equal(preview.direction,'column');assert.deepEqual(preview,active,'Incoming Search layout must match settled Search at '+width);
 }
 console.log('PASS: Search preview and settled layout match at 320/390/430 in WebKit');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
