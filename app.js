(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const DB_NAME='eduhub-v1', DB_VERSION=1, MAX_BYTES=20*1024*1024;
  let currentApps=[];
  let recognition=null;
  let toastTimer=null;
  const scopeUrl=new URL('./',location.href);
  const secureOrigin=(location.protocol==='https:' || ['localhost','127.0.0.1'].includes(location.hostname));
  const appUrl=id=>new URL('./apps/'+encodeURIComponent(id)+'/',scopeUrl).href;
  const formatBytes=bytes=>bytes>1024*1024?(bytes/1048576).toFixed(2)+' MB':Math.max(1,Math.round(bytes/1024))+' KB';
  const shortDate=stamp=>new Date(stamp).toLocaleDateString('pl-PL',{day:'numeric',month:'short',year:'numeric'});
  const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
  const toast=msg=>{clearTimeout(toastTimer);$('toast').textContent=msg;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,4200);};
  function openDb(){return new Promise((resolve,reject)=>{const request=indexedDB.open(DB_NAME,DB_VERSION);request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('apps')) request.result.createObjectStore('apps',{keyPath:'id'});};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
  async function dbOperation(mode,fn){const db=await openDb();try{return await new Promise((resolve,reject)=>{const tx=db.transaction('apps',mode);let value;tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Transakcja anulowana'));try{const req=fn(tx.objectStore('apps'));req.onsuccess=()=>value=req.result;req.onerror=()=>reject(req.error);}catch(e){reject(e);}});}finally{db.close();}}
  const listApps=()=>dbOperation('readonly',store=>store.getAll());
  const saveApp=app=>dbOperation('readwrite',store=>store.put(app));
  const removeApp=id=>dbOperation('readwrite',store=>store.delete(id));
  function isTrustedOrigin(){return secureOrigin && 'serviceWorker' in navigator && 'indexedDB' in window;}
  function setStatus(){const online=navigator.onLine;const node=$('netStatus');node.textContent=online?'● Online':'● Offline';node.classList.toggle('offline',!online);}
  async function initServiceWorker(){
    const notice=$('setupNotice');
    if(!isTrustedOrigin()){
      notice.hidden=false;notice.textContent='EduHub musi zostać uruchomiony pod HTTPS (np. GitHub Pages), a nie jako lokalny plik. Po jednorazowej instalacji działa offline. Nie importuj tutaj plików przez content://.';
      $('importBtn').disabled=true;
      return;
    }
    try{await navigator.serviceWorker.register('./sw.js',{scope:'./'});await navigator.serviceWorker.ready;
      if(!navigator.serviceWorker.controller){await new Promise(resolve=>{const finish=()=>{clearTimeout(timer);navigator.serviceWorker.removeEventListener('controllerchange',finish);resolve();};const timer=setTimeout(finish,3500);navigator.serviceWorker.addEventListener('controllerchange',finish);});}
      if(!navigator.serviceWorker.controller){notice.hidden=false;notice.textContent='Instalacja trybu offline zakończona. Odśwież EduHub, aby aktywować obsługę lokalnych aplikacji.';}
    }catch(err){notice.hidden=false;notice.textContent='Nie udało się zainstalować obsługi offline: '+String(err);}
  }
  async function refresh(){try{currentApps=(await listApps()).sort((a,b)=>b.updatedAt-a.updatedAt);renderCards();}catch(err){toast('Błąd wczytywania biblioteki: '+err.message);}}
  function renderCards(){
    const container=$('appGrid');container.replaceChildren();
    $('appCount').textContent=currentApps.length?currentApps.length+' aplikacji zapisanych lokalnie na tym urządzeniu.':'Twoje pliki są przechowywane tylko na tym urządzeniu.';
    if(!currentApps.length){const empty=el('div','empty');empty.append(el('div','empty-icon','📚'),el('h3','', 'Twoja biblioteka czeka'),el('p','','Dodaj „Misję Przyroda”, angielski lub matematykę jako gotowy plik HTML.'));const button=el('button','btn btn-primary','Wybierz plik HTML');button.onclick=chooseFile;empty.append(button);container.append(empty);return;}
    for(const app of currentApps){
      const card=el('article','app-card');const top=el('div','card-top');const icon=el('div','card-icon',app.icon||'📗');const details=el('div');const heading=el('h3','app-name',app.name);const meta=el('div','app-meta',formatBytes(app.byteSize)+' · '+shortDate(app.updatedAt));details.append(heading,meta);top.append(icon,details);
      const description=el('div','card-description','Zapisana w EduHub. Dane i wyniki pozostają w tej przeglądarce.');const actions=el('div','card-actions');
      const launch=el('button','btn btn-primary btn-sm open-app','▶ Uruchom');launch.onclick=()=>launchApp(app.id);
      const update=el('button','icon-btn','↻');update.title='Zastąp nowszą wersją pliku HTML';update.setAttribute('aria-label','Zaktualizuj '+app.name);update.onclick=()=>chooseReplacement(app);
      const rename=el('button','icon-btn','✎');rename.title='Zmień nazwę';rename.setAttribute('aria-label','Zmień nazwę '+app.name);rename.onclick=async()=>{const newName=prompt('Nazwa aplikacji:',app.name);if(newName===null||!newName.trim())return;app.name=newName.trim().slice(0,80);app.updatedAt=Date.now();await saveApp(app);refresh();};
      const del=el('button','icon-btn','×');del.title='Usuń z biblioteki';del.setAttribute('aria-label','Usuń '+app.name);del.onclick=async()=>{if(!confirm('Usunąć „'+app.name+'” z biblioteki? Historia postępów zapisana w przeglądarce nie będzie automatycznie usuwana.'))return;await removeApp(app.id);await refresh();toast('Usunięto aplikację.');};
      actions.append(launch,update,rename,del);card.append(top,description,actions);container.append(card);
    }
  }
  function chooseFile(){if(!isTrustedOrigin()){toast('Uruchom EduHub przez HTTPS.');return;}$('fileInput').click();}
  function extractName(content,filename){const parsed=new DOMParser().parseFromString(content,'text/html');const title=parsed.querySelector('title')?.textContent?.trim();if(title&&title.length>=3)return title.slice(0,80);return filename.replace(/\.html?$/i,'').replaceAll('_',' ').slice(0,80);}
  function inferIcon(title){const lower=title.toLocaleLowerCase('pl');if(lower.includes('przyrod'))return '🌿';if(lower.includes('angiel')||lower.includes('english'))return '🇬🇧';if(lower.includes('matemat'))return '🧮';if(lower.includes('ortograf'))return '✍️';return '📗';}
  async function readHtml(file){if(!file || !/\.html?$/i.test(file.name))throw new Error('Wybierz plik .html lub .htm.');if(file.size>MAX_BYTES)throw new Error('Plik ma ponad 20 MB.');const html=await file.text();if(!/<html[\s>]|<!doctype\s+html|<body[\s>]/i.test(html))throw new Error('To nie wygląda na kompletny dokument HTML.');return html;}
  async function importHtml(file,existing=null){
    try{
      const html=await readHtml(file);
      const parsedName=extractName(html,file.name);
      const id=existing?.id||'a_'+crypto.randomUUID().replaceAll('-','').slice(0,24);
      const app={id,name:existing?.name||parsedName,icon:existing?.icon||inferIcon(parsedName),html,filename:file.name,byteSize:new Blob([html]).size,createdAt:existing?.createdAt||Date.now(),updatedAt:Date.now()};
      await saveApp(app);await refresh();toast(existing?'Aplikacja zaktualizowana.':'Aplikacja dodana!');
    }catch(err){toast('Nie udało się zaimportować: '+err.message);}
  }
  function chooseReplacement(app){const input=document.createElement('input');input.type='file';input.accept='.html,.htm,text/html';input.onchange=()=>{if(input.files[0])importHtml(input.files[0],app);};input.click();}
  function launchApp(id){if(!navigator.serviceWorker.controller){toast('Obsługa plików nie jest jeszcze aktywna. Odśwież EduHub.');return;}location.assign(appUrl(id));}
  function showDialog(title,body){$('dialogTitle').textContent=title;$('dialogBody').replaceChildren();$('dialogBody').append(body);$('dialog').showModal();}
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
  async function exportBackup(){try{const apps=await listApps();if(!apps.length){toast('Nie ma jeszcze aplikacji do eksportu.');return;}if(!confirm('Eksport zawiera CAŁE pliki HTML, także ewentualne wbudowane klucze API. Zapisz go prywatnie. Kontynuować?'))return;const data={type:'eduhub-backup',version:1,exportedAt:new Date().toISOString(),apps};const blob=new Blob([JSON.stringify(data)],{type:'application/json'});const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download='eduhub-aplikacje-'+new Date().toISOString().slice(0,10)+'.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),2500);toast('Kopia zapisanych aplikacji wyeksportowana.');}catch(err){toast('Błąd eksportu: '+err.message);}}
  async function restoreBackup(file){try{if(file.size>80*1024*1024)throw new Error('Kopia jest zbyt duża.');const backup=JSON.parse(await file.text());if(backup.type!=='eduhub-backup'||!Array.isArray(backup.apps))throw new Error('Nieprawidłowy format kopii.');if(!confirm('Zaimportować '+backup.apps.length+' aplikacji? Te same identyfikatory zostaną zaktualizowane.'))return;let count=0;for(const app of backup.apps){if(!/^a_[a-f0-9]{24}$/.test(app.id)||typeof app.html!=='string'||typeof app.name!=='string')continue;app.name=app.name.slice(0,80);await saveApp(app);count++;}await refresh();toast('Przywrócono '+count+' aplikacji.');}catch(err){toast('Błąd importu kopii: '+err.message);}}
  $('importBtn').onclick=chooseFile;$('fileInput').onchange=e=>{if(e.target.files[0])importHtml(e.target.files[0]);e.target.value='';};$('diagBtn').onclick=showDiagnostics;
  $('closeDialog').onclick=()=>{$('dialog').close();if(recognition){recognition.abort();recognition=null;}};
  $('dialog').addEventListener('close',()=>{if(recognition){recognition.abort();recognition=null;}});
  $('backupBtn').onclick=exportBackup;$('restoreBtn').onclick=()=>$('backupInput').click();$('backupInput').onchange=e=>{if(e.target.files[0])restoreBackup(e.target.files[0]);e.target.value='';};
  window.addEventListener('online',setStatus);window.addEventListener('offline',setStatus);setStatus();
  initServiceWorker().then(refresh);
})();
