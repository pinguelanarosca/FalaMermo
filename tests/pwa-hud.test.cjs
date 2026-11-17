const test=require('node:test'),assert=require('node:assert/strict'),G=require('../global-jobs.js');
const origin=(tabId,documentId)=>({tabId,documentId,frameId:0});
test('documento novo não herda visibilidade global; tarefa alheia continua sincronizada',async()=>{
 const r=G.create();await r.ui({visible:true,minimized:false});await r.start({jobId:'other',type:'TTS',text:'Texto',origin:origin(1,'other')});
 const s=await r.attachHud(origin(2,'pwa'));assert.equal(G.forHud(s,2).visible,false);assert.equal(G.forHud(s,1).visible,true);assert.equal(s.jobs.length,1);
});
test('PWA vazia e documento recarregado ficam ocultos, sem mudar outro HUD',async()=>{
 const r=G.create();await r.attachHud(origin(1,'tab'));await r.ui({visible:false},1);await r.attachHud(origin(2,'pwa'));assert.equal(G.forHud(await r.get(),2).visible,false);
 await r.ui({visible:true},2);assert.equal(G.forHud(await r.attachHud(origin(2,'pwa')),2).visible,true);
 const s=await r.attachHud(origin(2,'reload'));assert.equal(G.forHud(s,2).visible,false);assert.equal(G.forHud(s,1).visible,false);
});
test('tarefa própria abre PWA; GET/foco e restart não anulam interação manual do documento',async()=>{
 const data={},services={storage:{get:async key=>({[key]:data[key]}),set:async value=>Object.assign(data,value)}};const r=G.create(services),o=origin(2,'pwa');
 await r.attachHud(o);await r.start({jobId:'own',type:'STT',origin:o});assert.equal(G.forHud(await r.get(),2).visible,true);await r.ui({visible:false},2);assert.equal(G.forHud(await r.attachHud(o),2).visible,false);
 const restored=G.create(services);assert.equal(G.forHud(await restored.attachHud(o),2).visible,false);
 await restored.ui({visible:true},2);assert.equal(G.forHud(await restored.attachHud(o),2).visible,true);
});
test('tarefa iniciada antes da primeira consulta do documento continua abrindo legitimamente',async()=>{
 const r=G.create(),o=origin(2,'pwa');await r.start({jobId:'own',type:'TTS',text:'Texto.',origin:o});assert.equal(G.forHud(await r.attachHud(o),2).visible,true);
});
