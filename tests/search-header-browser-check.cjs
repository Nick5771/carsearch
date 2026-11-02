const fs=require('fs'),path=require('path'),assert=require('assert'),{webkit}=require('playwright');
(async()=>{
 const html=fs.readFileSync('findai-app.html','utf8');
 let css=[...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(m=>m[1]).join('\n');
 for(const m of html.matchAll(/<link\b[^>]*href="([^"?]+\.css)(?:\?[^\"]*)?"[^>]*>/gi))if(fs.existsSync(m[1]))css+='\n'+fs.readFileSync(m[1],'utf8');
 const labels=[['following','Following'],['for-you','For You'],['trending','Trending'],['deals','Deals'],['auctions','Auctions'],['collectibles','Collectibles']];
 const fixture=`<style>${css}</style><div class="app"><section id="discover" class="screen"><header class="discover-social-topbar"></header><article class="reel-card wishwave-quality-reel"><div class="hero-stage"></div></article></section><section id="searchDetailOverlay" class="search-owned-v186 wishwave-home-reel-parity show" data-reel-owner="search"><header class="wishwave-search-reel-topbar ww-search-listing-topbar"><button class="ww-search-listing-back">‹</button><button class="ww-search-listing-query">Search WishWave</button><nav class="ww-search-feed-tabs">${labels.map(([key,label])=>`<button data-reel-feed="${key}" aria-selected="${key==='for-you'}"><span>${label}</span></button>`).join('')}</nav></header></section></div>`;
 const browser=await webkit.launch();try{
  const page=await browser.newPage();
  for(const width of [320,390,430]){
   await page.setViewportSize({width,height:844});await page.setContent(fixture);await page.waitForTimeout(100);
   const layout=await page.locator('.ww-search-feed-tabs').evaluate(row=>{const r=row.getBoundingClientRect();return {left:r.left,right:r.right,scroll:row.scrollLeft,labels:[...row.querySelectorAll('button>span')].map(label=>{const b=label.getBoundingClientRect();return {left:b.left,right:b.right};})};});
   assert.equal(layout.scroll,0,`${width}: initial row must not snap away from Following`);
   const first=layout.labels.slice(0,4);for(const label of first){assert(label.left>=layout.left+5,`${width}: label clipped on left`);assert(label.right<=layout.right-5,`${width}: label clipped on right`);}
   for(let i=1;i<first.length;i++)assert(first[i].left>first[i-1].right,`${width}: labels overlap`);
   assert(layout.labels[4].left>=layout.right-1,`${width}: fifth label should be offscreen until swiped`);
   const gradient=await page.locator('#discover .discover-social-topbar').evaluate(e=>getComputedStyle(e).backgroundImage);assert.equal(gradient,'none','Home header must not darken the photo');
  }
  console.log('PASS: first four Search labels fully visible and non-overlapping at 320/390/430px, no initial scroll snap, no Home header gradient');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
