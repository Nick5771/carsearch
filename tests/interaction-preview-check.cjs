const fs=require('fs'),assert=require('assert'),{JSDOM}=require('jsdom');
const source=fs.readFileSync(__dirname+'/../wishwave-interaction-preview.js','utf8');
async function check(url,on){
 const dom=new JSDOM('<html><head></head><body><article class="reel-card" data-recommendation-key="sample"><div class="reel-actions-rail">'+['like','comment','compare','share','bookmark'].map(x=>'<button class="reel-social-action '+x+'"><span class="reel-social-icon"></span>'+(x==='like'?'<span class="reel-social-label">7</span>':'')+'</button>').join('')+'</div></article></body></html>',{url,runScripts:'outside-only'});
 dom.window.eval(source);await new Promise(r=>setTimeout(r,20));
 assert.equal(dom.window.document.querySelectorAll('[data-preview-count]').length,on?5:0);
 assert.equal(dom.window.document.querySelector('.reel-social-label').textContent,'7','mock display does not replace the real count');
 if(on){assert.equal(dom.window.document.querySelector('.ww-preview-caption').textContent,'Preview counts');const rail=dom.window.document.querySelector('.reel-actions-rail');rail.insertAdjacentHTML('beforeend','<span>Loaded</span>');await new Promise(r=>setTimeout(r,10));assert.equal(rail.querySelectorAll('.ww-preview-caption').length,1,'subsequent paints do not duplicate the label');}
 dom.window.close();
}
(async()=>{await check('https://test/',false);await check('https://test/?treasure-test=1',true);await check('https://test/?treasure-test=1&interaction-preview=0',false);console.log('PASS: all five reel icons display labelled mock counts in beta preview only; underlying real counts remain intact');})().catch(e=>{console.error(e);process.exitCode=1});
