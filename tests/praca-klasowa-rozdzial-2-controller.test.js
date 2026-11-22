const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const file=[path.resolve(__dirname,'../catalog/apps/praca-klasowa-rozdzial-2/1.1.0/index.html'),path.resolve(__dirname,'../deliverables/Praca_Klasowa_Rozdzial_2_v1.1.0.html')].find(p=>fs.existsSync(p));
const html=fs.readFileSync(file,'utf8');
const script=id=>html.match(new RegExp('<script id="'+id+'"[^>]*>([\\s\\S]*?)<\\/script>'))[1];
const bank=JSON.parse(script('question-data'));
function harness(saved,denyRead=false){
 const nodes=new Map();
 function node(sel){if(!nodes.has(sel))nodes.set(sel,{innerHTML:'',textContent:'',disabled:false,open:false,style:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){},addEventListener(){},focus(){},showModal(){this.open=true;},close(){this.open=false;},remove(){}});return nodes.get(sel);}
 const sandbox={document:{getElementById(id){if(id==='question-data')return {textContent:JSON.stringify(bank)};return node('#'+id);},querySelector:node,querySelectorAll(){return[];},addEventListener(){}},localStorage:{getItem(){if(denyRead)throw new Error('denied');return saved?JSON.stringify(saved):null;},setItem(){}},window:{scrollTo(){},matchMedia(){return {matches:true};}},setTimeout(){return 0;},clearTimeout(){},console,Date,Math,Blob,URL,Event:class{}};
 vm.createContext(sandbox);vm.runInContext(script('learning-core'),sandbox);
 const ui=script('application-ui').replace(/renderHome\(\);\s*\}\)\(\);\s*$/,'globalThis.h={newSession,current,remember,finishSession,formatAnswer,correctValues,renderHome,renderResult,answersMarkup,renderRound,toggleWordCase:(...args)=>toggleWordCase(...args),placeQuote:(...args)=>placeQuote(...args),setAttempt,correctAnswer,revealAnswer,getState:()=>state,setSelection:(s,n)=>{selected=s;count=n;},nodes:null};renderHome();})();');
 vm.runInContext(ui,sandbox);return {h:sandbox.h,C:sandbox.LearningCore,node};
}
test('exam records do not disclose correctness through XP or topic progress before completion',()=>{
 const {h,C}=harness();h.newSession({mode:'exam'});const {q,a}=h.current();a.values=h.correctValues(q);const checked=C.check(q,a);h.remember(q,checked,true);
 assert.equal(h.getState().xp,0);assert.equal(Object.keys(h.getState().best).length,0);assert.equal(h.getState().active.records.length,1);
 h.finishSession();assert.equal(h.getState().xp,20);assert.equal(h.getState().best[q.id],2);h.finishSession();assert.equal(h.getState().xp,20);
});
test('invalid persisted sessions and reports are discarded without losing earned progress',()=>{
 const saved={schema:1,xp:70,best:{'voice-01':2},active:{mode:'training',ids:['voice-01'],cursor:0,records:[],attempts:null},lastResult:{mode:'training',records:{}}};
 const {h}=harness(saved);assert.equal(h.getState().active,null);assert.equal(h.getState().lastResult,null);assert.equal(h.getState().xp,70);assert.equal(h.getState().best['voice-01'],2);
});
test('reports preserve which words are italic instead of collapsing distinct answers',()=>{
 const {h}=harness();const q=bank.find(q=>q.id==='quote-04');const texts=q.options.map((_,i)=>h.formatAnswer(q,[i]));assert.equal(new Set(texts).size,q.options.length);assert.ok(texts.some(t=>t.includes('*')));
});
test('a training length label shows the available count when a single topic has fewer questions',()=>{
 const {h,node}=harness();h.setSelection(['noun'],25);h.renderHome();const markup=node('#main').innerHTML;assert.match(markup,/<option value="25" selected>18<\/option>/);assert.doesNotMatch(markup,/<option value="25" selected>25<\/option>/);
});
test('a blocked storage read does not claim the initial screen is saved',()=>{
 const {node}=harness(undefined,true);assert.match(node('#storage-note').textContent,/niedostępny/);
});

const wordFixture={id:'capital-12',topic:'capital',type:'wordcase',tokens:['Na','podwórku','spotkaliśmy','psa','łatka','i','kotkę','iskrę.'],answers:[4,7]};
const quoteFixture={id:'quote-13',topic:'quote',type:'quotes',tokens:['Czytałem','Deszczowy','dzień','i','Pod','starym','dębem','.'],answers:{1:'„',3:'”',4:'„',7:'”'}};
function attempt(values){return {values,marks:values.map(()=> 'neutral'),phase:'answer',done:false,checks:0,score:null,hadError:false,revealed:false};}
test('capitalization uses word buttons and preserves the exact sentence in reports',()=>{
 const {h}=harness();const a=attempt(wordFixture.tokens.map(()=>false));a.values[4]=true;
 const html=h.answersMarkup(wordFixture,a,{orders:{}});
 assert.match(html,/data-action="wordcase"/);assert.doesNotMatch(html,/<(?:input|textarea|select)\b/);
 assert.equal(h.formatAnswer(wordFixture,a.values),'Na podwórku spotkaliśmy psa Łatka i kotkę iskrę.');
 const capitalTitle={...wordFixture,tokens:['Czytam','„śnieg','nad','odrą”.'],answers:[1,3]};
 assert.equal(h.formatAnswer(capitalTitle,[false,true,false,true]),'Czytam „Śnieg nad Odrą”.');
});
test('quotation editor offers explicit boundaries and reports two separate titles',()=>{
 const {h}=harness();const a=attempt(Array(quoteFixture.tokens.length+1).fill(''));
 const html=h.answersMarkup(quoteFixture,a,{orders:{}});
 assert.match(html,/data-action="quote-gap"/);assert.match(html,/data-action="quote-tool"/);assert.doesNotMatch(html,/<(?:input|textarea|select)\b/);
 a.values[1]='„';a.values[3]='”';a.values[4]='„';a.values[7]='”';
 assert.equal(h.formatAnswer(quoteFixture,a.values),'Czytałem „Deszczowy dzień” i „Pod starym dębem”.');
 const questionTitle={type:'quotes',tokens:['W','opowiadaniu','Dokąd','płynie','rzeka','?','pojawia','się','most','.']};
 const values=Array(11).fill('');values[2]='„';values[6]='”';
 assert.equal(h.formatAnswer(questionTitle,values),'W opowiadaniu „Dokąd płynie rzeka?” pojawia się most.');
});

test('word taps preserve partial corrections and cannot edit locked correct words',()=>{
 const {h,C}=harness();h.newSession({mode:'retry',ids:['capital-12']});
 h.toggleWordCase(4);h.toggleWordCase(1);
 let {q,a}=h.current();assert.equal(a.checks,0);assert.equal(a.values[4],true);assert.equal(a.values[1],true);
 h.setAttempt(C.check(q,a));h.correctAnswer();
 assert.equal(h.current().a.values[4],true);assert.equal(h.current().a.values[1],false);
 h.toggleWordCase(4);assert.equal(h.current().a.values[4],true);
 h.toggleWordCase(7);a=C.check(q,h.current().a);assert.equal(a.done,true);assert.equal(a.score,1);
});
test('quote taps alternate the glyph and preserve both pairs across reload',()=>{
 const {h}=harness();h.newSession({mode:'retry',ids:['quote-13']});
 for(const index of [1,3,4,7])h.placeQuote(index);
 assert.equal(h.current().a.checks,0);assert.equal(h.current().a.done,false);
 const saved=JSON.parse(JSON.stringify(h.getState())),resumed=harness(saved);
 assert.ok(resumed.h.getState().active);const {q,a}=resumed.h.current();
 assert.equal(resumed.h.formatAnswer(q,a.values),'Czytałem „Deszczowy dzień” i „Pod starym dębem”.');
 assert.equal(resumed.C.check(q,a).score,2);
 a.quoteTool='';resumed.h.placeQuote(7);assert.equal(resumed.h.current().a.values[7],'');
});
test('old unfinished sentence tasks resume as touch tasks without losing the round or earned points',()=>{
 const saved={schema:1,xp:90,best:{'voice-01':2},active:{mode:'training',ids:['capital-12','quote-13'],cursor:0,orders:{},records:[],attempts:{'capital-12':{...attempt(['Na podwórku spotkaliśmy psa Łatka']),hadError:true,checks:1,phase:'feedback',marks:['red']}}}};
 const {h}=harness(saved);assert.ok(h.getState().active);assert.equal(h.getState().xp,90);assert.equal(h.current().s.cursor,0);
 assert.equal(h.current().a.values.length,8);assert.ok(h.current().a.values.every(v=>v===false));assert.equal(h.current().a.hadError,true);
});
test('old completed sentence answers remain verbatim on resume and in the report',()=>{
 const oldText='Czytałem Deszczowy dzień i Pod starym dębem.';
 const record={questionId:'quote-13',topic:'quote',score:0,hadError:true,revealed:false,values:[oldText]};
 const oldAttempt={...attempt([oldText]),done:true,score:0,hadError:true,checks:1,phase:'resolved',marks:['red']};
 const saved={schema:1,xp:3,best:{},active:{mode:'training',ids:['quote-13'],cursor:0,orders:{},records:[record],attempts:{'quote-13':oldAttempt}},lastResult:{mode:'training',records:[record]}};
 const {h}=harness(saved);assert.ok(h.getState().active);assert.ok(h.getState().lastResult);
 const {q,a,s}=h.current(),markup=h.answersMarkup(q,a,s);
 assert.match(markup,/poprzedniej wersji/);assert.doesNotMatch(markup,/quote-gap|word-token/);
 assert.equal(h.formatAnswer(q,a.values),oldText);assert.equal(h.getState().lastResult.records[0].score,0);
});
