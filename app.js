(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const DB_NAME='eduhub-v1', DB_VERSION=1, MAX_BYTES=20*1024*1024;
  const KEY_NAME='eduhub:groq-key';
  const scopeUrl=new URL('./',location.href);
  const isSecure=(location.protocol==='https:'||['localhost','127.0.0.1'].includes(location.hostname));
  const appUrl=id=>new URL('./apps/'+encodeURIComponent(id)+'/',scopeUrl).href;
  const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
  const formatBytes=n=>n>1048576?(n/1048576).toFixed(2)+' MB':Math.max(1,Math.round(n/1024))+' KB';
  const shortDate=n=>new Date(n).toLocaleDateString('pl-PL',{day:'numeric',month:'short',year:'numeric'});
  let currentApps=[],selectedGrade=null,selectedSubject=null,recognition=null,toastTimer=null;
  let showCatalogView=false,publicCatalog=null,catalogIsLoading=false,catalogGrade='all',catalogSubject='all',catalogError='',catalogInstalledOpen=false;
  const CATALOG_URL='./catalog/catalog.json';
  const gradeLabel=g=>g==='Bez klasy'?'Bez klasy':/^\d+[a-z]?$/i.test(g)?'Klasa '+g:g;
  const tidy=v=>String(v??'').trim().replace(/\s+/g,' ').slice(0,80);
  const subjectName=v=>{const s=tidy(v);const look={przyroda:'Przyroda',matematyka:'Matematyka',angielski:'Język angielski','język angielski':'Język angielski',english:'Język angielski',ortografia:'Język polski',polski:'Język polski','język polski':'Język polski',historia:'Historia',geografia:'Geografia',biologia:'Biologia',informatyka:'Informatyka'};return look[s.toLocaleLowerCase('pl')]||s||'Inne';};
  const normGrade=v=>{let s=tidy(v).replace(/^kl(?:asa)?[ ._-]*/i,'').replace(/^grade[ ._-]*/i,'');return s||'Bez klasy';};
  const inferSubject=text=>{const s=String(text).toLocaleLowerCase('pl');if(/przyrod/.test(s))return 'Przyroda';if(/angiel|english|together[_ -]?4/.test(s))return 'Język angielski';if(/matemat|kolejno[sś][cć] dzia[łl]a[nń]/.test(s))return 'Matematyka';if(/ortograf|j[eę]zyk polski/.test(s))return 'Język polski';if(/histor/.test(s))return 'Historia';return 'Inne';};
  const iconFor=s=>{const v=subjectName(s);return {'Przyroda':'🌿','Matematyka':'🧮','Język angielski':'🇬🇧','Język polski':'✍️','Historia':'🏛️','Geografia':'🌎','Informatyka':'💻','Biologia':'🧬'}[v]||'📗';};
  const toast=msg=>{clearTimeout(toastTimer);$('toast').textContent=msg;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,4500);};
  function openDb(){return new Promise((resolve,reject)=>{const request=indexedDB.open(DB_NAME,DB_VERSION);request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('apps'))request.result.createObjectStore('apps',{keyPath:'id'});};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
  async function dbOperation(mode,fn){const db=await openDb();try{return await new Promise((resolve,reject)=>{const tx=db.transaction('apps',mode);let value;tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Anulowano transakcję'));try{const r=fn(tx.objectStore('apps'));r.onsuccess=()=>value=r.result;r.onerror=()=>reject(r.error);}catch(e){reject(e);}});}finally{db.close();}}
  const listApps=()=>dbOperation('readonly',s=>s.getAll());
  const saveApp=a=>dbOperation('readwrite',s=>s.put(a));
  const removeApp=id=>dbOperation('readwrite',s=>s.delete(id));
  const trusted=()=>isSecure&&'indexedDB'in window&&'serviceWorker'in navigator;
  function setStatus(){$('netStatus').textContent=navigator.onLine?'● Online':'● Offline';$('netStatus').classList.toggle('offline',!navigator.onLine);}
  async function initServiceWorker(){const notice=$('setupNotice');if(!trusted()){notice.hidden=false;notice.textContent='Uruchom EduHub przez HTTPS (GitHub Pages) lub localhost. Importowane dokumenty nie zadziałają poprawnie przez content://.';$('importBtn').disabled=true;return;}try{await navigator.serviceWorker.register('./sw.js',{scope:'./'});await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller){await new Promise(resolve=>{const finish=()=>{clearTimeout(timer);navigator.serviceWorker.removeEventListener('controllerchange',finish);resolve();};const timer=setTimeout(finish,3000);navigator.serviceWorker.addEventListener('controllerchange',finish);});}if(!navigator.serviceWorker.controller){notice.hidden=false;notice.textContent='Odśwież EduHub, aby aktywować lokalne aplikacje.';}}catch(e){notice.hidden=false;notice.textContent='Błąd Service Workera: '+String(e);}}
  function getGroqKey(){try{return localStorage.getItem(KEY_NAME)||'';}catch(e){return '';}}
  function refreshGroqIndicator(){$('groqIndicator').textContent=getGroqKey()?'✓':'';}
  async function refresh(){try{currentApps=(await listApps()).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));renderLibrary();refreshGroqIndicator();}catch(e){toast('Błąd biblioteki: '+e.message);}}
  // Wersja należy do aplikacji, a nie do pliku EduHub; starsze wpisy migrujemy bez usuwania danych.
  const normalizeVersion=v=>{const s=String(v||'').trim().replace(/^v/i,'');return /^\d+\.\d+(?:\.\d+)?$/.test(s)?s:'';};
  const versionFromText=s=>(/(?:^|[^a-z0-9])v(\d+\.\d+(?:\.\d+)?)(?![\d.])/i.exec(String(s||''))||[])[1]||'';
  function versionFromHtml(html){const match=/<meta\s+[^>]*name=["'](?:eduhub:version|edu:version|app-version)["'][^>]*>/i.exec(String(html||''));if(!match)return '';return normalizeVersion((/content=["']([^"']+)["']/i.exec(match[0])||[])[1]);}
  function normalizedApp(a){return {...a,grade:normGrade(a.grade),subject:subjectName(a.subject||inferSubject((a.name||'')+' '+(a.filename||''))),name:tidy(a.name)||'Aplikacja',version:normalizeVersion(a.version)||versionFromHtml(a.html)||versionFromText((a.filename||'')+' '+(a.name||''))};}

  function activeGrades(){return [...new Set(currentApps.map(a=>normalizedApp(a).grade))].sort((a,b)=>a==='Bez klasy'?1:b==='Bez klasy'?-1:a.localeCompare(b,'pl',{numeric:true}));}
  function navButton(label,fn,current=false){const b=el('button','crumb',label);b.type='button';b.onclick=fn;if(current)b.setAttribute('aria-current','page');return b;}
  function renderBreadcrumbs(grades){const node=$('breadcrumbs');node.replaceChildren();const multiple=grades.length>1;
    if(selectedGrade===null||!currentApps.length){node.hidden=true;return;}
    node.hidden=false;
    if(multiple){node.append(navButton('🏠 Klasy',()=>{selectedGrade=null;selectedSubject=null;renderLibrary();}));node.append(el('span','crumb-divider','›'));}
    node.append(navButton(gradeLabel(selectedGrade),()=>{selectedSubject=null;renderLibrary();},selectedSubject===null));
    if(selectedSubject!==null){node.append(el('span','crumb-divider','›'));node.append(navButton(selectedSubject,()=>{},true));}
  }
  function renderLibrary(){if(showCatalogView){renderCatalog();return;}const wrap=$('appGrid');wrap.replaceChildren();$('appCount').textContent=currentApps.length?currentApps.length+' aplikacji przechowywanych lokalnie.':'Pliki pozostają na tym urządzeniu.';
    if(!currentApps.length){$('viewHeading').textContent='Moje aplikacje';$('breadcrumbs').hidden=true;const empty=el('div','empty');empty.append(el('div','empty-icon','📚'),el('h3','','Twoja biblioteka czeka'),el('p','','Dodaj szkolną aplikację HTML. Przypiszemy ją do klasy i przedmiotu.'));const b=el('button','btn btn-primary','Wybierz plik HTML');b.onclick=chooseFile;empty.append(b);wrap.append(empty);return;}
    const grades=activeGrades();if(selectedGrade!==null&&!grades.includes(selectedGrade)){selectedGrade=null;selectedSubject=null;}
    if(selectedGrade===null&&grades.length===1)selectedGrade=grades[0];
    if(selectedGrade===null){$('viewHeading').textContent='Wybierz klasę';for(const grade of grades){const apps=currentApps.filter(a=>normalizedApp(a).grade===grade);const b=el('button','app-card category-card');b.type='button';b.append(el('div','card-icon','🎒'),el('h3','app-name',gradeLabel(grade)),el('div','category-count',apps.length+' aplikacji · '+new Set(apps.map(a=>normalizedApp(a).subject)).size+' przedmiotów'));b.onclick=()=>{selectedGrade=grade;selectedSubject=null;renderLibrary();};wrap.append(b);}renderBreadcrumbs(grades);return;}
    const inGrade=currentApps.filter(a=>normalizedApp(a).grade===selectedGrade);const subjects=[...new Set(inGrade.map(a=>normalizedApp(a).subject))].sort((a,b)=>a.localeCompare(b,'pl'));
    if(selectedSubject!==null&&!subjects.includes(selectedSubject))selectedSubject=null;
    if(selectedSubject===null){$('viewHeading').textContent=gradeLabel(selectedGrade)+' — przedmioty';for(const subject of subjects){const count=inGrade.filter(a=>normalizedApp(a).subject===subject).length;const b=el('button','app-card category-card');b.type='button';b.append(el('div','card-icon',iconFor(subject)),el('h3','app-name',subject),el('div','category-count',count+(count===1?' aplikacja':' aplikacje')));b.onclick=()=>{selectedSubject=subject;renderLibrary();};wrap.append(b);}renderBreadcrumbs(grades);return;}
    $('viewHeading').textContent=selectedSubject+' — '+gradeLabel(selectedGrade);for(const app of inGrade.filter(a=>normalizedApp(a).subject===selectedSubject))renderAppCard(wrap,app);renderBreadcrumbs(grades);
  }
  function renderAppCard(container,app){const a=normalizedApp(app);const card=el('article','app-card');const top=el('div','card-top');const icon=el('div','card-icon',a.icon||iconFor(a.subject));const detail=el('div');detail.append(el('h3','app-name',a.name),el('div','app-meta',formatBytes(a.byteSize||new Blob([a.html]).size)+' · '+shortDate(a.updatedAt)),el('div',a.version?'version-tag':'version-tag missing',a.version?'Wersja v'+a.version:'⚠ Wersja do uzupełnienia'));top.append(icon,detail);const label=el('span','category-tag',gradeLabel(a.grade)+' · '+a.subject);const description=el('div','card-description','Zapisana lokalnie. Wyniki pozostaną na urządzeniu przy aktualizacji pliku.');const actions=el('div','card-actions');const launch=el('button','btn btn-primary btn-sm open-app','▶ Uruchom');launch.onclick=()=>launchApp(a.id);const update=el('button','icon-btn','↻');update.title='Aktualizuj plik HTML';update.setAttribute('aria-label','Aktualizuj '+a.name);update.onclick=()=>chooseReplacement(a);const edit=el('button','icon-btn','✎');edit.title='Zmień klasę, przedmiot lub nazwę';edit.setAttribute('aria-label','Edytuj '+a.name);edit.onclick=()=>editMetadata(a);const del=el('button','icon-btn','×');del.title='Usuń aplikację';del.setAttribute('aria-label','Usuń '+a.name);del.onclick=async()=>{if(!confirm('Usunąć „'+a.name+'” z biblioteki? Historia wyników nie będzie automatycznie usunięta.'))return;await removeApp(a.id);await refresh();toast('Usunięto aplikację.');};if(a.subject==='Język angielski'&&/gsk_[A-Za-z0-9_-]{18,}/.test(a.html)){const bridge=el('button','btn btn-outline btn-sm','🔑 Podłącz AI EduHub');bridge.title='Usuń stary klucz i podłącz wspólny Groq';bridge.onclick=()=>upgradeEnglish(a);actions.append(bridge);}if(publicCatalog){const match=publicCatalog.apps.find(e=>installedFor(e)?.id===a.id);if(match&&compareAppVersions(match.version,a.version)>0){const remoteUpdate=el('button','btn btn-outline btn-sm','⬇ Aktualizuj do v'+match.version);remoteUpdate.onclick=()=>installFromCatalog(match);actions.prepend(remoteUpdate);const info=el('div','update-available','Dostępna nowa wersja v'+match.version+'. Twoje wyniki zostaną zachowane.');description.append(info);}}actions.append(launch,update,edit,del);if(a.previousRelease){const rollback=el('button','btn btn-outline btn-sm','↩ Poprzednia wersja');rollback.onclick=()=>rollbackApp(a);actions.append(rollback);}card.append(top,label,description,actions);container.append(card);}
  // Aktualizacja starszej aplikacji angielskiego bez dostępu do jej pierwotnego projektu.
  // Zmienia tylko metadane i sposób autoryzacji zapytań do Groq, nie dotyka pytań ani localStorage aplikacji.
  function migrateLegacyEnglish(html){
    if(typeof html!=='string'||!/<html[\s>]|<!doctype\s+html/i.test(html))throw new Error('To nie jest pełny plik HTML.');
    if(html.includes('EDUHUB_GROQ_BRIDGE_V1'))return {html,removed:0,already:true};
    const found=html.match(/gsk_[A-Za-z0-9_-]{18,}/g)||[];
    let output=html.replace(/gsk_[A-Za-z0-9_-]{18,}/g,'gsk_EDUHUB_RUNTIME_PLACEHOLDER');
    // Dla bezpieczeństwa nie publikujemy starego klucza, nawet gdy pozostałby w logice aplikacji.
    output=output.replace(/<meta\s+name=["']eduhub:(?:class|subject|name)["'][^>]*>/gi,'');
    const meta='<meta name="eduhub:class" content="4">\n<meta name="eduhub:subject" content="Język angielski">\n<meta name="eduhub:name" content="Together 4 – Rozdział 1">\n';
    const bridge=`<script>
/* EDUHUB_GROQ_BRIDGE_V1: przechwytywanie autoryzacji wyłącznie do Groq */
(() => {
  'use strict';
  const originalFetch=window.fetch.bind(window);
  window.__eduhubGroqKey=() => {try {return localStorage.getItem('eduhub:groq-key')||'';} catch(e) {return '';} };
  window.fetch=function(input,init) {
    let url='';
    try {url=typeof input==='string'?input:(input instanceof URL?input.href:input?.url||'');}catch(e){}
    if(!url.startsWith('https://api.groq.com/'))return originalFetch(input,init);
    const key=window.__eduhubGroqKey();
    if(!key)return Promise.reject(new Error('Brak klucza Groq – otwórz EduHub i wpisz go w ustawieniach 🔑.'));
    const headers=new Headers(init?.headers||(input instanceof Request?input.headers:undefined));
    headers.set('Authorization','Bearer '+key);
    return originalFetch(input,{...(init||{}),headers});
  };
})();
</script>\n`;
    if(/<head\b[^>]*>/i.test(output))output=output.replace(/<head\b[^>]*>/i,match=>match+'\n'+meta+bridge);
    else output=output.replace(/<html\b[^>]*>/i,match=>match+'\n<head>'+meta+bridge+'</head>');
    if(!output.includes('EDUHUB_GROQ_BRIDGE_V1'))throw new Error('Nie znaleziono znacznika <head> ani <html>.');
    return {html:output,removed:found.length,already:false};
  }
  function downloadLocalHtml(text,filename){
    const url=URL.createObjectURL(new Blob([text],{type:'text/html;charset=utf-8'}));
    const a=el('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
  }
  function upgradeEnglish(app){
    const a=normalizedApp(app),root=el('div');
    root.append(el('p','hint','Dostosujemy Angielski do EduHub. Zostaną wszystkie pytania, wyniki i dotychczasowa aplikacja. Usuniemy klucz zaszyty w pliku, a zapytania do Groq będą korzystać ze wspólnego klucza EduHub.'));
    let result;
    try{result=migrateLegacyEnglish(a.html);}catch(e){toast(e.message);return;}
    const notice=el('p','security-note',result.already?'Ta aplikacja została już dostosowana do wspólnego klucza.':result.removed?'Wykryto zapisany w pliku klucz Groq. Zostanie zastąpiony bezpiecznym odwołaniem do EduHub.':'Nie znaleziono klucza Groq w pliku. Dodamy połączenie z EduHub, ale jeśli ta starsza wersja nie obsługiwała oceny AI, sama aktualizacja jej nie doda.');root.append(notice);
    const actions=el('div','form-actions');const upgrade=el('button','btn btn-primary',result.already?'Zapisz metadane':'Zaktualizuj angielski');
    upgrade.onclick=async()=>{upgrade.disabled=true;try{const updated={...app,html:result.html,grade:'4',subject:'Język angielski',name:'Together 4 – Rozdział 1',icon:'🇬🇧',byteSize:new Blob([result.html]).size,updatedAt:Date.now()};await saveApp(updated);selectedGrade='4';selectedSubject='Język angielski';$('dialog').close();await refresh();toast('Angielski dostosowany do EduHub.');}catch(e){toast('Błąd aktualizacji: '+e.message);}finally{upgrade.disabled=false;}};
    const saveFile=el('button','btn btn-outline','Pobierz nowy HTML');saveFile.onclick=()=>{downloadLocalHtml(result.html,'kl4__angielski__Together_4_Rozdzial_1_EduHub.html');toast('Pobrano nową wersję HTML.');};
    const cancel=el('button','btn btn-outline','Anuluj');cancel.onclick=()=>$('dialog').close();actions.append(upgrade,saveFile,cancel);root.append(actions);showDialog('🇬🇧 Nowy Angielski dla EduHub',root);
  }
  function chooseFile(){if(!trusted()){toast('Uruchom przez HTTPS.');return;}$('fileInput').click();}
  function metaContent(doc,names){for(const name of names){const value=[...doc.querySelectorAll('meta[name]')].find(e=>e.getAttribute('name')?.toLocaleLowerCase('pl')===name.toLocaleLowerCase('pl'))?.getAttribute('content');if(tidy(value))return tidy(value);}return '';}
  function filenameParts(filename){const base=filename.replace(/\.html?$/i,'');const chunks=base.split('__');if(chunks.length>=3&&/^kl(?:asa)?[ ._-]*[1-8][a-z]?$/i.test(chunks[0]))return{grade:normGrade(chunks[0]),subject:subjectName(chunks[1].replaceAll('_',' ')),name:tidy(chunks.slice(2).join(' ').replaceAll('_',' '))};return null;}
  function parseMetadata(html,filename){const doc=new DOMParser().parseFromString(html,'text/html');const parts=filenameParts(filename);const title=tidy(doc.querySelector('title')?.textContent);const original=tidy(filename.replace(/\.html?$/i,'').replaceAll('_',' '));const grade=metaContent(doc,['eduhub:class','eduhub:grade','edu:class'])||parts?.grade||(/^.*?\b(?:klasa|kl)[ ._-]*([1-8][a-z]?)\b/i.exec(filename+' '+title)||[])[1]||'Bez klasy';const subject=metaContent(doc,['eduhub:subject','edu:subject'])||parts?.subject||inferSubject(filename+' '+title);const name=metaContent(doc,['eduhub:name','edu:name'])||parts?.name||title||original||'Aplikacja';const version=normalizeVersion(metaContent(doc,['eduhub:version','edu:version','app-version']))||versionFromText(filename+' '+title);return {grade:normGrade(grade),subject:subjectName(subject),name:tidy(name),version,icon:iconFor(subject)};}
  async function readHtml(file){if(!file||!/\.html?$/i.test(file.name))throw new Error('Wybierz plik .html lub .htm.');if(file.size>MAX_BYTES)throw new Error('Plik przekracza 20 MB.');const html=await file.text();if(!/<html[\s>]|<!doctype\s+html|<body[\s>]/i.test(html))throw new Error('Plik nie jest kompletną stroną HTML.');return html;}
  function field(container,id,label,value,placeholder){const row=el('div','field');const lab=el('label','',label);lab.htmlFor=id;const input=el('input');input.id=id;input.value=value;input.placeholder=placeholder||'';input.maxLength=80;row.append(lab,input);container.append(row);return input;}
  function metadataEditor(values,title,submit,sourceNote){const wrap=el('div');if(sourceNote)wrap.append(el('p','hint',sourceNote));const grade=field(wrap,'editGrade','Klasa',values.grade==='Bez klasy'?'':values.grade,'np. 4');const subject=field(wrap,'editSubject','Przedmiot',values.subject==='Inne'?'':values.subject,'np. Przyroda');const name=field(wrap,'editName','Nazwa aplikacji',values.name,'np. Okiem badacza');const version=field(wrap,'editVersion','Wersja aplikacji (obowiązkowa)',values.version||'','np. 1.6 lub 1.6.0');version.inputMode='decimal';const buttons=el('div','form-actions');const cancel=el('button','btn btn-outline','Anuluj');cancel.type='button';cancel.onclick=()=>$('dialog').close();const save=el('button','btn btn-primary','Zapisz');save.type='button';save.onclick=async()=>{const n=tidy(name.value),s=tidy(subject.value),v=normalizeVersion(version.value);if(!n||!s){toast('Podaj nazwę i przedmiot.');return;}if(!v){toast('Wersja jest obowiązkowa, np. 1.6 lub 1.6.0.');version.focus();return;}save.disabled=true;try{const accepted=await submit({name:n,subject:subjectName(s),grade:normGrade(grade.value),version:v,icon:iconFor(s)});if(accepted===false)return;$('dialog').close();await refresh();}catch(e){toast('Błąd zapisu: '+e.message);}finally{save.disabled=false;}};buttons.append(cancel,save);wrap.append(buttons);showDialog(title,wrap);name.focus();}
  async function importHtml(file,existing=null){try{const html=await readHtml(file);const metadata=parseMetadata(html,file.name);const before=existing?normalizedApp(existing):null;const props=before?{...before,...Object.fromEntries(['grade','subject','name'].filter(k=>metadata[k]!==((k==='grade')?'Bez klasy':(k==='subject'?'Inne':''))).map(k=>[k,metadata[k]])),version:metadata.version}:metadata;
    metadataEditor(props,existing?'Aktualizacja aplikacji':'Dodaj aplikację',async input=>{if(existing&&before?.version){const oldParts=before.version.split('.').map(Number),newParts=input.version.split('.').map(Number);const cmp=[0,1,2].map(i=>(newParts[i]||0)-(oldParts[i]||0)).find(n=>n!==0)||0;if(cmp<0&&!confirm('Nowy plik ma starszą wersję (v'+input.version+') niż obecna (v'+before.version+'). Zastąpić mimo to?'))return false;if(cmp===0&&existing.html!==html&&!confirm('Plik różni się od obecnego, ale ma ten sam numer v'+input.version+'. Lepiej podnieść wersję. Zastąpić mimo to?'))return false;}const id=existing?.id||'a_'+crypto.randomUUID().replaceAll('-','').slice(0,24);const versionedHtml=html.replace(/<meta\s+[^>]*name=["']eduhub:version["'][^>]*>/gi,'').replace(/<head([^>]*)>/i,(_,attrs)=>'<head'+attrs+'>\n<meta name="eduhub:version" content="'+input.version+'">');const previousRelease=existing?{html:existing.html,version:normalizeVersion(existing.version)||versionFromHtml(existing.html),filename:existing.filename,byteSize:existing.byteSize,updatedAt:existing.updatedAt}:null;const app={...existing,...input,id,html:versionedHtml,filename:file.name,byteSize:new Blob([versionedHtml]).size,createdAt:existing?.createdAt||Date.now(),updatedAt:Date.now(),previousRelease,catalogId:null,blockedAutoUpdateVersion:null};await saveApp(app);selectedGrade=app.grade;selectedSubject=app.subject;toast(existing?'Zaktualizowano aplikację.':'Aplikacja dodana!');},'Odczytano informacje z metadanych, nazwy pliku lub tytułu. Numer wersji jest obowiązkowy.'+(before?' Obecnie: '+(before.version?'v'+before.version:'brak')+'. Nowy plik: '+(metadata.version?'v'+metadata.version:'brak wersji')+'.':''));
  }catch(e){toast('Błąd importu: '+e.message);}}
  function chooseReplacement(app){const input=document.createElement('input');input.type='file';input.accept='.html,.htm,text/html';input.onchange=()=>{if(input.files?.[0])importHtml(input.files[0],app);};input.click();}
  function editMetadata(app){metadataEditor(normalizedApp(app),'Edytuj informacje o aplikacji',async m=>{await saveApp({...app,...m,updatedAt:Date.now()});selectedGrade=m.grade;selectedSubject=m.subject;toast('Zapisano kategorię i nazwę.');});}
  function launchApp(id){if(!navigator.serviceWorker.controller){toast('Odśwież EduHub, by uruchomić obsługę plików.');return;}location.assign(appUrl(id));}
  function showDialog(title,body){$('dialogTitle').textContent=title;$('dialogBody').replaceChildren();$('dialogBody').append(body);$('dialog').showModal();}
  function showGroqSettings(){const root=el('div');root.append(el('p','hint','Klucz wklejasz tylko raz. Dzięki temu aplikacje EduHub mogą sprawdzać odpowiedzi dziecka.'));const bigHelp=el('a','btn btn-primary groq-easy-help','❓ Pokaż mi krok po kroku, jak zdobyć klucz');bigHelp.href='./groq-pomoc.html';root.append(bigHelp);root.append(el('p','hint','Masz już klucz? Wklej go w pole poniżej. Nie trzeba nic programować.'));
    const inp=field(root,'groqApiKey','Klucz API Groq',getGroqKey(),'gsk_...');inp.type='password';inp.autocomplete='off';inp.spellcheck=false;const showRow=el('div','micro-actions');const toggle=el('button','btn btn-outline btn-sm','👁 Pokaż / ukryj');toggle.onclick=()=>{inp.type=inp.type==='password'?'text':'password';};showRow.append(toggle);root.append(showRow);root.append(el('p','security-note','Klucz jest przechowywany tylko w localStorage tej przeglądarki. Jest dostępny dla kodu wszystkich importowanych aplikacji uruchamianych pod tym samym adresem. Importuj wyłącznie zaufane pliki HTML. Nie umieszczaj klucza w publicznym repozytorium.'));const status=el('div','test-output',getGroqKey()?'Status: klucz zapisany lokalnie':'Status: brak klucza (ustawienie domyślne)');root.append(status);const actions=el('div','form-actions');const save=el('button','btn btn-primary','Zapisz klucz');save.onclick=()=>{try{const key=inp.value.trim();localStorage.setItem(KEY_NAME,key);status.textContent=key?'✅ Klucz zapisany lokalnie.':'Brak klucza – pytania opisowe wymagające Groq mogą zostać pominięte.';refreshGroqIndicator();toast('Zapisano ustawienia Groq.');}catch(e){toast('Nie można zapisać klucza: '+e.message);}};
    const clear=el('button','btn btn-danger','Usuń klucz');clear.onclick=()=>{if(!confirm('Usunąć wspólny klucz Groq z tego urządzenia?'))return;try{localStorage.removeItem(KEY_NAME);inp.value='';status.textContent='Klucz usunięty.';refreshGroqIndicator();}catch(e){toast(e.message);}};
    const test=el('button','btn btn-outline','Test połączenia');test.onclick=async()=>{const key=inp.value.trim();if(!key){status.textContent='Podaj klucz Groq.';return;}test.disabled=true;status.textContent='Łączę z API Groq…';try{const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),12000);try{const res=await fetch('https://api.groq.com/openai/v1/models',{headers:{Authorization:'Bearer '+key},signal:controller.signal});if(!res.ok)throw new Error('HTTP '+res.status);status.textContent='✅ Klucz działa, API odpowiedziało poprawnie.';}finally{clearTimeout(timer);}}catch(e){status.textContent='❌ Nie udało się połączyć z Groq: '+e.message;}finally{test.disabled=false;}};
    actions.append(save,clear,test);root.append(actions);showDialog('🔑 Wspólny klucz Groq',root);}
  async function showDiagnostics(){
    const wrap=el('div');const grid=el('div','test-grid');const secure=el('div');const mic=el('div');const recog=el('div');const mode=el('div');
    const pair=(node,name,value)=>{node.append(el('span','',name),el('strong','',value));};
    pair(secure,'Bezpieczny kontekst',String(window.isSecureContext?'TAK':'NIE'));
    pair(mic,'Dostęp do mikrofonu',navigator.mediaDevices?.getUserMedia?'Obsługiwany':'Niedostępny');
    pair(recog,'Rozpoznawanie mowy',(window.SpeechRecognition||window.webkitSpeechRecognition)?'Obsługiwane':'Niedostępne');
    pair(mode,'Rodzaj adresu',location.protocol.replace(':','').toUpperCase());
    grid.append(secure,mic,recog,mode);wrap.append(grid);
    const permission=el('div','test-label','Uprawnienie do mikrofonu: sprawdzanie…');wrap.append(permission);
    const buttons=el('div','micro-actions');const ask=el('button','btn btn-primary btn-sm','🎙 Poproś o dostęp');const say=el('button','btn btn-outline btn-sm','🎤 Dyktuj tekst');const stop=el('button','btn btn-outline btn-sm','■ Zatrzymaj');stop.disabled=true;buttons.append(ask,say,stop);wrap.append(buttons);
    const label=el('div','test-label','Wypowiedz zdanie po polsku:');const area=el('textarea','stt-area');area.placeholder='Tu pojawi się rozpoznany tekst…';wrap.append(label,area);
    const output=el('div','test-output','Gotowy do testowania.');wrap.append(output);
    const explain=el('p','note','Przycisk „Poproś o dostęp” korzysta z getUserMedia(). Dyktowanie korzysta z Web Speech API – to osobna funkcja i może wymagać internetu.');wrap.append(explain);
    async function updatePerm(){if(!navigator.permissions?.query){permission.textContent='Uprawnienie do mikrofonu: brak interfejsu Permissions API';return;}try{const p=await navigator.permissions.query({name:'microphone'});permission.textContent='Uprawnienie do mikrofonu: '+({granted:'udzielone',prompt:'oczekuje na pytanie',denied:'zablokowane'}[p.state]||p.state);p.onchange=()=>permission.textContent='Uprawnienie do mikrofonu: '+p.state;}catch(err){permission.textContent='Uprawnienie: nie można odczytać';}}
    ask.onclick=async()=>{if(!navigator.mediaDevices?.getUserMedia){output.textContent='Przeglądarka nie udostępnia getUserMedia w tym kontekście.';return;}ask.disabled=true;output.textContent='Trwa prośba o uprawnienie…';try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});output.textContent='✅ Dostęp do mikrofonu działa! ('+stream.getAudioTracks().map(t=>t.label||'mikrofon').join(', ')+')';stream.getTracks().forEach(t=>t.stop());}catch(err){output.textContent='❌ '+err.name+': '+err.message;}finally{ask.disabled=false;updatePerm();}};
    say.onclick=()=>{const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;if(!Recognition){output.textContent='Rozpoznawanie mowy nie jest obsługiwane.';return;}
      if(recognition){recognition.abort();recognition=null;}
      recognition=new Recognition();recognition.lang='pl-PL';recognition.interimResults=true;recognition.continuous=false;let prefix=area.value.trim();const rec=recognition;
      rec.onstart=()=>{output.textContent='🎙 Słucham…';say.disabled=true;stop.disabled=false;};
      rec.onresult=event=>{let text='';for(let i=0;i<event.results.length;i++){text+=event.results[i][0].transcript+' ';}area.value=(prefix?prefix+' ':'')+text.trim();};
      rec.onerror=event=>{output.textContent='❌ Rozpoznawanie: '+event.error+'. '+(event.message||'');};
      rec.onend=()=>{say.disabled=false;stop.disabled=true;if(rec===recognition)recognition=null;if(output.textContent==='🎙 Słucham…')output.textContent='Rozpoznawanie zakończone.';};
      try{rec.start();}catch(err){say.disabled=false;stop.disabled=true;output.textContent='❌ '+err.message;}
    };
    stop.onclick=()=>{if(recognition)recognition.stop();};
    showDialog('🎙 Test mikrofonu i dyktowania',wrap);updatePerm();
  }

  // PUBLIC CATALOG. Repo publiczne, importowane pliki przechowywane wyłącznie w IndexedDB.
  function compareAppVersions(a,b){const ap=String(a||'').split('.').map(Number),bp=String(b||'').split('.').map(Number);for(let i=0;i<3;i++){if((ap[i]||0)!==(bp[i]||0))return (ap[i]||0)-(bp[i]||0);}return 0;}
  function validateCatalog(value){
    if(value?.schemaVersion!==1||!Array.isArray(value.apps)||value.apps.length>200)throw new Error('Nieznany format katalogu.');
    const seen=new Set();
    for(const e of value.apps){
      if(!e||!/^[-a-z0-9]{3,80}$/.test(e.id)||!normalizeVersion(e.version)||typeof e.name!=='string'||!e.name.trim()||typeof e.grade!=='string'||typeof e.subject!=='string'||typeof e.description!=='string'||!/^catalog\/apps\/[a-z0-9-]+\/[0-9]+\.[0-9]+(?:\.[0-9]+)?\/index\.html$/.test(e.html)||!e.html.includes('/'+e.id+'/'+e.version+'/')||!/^[a-f0-9]{64}$/.test(e.sha256)||seen.has(e.id))throw new Error('Nieprawidłowy wpis w katalogu.');
      seen.add(e.id);
    }
    return value;
  }
  function installedFor(entry){
    const byId=currentApps.find(a=>a.catalogId===entry.id);if(byId)return byId;
    // Starsze pliki importowane ręcznie mogą nie mieć katalogowego ID.
    const matches=currentApps.filter(a=>{const n=normalizedApp(a),meta=parseMetadata(a.html,a.filename||'app.html');return n.grade===normGrade(entry.grade)&&n.subject===subjectName(entry.subject)&&(n.name.toLocaleLowerCase('pl')===tidy(entry.name).toLocaleLowerCase('pl')||meta.name.toLocaleLowerCase('pl')===tidy(entry.name).toLocaleLowerCase('pl'));});
    return matches.length===1?matches[0]:null;
  }
  function describeCatalog(){if(!publicCatalog)return;let newCount=0,up=0;for(const e of publicCatalog.apps){const installed=installedFor(e);if(!installed)newCount++;else if(compareAppVersions(e.version,normalizedApp(installed).version)>0)up++;}const indicator=$('catalogIndicator');indicator.textContent=up?String(up)+' ↑':newCount?String(newCount):'';indicator.title=up?up+' aktualizacji':newCount+' nowych aplikacji';}
  async function fetchCatalog({quiet=false}={}){
    if(catalogIsLoading)return;
    if(!navigator.onLine){catalogError='Brak internetu. Twoje zainstalowane aplikacje nadal działają offline.';if(showCatalogView)renderCatalog();return;}
    catalogIsLoading=true;catalogError='';if(showCatalogView)renderCatalog();
    try{const resp=await fetch(new URL(CATALOG_URL,scopeUrl).href+'?t='+Date.now(),{cache:'no-store'});if(!resp.ok)throw new Error('Serwer odpowiedział '+resp.status);const data=validateCatalog(await resp.json());publicCatalog=data;describeCatalog();if(showCatalogView)renderCatalog();else renderLibrary();if(!quiet)toast('Katalog jest aktualny.');}
    catch(err){catalogError='Nie udało się odczytać katalogu: '+err.message;if(showCatalogView)renderCatalog();if(!quiet)toast(catalogError);}
    finally{catalogIsLoading=false;if(showCatalogView)renderCatalog();}
  }
  function catalogToggle(open){if(open&&!showCatalogView)catalogInstalledOpen=false;showCatalogView=open;if(open&&!publicCatalog&&!catalogIsLoading)fetchCatalog({quiet:true});renderLibrary();}
  function renderCatalog(){
    const node=$('appGrid');node.replaceChildren();$('viewHeading').textContent='📚 Katalog aplikacji';$('appCount').textContent='Pobierz nową aplikację lub zaktualizuj już zainstalowaną.';
    const crumbs=$('breadcrumbs');crumbs.hidden=false;crumbs.replaceChildren();const back=el('button','crumb','← Moja biblioteka');back.onclick=()=>catalogToggle(false);crumbs.append(back);
    const info=el('div','catalog-lead');info.append(el('strong','','Wszystkie aplikacje są bezpłatne i publiczne.'),el('p','','Po pobraniu zapisujemy je tylko na Twoim urządzeniu. Wyniki i klucz Groq nie trafiają do GitHuba.'));
    const refresh=el('button','btn btn-outline btn-sm','↻ Sprawdź nowości');refresh.disabled=catalogIsLoading;refresh.onclick=()=>fetchCatalog();info.append(refresh);node.append(info);
    if(catalogError)node.append(el('div','update-available',catalogError));
    if(catalogIsLoading&&!publicCatalog){node.append(el('div','empty','Sprawdzam nowe aplikacje…'));return;}
    if(!publicCatalog){node.append(el('div','empty','Katalog niedostępny. Sprawdź internet i spróbuj ponownie.'));return;}
    const grades=[...new Set(publicCatalog.apps.map(e=>normGrade(e.grade)))].sort((a,b)=>a.localeCompare(b,'pl',{numeric:true}));
    if(catalogGrade!=='all'&&!grades.includes(catalogGrade))catalogGrade='all';
    const availableSubjects=[...new Set(publicCatalog.apps.filter(e=>catalogGrade==='all'||normGrade(e.grade)===catalogGrade).map(e=>subjectName(e.subject)))].sort((a,b)=>a.localeCompare(b,'pl'));
    if(catalogSubject!=='all'&&!availableSubjects.includes(catalogSubject))catalogSubject='all';
    const toolbar=el('div','catalog-toolbar');
    function selectFilter(label,allText,values,current,change){const sel=el('select');sel.setAttribute('aria-label',label);for(const [value,text] of [['all',allText],...values.map(v=>[v,v])]){const option=el('option','',text);option.value=value;option.selected=value===current;sel.append(option);}sel.onchange=()=>change(sel.value);toolbar.append(sel);}
    if(grades.length>1)selectFilter('Klasa','Wszystkie klasy',grades,catalogGrade,v=>{catalogGrade=v;catalogSubject='all';renderCatalog();});
    if(availableSubjects.length>1)selectFilter('Przedmiot','Wszystkie przedmioty',availableSubjects,catalogSubject,v=>{catalogSubject=v;renderCatalog();});
    node.append(toolbar);
    const visible=publicCatalog.apps.filter(e=>(catalogGrade==='all'||normGrade(e.grade)===catalogGrade)&&(catalogSubject==='all'||subjectName(e.subject)===catalogSubject));
    const toInstall=[],installedEntries=[];
    for(const entry of visible){
      const local=installedFor(entry);
      if(!local||compareAppVersions(entry.version,normalizedApp(local).version)>0)toInstall.push(entry);
      else installedEntries.push(entry);
    }
    $('appCount').textContent='Nowe aplikacje i aktualizacje na górze. Zainstalowane znajdziesz po rozwinięciu sekcji na dole.';
    function catalogCard(entry){
      const installed=installedFor(entry),installedV=installed?normalizedApp(installed).version:null;
      const difference=installed?compareAppVersions(entry.version,installedV):1;
      const card=el('article','app-card catalog-card');const top=el('div','card-top');const detail=el('div');detail.append(el('h3','app-name',entry.name),el('div','version-tag','v'+entry.version));top.append(el('div','card-icon',entry.icon||iconFor(entry.subject)),detail);
      card.append(top,el('div','category-tag',gradeLabel(normGrade(entry.grade))+' · '+subjectName(entry.subject)),el('div','catalog-desc',entry.description));
      const status=el('div','catalog-status'+(installed&&difference>0?' update':''),installed?(difference>0?'Nowa wersja: v'+installedV+' → v'+entry.version:difference===0?'Już zainstalowana v'+installedV:'Masz nowszą wersję v'+installedV):'Nie jest jeszcze zainstalowana');card.append(status);
      const actions=el('div','card-actions');const button=el('button','btn '+(installed&&difference<=0?'btn-outline':'btn-primary')+' btn-sm',!installed?'⬇ Zainstaluj':difference>0?'⬇ Aktualizuj': '▶ Otwórz');
      if(installed&&difference<=0)button.onclick=()=>launchApp(installed.id);else button.onclick=()=>installFromCatalog(entry,button);
      actions.append(button);card.append(actions);return card;
    }
    node.append(el('h3','catalog-group-title','Nowe i aktualizacje ('+toInstall.length+')'));
    if(toInstall.length)for(const entry of toInstall)node.append(catalogCard(entry));
    else node.append(el('div','catalog-empty','Wszystko aktualne! Nowe aplikacje i aktualizacje pojawią się tutaj.'));
    if(installedEntries.length){
      const details=el('details','catalog-installed-section');
      details.open=catalogInstalledOpen;
      details.addEventListener('toggle',()=>{if(details.isConnected)catalogInstalledOpen=details.open;});
      const summary=el('summary','catalog-installed-summary','✓ Zainstalowane ('+installedEntries.length+')');
      const grid=el('div','app-grid catalog-installed-grid');
      for(const entry of installedEntries)grid.append(catalogCard(entry));
      details.append(summary,grid);
      node.append(details);
    }
  }
  async function installFromCatalog(entry,button=null){
    if(button)button.disabled=true;
    try{
      if(!publicCatalog?.apps.some(e=>e.id===entry.id&&e.version===entry.version&&e.sha256===entry.sha256))throw new Error('Nieznana pozycja katalogu.');
      const existing=installedFor(entry);if(existing&&compareAppVersions(entry.version,normalizedApp(existing).version)<=0){toast('Ta wersja jest już zainstalowana.');return;}
      const url=new URL(entry.html,scopeUrl);if(url.origin!==scopeUrl.origin||!url.pathname.startsWith(new URL('./catalog/apps/',scopeUrl).pathname))throw new Error('Niebezpieczna ścieżka aplikacji.');
      const resp=await fetch(url.href+'?v='+encodeURIComponent(entry.version),{cache:'no-store'});if(!resp.ok)throw new Error('Nie udało się pobrać pliku (HTTP '+resp.status+').');
      const bytes=await resp.arrayBuffer();if(bytes.byteLength>MAX_BYTES)throw new Error('Plik przekracza 20 MB.');
      const digest=await crypto.subtle.digest('SHA-256',bytes),actual=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
      if(actual!==entry.sha256)throw new Error('Plik jest inny niż w katalogu (SHA-256). Nie instaluję go.');
      const html=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(/gsk_[A-Za-z0-9_-]{18,}/.test(html))throw new Error('Plik zawiera zaszyty klucz Groq. Zablokowano instalację.');
      const metadata=parseMetadata(html,url.pathname.split('/').pop());
      if(metadata.version!==entry.version||normGrade(metadata.grade)!==normGrade(entry.grade)||subjectName(metadata.subject)!==subjectName(entry.subject)||metadata.name!==entry.name)throw new Error('Metadane pliku nie zgadzają się z katalogiem.');
      const previousRelease=existing?{html:existing.html,version:normalizeVersion(existing.version)||versionFromHtml(existing.html),filename:existing.filename,byteSize:existing.byteSize,updatedAt:existing.updatedAt}:null;
      const id=existing?.id||'a_'+crypto.randomUUID().replaceAll('-','').slice(0,24);
      const app={...existing,id,catalogId:entry.id,grade:existing?.grade||normGrade(entry.grade),subject:existing?.subject||subjectName(entry.subject),name:existing?.name||entry.name,icon:existing?.icon||entry.icon||iconFor(entry.subject),version:entry.version,html,filename:entry.html.split('/').slice(-2).join('-'),byteSize:bytes.byteLength,createdAt:existing?.createdAt||Date.now(),updatedAt:Date.now(),previousRelease,blockedAutoUpdateVersion:null};
      await saveApp(app);await refresh();describeCatalog();if(showCatalogView)renderCatalog();toast(existing?'Zaktualizowano '+entry.name+' do v'+entry.version+'.':'Zainstalowano '+entry.name+' v'+entry.version+'.');
    }catch(err){toast('Instalacja nieudana: '+err.message);}
    finally{if(button)button.disabled=false;}
  }
  async function rollbackApp(app){
    if(!app.previousRelease)return;
    const old=app.previousRelease;if(!confirm('Przywrócić wersję v'+(old.version||'?')+' aplikacji „'+app.name+'”? Wyniki zostaną zachowane.'))return;
    const newer={html:app.html,version:app.version,filename:app.filename,byteSize:app.byteSize,updatedAt:app.updatedAt};
    const restored={...app,html:old.html,version:old.version,filename:old.filename,byteSize:old.byteSize||new Blob([old.html]).size,updatedAt:Date.now(),previousRelease:newer,blockedAutoUpdateVersion:app.version};
    await saveApp(restored);await refresh();describeCatalog();toast('Przywrócono wersję v'+(old.version||'?')+'.');
  }

  async function exportBackup(){try{const apps=await listApps();if(!apps.length){toast('Nie ma aplikacji do eksportu.');return;}if(!confirm('Eksport zawiera pełne pliki HTML, które mogą mieć starsze wbudowane klucze API. Wspólny klucz Groq z EduHub NIE jest eksportowany. Kontynuować?'))return;const data={type:'eduhub-backup',version:2,exportedAt:new Date().toISOString(),apps};const url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));const a=el('a');a.href=url;a.download='eduhub-aplikacje-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),2500);toast('Wyeksportowano aplikacje.');}catch(e){toast('Błąd eksportu: '+e.message);}}
  async function restoreBackup(file){try{if(file.size>80*1024*1024)throw new Error('Kopia jest zbyt duża.');const data=JSON.parse(await file.text());if(data.type!=='eduhub-backup'||!Array.isArray(data.apps))throw new Error('Nieprawidłowa kopia EduHub.');if(!confirm('Przywrócić '+data.apps.length+' aplikacji? Aplikacje o tych samych identyfikatorach zostaną zaktualizowane.'))return;let count=0;for(const original of data.apps){if(!/^a_[a-f0-9]{24}$/.test(original.id)||typeof original.html!=='string'||original.html.length>MAX_BYTES||typeof original.name!=='string')continue;const meta=parseMetadata(original.html,original.filename||original.name+'.html');const a={...original,name:tidy(original.name),grade:normGrade(original.grade||meta.grade),subject:subjectName(original.subject||meta.subject),icon:original.icon||iconFor(original.subject||meta.subject),version:normalizeVersion(original.version)||meta.version};await saveApp(a);count++;}selectedGrade=null;selectedSubject=null;await refresh();toast('Przywrócono '+count+' aplikacji.');}catch(e){toast('Błąd importu: '+e.message);}}
  $('catalogBtn').onclick=()=>catalogToggle(!showCatalogView);
  $('importBtn').onclick=chooseFile;$('fileInput').onchange=e=>{if(e.target.files?.[0])importHtml(e.target.files[0]);e.target.value='';};$('groqBtn').onclick=showGroqSettings;$('diagBtn').onclick=showDiagnostics;
  $('closeDialog').onclick=()=>{$('dialog').close();if(recognition){recognition.abort();recognition=null;}};
  $('dialog').addEventListener('close',()=>{if(recognition){recognition.abort();recognition=null;}});
  $('backupBtn').onclick=exportBackup;$('restoreBtn').onclick=()=>$('backupInput').click();$('backupInput').onchange=e=>{if(e.target.files?.[0])restoreBackup(e.target.files[0]);e.target.value='';};
  window.addEventListener('online',()=>{setStatus();fetchCatalog({quiet:true});});window.addEventListener('offline',setStatus);setStatus();refreshGroqIndicator();initServiceWorker().then(async()=>{await refresh();await fetchCatalog({quiet:true});});
  if(location.hash==='#groq'){history.replaceState(null,'',location.pathname+location.search);showGroqSettings();}
})();
