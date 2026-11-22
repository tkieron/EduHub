const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const file=[path.resolve(__dirname,'../catalog/apps/praca-klasowa-rozdzial-2/1.0.0/index.html'),path.resolve(__dirname,'../deliverables/Praca_Klasowa_Rozdzial_2_v1.0.0.html')].find(p=>fs.existsSync(p));
const html=fs.readFileSync(file,'utf8');
const script=id=>html.match(new RegExp('<script id="'+id+'"[^>]*>([\\s\\S]*?)<\\/script>'))[1];
const bank=JSON.parse(script('question-data'));
function harness(saved,denyRead=false){
 const nodes=new Map();
 function node(sel){if(!nodes.has(sel))nodes.set(sel,{innerHTML:'',textContent:'',disabled:false,open:false,style:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){},addEventListener(){},focus(){},showModal(){this.open=true;},close(){this.open=false;},remove(){}});return nodes.get(sel);}
 const sandbox={document:{getElementById(id){if(id==='question-data')return {textContent:JSON.stringify(bank)};return node('#'+id);},querySelector:node,querySelectorAll(){return[];},addEventListener(){}},localStorage:{getItem(){if(denyRead)throw new Error('denied');return saved?JSON.stringify(saved):null;},setItem(){}},window:{scrollTo(){},matchMedia(){return {matches:true};}},setTimeout(){return 0;},clearTimeout(){},console,Date,Math,Blob,URL,Event:class{}};
 vm.createContext(sandbox);vm.runInContext(script('learning-core'),sandbox);
 const ui=script('application-ui').replace(/renderHome\(\);\s*\}\)\(\);\s*$/,'globalThis.h={newSession,current,remember,finishSession,formatAnswer,correctValues,renderHome,renderResult,getState:()=>state,setSelection:(s,n)=>{selected=s;count=n;},nodes:null};renderHome();})();');
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
