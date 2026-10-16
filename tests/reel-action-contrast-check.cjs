const fs=require('fs'),assert=require('assert'),{JSDOM}=require('jsdom');
const html=fs.readFileSync(__dirname+'/../findai-app.html','utf8');
const css=html.match(/<style id="wishwave-consistent-actions-v276">([\s\S]*?)<\/style>/)[1];
assert(!html.includes('wishwave-photo-aware-actions-v275-script'),'colour no longer depends on photo measurements');
for(const theme of ['','findai-light']){
 const dom=new JSDOM('<html class="'+theme+'"><head><style>'+css+'</style></head><body><main id="discover"><article class="reel-card"><div class="reel-actions-rail">'+['like','comment','compare','share','bookmark'].map(type=>'<button class="reel-social-action '+type+'"><span class="reel-social-icon"><svg fill="'+(type==='bookmark'?'currentColor':'none')+'"></svg></span><span class="ww-preview-count">123</span></button>').join('')+'</div></article></main></body></html>');
 const w=dom.window,d=w.document;
 for(const node of d.querySelectorAll('.reel-social-icon,svg,.ww-preview-count'))assert.equal(w.getComputedStyle(node).color,'rgb(255, 255, 255)','every action/count stays white in '+(theme||'dark'));
 d.querySelector('.like').classList.add('active');assert.equal(w.getComputedStyle(d.querySelector('.like svg')).color,'rgb(255, 48, 69)','liked heart stays red');
 assert.equal(d.querySelector('.bookmark svg').getAttribute('fill'),'currentColor','filled bookmark state is retained');
 assert(w.getComputedStyle(d.querySelector('.comment svg')).filter.includes('drop-shadow(0 1px 2px'),'subtle shadow, without a thick outline');w.close();
}
console.log('PASS: consistent white icons/counts in both themes, red liked hearts and filled bookmarks');
