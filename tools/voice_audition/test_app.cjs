// Small DOM stub: state/queue unit tests, not a replacement for browser QA.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
class Element {
  constructor(tag='div') { this.tagName=tag.toUpperCase(); this.children=[]; this.dataset={}; this.style={}; this.value=''; this.textContent=''; this.classList={toggle(){},remove(){}}; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children=[...nodes]; }
  setAttribute() {}
  addEventListener() {}
  pause() { this.pauses=(this.pauses||0)+1; }
  load() {}
  querySelectorAll(selector) {
    const matches = node => selector==='[data-write]' ? 'write' in node.dataset : selector==='[data-benchmark-path]' ? 'benchmarkPath' in node.dataset : selector.split(',').includes(node.tagName.toLowerCase());
    return this.children.flatMap(node=>[...(matches(node)?[node]:[]),...node.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0]; }
}
async function setup() {
  const elements=new Map(), get=id=>{if(!elements.has(id)) elements.set(id,new Element()); return elements.get(id);};
  get('main-audio').tagName='AUDIO';
  const initial={voices:['A','B'].map((path,i)=>({path,decision:'keep',speaker:path,name:path,url:'/ref/'+path,favorite_rank:i+1,reference_note:'',clone_note:'',note_revision:0})),revision:2,order_revision:0,can_undo:true,database:'test.sqlite3'};
  let stored=structuredClone(initial), reject=false;
  const calls=[];
  const document={getElementById:get,createElement:tag=>new Element(tag),addEventListener(){},activeElement:new Element('body'),querySelectorAll:selector=>[...elements.values()].flatMap(n=>n.querySelectorAll(selector))};
  const context=vm.createContext({document,location:{hash:'#favorites'},window:{addEventListener(){}},setInterval(){},setTimeout,Blob,URL,Map,Promise,fetch:async(url,options)=>{
    if(url==='/api/benchmarks') return {ok:true,json:async()=>({voices:[]})};
    if(options) {
      const payload=JSON.parse(options.body); calls.push({url,...payload});
      if(reject) return {ok:false,status:409,json:async()=>({error:'Conflit'})};
      if(url==='/api/note') { const voice=stored.voices.find(v=>v.path===payload.path); voice[payload.kind+'_note']=payload.note; voice.note_revision++; }
      if(url==='/api/order') { payload.paths.forEach((path,i)=>stored.voices.find(v=>v.path===path).favorite_rank=i+1); stored.order_revision++; }
    }
    return {ok:true,json:async()=>structuredClone(stored)};
  }});
  vm.runInContext(fs.readFileSync(__dirname+'/app.js','utf8'),context);
  await new Promise(resolve=>setImmediate(resolve));
  return {context,get,calls,reject:()=>reject=true};
}
test('ranking is displayed in persisted order; notes save serially without rebuilding players',async()=>{
  const {context,get,calls}=await setup();
  await vm.runInContext("write('order',{paths:['B','A']})",context);
  assert.equal(get('favorite-grid').children[0].children[0].textContent,'1. Voix B');
  const card=get('favorite-grid').children[0];
  const texts=card.querySelectorAll('textarea');
  texts[0].value='Une référence claire'; texts[0].oninput(); texts[0].onblur();
  texts[1].value='Conférence agréable'; texts[1].oninput(); texts[1].onblur();
  await vm.runInContext('writes',context);
  const notes=calls.filter(c=>c.url==='/api/note');
  assert.deepEqual(notes.map(c=>c.note_revision),[0,1]);
  assert.equal(get('favorite-grid').children[0],card);
  assert.equal(vm.runInContext('drafts.size',context),0);
});
test('failed note keeps its draft across a list redraw',async()=>{
  const {context,get,reject}=await setup(); reject();
  const text=get('favorite-grid').children[0].querySelectorAll('textarea')[1];
  text.value='À conserver malgré le conflit'; text.oninput(); text.onblur();
  await vm.runInContext('writes',context);
  vm.runInContext('render()',context);
  assert.equal(get('favorite-grid').children[0].querySelectorAll('textarea')[1].value,'À conserver malgré le conflit');
  assert.match(get('error').textContent,/Conflit/);
  assert.equal(vm.runInContext('drafts.size',context),1);
});
test('ready clones use video; metadata polling preserves their player',async()=>{
  const {context,get}=await setup();
  vm.runInContext("benchmarkData={voices:[{voice_path:'A',video_url:'/video/A.mp4'}]}; updateClones()",context);
  const slot=get('favorite-grid').children[0].querySelector('[data-benchmark-path]');
  const player=slot.querySelector('video');
  assert.equal(player.src,'/video/A.mp4');
  vm.runInContext('benchmarkData.voices[0].completed_parts=10; updateClones()',context);
  assert.equal(slot.querySelector('video'),player);
});
