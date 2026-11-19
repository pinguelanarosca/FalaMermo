'use strict';
// Real Chrome/MV3 and native range/keyboard input; task kinds are test fixtures.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async({call,evaluate,attach,page,worker,base,content,send,hud,state,until,sleep,pass,out})=>{
 await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]},page);
 const original=(await state()).jobs;for(const j of original.slice(1))await send('HUD_GLOBAL_COMMAND',{jobId:j.jobId,action:'remove'});
 const fixtures=[{jobId:'border-narration',type:'TTS'},{jobId:'border-dictation',type:'STT'},{jobId:'border-lens',type:'TTS',source:'lens'}];
 for(const j of fixtures)await evaluate(worker,'fixtureRegistry.start('+JSON.stringify({...j,origin:{tabId:0,frameId:0}})+')');
 const ids=[...fixtures.map(j=>j.jobId),original[0].jobId];
 for(const jobId of ids)await send('HUD_GLOBAL_COMMAND',{jobId,action:'collapse',collapsed:true});
 await send('HUD_GLOBAL_UI_SET',{visible:true,minimized:false,size:{width:560,height:700}});
 const gap=()=>hud('(()=>{const cards=[...h.querySelectorAll(".fm-global-card")].filter(n=>!n.hidden),last=cards.at(-1).getBoundingClientRect(),p=h.querySelector(".fm-global-player").getBoundingClientRect(),list=h.querySelector(".fm-global-jobs");return{gap:p.top-last.bottom,height:list.clientHeight,content:list.scrollHeight}})()');
 for(const expanded of [false,true,false]){
  await send('HUD_GLOBAL_COMMAND',{jobId:fixtures[0].jobId,action:'collapse',collapsed:!expanded});await sleep(60);const g=await gap();assert.ok(g.gap>=7&&g.gap<=12,JSON.stringify(g));
 }
 await hud('h.querySelector("#ext-resize-handle").focus()');for(const type of ['keyDown','keyUp'])await call('Input.dispatchKeyEvent',{type,key:'ArrowUp',code:'ArrowUp',windowsVirtualKeyCode:38},page);await sleep(80);assert.ok((await gap()).gap<=12);
 pass('controles seguem o último cartão após expandir/recolher e redimensionar');
 const geometry=()=>hud('(()=>{const cards=[...h.querySelectorAll(".fm-global-card")].filter(n=>!n.hidden),panel=h.querySelector(".ext-hud-panel"),player=h.querySelector(".fm-global-player"),p=panel.getBoundingClientRect(),c=player.getBoundingClientRect(),first=cards[0].getBoundingClientRect(),last=cards.at(-1).getBoundingClientRect(),buttons=[...h.querySelectorAll(".fm-global-player-buttons button")].map(n=>n.getBoundingClientRect()),s=getComputedStyle(player);return{top:p.top,bottom:p.bottom,height:p.height,first:first.top,last:last.bottom,controlsTop:c.top,controlsBottom:c.bottom,paddingLeft:parseFloat(s.paddingLeft),paddingRight:parseFloat(s.paddingRight),margin:s.marginTop,leftGap:buttons[0].left-c.left,rightGap:c.right-buttons.at(-1).right,border:s.borderTopWidth}})()');
 const saved=await content('chrome.storage.local.get("hudSize").then(s=>s.hudSize)');
 const captureLayout=async name=>{await call('Page.bringToFront',{},page);const shot=await call('Page.captureScreenshot',{format:'png'},page);fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(shot.data,'base64'));};
 const compact=await geometry();
 await captureLayout('layout-recolhido');
 await send('HUD_GLOBAL_COMMAND',{jobId:fixtures[0].jobId,action:'collapse',collapsed:false});await sleep(100);const expanded=await geometry();
 await captureLayout('layout-expandido');
 assert.ok(compact.first>expanded.first+15,'cartões recolhidos descem');assert.ok(compact.height<expanded.height-15,'vidro encolhe com conteúdo');assert.equal(compact.bottom,expanded.bottom);assert.equal(compact.controlsBottom,expanded.controlsBottom);
 await send('HUD_GLOBAL_COMMAND',{jobId:fixtures[0].jobId,action:'collapse',collapsed:true});await sleep(80);const collapsed=await geometry();assert.equal(collapsed.top,compact.top);assert.equal(collapsed.height,compact.height);
 for(const g of [compact,expanded,collapsed]){assert.ok(g.first-g.top<=14,'sem vazio acima dos cartões');assert.ok(g.bottom-g.controlsBottom<=14,'sem vazio abaixo dos controles');assert.ok(g.controlsTop-g.last<=12);assert.ok(g.paddingLeft>=6&&g.paddingRight>=6&&g.leftGap>=6&&g.rightGap>=6,'padding interno dos controles');assert.equal(g.margin,'10px');assert.equal(g.border,'1px');}
 assert.deepEqual(await content('chrome.storage.local.get("hudSize").then(s=>s.hudSize)'),saved,'recolher/expandir não sobrescreve tamanho global');
 const one=fixtures[0].jobId;for(const jobId of ids.filter(id=>id!==one))await send('HUD_GLOBAL_COMMAND',{jobId,action:'remove'});await sleep(80);const single=await geometry();assert.ok(single.first-single.top<=14&&single.bottom-single.controlsBottom<=14&&single.controlsTop-single.last<=12);
 for(const jobId of ids.filter(id=>id!==one))await evaluate(worker,'fixtureRegistry.reopen('+JSON.stringify(jobId)+')');for(const jobId of ids)await send('HUD_GLOBAL_COMMAND',{jobId,action:'collapse',collapsed:true});
 for(const jobId of ids)await send('HUD_GLOBAL_COMMAND',{jobId,action:'collapse',collapsed:false});await send('HUD_GLOBAL_UI_SET',{size:{width:560,height:320}});await sleep(80);
 const overflow=await hud('(()=>{const list=h.querySelector(".fm-global-jobs"),p=h.querySelector(".ext-hud-panel").getBoundingClientRect();list.scrollTop=list.scrollHeight;return{scroll:list.scrollHeight>list.clientHeight,scrolled:list.scrollTop>0,height:p.height,gap:h.querySelector(".fm-global-player").getBoundingClientRect().top-list.getBoundingClientRect().bottom}})()');assert.ok(overflow.scroll&&overflow.scrolled&&overflow.height<=320&&overflow.gap<=12,JSON.stringify(overflow));
 await send('HUD_GLOBAL_UI_SET',{size:saved});for(const jobId of ids)await send('HUD_GLOBAL_COMMAND',{jobId,action:'collapse',collapsed:true});
 fs.writeFileSync(path.join(out,'layout-geometria.json'),JSON.stringify({compact,expanded,collapsed,single,overflow,saved},null,2));
 pass('recolher desce os cartões, vidro ajusta sem vazios, uma/várias tarefas e padding interno de 6 px sem alterar tamanho salvo');
 const border=id=>hud('(()=>{const n=h.querySelector('+JSON.stringify('[data-job-id="'+id+'"]')+'),s=getComputedStyle(n),b=getComputedStyle(n,"::before"),g=getComputedStyle(n,"::after");return{type:n.dataset.taskType,bg:s.backgroundColor,image:s.backgroundImage,opacity:s.opacity,main:s.getPropertyValue("--task-main").trim(),accent:s.getPropertyValue("--task-accent").trim(),glow:s.getPropertyValue("--task-glow").trim(),borderOpacity:b.opacity,angle:b.getPropertyValue("--fm-border-angle"),animation:b.animationName,duration:b.animationDuration,mask:b.maskComposite,padding:b.paddingTop,pointer:b.pointerEvents,gradient:b.backgroundImage,glowOpacity:g.opacity,pulse:g.animationDuration,pulseName:g.animationName,glowBackground:g.backgroundColor,filter:s.backdropFilter}})()');
 for(const [id,kind,main,accent]of [['border-narration','narration','#2563eb','#38bdf8'],['border-dictation','dictation','#10a37f','#34d399'],['border-lens','lens','#ea580c','#fb923c']]){
  const b=await border(id);assert.equal(b.type,kind);assert.equal(b.main.toLowerCase(),main);assert.equal(b.accent.toLowerCase(),accent);assert.equal(b.animation,'fm-task-border-turn');assert.equal(b.duration,'4s');assert.equal(b.pulse,'3s');assert.ok(b.mask.split(',').every(v=>v.trim()==='exclude'));assert.equal(b.padding,'2px');assert.equal(b.pointer,'none');assert.ok(b.gradient.includes('conic-gradient'));const whiteStops=[...b.gradient.matchAll(/rgb\(255, 255, 255\) ([\d.]+)deg(?: ([\d.]+)deg)?/g)].flatMap(m=>[m[1],m[2]].filter(Boolean).map(Number));assert.deepEqual(whiteStops,[146,148,326,328],'apenas dois pequenos reflexos brancos');assert.equal(b.image,'none');assert.equal(b.opacity,'1');assert.equal(b.glowBackground,'rgba(0, 0, 0, 0)');
 }
 assert.equal((await border(original[0].jobId)).animation,'none');
 const angle=(await border(fixtures[0].jobId)).angle;await sleep(160);assert.notEqual((await border(fixtures[0].jobId)).angle,angle,'o gradiente realmente gira no Shadow DOM');
 const clickCollapse=async()=>{const p=await hud('(()=>{const n=h.querySelector("[data-job-id=border-narration] [data-action=collapse]"),r=n.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()');for(const type of ['mousePressed','mouseReleased'])await call('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1},page);};
 await clickCollapse();await until('clique atravessa decoração e expande',async()=>!(await state()).jobs.find(j=>j.jobId==='border-narration').collapsed);await clickCollapse();await until('clique recolhe novamente',async()=>(await state()).jobs.find(j=>j.jobId==='border-narration').collapsed);
 pass('bordas por tipo, contorno mascarado de 2 px, giro real 4 s e pulso 3 s; manual neutro');
 const {targetId}=await call('Target.createTarget',{url:base+'popup.html'}),popup=await attach(targetId);await until('sliders',()=>evaluate(popup,'typeof document.querySelector("#hud-content-transparency")?.oninput==="function"&&!!document.querySelector("#agent option")'));
 await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]},page);
 for(const jobId of ['border-narration','border-dictation'])await send('HUD_GLOBAL_COMMAND',{jobId,action:'collapse',collapsed:false});
 const values=[];
 await evaluate(page,'document.body.style.background="#fffdf5";document.body.style.color="#172033";document.querySelector("main").style.cssText="max-width:none;padding:24px";document.querySelector("main").innerHTML="<h1>Texto atrás dos cartões</h1>"+Array.from({length:28},(_,i)=>"<p style=\\"color:#172033\\">"+("Linha "+i+": página legível através do vidro, com textos e elementos reais. ").repeat(4)+"</p>").join("")');
 await call('Page.bringToFront',{},popup);await evaluate(popup,'document.querySelector("#hud-transparency").focus()');for(const type of ['rawKeyDown','keyUp'])await call('Input.dispatchKeyEvent',{type,key:'End',code:'End',windowsVirtualKeyCode:35},popup);await until('fundo estrutural claro para comparar elementos',()=>hud('h.querySelector(".ext-hud-card").dataset.transparency==="100"'));
 for(const [level,key,code]of [[0,'Home',36],[100,'End',35]]){
  await call('Page.bringToFront',{},popup);await evaluate(popup,'document.querySelector("#hud-content-transparency").focus()');for(const type of ['rawKeyDown','keyUp'])await call('Input.dispatchKeyEvent',{type,key,code:key,windowsVirtualKeyCode:code},popup);
  await until('alpha interno '+level,()=>hud('h.querySelector(".ext-hud-card").dataset.contentTransparency==='+JSON.stringify(String(level))));
  const b=await border(fixtures[0].jobId);assert.equal(b.animation,'none');assert.equal(b.pulseName,'none');assert.equal(b.filter,'none');
  const layers=await hud('Array.from(h.querySelectorAll(".ext-hud-card,.ext-hud-panel,.ext-hud-glass,.fm-global-card,textarea,button,.fm-global-player")).map(n=>{const s=getComputedStyle(n);return{filter:s.filter,backdrop:s.backdropFilter,opacity:s.opacity}})');assert.ok(layers.every(s=>s.filter==='none'&&s.backdrop==='none'));assert.equal(await hud('getComputedStyle(h.querySelector(".ext-hud-card")).opacity'),'1');
  values.push({...b,structural:await hud('getComputedStyle(h.querySelector(".ext-hud-panel>.ext-hud-glass")).backgroundColor')});
  await call('Page.bringToFront',{},page);const shot=await call('Page.captureScreenshot',{format:'png'},page);fs.writeFileSync(path.join(out,'refinamentos-alpha-'+level+'.png'),Buffer.from(shot.data,'base64'));
 }
 assert.ok(Number(values[0].borderOpacity)>Number(values[1].borderOpacity));assert.notEqual(values[0].bg,values[1].bg);assert.ok(Number(values[0].glowOpacity)>Number(values[1].glowOpacity));assert.equal(values[0].structural,values[1].structural);assert.equal(values[0].main,values[1].main);
 fs.writeFileSync(path.join(out,'refinamentos-computado.json'),JSON.stringify(values,null,2));
 pass('slider altera alpha e suaviza borda/brilho, sem filtros nem alteração estrutural; movimento reduzido respeitado');
 await call('Target.closeTarget',{targetId});
 await require('./hud-border-states-chrome.cjs')({call,evaluate,page,worker,content,hud,state,until,sleep,pass,out});
};
