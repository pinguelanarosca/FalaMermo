'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),Jobs=require('../global-jobs.js');
const source=fs.readFileSync(require.resolve('../content.js'),'utf8');
function controller(chrome){const c=vm.createContext({console,GlobalHud:{},chrome});vm.runInContext(source.replace('__require("extension/src/content/entrypoint.ts");','globalThis.modules=__modules;'),c);const m={exports:{}};c.modules['extension/src/content/ui/hudController.ts'](m,m.exports,()=>({}));return m.exports.hud;}
test('dois cliques antes do ACK alternam duas vezes, sem usar o cache visual como decisão',async()=>{
 const r=Jobs.create();await r.ui({visible:true,minimized:false},1);let release;const gate=new Promise(resolve=>release=resolve),work=[];
 const chrome={runtime:{sendMessage(message){const p=(async()=>{await gate;return{success:true,state:Jobs.forHud(await r.ui(message.payload,1),1)};})();work.push(p);return p;}}};
 const hud=controller(chrome),events={};hud.globalMinimized=false;
 const selector=source.includes('id="ext-btn-toggle"')?'#ext-btn-toggle':'#ext-btn-min';
 hud.setupListeners({querySelector:s=>s===selector?{addEventListener:(event,fn)=>events[event]=fn}:null});
 events.click();events.click();release();await Promise.all(work);assert.equal(work.length,2);assert.equal(Jobs.forHud(await r.get(),1).minimized,false);
});
test('alternância serializada pertence à aba informada pelo roteador e preserva outra apresentação',async()=>{
 const r=Jobs.create();await r.attachHud({tabId:1,frameId:0,documentId:'a'});await r.attachHud({tabId:2,frameId:0,documentId:'b'});await r.ui({visible:true,minimized:false},1);await r.ui({visible:true,minimized:true},2);
 const before=(await r.get()).tabHud[1];await r.ui({toggleMinimized:true},2);assert.equal(Jobs.forHud(await r.get(),2).minimized,false);assert.deepEqual((await r.get()).tabHud[1],before);assert.equal((await r.get()).tabHud[2].documentId,'b');
 await Promise.all(Array.from({length:10},()=>r.ui({toggleMinimized:true},2)));assert.equal(Jobs.forHud(await r.get(),2).minimized,false);assert.deepEqual((await r.get()).tabHud[1],before);await assert.rejects(r.ui({toggleMinimized:true}),/aba/);
});
test('transparência altera somente dois fundos estruturais, sem blur ou materiais funcionais',()=>{
 const hud=controller(),values=new Map();hud.container={style:{setProperty:(key,value)=>values.set(key,value)},dataset:{}};
 hud.applyTransparency(undefined);assert.equal(hud.container.dataset.transparency,'50');assert.equal(Number(values.get('--hud-panel-alpha')),.49);assert.equal(Number(values.get('--hud-rail-alpha')),.44);
 hud.applyTransparency(0);for(const value of values.values())assert.ok(Number(value)>.9);
 hud.applyTransparency(100);for(const value of values.values())assert.ok(Number(value)>0&&Number(value)<=.04);
 assert.deepEqual([...values.keys()],['--hud-panel-alpha','--hud-rail-alpha']);hud.applyTransparency(NaN);assert.equal(hud.container.dataset.transparency,'50');
});
test('borda e brilho enfraquecem com transparência interna sem mudar alpha estrutural',()=>{
 const hud=controller(),values=new Map();hud.container={style:{setProperty:(k,v)=>values.set(k,v)},dataset:{}};hud.applyTransparency(50);const before=values.get('--hud-panel-alpha');hud.applyContentTransparency(0);const opaque=Number(values.get('--hud-border-strength'));hud.applyContentTransparency(50);const middle=Number(values.get('--hud-border-strength'));hud.applyContentTransparency(100);const clear=Number(values.get('--hud-border-strength'));assert.ok(opaque>middle&&middle>clear&&clear>0);assert.equal(values.get('--hud-panel-alpha'),before);assert.ok(!values.has('opacity'));
});
