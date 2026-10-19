/* Native sign-in uses the OS authentication session, never a WKWebView popup. */
(function () {
  'use strict';
  const webGoogle = window.startGoogleAuth, webApple = window.startAppleAuth;
  let busy = false;
  function feedback(text) {
    ['googleAuthError', 'profileAppleFeedback'].forEach(id => {
      const element = document.getElementById(id);
      if (element) { element.textContent = text; element.setAttribute('role', 'status'); }
    });
  }
  function nativeHost() {
    return !!(window.wishwaveNativeBuild || window.webkit?.messageHandlers?.findaiHaptic);
  }
  async function start(provider, fallback) {
    if (busy) return;
    const bridge = window.webkit?.messageHandlers?.wishwaveAuth;
    if (!bridge) {
      if (nativeHost()) { feedback('Update the WishWave iPhone build to use Google or Apple sign-in. You can use email meanwhile.'); return; }
      return fallback?.();
    }
    busy = true;
    feedback('Opening ' + (provider === 'google' ? 'Google' : 'Apple') + ' sign-in…');
    const buttons = [...document.querySelectorAll('.google-signin-btn,.apple-signin-btn')];
    const states = buttons.map(button => button.disabled);
    buttons.forEach(button => { button.disabled = true; button.setAttribute('aria-busy', 'true'); });
    try {
      const user = await bridge.postMessage({ provider });
      if (!user?.email || !user?.session || user.provider !== provider) throw new Error('Sign-in could not be completed. Please try again.');
      feedback('');
      window.applyFindaiUser(user, provider);
    } catch (error) {
      feedback(String(error?.message || error || 'Sign-in could not be completed. Please try again.'));
    } finally {
      busy = false;
      buttons.forEach((button, index) => { button.disabled = states[index]; button.removeAttribute('aria-busy'); });
    }
  }
  window.startGoogleAuth = () => start('google', webGoogle);
  window.startAppleAuth = () => start('apple', webApple);
})();
