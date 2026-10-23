/* Purchase actions belong on native reels as well as the detail page. */
(function(){
 'use strict';
 const eligible=item=>!!item&&isFindAIListing(item)&&item.listingType!=='auction'&&String(item.status||'active')==='active'&&Number(item.price)>.01&&!wishwaveIsOwnMarketplaceListing(item);
 const render=window.renderReelCard;
 window.renderReelCard=function(item,index,data){
  const html=render.apply(this,arguments);
  if(!eligible(item))return html;
  const offer=item.offersEnabled!==false?'<button type="button" class="ww-reel-offer" onclick="wishwaveNativeReelAction('+index+',\'offer\',event)">Make offer</button>':'';
  const actions='<div class="ww-native-reel-actions" role="group" aria-label="Purchase listing">'+offer+'<button type="button" class="ww-reel-buy" onclick="wishwaveNativeReelAction('+index+',\'buy\',event)">Buy now</button></div>';
  const end=html.lastIndexOf('</article>');
  return end<0?html:html.slice(0,end)+actions+html.slice(end);
 };
 window.wishwaveNativeReelAction=async function(index,action,event){
  event?.preventDefault();event?.stopPropagation();
  const item=currentFeedItems[index],bar=event?.target?.closest('.ww-native-reel-actions');
  if(!eligible(item)||!['buy','offer'].includes(action)||bar?.dataset.busy)return;
  if(!appMpRequireLogin())return;
  const session=marketplaceSession(),surface=bar?.closest('#findaiContextualReelV168,#searchDetailOverlay,#discover');
  const valid=()=>marketplaceSession()===session&&currentFeedItems[index]===item&&(!surface||(surface.isConnected&&surface.classList.contains(surface.id==='discover'?'active':'show')));
  if(bar){bar.dataset.busy='1';bar.querySelectorAll('button').forEach(b=>b.disabled=true);}
  try{
   const data=await marketplaceFetch('/marketplace/listings/'+encodeURIComponent(appMpId(item)),{method:'GET'});
   if(!valid())return;
   const listing=data.listing;
   if(!listing||data.viewer?.isSeller||!eligible(listing)||wishwaveIsOwnMarketplaceListing(listing,data)){toast('This listing is no longer available to purchase.');return;}
   if(action==='offer'&&listing.offersEnabled===false){toast('This seller is not accepting offers.');return;}
   appMpListing=listing;appMpContext=data;
   if(action==='offer')return await openAppMarketplaceOfferInMessages();
   return await appMpBuy();
  }catch(error){if(valid())toast(error.message||'Could not open this listing.');}
  finally{if(bar){delete bar.dataset.busy;bar.querySelectorAll('button').forEach(b=>b.disabled=false);}}
 };
 // Cached Home cards can render before this enhancement is loaded.
 for(const card of document.querySelectorAll('#personalFeed .reel-card')){
  const index=Number(card.dataset.index),item=currentFeedItems[index];
  if(!eligible(item)||card.querySelector('.ww-native-reel-actions'))continue;
  const template=document.createElement('template');template.innerHTML=window.renderReelCard(item,index,currentFeedData);
  const actions=template.content.querySelector('.ww-native-reel-actions');if(actions)card.append(actions);
 }
 // Contextual reels were painted over the header. Keep the actual Home controls
 // above that layer, so message badges and handlers retain a single owner.
 const homeFeed=window.wishwaveSetHomeFeed;
 window.wishwaveSetHomeFeed=function(mode,refresh){
  const contextual=document.getElementById('findaiContextualReelV168');
  if(contextual?.classList.contains('show')){go('discover');contextual.classList.remove('show');return homeFeed.call(this,mode,true);}
  return homeFeed.apply(this,arguments);
 };
})();
