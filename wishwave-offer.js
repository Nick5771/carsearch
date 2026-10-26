/* Dedicated offer editor, backed by existing conversation and offer APIs. */
(function(){
 'use strict';
 const root=document.createElement('section');root.id='wwOffer';root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-label','Make an offer');(document.querySelector('.app')||document.body).append(root);
 let state=null,quoteTimer=0,quoteVersion=0,confirmationTimer=0;
 const confirmation=document.createElement('div');confirmation.id='wwOfferSent';confirmation.setAttribute('role','status');confirmation.setAttribute('aria-live','polite');(document.querySelector('.app')||document.body).append(confirmation);
 function hideConfirmation(){clearTimeout(confirmationTimer);confirmation.classList.remove('show');}
 function sent(s,amount){
  const profile=getAccountProfile()||{},avatar=String(profile.avatar||profile.avatarUrl||profile.avatar_url||''),safe=/^(https?:|data:image\/|blob:)/i.test(avatar);
  confirmation.innerHTML='<span class="wwo-sent-avatar"><svg class="wwo-avatar-placeholder" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 22a8 8 0 0 1 16 0"/></svg>'+(safe?'<img src="'+escapeAttr(avatar)+'" alt="" onerror="this.hidden=true">':'')+'<span class="wwo-sent-tick"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg></span></span><span class="wwo-sent-copy"><b>'+esc(s.counter?'Counteroffer sent':'Offer sent')+'</b><small>'+esc(money(amount,s)+' · '+s.title)+'</small></span>';
  confirmation.style.removeProperty('bottom');confirmation.classList.add('show');confirmationTimer=setTimeout(hideConfirmation,4500);
 }

 const esc=value=>escapeHTML(String(value??''));
 const icons={back:'<path d="m15 18-6-6 6-6"/>',truck:'<path d="M2 5h12v12H2zM14 9h4l4 4v4h-8"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>'};
 const icon=name=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+icons[name]+'</svg>';
 const money=(minor,s=state)=>appMpMoney(minor/100,s.currency);
 const session=()=>String(getAccountProfile()?.email||'')+'|'+marketplaceSession();
 const current=s=>state===s&&s.session===session()&&root.classList.contains('show');
 function error(message){const field=root.querySelector('#appMpMessageOfferError');if(field)field.textContent=message||'';}
 async function request(path,options={}){
  const controller=new AbortController();let timer;
  try{return await Promise.race([marketplaceFetch(path,{...options,signal:controller.signal}),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('The request timed out. Please check your connection and try again.'));},20000);})]);}
  finally{clearTimeout(timer);}
 }
 function amountMinor(){const text=root.querySelector('#appMpMessageOfferAmount').value.trim();return /^\d+(?:\.\d{1,2})?$/.test(text)?Math.round(Number(text)*100):NaN;}
 function valid(s,amount){return Number.isSafeInteger(amount)&&amount>0&&amount<s.priceMinor;}
 function controls(){if(!state)return;const s=state,button=root.querySelector('#appMpMessageOfferSubmit');button.disabled=!!s.busy||!s.loaded||!s.quote||!valid(s,amountMinor());button.textContent=s.busy?'Sending…':!s.loaded&&!s.loadError?'Loading offer…':s.quotePending?'Calculating total…':s.counter?'Send counter':'Send offer';button.setAttribute('aria-busy',String(!!s.busy));root.querySelector('#appMpMessageOfferAmount').disabled=!!s.busy;root.querySelector('#appMpMessageOfferNote').disabled=!!s.busy;const retry=root.querySelector('.wwo-retry');retry.hidden=!!s.busy||!(s.loadError||s.quoteError);}

 function summary(){const s=state;if(!s)return;const amount=amountMinor(),q=s.quote;root.querySelector('[data-offer-subtotal]').textContent=valid(s,amount)?money(amount):'—';root.querySelector('[data-offer-fee]').textContent=q?money(q.buyerFeeMinor):'—';root.querySelector('[data-offer-total]').textContent=q?money(q.buyerTotalMinor):'—';root.querySelector('[data-offer-total-label]').textContent=s.shippingMinor===null?'Estimated total, excluding delivery':'Total if accepted';controls();}
 async function updateQuote(s){
  const amount=amountMinor(),version=++quoteVersion;s.quote=null;s.quoteError=false;s.quotePending=s.loaded&&valid(s,amount);summary();if(!s.quotePending)return;
  try{const data=await request('/marketplace/quote',{method:'POST',body:JSON.stringify({itemMinor:amount,shippingMinor:s.shippingMinor??0,currency:s.currency})});if(!current(s)||version!==quoteVersion||amount!==amountMinor())return;
   const q=data.quote;if(!q||![q.buyerFeeMinor,q.buyerTotalMinor].every(v=>Number.isSafeInteger(v)&&v>=0))throw Error('Could not calculate the buyer fee');s.quote=q;s.quotePending=false;error('');summary();
  }catch(e){if(current(s)&&version===quoteVersion){s.quotePending=false;s.quoteError=true;error(e.message||'Could not calculate the total. Try again.');controls();}}
 }
 function validateAmount(){const field=root.querySelector('#appMpMessageOfferAmount'),amount=amountMinor(),text=field.value.trim(),invalid=!!text&&!valid(state,amount);field.setAttribute('aria-invalid',String(invalid));const hint=root.querySelector('#wwoAmountHint');hint.classList.toggle('wwo-invalid',invalid);hint.textContent=invalid?(Number.isFinite(amount)&&amount>=state.priceMinor?'Your offer must be below '+money(state.priceMinor)+'.':'Enter an amount greater than zero, with up to two decimal places.'):'Enter an amount below '+money(state.priceMinor);}
 function input(){const s=state;if(!s)return;clearTimeout(quoteTimer);quoteVersion++;s.quote=null;s.quoteError=false;s.quotePending=s.loaded&&valid(s,amountMinor());error('');validateAmount();summary();quoteTimer=setTimeout(()=>{if(current(s))updateQuote(s);},180);}
 function render(s){
  const title=s.counter?'Send a counter offer':'Make an offer';root.setAttribute('aria-label',title);
  root.innerHTML='<header class="wwo-head"><button type="button" class="wwo-back" onclick="appMpCloseMessageOffer()" aria-label="Back">'+icon('back')+'</button><h1>'+title+'</h1><span></span></header><form><div class="wwo-scroll"><section class="wwo-item">'+(s.image?'<img src="'+escapeAttr(s.image)+'" alt="'+escapeAttr(s.title)+'">':'')+'<div class="wwo-copy"><h2>'+esc(s.title)+'</h2><div class="wwo-muted">Asking price</div><div class="wwo-price">'+esc(money(s.priceMinor,s))+'</div></div></section>'+
   '<label class="wwo-amount-label" for="appMpMessageOfferAmount">Your offer</label><div class="wwo-amount"><span class="wwo-currency">'+esc(s.currency==='AUD'?'A$':s.currency==='USD'?'US$':s.currency==='GBP'?'£':s.currency==='EUR'?'€':s.currency+' ')+'</span><input id="appMpMessageOfferAmount" type="text" inputmode="decimal" autocomplete="off" enterkeyhint="done" required maxlength="14" placeholder="0" aria-describedby="wwoAmountHint" value="'+escapeAttr(s.initial)+'"></div><div id="wwoAmountHint" class="wwo-muted">Enter an amount below '+esc(money(s.priceMinor,s))+'</div>'+
   '<details class="wwo-note"><summary>Add a message (optional)<span aria-hidden="true">›</span></summary><div class="wwo-note-wrap"><label class="wwo-sr-only" for="appMpMessageOfferNote">Message (optional)</label><textarea id="appMpMessageOfferNote" maxlength="500" placeholder="Add a note to the seller…"></textarea><span class="wwo-count">0/500</span></div></details>'+
   '<div class="wwo-shipping">'+icon('truck')+'<span data-offer-shipping>Loading delivery…</span></div><div class="wwo-total-row"><span>Your offer</span><strong data-offer-subtotal>—</strong></div><div class="wwo-total-row"><span>Buyer fee</span><strong data-offer-fee>—</strong></div><div class="wwo-total-row wwo-total"><span data-offer-total-label>Total if accepted</span><strong data-offer-total>—</strong></div><p class="wwo-info">'+icon('info')+'<span>If accepted, the item is reserved for 24 hours while you complete payment.</span></p></div><footer class="wwo-footer"><div id="appMpMessageOfferError" role="alert" aria-live="assertive"></div><button type="button" class="wwo-retry" hidden>Try again</button><button type="button" class="wwo-submit" id="appMpMessageOfferSubmit" disabled>'+(s.counter?'Send counter':'Send offer')+'</button></footer><div class="wwo-keyboard-bar" hidden><button type="button" class="wwo-done">Done</button></div></form>';
  root.querySelector('.wwo-note').ontoggle=event=>{event.target.querySelector('summary').firstChild.textContent=event.target.open?'Message (optional)':'Add a message (optional)';requestAnimationFrame(resize);};root.querySelector('.wwo-done').onclick=finishEditing;root.querySelector('#appMpMessageOfferAmount').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();finishEditing();}};root.querySelector('form').onsubmit=submit;root.querySelector('#appMpMessageOfferSubmit').onclick=submit;root.querySelector('.wwo-retry').onclick=()=>{if(current(s)){error('');if(s.loaded)updateQuote(s);else loadDetails(s);}};root.querySelector('#appMpMessageOfferAmount').oninput=input;root.querySelector('#appMpMessageOfferNote').oninput=event=>{root.querySelector('.wwo-count').textContent=event.target.value.length+'/500';};
 }
 const closeBefore=window.appMpCloseMessageOffer;
 window.appMpCloseMessageOffer=function(){clearTimeout(quoteTimer);quoteVersion++;root.querySelector(':focus')?.blur();window.wishwaveSyncKeyboardBackdrop?.();state=null;root.classList.remove('show');root.innerHTML='';root.style.height='';return closeBefore?.apply(this,arguments);};
 window.appMpOpenMessageOffer=async function(mode,offerId,initial,direct){
  if(!appMpRequireLogin())return;hideConfirmation();const offer=mode==='counter'?(typeof appMpCurrentOffers!=='undefined'?appMpCurrentOffers:[]).find(o=>String(o.id)===String(offerId)):null;const c=direct?{listingId:appMpId(direct.listing),listingTitle:direct.listing.title,listingImage:direct.listing.images?.[0]||direct.listing.image,listingPrice:direct.listing.price,currency:direct.listing.currency,viewerRole:'buyer'}:offer?{...appMpCurrentConversation,...offer}:appMpCurrentConversation||{},counter=mode==='counter';if(c.viewerRole!=='buyer'&&!counter)return;
  const listingId=String(c.listingId||appMpId(appMpListing)||'');if(!listingId)return;
  const token=window.__wishwaveWillOpenView?.('wwOffer');window.appMpCloseMessageOffer();
  const s={session:session(),listingId,counter,direct:!!direct,sellerName:String(direct?.context?.seller?.displayName||c.otherParty||''),offerId:String(offerId||''),title:String(c.listingTitle||appMpListing?.title||'WishWave listing'),image:String(c.listingImage||appMpListing?.images?.[0]||appMpListing?.image||''),currency:String(c.currency||appMpListing?.currency||'AUD'),priceMinor:Math.round(Number(c.listingPrice||appMpListing?.price||0)*100),initial:initial?Number(initial).toFixed(2):'',loaded:false,busy:false,shippingMinor:null,quote:null};state=s;render(s);root.classList.add('show');window.__wishwaveDidOpenView?.(token);resize();
  await loadDetails(s);
 };
 async function loadDetails(s){
  s.loadError=false;s.loaded=false;controls();const listingId=s.listingId,counter=s.counter;
  try{
   const data=await request('/marketplace/listings/'+encodeURIComponent(listingId),{method:'GET'});if(!current(s))return;const listing=data.listing;if(!listing||data.viewer?.isSeller&&!counter||!counter&&(listing.status||'active')!=='active'||listing.offersEnabled===false)throw Error('This listing is not accepting offers');
   s.priceMinor=Math.round(Number(listing.price)*100);s.currency=String(listing.currency||s.currency);s.listing=listing;
   root.querySelector('.wwo-price').textContent=money(s.priceMinor,s);root.querySelector('#wwoAmountHint').textContent='Enter an amount below '+money(s.priceMinor,s);
   const config=await request('/marketplace/config',{method:'GET'});if(!current(s))return;
   if(listing.deliveryMode==='pickup'){s.shippingMinor=0;root.querySelector('[data-offer-shipping]').textContent='Local pickup';}
   else if(listing.shippingMode==='calculated'){root.querySelector('[data-offer-shipping]').textContent='Delivery calculated at checkout';}
   else{const delivery=await request('/marketplace/shipping/quote',{method:'POST',body:JSON.stringify({listingId,destinationCountry:config.marketplace?.detectedCountry||listing.country||'US',destinationPostalCode:''})});if(!current(s))return;const minor=delivery.rates?.[0]?.amountMinor;if(!Number.isSafeInteger(minor)||minor<0)throw Error('Could not calculate delivery');s.shippingMinor=minor;const label=root.querySelector('[data-offer-shipping]');label.textContent=minor===0?'Free shipping':'Shipping '+money(minor,s);label.classList.toggle('wwo-free',minor===0);}
   if(!current(s))return;s.loaded=true;validateAmount();await updateQuote(s);
  }catch(e){if(current(s)){s.loadError=true;error(e.message||'Could not load offer details');root.querySelector('[data-offer-shipping]').textContent='Delivery unavailable';controls();}}
 };
 async function submit(event){
  event.preventDefault();const s=state;if(!s||!current(s)||s.busy)return;
  const amount=amountMinor();if(!valid(s,amount)){error('Enter a valid amount below the asking price.');return;}if(!s.loaded||!s.quote){error('Wait for the total to finish loading.');return;}
  clearTimeout(quoteTimer);s.busy=true;controls();error('');const started=Date.now(),note=root.querySelector('#appMpMessageOfferNote').value;
  try{
   let result;if(s.counter){result=await request('/marketplace/offers/'+encodeURIComponent(s.offerId),{method:'PATCH',body:JSON.stringify({action:'counter',amount:amount/100,message:note})});}
   else{if(!s.direct&&String(appMpCurrentConversation?.listingId||appMpId(appMpListing))!==s.listingId)throw Error('The conversation changed. Reopen the offer.');result=await request('/marketplace/offers',{method:'POST',body:JSON.stringify({listingId:s.listingId,amount:amount/100,message:note})});if(current(s)&&!s.direct&&result.conversationId)appMpConversation=String(result.conversationId);}
   if(!result?.ok||!result.offer?.id)throw Error('The server did not confirm the offer. Please try again.');
   if(!current(s))return;window.appMpCloseMessageOffer();sent(s,amount);if(!s.direct)await appMpLoadMessages();
  }catch(e){if(current(s)){
   // A lost response can follow a successful write. Check before inviting a retry.
   if(!s.counter&&/timed out|failed to fetch|network|load failed|did not confirm/i.test(String(e.message||''))){
    try{const data=await request('/marketplace/offers?listingId='+encodeURIComponent(s.listingId),{method:'GET'});if(!current(s))return;const saved=(data.offers||[]).find(o=>o.viewerRole==='buyer'&&o.listingId===s.listingId&&Math.round(Number(o.amount)*100)===amount&&String(o.message||'')===note&&Date.parse(o.createdAt||'')>=started-5000&&['pending','accepted'].includes(o.status));if(saved){window.appMpCloseMessageOffer();sent(s,amount);if(!s.direct)await appMpLoadMessages();return;}}catch(_){}
   }
   if(!current(s))return;s.busy=false;error(e.message||'Offer could not be sent. Try again.');controls();
  }}
 }
 function finishEditing(){root.querySelector(':focus')?.blur();root.querySelector('.wwo-keyboard-bar')?.setAttribute('hidden','');root.querySelector('.wwo-scroll')?.scrollTo?.(0,0);resize();window.wishwaveSyncKeyboardBackdrop?.();}
 function resize(){
  const checkout=document.getElementById('wwCheckout'),target=state?root:checkout?.classList.contains('show')?checkout:null;if(!target)return;
  const focused=document.activeElement,editing=target.contains(focused)&&/^(INPUT|TEXTAREA|SELECT)$/.test(focused.tagName),app=document.querySelector('.app').getBoundingClientRect(),v=window.visualViewport;
  const visible=v?Math.min(app.height,v.height+v.offsetTop-app.top):app.height,keyboard=editing&&visible>0&&app.height-visible>120;
  target.style.height=keyboard?visible+'px':'';
  if(state){
   root.querySelector('.wwo-keyboard-bar').hidden=!editing;root.classList.toggle('wwo-editing',editing);
   if(!keyboard&&root.dataset.keyboard==='true'){root.querySelector('.wwo-scroll').scrollTop=0;root.scrollTop=0;}root.dataset.keyboard=String(keyboard);
   if(editing){const scroll=root.querySelector('.wwo-scroll'),field=focused.getBoundingClientRect(),wrap=scroll.getBoundingClientRect();if(field.bottom>wrap.bottom-12)scroll.scrollTop+=field.bottom-wrap.bottom+12;else if(field.top<wrap.top+12)scroll.scrollTop-=wrap.top+12-field.top;}
  }
 }
 document.addEventListener('focusin',()=>requestAnimationFrame(resize));document.addEventListener('focusout',()=>requestAnimationFrame(resize));window.visualViewport?.addEventListener('resize',resize);window.visualViewport?.addEventListener('scroll',resize);window.addEventListener('resize',resize);
 const closeCheckout=window.wishwaveCloseCheckout;window.wishwaveCloseCheckout=function(){const checkout=document.getElementById('wwCheckout');if(checkout)checkout.style.height='';return closeCheckout.apply(this,arguments);};
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&state){event.preventDefault();window.appMpCloseMessageOffer();}});
 const buyBefore=window.appMpBuy;window.appMpBuy=function(){hideConfirmation();return buyBefore.apply(this,arguments);};
 window.openAppMarketplaceOfferInMessages=function(){if(!appMpListing||appMpContext?.viewer?.isSeller)return;return window.appMpOpenMessageOffer(undefined,undefined,undefined,{listing:{...appMpListing},context:appMpContext});};
 document.addEventListener('wishwave-recommendation-account-change',()=>{hideConfirmation();if(state)window.appMpCloseMessageOffer();});
})();
