'use strict';
// Run with FALAMERMO_TRANSPARENCY=1 node tests/hud-glass-chrome.cjs.
// Real MV3, existing Popup slider and computed styles; screenshots require visual review.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async({call,evaluate,attach,page,base,content,send,hud,state,until,sleep,pass,out,inspect})=>{
 const {targetId}=await call('Target.createTarget',{url:base+'popup.html'}),popup=await attach(targetId);
 await until('slider existente',()=>evaluate(popup,'document.querySelector("#hud-transparency")&&document.querySelector("#agent option")'));

 await evaluate(page,`(()=>{document.querySelector('main').remove();document.querySelector('button').remove();const style=document.createElement('style');style.textContent='body{margin:0;min-height:100vh;background:var(--paper);color:var(--ink);font:16px/1.7 system-ui}article{padding:24px;display:grid;grid-template-columns:1fr 470px;gap:50px}section{min-width:0}h1{font-size:26px;line-height:1.3}p{color:inherit;line-height:1.7}figure{height:100px;margin:12px 0;background:linear-gradient(125deg,#0369a1 0 30%,#7dd3fc 30% 52%,#d97706 52% 74%,#a3e635 74%);border-radius:8px}.underlay-probe{position:fixed;white-space:nowrap;font:15px/20px system-ui;letter-spacing:.02em;pointer-events:none;background:var(--paper)}';document.head.append(style);const article=document.createElement('article');article.innerHTML='<section><small>PÁGINA DE VALIDAÇÃO · GLASS</small><h1>Transparência e desfoque independentes</h1><p>O fundo estrutural permite reconhecer o conteúdo desta página. Os cartões e controles mantêm sua própria superfície de leitura.</p><figure></figure><p>Compare o mesmo HUD nos extremos do controle existente no Popup.</p></section><section><h1>Texto atrás do HUD</h1>'+Array.from({length:15},(_,i)=>'<p>Parágrafo '+(i+1)+': textos, imagens e elementos da página permanecem atrás da interface flutuante.</p>').join('')+'</section>';document.body.append(article);const probe=document.createElement('div');probe.className='underlay-probe';probe.textContent='Página: texto reconhecível 123';document.body.append(probe);})()`);
 const before=await state(),observations=[];
 const snapshot=()=>hud(`(()=>{const selectors=['.ext-hud-card','.ext-hud-panel','.ext-hud-header','.ext-hud-panel>.ext-hud-glass','.ext-hud-header>.ext-hud-glass','.ext-hud-body','.fm-global-hud','.fm-global-jobs','.fm-global-card:not([data-active="true"])','.fm-global-card[data-active="true"]','.fm-global-player','.ext-hud-title','#ext-btn-toggle','[data-action=panic]','.fm-hud-task-wave'];const layers={};for(const selector of selectors){const n=h.querySelector(selector);if(!n)continue;const read=pseudo=>{const s=getComputedStyle(n,pseudo);return Object.fromEntries(['background','backgroundColor','backgroundImage','opacity','backdropFilter','boxShadow','color','textShadow','content','width','height'].map(key=>[key,s[key]]));};layers[selector]={...read(null),before:read('::before'),after:read('::after')};}const r=h.querySelector('.ext-hud-card').getBoundingClientRect();return{layers,rect:{x:r.x,y:r.y,width:r.width,height:r.height},level:h.querySelector('.ext-hud-card').dataset.transparency};})()`);
 const save=async name=>{await call('Page.bringToFront',{},page);const shot=await call('Page.captureScreenshot',{format:'png'},page);fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(shot.data,'base64'));};
 // A line of ordinary page text lies in the structural part of the header row,
 // beside (rather than underneath) its functional heading label.
 const position=await hud('(()=>{const r=h.querySelector(".fm-global-card-header").getBoundingClientRect();return{x:r.x+104,y:r.y+Math.max(0,(r.height-20)/2)}})()');
 await evaluate(page,'(()=>{const p=document.querySelector(".underlay-probe");p.style.left='+JSON.stringify(position.x+'px')+';p.style.top='+JSON.stringify(position.y+'px')+'})()');
 for(const [theme,paper,ink]of [['clara','#f4f6fa','#172033'],['escura','#101a2c','#e3eaf6'],['texto','#fffdf5','#211a10']]){
  await evaluate(page,'document.body.style.setProperty("--paper",'+JSON.stringify(paper)+');document.body.style.setProperty("--ink",'+JSON.stringify(ink)+')');
  const extremes=[];
  for(const [level,key,code]of [[0,'Home',36],[100,'End',35]]){
   await call('Page.bringToFront',{},popup);await evaluate(popup,'document.querySelector("#hud-transparency").focus()');
   for(const type of ['rawKeyDown','keyUp'])await call('Input.dispatchKeyEvent',{type,key,code:key,windowsVirtualKeyCode:code},popup);
   await until('transparência '+level,()=>hud('h.querySelector(".ext-hud-card").dataset.transparency==='+JSON.stringify(String(level))));await sleep(80);
   const observed=await snapshot();observed.theme=theme;observations.push(observed);extremes.push(observed);await save('transparencia-'+theme+'-'+level);
  }
  if(!inspect){
   const [opaque,clear]=extremes;assert.deepEqual(opaque.rect,clear.rect,'slider não altera layout');
   for(const s of ['.ext-hud-panel>.ext-hud-glass','.ext-hud-header>.ext-hud-glass']){const a=opaque.layers[s],b=clear.layers[s];assert.equal(b.opacity,'1');assert.equal(a.backdropFilter,b.backdropFilter,'blur independente do slider');assert.equal(b.backdropFilter,'none');assert.notEqual(a.background,b.background);assert.ok(Number(b.backgroundColor.match(/,\s*([\d.]+)\)$/)[1])<=.04,'fundo estrutural altamente translúcido');assert.equal(b.backgroundImage,'none');}
   for(const s of ['.ext-hud-panel','.ext-hud-header','.ext-hud-body','.fm-global-hud','.fm-global-jobs']){assert.equal(clear.layers[s].backgroundColor,'rgba(0, 0, 0, 0)');assert.equal(clear.layers[s].backdropFilter,'none','nenhum filtro amplo sobre a camada funcional');}
   assert.equal(clear.layers['.ext-hud-card'].opacity,'1');assert.equal(clear.layers['.ext-hud-card'].backdropFilter,'none');
   for(const s of ['.fm-global-card:not([data-active="true"])','.fm-global-card[data-active="true"]','.fm-global-player','.ext-hud-title','#ext-btn-toggle','[data-action=panic]','.fm-hud-task-wave']){assert.deepEqual(opaque.layers[s],clear.layers[s],s+' deve preservar seu material funcional');}
   pass('fundos '+theme+': slider altera somente material estrutural, blur fixo reduzido e conteúdo funcional preservado');
  }
 }
 await call('Page.bringToFront',{},popup);await evaluate(popup,'document.querySelector("#hud-content-transparency").focus()');
 for(const type of ['rawKeyDown','keyUp'])await call('Input.dispatchKeyEvent',{type,key:'End',code:'End',windowsVirtualKeyCode:35},popup);
 await until('transparência interna máxima',()=>hud('h.querySelector(".ext-hud-card").dataset.contentTransparency==="100"'));
 await save('internos-maximo-texto');
 fs.writeFileSync(path.join(out,'camadas-computadas.json'),JSON.stringify(observations,null,2));
 assert.deepEqual((await state()).jobs,before.jobs,'estilo não altera tarefas');
 await hud('h.querySelector("#ext-btn-toggle").click()');await until('minimização preservada',()=>hud('h.querySelector(".ext-hud-card").dataset.minimized==="true"'));await save('transparencia-barra-100');
 await hud('h.querySelector("#ext-btn-toggle").click()');await until('expansão preservada',()=>hud('h.querySelector(".ext-hud-card").dataset.minimized==="false"'));
 if(!inspect)pass('tarefas, layout, raio e barra minimizada preservados');
 await call('Target.closeTarget',{targetId});
};
