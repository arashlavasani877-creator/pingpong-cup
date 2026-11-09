/* Scope: GitHub Pages /pingpong-cup/. Never cache Firebase responses or the JS config. */
const CACHE_NAME='pingpong-offline-fallback-v1';
const OFFLINE_PAGE='./offline.html';
self.addEventListener('install',event=>{
 event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.add(OFFLINE_PAGE)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
 event.waitUntil(Promise.all([
   caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE_NAME).map(key=>caches.delete(key)))),
   self.clients.claim()
 ]));
});
self.addEventListener('fetch',event=>{
 if(event.request.mode!=='navigate')return;
 event.respondWith(fetch(event.request).catch(async()=>{
   const cache=await caches.open(CACHE_NAME);
   return (await cache.match(OFFLINE_PAGE)) || Response.error();
 }));
});
