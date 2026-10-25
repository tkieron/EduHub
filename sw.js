/* EduHub 0.1 — lokalny wirtualny serwer HTML, działający w Service Workerze. */
const CACHE = 'eduhub-shell-0.1';
const SHELL = ['./', './index.html', './style.css', './app.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];
const DB_NAME = 'eduhub-v1';
const DB_VERSION = 1;
function openDb() {
  return new Promise((resolve,reject) => {
    const req = indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded = () => {if(!req.result.objectStoreNames.contains('apps')) req.result.createObjectStore('apps',{keyPath:'id'});};
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function getApp(id) {
  const db=await openDb();
  try {return await new Promise((resolve,reject)=>{const req=db.transaction('apps','readonly').objectStore('apps').get(id);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
  finally {db.close();}
}
self.addEventListener('install', event=> {
  event.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', event=> {
  event.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('eduhub-shell-')&&k!==CACHE).map(k=>caches.delete(k)))),self.clients.claim()]));
});
self.addEventListener('fetch', event=>{
  const request=event.request;
  if(request.method!=='GET') return;
  const url=new URL(request.url);
  const scope=new URL(self.registration.scope);
  if(url.origin!==scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const relative=url.pathname.slice(scope.pathname.length);
  const match=/^apps\/([a-zA-Z0-9_-]+)\/?(?:index\.html)?$/.exec(relative);
  if(match){
    if(request.mode!=='navigate' && request.destination!=='document') return;
    event.respondWith((async()=>{
      try{
        const app=await getApp(match[1]);
        if(!app) return new Response('<h1>Nie znaleziono aplikacji</h1><p><a href="'+scope.href+'">Wróć do EduHubu</a></p>',{status:404,headers:{'Content-Type':'text/html; charset=utf-8'}});
        return new Response(app.html,{status:200,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
      }catch(err){return new Response('Błąd wczytywania: '+String(err),{status:500,headers:{'Content-Type':'text/plain; charset=utf-8'}});}
    })());
    return;
  }
  event.respondWith((async()=>{
    const cached=await caches.match(request,{ignoreSearch:true});
    if(cached) return cached;
    try{return await fetch(request);}catch(err){
      if(request.mode==='navigate') return (await caches.match(new URL('./index.html',scope).href))||Response.error();
      throw err;
    }
  })());
});
