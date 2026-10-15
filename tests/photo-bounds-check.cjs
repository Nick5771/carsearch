const fs=require('fs'),assert=require('assert'),{JSDOM,VirtualConsole}=require('jsdom');
const html=fs.readFileSync(__dirname+'/../findai-app.html','utf8');
const css=html.match(/<style id="wishwave-photo-camera-search-v258">([\s\S]*?)<\/style>/)[1];
const dom=new JSDOM('<html><head><style>.hero-stage{height:100%;inset:0}.premium-explore-grid{background:#050607}'+css+'</style></head><body><div class="app"><div id="discover"><header class="discover-social-topbar"></header>'+[1,2].map(i=>'<div class="reel-card wishwave-quality-reel" id="c'+i+'"><div class="hero-stage"></div><div class="product-panel"></div></div>').join('')+'</div><div id="search"><div id="premiumDiscoverySections"><div class="premium-explore-grid"></div></div></div><div id="profile"><div class="wishwave-collection-empty"><button class="social-profile-create-first"></button></div></div></div></body></html>',{runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:new VirtualConsole()});
const w=dom.window,d=w.document;let callback,caption=250,header=114;
w.ResizeObserver=class{constructor(cb){callback=cb}observe(){}unobserve(){}};
d.getElementById('discover').getBoundingClientRect=()=>({top:0});d.querySelector('header').getBoundingClientRect=()=>({bottom:header});
d.querySelectorAll('.product-panel').forEach(p=>p.getBoundingClientRect=()=>({height:caption}));
w.eval(html.match(/<script id="wishwave-light-reel-fit-script">([\s\S]*?)<\/script>/)[1]);
(async()=>{await new Promise(r=>setTimeout(r,40));
 for(const c of d.querySelectorAll('.reel-card')){assert.equal(c.style.getPropertyValue('--wishwave-light-header-height'),'114px');assert.equal(c.style.getPropertyValue('--wishwave-light-caption-height'),'250px');}
 assert.equal(w.getComputedStyle(d.querySelector('.hero-stage')).height,'100%','dark canvas remains unchanged');
 d.documentElement.classList.add('findai-light');assert(w.getComputedStyle(d.querySelector('.hero-stage')).inset.includes('--wishwave-light-header-height'),'light stage reserves measured header');
 caption=320;callback([{target:d.querySelector('.product-panel')}]);assert.equal(d.getElementById('c1').style.getPropertyValue('--wishwave-light-caption-height'),'320px');
 header=140;callback([{target:d.querySelector('header')}]);await new Promise(r=>setTimeout(r,40));for(const c of d.querySelectorAll('.reel-card'))assert.equal(c.style.getPropertyValue('--wishwave-light-header-height'),'140px','all snap pages reserve header even while offscreen');
 assert.equal(w.getComputedStyle(d.querySelector('.premium-explore-grid')).backgroundColor,'rgba(0, 0, 0, 0)');assert.equal(w.getComputedStyle(d.querySelector('button')).backgroundColor,'rgb(232, 224, 244)');
 d.documentElement.classList.remove('findai-light');assert.equal(w.getComputedStyle(d.querySelector('.hero-stage')).height,'100%');
 await new Promise(r=>setTimeout(r,40));console.log('PASS: measured header/caption bounds on all light snap pages, dynamic chrome, unchanged dark canvas, transparent sparse grid and lavender action');w.close();
})().catch(e=>{console.error(e);w.close();process.exitCode=1});
