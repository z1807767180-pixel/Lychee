// Notification-only worker. No cache or fetch interception; existing update flow remains unchanged.
self.addEventListener('install',e=>e.waitUntil(self.skipWaiting()));
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('notificationclick',e=>{e.notification.close();e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(clients=>{let c=clients.find(x=>new URL(x.url).pathname.startsWith('/mobile'));return c?c.focus():self.clients.openWindow('/mobile/')}))});
