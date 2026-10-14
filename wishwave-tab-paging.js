/* Prepare existing surfaces before a drag; guest Create uses the real auth form. */
(function(){
  'use strict';
  const create=()=>document.getElementById('createListingScreen');
  const login=document.getElementById('loginOverlay'),loginParent=login.parentElement;
  const isGuest=()=>!getAccountProfile()||!marketplaceSession();
  function releaseLogin(){
    if(login.parentElement===create()){
      loginParent.appendChild(login);login.removeAttribute('data-create-login');
      login.setAttribute('aria-modal','true');
    }
  }
  function prepareCreate(){
    const root=create();if(!root)return;
    const guest=isGuest();root.classList.toggle('wishwave-create-guest',guest);
    if(guest&&!login.classList.contains('show')){
      root.appendChild(login);login.dataset.createLogin='1';login.setAttribute('aria-modal','false');
    }else if(!guest)releaseLogin();
  }
  const prepare=window.__wishwavePrepareTab;
  window.__wishwavePrepareTab=function(tab){
    prepare?.(tab);
    if(tab==='create')prepareCreate();
    if(tab==='notifications'&&!document.getElementById('findaiNotificationPanel')){window.findaiNotificationState?.ensureUI?.();window.findaiNotificationState?.render?.();}
    if(tab==='profile'&&!document.querySelector('#profile .social-profile-grid'))renderProfileTab();
    if(tab==='search'&&!document.querySelector('#search .premium-explore-tile'))renderPremiumSearchHome();
  };
  const open=window.wishwaveOpenCreateTab;
  window.wishwaveOpenCreateTab=function(){
    prepareCreate();const root=create();
    if(root?.classList.contains('wishwave-create-guest')){
      window.findaiDismissTransientUI?.({preserveCreate:true});prepareCreate();
      if(!root.classList.contains('show'))root.dataset.returnTab=String(document.body.dataset.activeTab||'discover');
      document.body.classList.add('creating-listing');root.classList.add('show');setMainNavActive('create');return;
    }
    return open.apply(this,arguments);
  };
  const close=window.closeCreateListing;
  window.closeCreateListing=function(options={}){
    if(create()?.classList.contains('wishwave-create-guest')){
      const root=create(),wasOpen=root.classList.contains('show'),origin=root.dataset.returnTab||'discover';
      root.classList.remove('show');document.body.classList.remove('creating-listing');releaseLogin();
      if(wasOpen&&!options.navigation&&!window.__wishwaveNavigationHandoff){go(origin);setMainNavActive(origin);}
      return;
    }
    releaseLogin();return close.apply(this,arguments);
  };
  const openAuth=window.openLogin,closeAuth=window.closeLogin;
  window.openLogin=function(){
    if(create()?.classList.contains('show')&&isGuest())window.closeCreateListing({navigation:true});
    releaseLogin();return openAuth.apply(this,arguments);
  };
  window.closeLogin=function(){
    if(login.parentElement===create()&&create().classList.contains('show')){
      document.activeElement?.blur?.();window.closeCreateListing();window.resetAppEmailAuth?.();return;
    }
    releaseLogin();return closeAuth.apply(this,arguments);
  };
  const css=document.createElement('style');css.id='wishwave-pager-surfaces-v253';css.textContent=`
    html body .app #notifications.findai-v132-swipe-surface #findaiNotificationPanel{display:flex!important;opacity:1!important;visibility:visible!important;transform:none!important;transition:none!important;pointer-events:none!important;}
    #createListingScreen.wishwave-create-guest>:not(#loginOverlay){display:none!important;}
    html body .app #createListingScreen.wishwave-create-guest>#loginOverlay{display:flex!important;position:absolute!important;inset:0!important;visibility:visible!important;opacity:1!important;transform:none!important;transition:none!important;}
    #createListingScreen.wishwave-create-guest #loginOverlay .auth-card{padding-bottom:calc(var(--fa-nav-total,52px) + 12px + env(safe-area-inset-bottom,0px))!important;}
    html body #loginOverlay .auth-close{left:0!important;right:auto!important;}
    html body.creating-listing .app:has(#createListingScreen.show)>#wishwaveMainNav{display:flex!important;opacity:1!important;visibility:visible!important;pointer-events:auto!important;}
    html body.creating-listing.keyboard-open .app:has(#createListingScreen.show)>#wishwaveMainNav{visibility:hidden!important;pointer-events:none!important;}
  `;document.head.appendChild(css);
})();
