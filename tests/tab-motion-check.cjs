const fs=require('fs'),vm=require('vm'),assert=require('assert');
const painted=[],handlers={};let account='one';
const ctx={document:{querySelector:()=>true,addEventListener:(n,f)=>handlers[n]=f},marketplaceSession:()=>account,feedState:{},__wishwavePageMotion:true,renderPersonalisedFeed:items=>painted.push(['render',items]),appendFeedItems:items=>painted.push(['append',items])};ctx.window=ctx;vm.createContext(ctx);vm.runInContext(fs.readFileSync('wishwave-tab-motion.js','utf8'),ctx);
ctx.renderPersonalisedFeed(['first']);ctx.appendFeedItems(['second']);assert.equal(painted.length,0,'Network responses cannot rebuild moving DOM');ctx.__wishwavePageMotion=false;ctx.__wishwaveFlushHomeRender();assert.deepEqual(painted,[['render',['first']],['append',['second']]]);
ctx.__wishwavePageMotion=true;ctx.appendFeedItems(['old']);ctx.feedState={};ctx.__wishwavePageMotion=false;ctx.__wishwaveFlushHomeRender();assert.equal(painted.length,2,'Feed changes invalidate pending renders');
ctx.__wishwavePageMotion=true;ctx.appendFeedItems(['private']);account='two';ctx.__wishwavePageMotion=false;ctx.__wishwaveFlushHomeRender();assert.equal(painted.length,2,'Account changes invalidate pending renders');
ctx.__wishwavePageMotion=true;ctx.renderPersonalisedFeed(['obsolete']);ctx.renderPersonalisedFeed(['latest']);ctx.__wishwavePageMotion=false;ctx.__wishwaveFlushHomeRender();assert.deepEqual(painted.at(-1),['render',['latest']]);
ctx.__wishwavePageMotion=true;ctx.__wishwaveNavigationHandoff=true;ctx.renderPersonalisedFeed(['handoff']);assert.deepEqual(painted.at(-1),['render',['handoff']]);
console.log('PASS: renders deferred during drag, ordered flush, supersession, stale feed/account guards and navigation handoff');
