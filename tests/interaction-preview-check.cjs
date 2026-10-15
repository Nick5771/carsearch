const fs=require('fs'),assert=require('assert'),{JSDOM}=require('jsdom');
const source=fs.readFileSync(__dirname+'/../wishwave-interaction-preview.js','utf8');
async function check(url,on){
 const dom=new JSDOM('<html><head></head><body><main id="discover"><article class="reel-card" data-recommendation-key="sample"><div class="reel-actions-rail">'+['like','comment','compare','share','bookmark'].map(x=>'<button class="reel-social-action '+x+'"><span class="reel-social-icon"></span>'+(x==='like'?'<span class="reel-social-label">7</span>':'')+'</button>').join('')+'</div></article></main></body></html>',{url,runScripts:'outside-only'});
 dom.window.eval(source);await new Promise(r=>setTimeout(r,20));
 assert.equal(dom.window.document.querySelectorAll('[data-preview-count]').length,on?5:0);
 assert.equal(dom.window.document.querySelector('.reel-social-label').textContent,'7','mock display does not replace the real count');
 assert.equal(dom.window.document.querySelectorAll('.ww-preview-caption').length,0);
 assert.equal(dom.window.document.querySelectorAll('.ww-preview-count').length,on?5:0);
 if(on){
  const rail=dom.window.document.querySelector('.reel-actions-rail');
  for(const button of rail.querySelectorAll('button')){
   const number=button.querySelector('.ww-preview-count');assert.ok(number.textContent,'every action, including heart, has a number');assert.equal(button.lastElementChild,number);
   assert.equal(dom.window.getComputedStyle(button).flexDirection,'column');assert.equal(dom.window.getComputedStyle(button).alignItems,'center');
  }
  const read=type=>Number(rail.querySelector('.'+type+' .ww-preview-count').textContent.replace(/,/g,''));
  const like=rail.querySelector('.like'),baseLike=read('like');like.classList.add('active');await new Promise(r=>setTimeout(r,10));assert.equal(read('like'),baseLike+1,'liking visibly adds exactly one');
  like.classList.remove('active');await new Promise(r=>setTimeout(r,10));assert.equal(read('like'),baseLike,'unliking restores baseline');
  const comment=rail.querySelector('.comment'),baseComment=read('comment');comment.insertAdjacentHTML('beforeend','<span class="reel-comment-count">1</span>');await new Promise(r=>setTimeout(r,10));assert.equal(read('comment'),baseComment+1,'posted comment adds one');
  comment.querySelector('.reel-comment-count').firstChild.data='2';await new Promise(r=>setTimeout(r,10));assert.equal(read('comment'),baseComment+2,'text-node updates are observed');
  comment.querySelector('.reel-comment-count').textContent='';await new Promise(r=>setTimeout(r,10));assert.equal(read('comment'),baseComment,'deletion restores baseline');
  rail.insertAdjacentHTML('beforeend','<span>Loaded</span>');await new Promise(r=>setTimeout(r,10));assert.equal(rail.querySelectorAll('.ww-preview-count').length,5,'subsequent paints do not duplicate numbers');
  rail.querySelector('.bookmark').remove();rail.insertAdjacentHTML('beforeend','<button class="reel-social-action bookmark"><span class="reel-social-icon"></span></button>');await new Promise(r=>setTimeout(r,10));assert.ok(rail.querySelector('.bookmark .ww-preview-count').textContent,'late-mounted bookmark receives a count');
 }
 dom.window.close();
}
(async()=>{await check('https://test/',false);await check('https://test/?treasure-test=1',true);await check('https://test/?treasure-test=1&interaction-preview=0',false);console.log('PASS: all five centered reel icons display numbers underneath without a caption in beta preview only; underlying real counts remain intact');})().catch(e=>{console.error(e);process.exitCode=1});
