'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async({call,page,content,hud,state,send,until,sleep,pass,out,ids})=>{
 const id=ids[0],floating=expression=>content('(()=>{const h=document.querySelector("#ext-tts-stt-task-host")?.shadowRoot;return '+expression+'})()');
 await hud('h.querySelector('+JSON.stringify('[data-job-id="'+id+'"] [data-action=maximize]')+').click()');await until('tarefa flutuante',()=>floating('!!h?.querySelector(".fm-task-float .fm-global-card-header")'));
 const rect=()=>floating('(()=>{const r=h.querySelector(".fm-task-float").getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})()'),initial=await rect();
 const main=await hud('({right:h.querySelector(".ext-hud-card").style.right,bottom:h.querySelector(".ext-hud-card").style.bottom,width:h.querySelector(".ext-hud-card").style.width,height:h.querySelector(".ext-hud-card").style.height})');
 await floating('(()=>{const f=h.querySelector(".fm-task-float");globalThis.fixtureTaskDragTrace=[];for(const name of ["pointerdown","gotpointercapture","lostpointercapture","pointercancel"])f.addEventListener(name,e=>fixtureTaskDragTrace.push({name,target:e.target.className?.baseVal??e.target.className,button:e.button,pointerId:e.pointerId}),true)})()');
 const input=(type,p,extra={})=>call('Input.dispatchMouseEvent',{type,...p,...(type==='mouseMoved'&&extra.buttons?{button:'left'}:{}),...extra},page);
 const drag=async(selector,dx,dy,offset)=>{
  const before=await rect(),point=await floating('(()=>{const n=h.querySelector('+JSON.stringify(selector)+'),r=n.getBoundingClientRect();return{x:r.x+'+(offset?.x??'r.width/2')+',y:r.y+'+(offset?.y??'r.height/2')+'}})()');
  const hit=await floating('(()=>{const n=h.elementFromPoint('+point.x+','+point.y+');return{tag:n?.tagName,className:n?.className?.baseVal??n?.className}})()');
  await input('mousePressed',point,{button:'left',clickCount:1});
  for(let step=1;step<=4;step++){await input('mouseMoved',{x:point.x+dx*step/4,y:point.y+dy*step/4},{buttons:1});await send('HUD_GLOBAL_GET');}
  await input('mouseReleased',{x:point.x+dx,y:point.y+dy},{button:'left',clickCount:1});const after=await rect(),trace=await content('fixtureTaskDragTrace');
  assert.ok(Math.abs(after.x-before.x-dx)<.5&&Math.abs(after.y-before.y-dy)<.5,JSON.stringify({selector,point,hit,before,after,trace}));assert.equal(after.width,before.width);assert.equal(after.height,before.height);
  await sleep(180);assert.deepEqual(await rect(),after,'posição não retorna nem deriva após soltar e receber estado');return trace;
 };
 await drag('.fm-global-kind',-70,-55);await drag('.fm-global-description',80,65);await drag('.fm-global-card-header',-30,-20,{x:4,y:4});
 pass('arraste real pelo título, descrição e espaço do cabeçalho, com atualizações e tamanho intacto');
 await drag('.fm-hud-task-wave',35,20);await drag('.fm-hud-task-wave svg',-35,-20);await drag('.fm-global-card',10,10,{x:40,y:5});
 for(let i=0;i<4;i++){await drag('.fm-global-description',25,20);await drag('.fm-global-kind',-25,-20);}
 assert.equal((await rect()).width,initial.width);assert.equal((await rect()).height,initial.height);
 pass('faixa superior, título e descrição permitem arrastes consecutivos em quatro direções, sem deriva');
 const beforeText=await rect(),p=await floating('(()=>{const r=h.querySelector("textarea").getBoundingClientRect();return{x:r.x+12,y:r.y+14}})()');
 const textHit=await floating('(()=>{const e=h.querySelector("textarea"),n=h.elementFromPoint('+p.x+','+p.y+');return{target:n?.className,disabled:e.disabled,length:e.value.length,top:e.scrollTop}})()');
 await input('mousePressed',p,{button:'left',clickCount:1});await input('mouseMoved',{x:p.x+100,y:p.y},{buttons:1});await input('mouseReleased',{x:p.x+100,y:p.y},{button:'left',clickCount:1});assert.deepEqual(await rect(),beforeText);const selection=await floating('(()=>{const e=h.querySelector("textarea");return{start:e.selectionStart,end:e.selectionEnd,active:h.activeElement?.className}})()');assert.ok(selection.end>selection.start,JSON.stringify({p,textHit,selection,trace:await content('fixtureTaskDragTrace')}));
 await call('Input.insertText',{text:'Edição nativa após arraste. '},page);await until('edição continua funcionando',async()=>(await state()).jobs.find(j=>j.jobId===id).text.includes('Edição nativa após arraste.'));assert.deepEqual(await rect(),beforeText);
 const slider=await floating('(()=>{const r=h.querySelector("[data-card-control=volume]").getBoundingClientRect();return{x:r.x+r.width*.3,y:r.y+r.height/2}})()');await input('mousePressed',slider,{button:'left',clickCount:1});await input('mouseReleased',slider,{button:'left',clickCount:1});await until('slider individual continua funcionando',async()=>Math.abs(((await state()).jobs.find(j=>j.jobId===id).progress.volume??1)-.3)<.1);assert.deepEqual(await rect(),beforeText);
 const grip=await floating('(()=>{const r=h.querySelector(".fm-task-resize").getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()');await input('mousePressed',grip,{button:'left',clickCount:1});await input('mouseMoved',{x:grip.x+40,y:grip.y+25},{buttons:1});await input('mouseReleased',{x:grip.x+40,y:grip.y+25},{button:'left',clickCount:1});const resized=await rect();assert.equal(resized.width,beforeText.width+40);assert.equal(resized.height,beforeText.height+25);
 await drag('.fm-global-description',-20,-15);assert.equal((await rect()).width,resized.width);assert.equal((await rect()).height,resized.height);
 const viewport=await content('({width:visualViewport.width,height:visualViewport.height,left:visualViewport.offsetLeft,top:visualViewport.offsetTop})');
 for(const corner of [{x:viewport.left+1,y:viewport.top+1},{x:viewport.left+viewport.width-1,y:viewport.top+viewport.height-1}]){
  const point=await floating('(()=>{const r=h.querySelector(".fm-global-card-header").getBoundingClientRect();return{x:r.x+4,y:r.y+4}})()');await input('mousePressed',point,{button:'left',clickCount:1});await input('mouseMoved',corner,{buttons:1});await input('mouseReleased',corner,{button:'left',clickCount:1});const r=await rect();assert.ok(r.x>=viewport.left+11&&r.y>=viewport.top+11&&r.x+r.width<=viewport.left+viewport.width-11&&r.y+r.height<=viewport.top+viewport.height-11,JSON.stringify({corner,r}));assert.equal(r.width,resized.width);assert.equal(r.height,resized.height);
 }
 assert.deepEqual(await hud('({right:h.querySelector(".ext-hud-card").style.right,bottom:h.querySelector(".ext-hud-card").style.bottom,width:h.querySelector(".ext-hud-card").style.width,height:h.querySelector(".ext-hud-card").style.height})'),main);
 const shot=await call('Page.captureScreenshot',{format:'png'},page);fs.writeFileSync(path.join(out,'tarefa-arraste.png'),Buffer.from(shot.data,'base64'));fs.writeFileSync(path.join(out,'pointer-trace.json'),JSON.stringify(await content('fixtureTaskDragTrace'),null,2));
 const close=await floating('(()=>{const r=h.querySelector(".fm-task-close").getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()');await input('mousePressed',close,{button:'left',clickCount:1});await input('mouseReleased',close,{button:'left',clickCount:1});await until('botão fecha sem parar tarefa',()=>floating('!h.querySelector(".fm-task-float")'));assert.equal((await state()).jobs.find(j=>j.jobId===id).status,'ready');
 pass('seleção, edição, slider, limites da viewport, redimensionamento e fechamento nativos preservados; HUD principal não mudou');
};
