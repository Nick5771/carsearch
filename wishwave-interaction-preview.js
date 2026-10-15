/* Explicitly labelled beta mock-up. No invented counts enter item/account/API data. */
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
  const rail=card.querySelector('.reel-actions-rail');if(!rail)return;if(card.dataset.interactionPreview==='1'&&!rail.querySelector('.reel-social-action:not([data-preview-count])'))return;const key=card.getAttribute('data-recommendation-key')||card.getAttribute('aria-label')||'',sample=counts(key);
  card.dataset.interactionPreview='1';rail.classList.add('ww-interaction-preview');
  const label=root.document.createElement('span');label.className='ww-preview-caption';label.textContent='Preview counts';label.title='Sample interaction numbers for this design mock-up';if(!rail.querySelector('.ww-preview-caption'))rail.prepend(label);
  for(const[type,value]of Object.entries(sample)){const button=rail.querySelector('.reel-social-action.'+type);if(!button)continue;button.dataset.previewCount=compact(value);button.setAttribute('aria-description','Design preview: '+value+' sample interactions');}
 });}
 const observer=new MutationObserver(()=>{if(!queued){queued=true;queueMicrotask(()=>{queued=false;paint();});}});let queued=false;
 function start(){const style=root.document.createElement('style');style.textContent=`
 html body .reel-actions-rail.ww-interaction-preview{width:80px!important;gap:10px!important;align-items:flex-start!important}
 html body .ww-interaction-preview .reel-social-action{width:80px!important;flex-direction:row!important;justify-content:flex-start!important;gap:6px!important}
 html body .ww-interaction-preview .reel-social-action>.reel-social-label{display:none!important}
 html body .ww-interaction-preview [data-preview-count]::after{content:attr(data-preview-count);font-size:11px;line-height:1;font-weight:650;font-variant-numeric:tabular-nums;color:#fff;white-space:nowrap}
 html.findai-light body .ww-interaction-preview [data-preview-count]::after{color:#16181c}
 html body .ww-preview-caption{font-size:8px;line-height:1.25;color:inherit;opacity:.75;white-space:nowrap;letter-spacing:.1px}
 `;root.document.head.appendChild(style);paint();observer.observe(root.document.body,{childList:true,subtree:true});}
 if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})(globalThis);
