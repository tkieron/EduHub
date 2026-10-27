/* EduHub v0.8: statyczna powłoka oraz lokalne aplikacje z IndexedDB */
const CACHE='eduhub-shell-0.8';
const SHELL=['./','./index.html','./style.css','./app.js','./groq-pomoc.html','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png'];
const DB_NAME='eduhub-v1', DB_VERSION=1;
function openDb(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,DB_VERSION);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('apps'))req.result.createObjectStore('apps',{keyPath:'id'});};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function getApp(id){const db=await openDb();try{return await new Promise((resolve,reject)=>{const req=db.transaction('apps','readonly').objectStore('apps').get(id);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}finally{db.close();}}
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('eduhub-shell-')&&key!==CACHE).map(key=>caches.delete(key)))),self.clients.claim()])));
self.addEventListener('fetch',event=>{
 const req=event.request;if(req.method!=='GET')return;
 const url=new URL(req.url),scope=new URL(self.registration.scope);
 if(url.origin!==scope.origin||!url.pathname.startsWith(scope.pathname))return;
 const relative=url.pathname.slice(scope.pathname.length);
 const match=/^apps\/([a-zA-Z0-9_-]+)\/?(?:index\.html)?$/.exec(relative);
 if(match){if(req.mode!=='navigate'&&req.destination!=='document')return;
  event.respondWith((async()=>{try{const app=await getApp(match[1]);if(!app)return new Response('<h1>Nie znaleziono aplikacji</h1><p><a href="'+scope.href+'">Wróć do EduHubu</a></p>',{status:404,headers:{'Content-Type':'text/html; charset=utf-8'}});
   // Most aplikacji: nowy plik może odczytać ustawienie przez window.EduHub.getGroqKey().
   // Historyczne aplikacje z wpisanym na stałe kluczem nie są automatycznie przepisywane.
   const bridge='<script>window.EduHub=Object.freeze({version:"0.2",getGroqKey:function(){try{return localStorage.getItem("eduhub:groq-key")||""}catch(e){return ""}},isEduHub:true});<\/script>';
   const html=/<head(?:\s[^>]*)?>/i.test(app.html)?app.html.replace(/<head(\s[^>]*)?>/i,m=>m+bridge):bridge+app.html;
   return new Response(html,{status:200,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  }catch(e){return new Response('Błąd lokalnej aplikacji: '+String(e),{status:500,headers:{'Content-Type':'text/plain; charset=utf-8'}});}})());return;}
 event.respondWith((async()=>{const isShell=['','index.html','app.js','style.css','groq-pomoc.html','sw.js','manifest.webmanifest','icons/icon-192.png','icons/icon-512.png'].includes(relative);
  if(isShell){const cached=await caches.match(req,{ignoreSearch:true});if(cached)return cached;}
  try{return await fetch(req);}catch(e){if(req.mode==='navigate')return(await caches.match(new URL('./index.html',scope).href))||Response.error();throw e;}
 })());
});
