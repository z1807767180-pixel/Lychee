// Read the visible rectangle, including Safari's pan while the keyboard opens.
const viewport = window.visualViewport;
if (viewport) {
  const page = document.documentElement;
  let fullHeight = viewport.height;
  let lastWidth = viewport.width;
  const syncViewport = () => {
    if (Math.abs(viewport.scale - 1) > 0.02) return;
    const typing = document.activeElement?.matches('input:not([type=file]),textarea,[contenteditable=true]');
    if (Math.abs(lastWidth - viewport.width) > 50) fullHeight = viewport.height;
    lastWidth = viewport.width;
    if (!typing) fullHeight = Math.max(viewport.height, window.innerHeight);
    const obscured = Math.max(window.innerHeight, fullHeight) - viewport.height;
    page.dataset.keyboard = typing && obscured > 90 ? 'open' : 'closed';
    page.style.setProperty('--phone-height', viewport.height + 'px');
    page.style.setProperty('--phone-top', viewport.offsetTop + 'px');
  };
  viewport.addEventListener('resize', syncViewport);
  viewport.addEventListener('scroll', syncViewport);
  window.addEventListener('pageshow', syncViewport);
  document.addEventListener('focusin', syncViewport);
  document.addEventListener('focusout', () => requestAnimationFrame(syncViewport));
  syncViewport();
}

// WebKit can recognize a native pinch independently of the viewport meta tag.
// Leave touchstart, touchend and single-finger movement to the app and browser.
function preventPagePinch(event) {
  if (event.cancelable) event.preventDefault();
}
document.addEventListener('gesturestart', preventPagePinch, {capture:true, passive:false});
document.addEventListener('gesturechange', preventPagePinch, {capture:true, passive:false});
