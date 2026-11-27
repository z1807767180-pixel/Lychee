'use strict';
(() => {
  const bridge = window.chrome?.webview;
  if (!window.lycheeDesktopHost || !bridge) return;
  document.documentElement.classList.add('lychee-native-window');
  document.addEventListener('click', event => {
    const link = event.target.closest?.('.qz a[target="_blank"]');
    if (!link || link.protocol !== 'https:' || link.username || link.password) return;
    event.preventDefault();
    const dialog = document.createElement('dialog');
    dialog.className = 'lychee-source-link';
    dialog.setAttribute('aria-label', link.textContent);
    const label = document.createElement('label');
    label.textContent = link.textContent;
    const url = document.createElement('input');
    url.type = 'text';
    url.readOnly = true;
    url.value = link.href;
    label.append(url);
    const copy = document.createElement('button'), close = document.createElement('button');
    copy.textContent = '复制链接';
    close.textContent = '关闭';
    copy.onclick = async () => {
      url.focus();
      url.select();
      try {
        await navigator.clipboard.writeText(url.value);
        copy.textContent = '已复制';
      } catch {
        copy.textContent = '请按 Ctrl+C 复制';
      }
    };
    close.onclick = () => dialog.close();
    dialog.onclose = () => { dialog.remove(); if (link.isConnected) link.focus(); };
    dialog.append(label, copy, close);
    document.body.append(dialog);
    dialog.showModal();
    url.select();
  });
  window.addEventListener('keydown', event => {
    if (!event.ctrlKey || event.altKey || event.shiftKey || event.metaKey || event.key.toLowerCase() !== 'q') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.repeat) bridge.postMessage('window:minimize');
  }, true);
  if (!window.lycheeNativeFrame) return;
  const controls = document.createElement('div');
  controls.className = 'lychee-window-controls';
  controls.setAttribute('role','group');
  controls.setAttribute('aria-label','窗口');
  for (const [command, label] of [['minimize','最小化'], ['maximize','最大化或还原'], ['close','关闭']]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.command = command;
    button.title = command === 'minimize' ? '最小化（Ctrl+Q）' : label;
    if (command === 'minimize') button.setAttribute('aria-keyshortcuts','Control+Q');
    button.setAttribute('aria-label',label);
    button.onclick = () => bridge.postMessage('window:' + command);
    controls.append(button);
  }
  document.body.append(controls);
  let previous, pending = false;
  function update() {
    pending = false;
    const header = document.querySelector('.s8 > .s8-header,.garden-app > .appbar');
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
