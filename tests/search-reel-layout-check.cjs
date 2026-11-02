const fs=require('fs'),vm=require('vm'),assert=require('assert');
const html=fs.readFileSync('findai-app.html','utf8');
const a=html.indexOf('  function dismissSearchEditingForReel(){'),b=html.indexOf('  function openList(',a);
for(const origin of ['search','searchResults']){
 const bodyClasses=new Set(['wishwave-search-editing']),searchClasses=new Set(['ww-search-keyboard','ww-search-session']),rootClasses=new Set(['ww-search-keyboard-canvas']);
 const cl=set=>({remove:(...names)=>names.forEach(n=>set.delete(n))});let blurred=0,synced=0,cleared='';
 const field={value:'lego spongebob',closest:()=>({id:origin}),blur(){blurred++;}},backing={hidden:false};
 const document={activeElement:field,body:{classList:cl(bodyClasses)},documentElement:{classList:cl(rootClasses)},getElementById:id=>id==='search'?{classList:cl(searchClasses),style:{removeProperty:name=>cleared=name}}:id==='wwSearchKeyboardBacking'?backing:null};
 const ctx={document,window:{wishwaveSyncKeyboardBackdrop(){synced++;}}};vm.createContext(ctx);vm.runInContext(html.slice(a,b)+'dismissSearchEditingForReel();',ctx);
 assert.equal(blurred,1);assert.equal(field.value,'lego spongebob');assert.equal(bodyClasses.size,0);assert.equal(searchClasses.size,0);assert.equal(rootClasses.size,0);assert.equal(backing.hidden,true);assert.equal(synced,1);assert.equal(cleared,'--ww-recents-height');
}
assert(html.includes("if(owner==='search')dismissSearchEditingForReel();"));
assert(fs.readFileSync('wishwave-experience.js','utf8').includes("const open=!document.querySelector('#searchDetailOverlay.search-owned-v186.show')&&"));
const css=fs.readFileSync('wishwave-home-controls.css','utf8');assert(css.includes('.app>#searchDetailOverlay#searchDetailOverlay.search-owned-v186[data-reel-owner="search"]'));assert(css.includes('width:100%!important;height:100%!important;max-height:none!important'));assert(css.includes('opacity:1!important;visibility:visible!important;pointer-events:auto!important;transform:none!important;z-index:9999!important;'));
console.log('PASS: Search and results dismiss keyboard state, preserve query, prevent keyboard backing reopening, and restore app-sized reel/navigation baseline');
