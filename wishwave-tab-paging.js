/* Prepare real tab surfaces without changing the current route during a drag. */
(function(){
  'use strict';
  const create=()=>document.getElementById('createListingScreen');
  function prepareCreate(){
    const root=create();if(!root)return;
    const guest=!getAccountProfile()||!marketplaceSession();root.classList.toggle('wishwave-create-guest',guest);
    if(guest&&!root.querySelector('.wishwave-create-guest-pane')){
      root.insertAdjacentHTML('beforeend','<section class="wishwave-create-guest-pane"><h1>Create a listing</h1><p>Sign in to share your finds and sell on WishWave.</p><button type="button" onclick="closeCreateListing({navigation:true});openLogin()">Sign in</button></section>');
    }
  }
  const prepare=window.__wishwavePrepareTab;
  window.__wishwavePrepareTab=function(tab){
    prepare?.(tab);
    if(tab==='create')prepareCreate();
    if(tab==='notifications'){window.findaiNotificationState?.ensureUI?.();window.findaiNotificationState?.render?.();}
    if(tab==='profile')renderProfileTab();
    if(tab==='search'&&!document.querySelector('#search .premium-explore-tile'))renderPremiumSearchHome();
  };
  const open=window.wishwaveOpenCreateTab;
  window.wishwaveOpenCreateTab=function(){
    prepareCreate();const root=create();
    if(root?.classList.contains('wishwave-create-guest')){
      window.findaiDismissTransientUI?.({preserveCreate:true});
      root.dataset.returnTab=String(document.body.dataset.activeTab||'discover');
      document.body.classList.add('creating-listing');root.classList.add('show');setMainNavActive('create');return;
    }
    return open.apply(this,arguments);
  };
  const close=window.closeCreateListing;
  window.closeCreateListing=function(){
    if(create()?.classList.contains('wishwave-create-guest')){create().classList.remove('show');document.body.classList.remove('creating-listing');return;}
    return close.apply(this,arguments);
  };
  const css=document.createElement('style');css.id='wishwave-pager-surfaces-v250';css.textContent=`
    html body .app #notifications.findai-v132-swipe-surface #findaiNotificationPanel{display:flex!important;opacity:1!important;visibility:visible!important;transform:none!important;transition:none!important;pointer-events:none!important;}
    #createListingScreen.wishwave-create-guest>:not(.wishwave-create-guest-pane){display:none!important;}
    #createListingScreen:not(.wishwave-create-guest)>.wishwave-create-guest-pane{display:none!important;}
    .wishwave-create-guest-pane{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;align-items:center;padding:40px 28px calc(var(--fa-nav-total,52px) + 40px);text-align:center;background:var(--bg,#0c0d0f);color:var(--ink,#f1f2f4);}
    .wishwave-create-guest-pane h1{font-size:26px;letter-spacing:-.5px;margin:0 0 12px;}
    .wishwave-create-guest-pane p{font-size:15px;color:var(--muted,#979da7);max-width:270px;margin:0 0 24px;line-height:1.5;}
    .wishwave-create-guest-pane button{font:inherit;font-weight:600;padding:14px 36px;border:0;border-radius:12px;background:var(--ink,#f1f2f4);color:var(--bg,#0c0d0f);}
    html body.creating-listing .app:has(#createListingScreen.show)>#wishwaveMainNav{visibility:visible!important;pointer-events:auto!important;}
    html body.creating-listing.keyboard-open .app:has(#createListingScreen.show)>#wishwaveMainNav{visibility:hidden!important;pointer-events:none!important;}
  `;document.head.appendChild(css);
})();
