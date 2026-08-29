const CACHE='lectoria-shell-v15'
const scopeUrl=new URL(self.registration.scope)
const CORE=[scopeUrl.href,new URL('manifest.webmanifest',scopeUrl).href]

self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE)).then(()=>self.skipWaiting()))})
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))})

function cacheable(req,url){
  if(req.method!=='GET')return false
  if(url.origin!==self.location.origin)return false
  if(req.headers.has('authorization')||req.headers.has('cookie'))return false
  if(url.pathname.includes('/api/'))return false
  return req.mode==='navigate'||['document','script','style','font','image','manifest'].includes(req.destination)
}

self.addEventListener('fetch',event=>{
  const req=event.request,url=new URL(req.url)
  if(!cacheable(req,url))return
  if(req.mode==='navigate'){
    event.respondWith(fetch(req).then(res=>{if(res.ok)caches.open(CACHE).then(cache=>cache.put(req,res.clone()));return res}).catch(()=>caches.match(req).then(hit=>hit||caches.match(scopeUrl.href))))
    return
  }
  event.respondWith(caches.match(req).then(hit=>hit||fetch(req).then(res=>{if(res.ok&&res.type==='basic')caches.open(CACHE).then(cache=>cache.put(req,res.clone()));return res})))
})

self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(clients=>{const existing=clients[0];if(existing)return existing.focus();return self.clients.openWindow(scopeUrl.href)}))})
