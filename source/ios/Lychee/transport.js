// WKWebView loads files from the app. Account cookies stay in the native HTTPS session.
(() => {
  // Some WebKit versions omit secure-context conveniences on app-owned URL schemes.
  if (!crypto.randomUUID) crypto.randomUUID = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
  };
  if (!crypto.subtle) Object.defineProperty(crypto, 'subtle', {value:{
    async digest(algorithm, buffer) {
      if (algorithm !== 'SHA-256') throw new Error('仅支持 SHA-256');
      const bytes = ArrayBuffer.isView(buffer) ? new Uint8Array(buffer.buffer,buffer.byteOffset,buffer.byteLength) : new Uint8Array(buffer);
      const chunks = [];
      for (let i=0; i<bytes.length; i+=8192) chunks.push(String.fromCharCode(...bytes.subarray(i,i+8192)));
      const hash = await window.webkit.messageHandlers.lycheeAPI.postMessage({op:'sha256',data:btoa(chunks.join(''))});
      return Uint8Array.from(atob(hash),c=>c.charCodeAt(0)).buffer;
    }
  }});
  const webFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input, location.href);
    if (url.protocol !== 'lychee:' || url.host !== 'localhost' ||
        !/^\/(?:api\/|g\/)/.test(url.pathname)) return webFetch(input, init);
    const request = new Request(url.href, input instanceof Request ? input : undefined);
    const call = init ? new Request(request, init) : request;
    const signal = call.signal;
    signal.throwIfAborted();
    const body = call.method === 'POST' ? await call.text() : '';
    const pending = window.webkit.messageHandlers.lycheeAPI.postMessage({
      path: url.pathname + url.search, method: call.method, body,
      type: call.headers.get('content-type') || ''
    });
    let abort;
    try {
      const reply = await Promise.race([pending, new Promise((_, reject) => {
        abort = () => reject(signal.reason || new DOMException('Aborted', 'AbortError'));
        signal.addEventListener('abort', abort, {once:true});
        if (signal.aborted) abort();
      })]);
      const bytes = Uint8Array.from(atob(reply.data), c => c.charCodeAt(0));
      return new Response([204, 205, 304].includes(reply.status) ? null : bytes,
        {status:reply.status, headers:reply.headers});
    } finally {
      if (abort) signal.removeEventListener('abort', abort);
    }
  };
})();
