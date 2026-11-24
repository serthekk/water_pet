'use strict';
// Invisible click catcher under the open menu (catcher.html): any press closes the menu.
(() => {
  const close = (e) => {
    e.preventDefault();
    window.menuApi.close('clicked outside');
  };
  // Windows can swallow the PRESS on a never-focused window (only the release arrives),
  // so the release counts too (main also listens for WM_MOUSEACTIVATE)
  window.addEventListener('mousedown', close, true);
  window.addEventListener('mouseup', close, true);
  window.addEventListener('contextmenu', close, true);
  window.addEventListener('wheel', () => window.menuApi.close('scrolled outside'), { passive: true });
})();
