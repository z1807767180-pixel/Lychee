(() => {
  const bridge = window.chrome?.webview;
  if (!window.lycheeCanUpdate || !bridge || typeof bridge.postMessage !== 'function') return;
  const panel = document.createElement('section');
  panel.className = 'lychee-update';
  panel.setAttribute('data-windows-update', '');
  panel.setAttribute('aria-label', '荔枝软件更新');
  panel.setAttribute('aria-live', 'polite');
  panel.hidden = true;
  const title = document.createElement('strong');
  const message = document.createElement('p');
  const actions = document.createElement('div');
  panel.append(title, message, actions);
  document.body.append(panel);
  let returnFocus;
  function hide() {
    panel.hidden = true;
    bridge.postMessage('update:dismiss');
    if (returnFocus?.isConnected) returnFocus.focus();
    returnFocus = null;
  }
  function button(text, click) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = text; b.addEventListener('click', click);
    actions.append(b);
  }
  window.LycheeDesktopUpdate = {
    check() { returnFocus = document.activeElement; bridge.postMessage('update:check'); }
  };
  bridge.addEventListener('message', event => {
    const info = event.data;
    if (info?.type !== 'lychee:update') return;
    const headings = {checking:'检查更新', available:'发现新版本 '+info.version,
      current:'荔枝 '+info.current, 'check-error':'暂时无法检查更新', error:'更新暂未完成', downloading:'正在更新荔枝'};
    if (!Object.hasOwn(headings, info.state)) return;
    panel.dataset.updateState = info.state;
    title.textContent = headings[info.state]; message.textContent = info.message;
    actions.replaceChildren();
    if (info.state === 'available') button('立即更新', () => bridge.postMessage('update:install'));
    if (info.state === 'error' || info.state === 'check-error') button('重试', () => bridge.postMessage('update:check'));
    if (info.state !== 'downloading') button(info.state === 'available' ? '稍后' : '关闭', hide);
    panel.hidden = false;
  });
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape' && panel.dataset.updateState !== 'downloading') hide();
  });
})();
