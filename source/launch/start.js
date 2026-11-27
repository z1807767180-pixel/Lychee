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
  // Older Android WebViews can fetch normally without AbortSignal.timeout.
  window.lycheeTimeoutSignal = function(ms) {
    if (typeof window.AbortSignal?.timeout === 'function') return window.AbortSignal.timeout(ms);
    if (typeof window.AbortController !== 'function') return undefined;
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
  };
  function probe(timeout) {
    return new Promise(resolve => {
      const request = new XMLHttpRequest();
      request.open('GET','/api/client-capabilities?accountApi=v640');
      request.timeout = timeout;
      request.setRequestHeader('Accept','application/json');
      request.setRequestHeader('Cache-Control','no-cache');
      request.onload = () => {
        let data;
        if (request.status === 200 && (request.getResponseHeader('Content-Type') || '').includes('application/json')) {
          try { data = JSON.parse(request.responseText); } catch { /* The service may still be starting. */ }
        }
        resolve({status:request.status, data});
      };
      request.onerror = () => resolve({status:0});
      request.ontimeout = () => resolve({status:0});
      request.onabort = () => resolve({status:0});
      request.send();
    });
  }
  function offerRetry(message) {
    status.textContent = message;
    retry.hidden = false;
  }
  async function start() {
    if (running) return;
    running = true;
    retry.hidden = true;
    status.textContent = '正在连接荔枝园…';
    const deadline = Date.now()+90000;
    const waking = setTimeout(() => {
      if (running && retry.hidden) status.textContent='正在等荔枝园响应…';
    },5000);
    try {
      while (true) {
        const remaining = deadline-Date.now();
        if (remaining<=0) {offerRetry('暂时连不上荔枝园，请检查当前网络后重试。');return;}
        const {status:code,data:capabilities} = await probe(Math.min(75000,remaining));
        if (capabilities?.protocol === 1 && capabilities.accountApi==='v640' && capabilities.privateGardens && capabilities.accountNotices) break;
        if (code === 0 && navigator.onLine === false) {
          offerRetry('网络未连接，连上后可以重试。');return;
        }
        if (code === 404 || capabilities?.protocol) {
          offerRetry('服务正在准备新版，稍后可以重试。');return;
        }
        if (code === 401 || code === 403) {
          offerRetry('当前连接被拒绝（HTTP '+code+'），请检查网络后重试。');return;
        }
        await sleep(Math.max(0,Math.min(2500,deadline-Date.now())));
      }
      clearTimeout(waking);
      status.textContent='正在打开荔枝…';
      const gate = document.createElement('script');
      gate.src='/client/garden.js?v='+encodeURIComponent(document.body.dataset.clientBuild);
      const visibleControl = () => {
        const controls = document.querySelectorAll('.garden-access input,.garden-access button,#root input,#root button,#root a[href],#root [role="button"]');
        return Array.from(controls).some(control => {
          if (control.disabled || control.closest('[hidden],[aria-hidden="true"]')) return false;
          const box = control.getBoundingClientRect();
          return box.width > 0 && box.height > 0 && getComputedStyle(control).visibility === 'visible';
        });
      };
      const rendered = new Promise((resolve,reject) => {
        const deadline = Date.now()+30000;
        let since=0, timer=0, stopped=false;
        function check(){
          if(stopped)return;
          const now=Date.now();
          if(visibleControl()){
            if(since && now-since>=350){resolve();return;}
            if(!since)since=now;
          }else since=0;
          if(now>=deadline){reject(new Error('load'));return;}
          timer=setTimeout(check,100);
        }
        gate.onerror=()=>{stopped=true;clearTimeout(timer);reject(new Error('load'));};
        document.head.append(gate);
        // A temporary sign-in control or an empty React main can disappear during startup.
        opening.then(check);
      });
      try {
        await Promise.all([rendered,opening]);
        panel.classList.add('launch-finished');
        if(!reducedMotion)await sleep(230);
        panel.remove();
      }
      catch {retry.onclick=()=>location.reload();offerRetry('页面加载中断，可以重新打开。');}
    } catch {offerRetry('启动请求未能完成，请重试。');}
    finally {clearTimeout(waking);running=false;}
  }
  retry.onclick=start;
  window.addEventListener('online',()=>{if(!retry.hidden)retry.click();});
  start();
})();
