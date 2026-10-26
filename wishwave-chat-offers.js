/* Image-led offer messages. Commerce permissions and expiry come from the API. */
(function(){
 'use strict';
 const icons={clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',accepted:'<circle cx="12" cy="12" r="9"/><path d="m7 12 3 3 7-7"/>',declined:'<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6"/>',image:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1"/><path d="m3 16 5-5 4 4 3-3 6 6"/>'};
 const icon=name=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+icons[name]+'</svg>';
 const esc=value=>escapeHTML(String(value??''));
 function imageFor(o){
  let value=String(o.listingImage||'');
  const c=typeof appMpCurrentConversation==='undefined'?null:appMpCurrentConversation;
  if(!value&&String(c?.listingId||'')===String(o.listingId||''))value=String(c.listingImage||'');
  try{const u=new URL(value,location.href);return value&&/^https?:$/.test(u.protocol)?u.href:'';}catch(_){return '';}
 }
 function timeLeft(value){const ms=Date.parse(value||'')-Date.now();if(!Number.isFinite(ms))return '';if(ms<=0)return 'Expired';const minutes=Math.max(1,Math.ceil(ms/60000));return minutes>=60?Math.ceil(minutes/60)+'h left':minutes+'m left';}
 window.appMpMessageOfferCard=function(o){
  if(!o)return '';
  let status=String(o.status||'pending');if(!['pending','accepted','declined','expired','withdrawn'].includes(status))status='pending';
  if(['pending','accepted'].includes(status)&&Date.parse(o.expiresAt||'')<=Date.now())status='expired';
  const authorRole=status==='pending'&&o.lastActorRole?o.lastActorRole:((Number(o.revision)||1)%2===0?'seller':'buyer');
  const outgoing=authorRole===o.viewerRole;
  const label=status==='pending'?(Number(o.revision)>1?(outgoing?'Counteroffer sent':'Counteroffer received'):(outgoing?'Offer sent':'Offer received')):({accepted:'Offer accepted',declined:'Offer declined',expired:'Offer expired',withdrawn:'Offer withdrawn'}[status]);
  const title=String(o.listingTitle||'WishWave listing'),image=imageFor(o),expiry=['pending','accepted'].includes(status)?timeLeft(o.expiresAt):'',statusIcon=icons[status]?icon(status):'';
  const c=typeof appMpCurrentConversation==='undefined'?{}:appMpCurrentConversation||{};
  const avatar=String(c.otherPartyAvatar||''),safeAvatar=/^(https?:|data:image\/|blob:)/i.test(avatar),name=String(c.otherParty||'WishWave member');
  const avatarMarkup='<span class="wwoc-avatar" role="img" aria-label="'+escapeAttr(name)+'"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 22a8 8 0 0 1 16 0"/></svg>'+(safeAvatar?'<img src="'+escapeAttr(avatar)+'" alt="" onerror="this.hidden=true">':'')+'</span>';
  const button=(action,label,primary)=>'<button type="button" class="wwoc-action'+(primary?' wwoc-primary':'')+'" data-offer-action="'+action+'">'+label+'</button>';
  let actions='';
  if(status==='pending'&&o.canRespond)actions='<div class="wwoc-actions">'+button('accept','Accept',true)+button('decline','Decline',false)+'</div>';
  else if(status==='pending'&&o.canWithdraw)actions='<div class="wwoc-withdraw">'+button('withdraw','Withdraw offer',false)+'</div>';
  else if(status==='accepted'&&o.viewerRole==='buyer')actions='<div class="wwoc-actions wwoc-single">'+button('pay','Continue to checkout',true)+'</div>';
  const card='<article class="app-mp-chat-offer wwoc-card '+(outgoing?'wwoc-outgoing':'wwoc-incoming')+'" data-offer-id="'+escapeAttr(String(o.id||''))+'" data-offer-listing="'+escapeAttr(String(o.listingId||''))+'" data-offer-status="'+status+'" data-offer-expires="'+escapeAttr(String(o.expiresAt||''))+'">'+
   '<div class="wwoc-hero'+(image?'':' wwoc-missing-image')+'"><span class="wwoc-image-placeholder">'+icon('image')+'</span>'+(image?'<img src="'+escapeAttr(image)+'" alt="'+escapeAttr(title)+'" loading="lazy" decoding="async" onerror="this.hidden=true;this.parentElement.classList.add(\'wwoc-missing-image\')">':'')+'<div class="wwoc-title">'+esc(title)+'</div></div>'+
   '<div class="wwoc-info"><div class="wwoc-price-copy"><strong class="wwoc-amount">'+esc(appMpMoney(Number(o.amount)||0,o.currency||'AUD').replace(/[.,]00(?=\D*$)/,''))+'</strong><span class="wwoc-status">'+statusIcon+esc(label)+'</span></div>'+(expiry?'<div class="wwoc-expiry">'+icon('clock')+'<span>'+esc(expiry)+'</span></div>':'')+'</div>'+
   (o.message?'<p class="wwoc-note">'+esc(o.message)+'</p>':'')+actions+'</article>';
  return '<div class="wwoc-row '+(outgoing?'wwoc-row-outgoing':'wwoc-row-incoming')+'">'+(outgoing?card:avatarMarkup+card)+'</div>';
 };
 // The timeline may be cached between polls, so keep the visible countdown current.
 setInterval(()=>{
  if(document.hidden)return;
  document.querySelectorAll('#appMpInbox.show .wwoc-card[data-offer-expires]').forEach(card=>{
   if(!['pending','accepted'].includes(card.dataset.offerStatus))return;
   const left=timeLeft(card.dataset.offerExpires),expiry=card.querySelector('.wwoc-expiry');
   if(left==='Expired'){card.dataset.offerStatus='expired';card.querySelector('.wwoc-status').textContent='Offer expired';expiry?.remove();card.querySelector('.wwoc-actions,.wwoc-withdraw')?.remove();}
   else if(expiry)expiry.querySelector('span').textContent=left;
  });
 },30000);
 // Delegate by data attributes so listing/offer IDs never enter executable markup.
 document.addEventListener('click',async event=>{
  const button=event.target.closest?.('.wwoc-card [data-offer-action]');if(!button)return;
  const card=button.closest('.wwoc-card');if(card.dataset.busy==='true')return;
  event.preventDefault();card.dataset.busy='true';const buttons=[...card.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
  try{if(button.dataset.offerAction==='pay')await appMpMessagePay(card.dataset.offerId,card.dataset.offerListing);else await appMpMessageOfferAction(card.dataset.offerId,button.dataset.offerAction);}
  finally{card.dataset.busy='false';buttons.forEach(b=>b.disabled=false);}
 });
})();

