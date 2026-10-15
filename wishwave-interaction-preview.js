/* Beta interaction mock-up. No invented counts enter item/account/API data. */
(function(root){
 'use strict';
 const hash=value=>{let h=2166136261;for(const c of String(value)){h=Math.imul(h^c.charCodeAt(0),16777619);}return h>>>0;};
 const compact=n=>n>=1000?(Math.round(n/100)/10).toFixed(n%1000?1:0).replace(/\.0$/,'')+'k':String(n);
 function counts(key){const h=hash(key),likes=1+h%10000,ratio=n=>.03+(hash(key+n)%91)/1000;return {like:likes,comment:Math.max(1,Math.round(likes*ratio('comment'))),compare:Math.max(1,Math.round(likes*ratio('compare')*.5)),share:Math.max(1,Math.round(likes*ratio('share')*.8)),bookmark:Math.max(1,Math.round(likes*(.08+ratio('save'))))};}
 if(typeof module!=='undefined'&&module.exports)module.exports={counts,compact};
 if(!root.document)return;
 const params=new URLSearchParams(root.location.search);
 const active=()=>params.get('interaction-preview')==='1'||params.get('treasure-test')==='1'&&params.get('interaction-preview')!=='0';
 function paint(){if(!root.document?.documentElement||!active())return;root.document.querySelectorAll('article.reel-card').forEach(card=>{
  const rail=card.querySelector('.reel-actions-rail');if(!rail)return;const key=card.getAttribute('data-recommendation-key')||card.getAttribute('aria-label')||'',sample=counts(key);
  card.dataset.interactionPreview='1';rail.classList.add('ww-interaction-preview');
  rail.querySelectorAll('.ww-preview-caption').forEach(label=>label.remove());
  for(const[type,value]of Object.entries(sample)){
   const button=rail.querySelector('.reel-social-action.'+type);if(!button)continue;
   const display=compact(value);if(button.dataset.previewCount!==display){button.dataset.previewCount=display;button.setAttribute('aria-description','Design preview: '+value+' sample interactions');}
   let number=button.querySelector('.ww-preview-count');if(!number){number=root.document.createElement('span');number.className='ww-preview-count';number.setAttribute('aria-hidden','true');button.appendChild(number);}
   if(number.textContent!==display)number.textContent=display;
  }
 });}
 const observer=new MutationObserver(()=>{if(!queued){queued=true;queueMicrotask(()=>{queued=false;paint();});}});let queued=false;
 function start(){const style=root.document.createElement('style');style.textContent=`
 html body :is(#discover,#searchDetailOverlay,#findaiContextualReelV168) article.reel-card[data-interaction-preview="1"] .reel-actions-rail.ww-interaction-preview{width:50px!important;gap:10px!important;align-items:center!important}
 html body :is(#discover,#searchDetailOverlay,#findaiContextualReelV168) article.reel-card[data-interaction-preview="1"] .ww-interaction-preview .reel-social-action{display:flex!important;position:relative!important;flex:0 0 53px!important;width:50px!important;min-width:50px!important;height:53px!important;min-height:53px!important;max-height:53px!important;margin:0!important;padding:0!important;flex-direction:column!important;align-items:center!important;justify-content:center!important;gap:4px!important}
 html body :is(#discover,#searchDetailOverlay,#findaiContextualReelV168) article.reel-card[data-interaction-preview="1"] .ww-interaction-preview .reel-social-icon{display:grid!important;place-items:center!important;flex:0 0 28px!important;width:28px!important;height:28px!important;min-width:28px!important;min-height:28px!important;margin:0!important;padding:0!important;transform:none!important}
 html body article.reel-card[data-interaction-preview="1"] .ww-interaction-preview .reel-social-action>:is(.reel-social-label,.reel-like-count,.reel-comment-count){display:none!important}
 html body article.reel-card[data-interaction-preview="1"] .ww-interaction-preview .ww-preview-count{display:block!important;position:static!important;order:2!important;width:100%!important;margin:0!important;padding:0!important;background:transparent!important;font-size:12px!important;line-height:15px!important;font-weight:650!important;font-variant-numeric:tabular-nums;text-align:center!important;color:#fff!important;white-space:nowrap!important}
 html.findai-light body article.reel-card[data-interaction-preview="1"] .ww-interaction-preview .ww-preview-count{color:#16181c!important}
 @media(max-height:740px){html body :is(#discover,#searchDetailOverlay,#findaiContextualReelV168) article.reel-card[data-interaction-preview="1"] .ww-interaction-preview .reel-social-action{flex-basis:48px!important;height:48px!important;min-height:48px!important;max-height:48px!important;gap:2px!important}}
 `;root.document.head.appendChild(style);paint();observer.observe(root.document.body,{childList:true,subtree:true});}
 if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})(globalThis);
