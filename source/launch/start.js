'use strict';
(() => {
  const panel = document.querySelector('#lychee-launch');
  const status = panel.querySelector('p');
  const retry = panel.querySelector('button');
  let running = false;
  const sleep = ms => new Promise(done => setTimeout(done,ms));
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const firstPaint = new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const opening = firstPaint.then(() => sleep(reducedMotion ? 0 : 2300));
  function offerRetry(message) {
    status.textContent = message;
    retry.hidden = false;
  }
  async function start() {
    if (running) return;
    running = true;
    retry.hidden = true;
    status.textContent = '正在连接荔枝园…';
    const started = Date.now();
    try {
      while (true) {
        if (!navigator.onLine) {offerRetry('网络未连接，连上后可以重试。');return;}
        let response;
        let capabilities;
        try {
          response = await fetch('/api/client-capabilities?accountApi=v640', {cache:'no-store',signal:AbortSignal.timeout(9000)});
          if (response.ok && (response.headers.get('content-type')||'').includes('application/json')) {
            capabilities = await response.json();
          }
        } catch { /* A cold service can time out before it starts accepting requests. */ }
        if (capabilities?.protocol === 1 && capabilities.accountApi==='v640' && capabilities.privateGardens && capabilities.accountNotices) break;
        if (response?.status === 404 || capabilities?.protocol) {
          offerRetry('服务正在准备新版，稍后可以重试。');return;
        }
        if (Date.now()-started>90000) {offerRetry('暂时连不上荔枝园，请稍后重试。');return;}
        if (Date.now()-started>5000) status.textContent='荔枝园正在醒来，请稍候…';
        await sleep(2500);
      }
      status.textContent='正在打开荔枝…';
      const gate = document.createElement('script');
      gate.src='/client/garden.js?v='+encodeURIComponent(document.body.dataset.clientBuild);
      // Keep the splash until the client has actually painted an interactive view.
      const root = document.getElementById('root');
      const ready = () => !!document.querySelector('.garden-access button,.garden-access input') || !!root.querySelector('input,button,main,form');
      const rendered = new Promise((resolve,reject) => {
        const observer = new MutationObserver(() => {if(ready()) finish(true);});
        const timeout=setTimeout(()=>finish(false),30000);
        function finish(ok) {observer.disconnect(); clearTimeout(timeout);ok?resolve():reject(new Error('load'));}
        observer.observe(document.body,{childList:true,subtree:true});
        gate.onerror=()=>finish(false);
        document.head.append(gate);
        if(ready())finish(true);
      });
      try {
        await Promise.all([rendered,opening]);
        panel.classList.add('launch-finished');
        if(!reducedMotion)await sleep(230);
        panel.remove();
      }
      catch {retry.onclick=()=>location.reload();offerRetry('页面加载中断，可以重新打开。');}
    } finally {running=false;}
  }
  retry.onclick=start;
  window.addEventListener('online',()=>{if(!retry.hidden)retry.click();});
  start();
})();
