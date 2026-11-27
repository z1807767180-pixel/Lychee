/* Account-scoped requests shared by the mobile website and Windows client. */
(function () {
  'use strict';
  function requestId() {
    if (typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    const bytes = window.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, value => ('0' + value.toString(16)).slice(-2)).join('');
    return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
  }
  function connect(accountId) {
    if (!accountId) throw Error('请先登录荔枝');
    async function send(params, body) {
      const query = new URLSearchParams(params);
      query.set('accountId', accountId);
      const options = {method:body ? 'POST' : 'GET', credentials:'same-origin', cache:'no-store',
        headers:{Accept:'application/json'}};
      if (body) {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
      }
      const response = await fetch('/api/v8/social?' + query, options);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = Error(data.error || '暂时无法读取，请重试。');
        error.status = response.status;
        throw error;
      }
      return data;
    }
    return {
      read(view, params) { return send(Object.assign({view}, params)); },
      write(action, fields) { return send({}, Object.assign({action}, fields)); }
    };
  }
  function chatDivider(previous, current, interval) {
    const date = new Date(current), prev = previous == null ? null : new Date(previous);
    const sameDay = prev && prev.toDateString() === date.toDateString();
    if (sameDay && current - previous < interval) return '';
    const clock = ('0'+date.getHours()).slice(-2)+':'+('0'+date.getMinutes()).slice(-2);
    if (sameDay || (!prev && date.toDateString() === new Date().toDateString())) return clock;
    return date.getFullYear()+'年'+(date.getMonth()+1)+'月'+date.getDate()+'日 '+clock;
  }
  window.LycheeSocialApi = Object.freeze({connect, requestId, chatDivider});
})();
