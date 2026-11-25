'use strict';
(() => {
  const bridge = window.chrome?.webview;
  if (!window.lycheeNativeFrame || !bridge) return;
  document.documentElement.classList.add('lychee-native-window');
  const controls = document.createElement('div');
  controls.className = 'lychee-window-controls';
  controls.setAttribute('role','group');
  controls.setAttribute('aria-label','窗口');
  for (const [command, label] of [['minimize','最小化'], ['maximize','最大化或还原'], ['close','关闭']]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.command = command;
    button.title = label;
    button.setAttribute('aria-label',label);
    button.onclick = () => bridge.postMessage('window:' + command);
    controls.append(button);
  }
  document.body.append(controls);
  let previous, pending = false;
  function update() {
    pending = false;
    const header = document.querySelector('.garden-app > .appbar');
    const rect = header?.getBoundingClientRect();
    // Full-screen activities, login and dialogs retain the compact native caption.
    const blocked = document.querySelector('#lychee-launch,.garden-access:not([hidden])');
    const x = rect ? Math.min(innerWidth - 2, rect.right - 2) : 0;
    const top = rect ? document.elementFromPoint(x, rect.top + rect.height / 2) : null;
    const visible = Boolean(!blocked && rect && rect.width > 240 && rect.height >= 42 &&
      rect.top >= -2 && rect.top < 8 && (header.contains(top) || controls.contains(top)));
    if (visible) {
      controls.style.top = Math.round(rect.top + (rect.height - 30) / 2) + 'px';
      controls.style.right = Math.max(0, innerWidth - rect.right + 4) + 'px';
    }
    if (visible === previous) return;
    previous = visible;
    document.documentElement.classList.toggle('lychee-unified-header', visible);
    bridge.postMessage(visible ? 'frame:on' : 'frame:off');
  }
  function schedule() {
    if (!pending) { pending = true; requestAnimationFrame(update); }
  }
  new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','hidden']});
  window.addEventListener('resize',schedule);
  schedule();
})();
