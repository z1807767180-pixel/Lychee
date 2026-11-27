// Include only standard library features used by the shipped mobile client.
require('core-js/modules/es.array.at');
require('core-js/modules/es.array.flat-map');
require('core-js/modules/es.object.from-entries');
require('core-js/modules/es.object.has-own');
require('core-js/modules/es.string.replace-all');
require('core-js/modules/web.structured-clone');
require('core-js/modules/web.queue-microtask');

if (!Element.prototype.replaceChildren) {
  Element.prototype.replaceChildren = function (...children) {
    const next = document.createDocumentFragment();
    next.append(...children);
    while (this.firstChild) this.removeChild(this.firstChild);
    this.appendChild(next);
  };
}

if (!crypto.randomUUID && crypto.getRandomValues) {
  crypto.randomUUID = function () {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, n => n.toString(16).padStart(2,'0')).join('');
    return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
  };
}
