'use strict';
// Two native Chrome windows, real MV3 sender identities and pointer input.
// Isolated profile; no provider credentials or physical microphone.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),out=fs.mkdtempSync(path.join(os.tmpdir(),'falamermo-hud-windows-')),extension=path.join(out,'extension'),diagnose=process.argv.includes('--diagnose');
let chrome,serial=0,buffer='';const pending=new Map(),contexts=new Map(),checks=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><title>HUD '+req.url+'</title><style>body{min-height:120vh;background:linear-gradient(120deg,#15304b,#45647e);color:white;font:18px system-ui}textarea{width:400px;height:100px}</style><h1>'+req.url+'</h1><textarea>Texto da página</textarea>');});
function call(method,params={},sessionId){return new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('Timeout '+method));},15000);pending.set(id,{resolve,reject,timer});chrome.stdio[3].write(JSON.stringify({id,method,params,sessionId})+'\0');});}
async function evaluate(session,expression,contextId){const r=await call('Runtime.evaluate',{expression,contextId,awaitPromise:true,returnByValue:true,userGesture:true},session);if(r.exceptionDetails)throw Error(r.result.description||r.exceptionDetails.text);return r.result.value;}
async function until(label,fn){for(let i=0;i<250;i++){const r=await fn();if(r)return r;await sleep(30);}throw Error('Não observado: '+label);}
async function attach(id){const {sessionId}=await call('Target.attachToTarget',{targetId:id,flatten:true});await call('Runtime.enable',{},sessionId);return sessionId;}
function pass(label){checks.push(label);console.log('PASS '+label);}
(async()=>{try{
 fs.mkdirSync(extension);for(const name of fs.readdirSync(root))if(/\.(js|html|css|json)$/.test(name))fs.copyFileSync(path.join(root,name),path.join(extension,name));for(const name of ['icons','vad-assets'])fs.cpSync(path.join(root,name),path.join(extension,name),{recursive:true});
 const manifest=JSON.parse(fs.readFileSync(path.join(extension,'manifest.json')));manifest.host_permissions.push('<all_urls>');fs.writeFileSync(path.join(extension,'manifest.json'),JSON.stringify(manifest));
 const contentFile=path.join(extension,'content.js');fs.writeFileSync(contentFile,fs.readFileSync(contentFile,'utf8').replace('exports.hud = HudController.getInstance();','globalThis.fixtureHudController=exports.hud = HudController.getInstance();'));
 const bgFile=path.join(extension,'background.js'),needle='const payload=message.payload||{},origin=senderOrigin(sender);';let bg=fs.readFileSync(bgFile,'utf8');assert.equal(bg.split(needle).length,2);bg=bg.replace(needle,needle+'globalThis.fixtureUiTrace.push({tabId:sender.tab?.id,windowId:sender.tab?.windowId,documentId:sender.documentId,page:origin.page,payload:{...payload}});');if(process.env.FALAMERMO_INTERACTIONS)bg=bg.replace('const globalJobs=globalThis.GlobalJobs.create(','const globalJobs=globalThis.fixtureRegistry=globalThis.GlobalJobs.create(');fs.writeFileSync(bgFile,'globalThis.fixtureUiTrace=[];\n'+bg);
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
 const launch=()=>{buffer='';contexts.clear();chrome=spawn(process.env.FALAMERMO_CHROME||'/opt/google/chrome/chrome',[...(process.env.FALAMERMO_HEADED?['--ozone-platform=x11']:['--headless']),'--no-sandbox','--no-first-run','--disable-dev-shm-usage','--remote-debugging-pipe','--enable-unsafe-extension-debugging','--user-data-dir='+path.join(out,'profile'),'about:blank'],{env:{...process.env,XDG_DATA_HOME:path.join(out,'xdg-data'),XDG_CONFIG_HOME:path.join(out,'xdg-config')},stdio:['ignore','ignore','pipe','pipe','pipe']});
 chrome.stderr.pipe(fs.createWriteStream(path.join(out,'chrome.log')));chrome.stdio[4].on('data',chunk=>{buffer+=chunk;let at;while((at=buffer.indexOf('\0'))>=0){const m=JSON.parse(buffer.slice(0,at));buffer=buffer.slice(at+1);if(m.method==='Runtime.executionContextCreated'){const list=contexts.get(m.sessionId)||[];list.push(m.params.context);contexts.set(m.sessionId,list);}const p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}}});};launch();
 const version=(await call('Browser.getVersion')).product;console.log(version);
 const {id}=await call('Extensions.loadUnpacked',{path:extension}),base='chrome-extension://'+id+'/';
 let worker=await attach((await until('worker',async()=>(await call('Target.getTargets')).targetInfos.find(t=>t.url===base+'background.js'))).targetId);await until('registry',()=>evaluate(worker,'typeof chrome!=="undefined"&&chrome.storage.local.get("agents").then(s=>!!s.agents)'));
 const openWindow=async suffix=>{const w=await evaluate(worker,'chrome.windows.create('+JSON.stringify({url:url+'/'+suffix,type:'normal',width:1000,height:800,focused:true})+')');const target=await until('target '+suffix,async()=>(await call('Target.getTargets')).targetInfos.find(t=>t.url===url+'/'+suffix));const session=await attach(target.targetId);const context=await until('content '+suffix,async()=>{for(const c of contexts.get(session)||[])if(!c.auxData?.isDefault&&await evaluate(session,'typeof fixtureHudController!=="undefined"',c.id))return c.id;});const tab=w.tabs[0];return{session,context,tabId:tab.id,windowId:w.id,targetId:target.targetId,documentId:await evaluate(session,'chrome.runtime.sendMessage({type:"HUD_GLOBAL_GET"}).then(()=>chrome.runtime.sendMessage({type:"HUD_GLOBAL_GET"}))',context).then(async()=>evaluate(worker,'chrome.storage.session.get("falamermo.globalJobs.v1").then(s=>s["falamermo.globalJobs.v1"].tabHud['+tab.id+'].documentId)'))};};
 const a=await openWindow('primeira'),b=await openWindow('segunda');assert.notEqual(a.windowId,b.windowId);assert.notEqual(a.tabId,b.tabId);assert.notEqual(a.documentId,b.documentId);
 const content=(v,expression)=>evaluate(v.session,expression,v.context),send=(v,type,payload={})=>content(v,'chrome.runtime.sendMessage('+JSON.stringify({type,payload})+')');
 const hud=(v,expression)=>content(v,'(()=>{const h=document.querySelector("#ext-tts-stt-host").shadowRoot;return '+expression+'})()');
 const appearance=v=>hud(v,'({visible:!h.querySelector(".ext-hud-card").classList.contains("hidden"),minimized:h.querySelector(".ext-hud-card").dataset.minimized==="true"})');
 const focus=async v=>{await evaluate(worker,'chrome.windows.update('+v.windowId+',{focused:true})');await call('Page.bringToFront',{},v.session);await until('foco real da janela '+v.windowId,()=>evaluate(worker,'chrome.windows.getLastFocused().then(w=>w.id==='+v.windowId+')'));};
 const click=async(v,selector)=>{await focus(v);const p=await hud(v,'(()=>{const r=h.querySelector('+JSON.stringify(selector)+').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');for(const type of ['mousePressed','mouseReleased'])await call('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1},v.session);};
 for(const v of [a,b])assert.equal((await send(v,'HUD_GLOBAL_UI_SET',{scope:'tab',visible:true,minimized:false})).success,true);
 const ct=await evaluate(worker,'chrome.tabs.create({windowId:'+a.windowId+',url:'+JSON.stringify(url+'/outra-aba')+'})'),cs=await attach((await until('outra aba na primeira janela',async()=>(await call('Target.getTargets')).targetInfos.find(t=>t.url===url+'/outra-aba'))).targetId);
 const cc=await until('contexto da outra aba',async()=>{for(const c of contexts.get(cs)||[])if(!c.auxData?.isDefault&&await evaluate(cs,'typeof fixtureHudController!=="undefined"',c.id))return c.id;});
 const peer={session:cs,context:cc,tabId:ct.id,windowId:a.windowId};
 if(process.env.FALAMERMO_INTERACTIONS){await require('./hud-interactions-chrome.cjs')({a,b,peer,worker,call,evaluate,content,hud,send,until,focus,click,appearance,pass,out});fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({version,checks},null,2));console.log('Artefatos: '+out);return;}
 const beforeDraftA=await appearance(a),beforeDraftB=await appearance(b);
 await send(peer,'HUD_GLOBAL_CREATE');await until('rascunho abre somente a barra na origem',async()=>{const s=await appearance(peer);return s.visible&&s.minimized;});
 await click(peer,'#ext-btn-toggle');await until('raio expande rascunho',async()=>!(await appearance(peer)).minimized);
 await send(peer,'HUD_GLOBAL_CREATE');assert.equal((await appearance(peer)).minimized,false,'novo rascunho preserva expansão manual');
 await click(peer,'#ext-btn-toggle');await until('raio minimiza rascunho',async()=>(await appearance(peer)).minimized);
 await send(peer,'HUD_GLOBAL_CREATE');assert.equal((await appearance(peer)).minimized,true,'novo rascunho preserva minimização manual');
 assert.deepEqual(await appearance(a),beforeDraftA);assert.deepEqual(await appearance(b),beforeDraftB);
 await click(peer,'#ext-btn-close');await until('ocultação do rascunho',async()=>!(await appearance(peer)).visible);await send(peer,'HUD_GLOBAL_CREATE');await until('rascunho reabre compacto',async()=>{const s=await appearance(peer);return s.visible&&s.minimized;});
 assert.deepEqual(await appearance(a),beforeDraftA);assert.deepEqual(await appearance(b),beforeDraftB);
 pass('criação abre compacta; raio e novas tarefas preservam escolhas manuais sem afetar outras abas/janelas');
 await send(peer,'HUD_GLOBAL_UI_SET',{minimized:false});
 for(const visible of [true,false,true]){const beforeA=await appearance(a),beforeB=await appearance(b);await send(peer,'HUD_GLOBAL_UI_SET',{visible});await until('visibilidade apenas da terceira aba',async()=>(await appearance(peer)).visible===visible);assert.deepEqual(await appearance(a),beforeA);assert.deepEqual(await appearance(b),beforeB);}
 await click(peer,'#ext-btn-toggle');await until('minimização local terceira aba',async()=>(await appearance(peer)).minimized);assert.equal((await appearance(a)).minimized,false);assert.equal((await appearance(b)).minimized,false);await send(peer,'HUD_GLOBAL_UI_SET',{visible:false});
 pass('duas abas na primeira janela e outra janela: mostrar/ocultar/minimizar não atravessam origens');
 const control=diagnose&&await hud(a,'!!h.querySelector("#ext-btn-min")')?'#ext-btn-min':'#ext-btn-toggle';
 for(const [index,v]of [a,b,b,a,b,a].entries()){
  const other=v===a?b:a,prior=await appearance(v),untouched=await appearance(other);await click(v,control);await until('alternância local '+index,async()=>(await appearance(v)).minimized!==prior.minimized);assert.deepEqual(await appearance(other),untouched);
  const trace=await evaluate(worker,'fixtureUiTrace.at(-1)');assert.equal(trace.tabId,v.tabId);assert.equal(trace.windowId,v.windowId);assert.equal(trace.documentId,v.documentId);
 }
 pass('duas janelas Chrome distintas: alternâncias seguem tabId/windowId/documentId do remetente');
 if(diagnose){fs.writeFileSync(path.join(out,'diagnostico.json'),JSON.stringify({version,headed:!!process.env.FALAMERMO_HEADED,windows:[a,b],trace:await evaluate(worker,'fixtureUiTrace'),checks},null,2));console.log('Artefatos: '+out);return;}
 // Per-tab operations must not depend on the active/first window or payload hints.
 const priorA=await appearance(a);await send(b,'HUD_GLOBAL_UI_SET',{scope:'tab',toggleMinimized:true,tabId:a.tabId,windowId:a.windowId,documentId:a.documentId});assert.deepEqual(await appearance(a),priorA);
 for(const v of [a,b]){
  assert.equal(await hud(v,'h.querySelectorAll("#ext-btn-toggle").length'),1);assert.equal(await hud(v,'h.querySelector("#ext-btn-min")'),null);assert.equal(await hud(v,'h.querySelectorAll("#ext-global-emergency button").length'),3);
  assert.equal(await hud(v,'h.querySelector("#ext-btn-toggle").getAttribute("aria-expanded")'),String(!(await appearance(v)).minimized));
 }
 pass('raio único, acessível, sem botão redundante; payload não escolhe outra aba');
 const captureId='window-b-capture';assert.equal((await send(b,'STT_CAPTURE_RESERVE',{jobId:captureId})).success,true);await send(b,'HUD_CAPTURE_STATE',{jobId:captureId,status:'recording',microphoneReleased:false});
 const stableA=await appearance(a);for(let i=0;i<4;i++){const before=await appearance(b);await click(b,control);await until('raio durante gravação',async()=>(await appearance(b)).minimized!==before.minimized);assert.deepEqual(await appearance(a),stableA);assert.equal((await send(b,'HUD_GLOBAL_GET')).state.jobs.find(j=>j.jobId===captureId).status,'recording');}
 const savedTrace=await evaluate(worker,'fixtureUiTrace');for(const item of savedTrace.filter(t=>t.payload.toggleMinimized))assert.equal(item.payload.scope,'tab');
 pass('raio alterna durante captura sem parar tarefa ou modificar outra janela');
 await require('./hud-adjustments-chrome.cjs')({a,b,call,evaluate,content,hud,send,until,focus,click,appearance,captureId,out,pass,worker,contexts});
 const openPopup=async v=>{
  await focus(v);let popupTarget;
  if(process.env.FALAMERMO_HEADED){await evaluate(worker,'chrome.action.openPopup()');popupTarget=await until('popup nativo',async()=>(await call('Target.getTargets')).targetInfos.find(t=>t.url===base+'popup.html'));}
  else{const t=await call('Target.createTarget',{url:base+'popup.html'});popupTarget={targetId:t.targetId};}
  const session=await attach(popupTarget.targetId);await until('slider no popup',()=>evaluate(session,'!!document.querySelector("#hud-transparency")&&!!document.querySelector("#agent option")'));return{session,targetId:popupTarget.targetId};
 };
 const popup=await openPopup(b);assert.equal(await evaluate(popup.session,'document.querySelector("#hud-transparency").value'),'50');
 const baseline={a:await appearance(a),b:await appearance(b)};
 await evaluate(popup.session,'document.querySelector("#hud-transparency").focus()');
 const sliderKey=async key=>{const code=key==='End'?35:36;for(const type of ['rawKeyDown','keyUp'])await call('Input.dispatchKeyEvent',{type,key,code:key,windowsVirtualKeyCode:code},popup.session);};
 const color=v=>hud(v,'({level:h.querySelector(".ext-hud-card").dataset.transparency,panel:parseFloat(getComputedStyle(h.querySelector(".ext-hud-card")).getPropertyValue("--hud-panel-alpha")),rail:parseFloat(getComputedStyle(h.querySelector(".ext-hud-card")).getPropertyValue("--hud-rail-alpha")),card:h.querySelector(".fm-global-card")?getComputedStyle(h.querySelector(".fm-global-card")).background:null,blur:getComputedStyle(h.querySelector(".ext-hud-panel>.ext-hud-glass")).backdropFilter})');
 for(const v of [a,b])await content(v,'globalThis.fixtureOriginalHud=fixtureHudController.container');
 await sliderKey('End');await until('transparência clara nas duas janelas',async()=>((await color(a)).level==='100')&&((await color(b)).level==='100'));
 const clear=await color(b);assert.ok(clear.panel<=.04&&clear.rail<=.04);assert.equal(clear.blur,'none');
 await sliderKey('Home');await until('HUD opaco nas duas janelas',async()=>((await color(a)).level==='0')&&((await color(b)).level==='0'));const opaque=await color(b);assert.ok(opaque.panel>.9&&opaque.rail>.9);assert.equal(opaque.card,clear.card);assert.equal(opaque.blur,clear.blur);
 await sliderKey('End');await until('preferência global persistida',()=>evaluate(worker,'chrome.storage.local.get("hudTransparency").then(s=>s.hudTransparency===100)'));
 const materialBefore=await color(b);
 await evaluate(popup.session,'document.querySelector("#hud-content-transparency").focus()');await sliderKey('End');
 await until('elementos claros em todos os HUDs',async()=>await hud(a,'h.querySelector(".ext-hud-card").dataset.contentTransparency==="100"')&&await hud(b,'h.querySelector(".ext-hud-card").dataset.contentTransparency==="100"'));
 const elementsClear=await color(b);assert.equal(elementsClear.panel,materialBefore.panel);assert.equal(elementsClear.blur,materialBefore.blur);assert.notEqual(elementsClear.card,materialBefore.card);
 await sliderKey('Home');await until('elementos opacos persistidos',()=>evaluate(worker,'chrome.storage.local.get("hudContentTransparency").then(s=>s.hudContentTransparency===0)'));
 assert.equal((await color(b)).panel,materialBefore.panel);assert.equal((await color(b)).blur,materialBefore.blur);
 pass('segundo slider altera somente superfícies funcionais, em ambas as janelas, sem mudar blur');
 const beforePopupA=await appearance(a),beforePopupC=await appearance(peer),beforePopupB=await appearance(b);
 await evaluate(popup.session,'document.querySelector(".fm-global-toolbar button:nth-child(2)").click()');await until('Popup altera só a aba de origem',async()=>(await appearance(b)).visible!==beforePopupB.visible);assert.deepEqual(await appearance(a),beforePopupA);assert.deepEqual(await appearance(peer),beforePopupC);
 await evaluate(popup.session,'document.querySelector(".fm-global-toolbar button:nth-child(2)").click()');await until('Popup restaura só a aba de origem',async()=>(await appearance(b)).visible===beforePopupB.visible);
 pass('mostrar/ocultar no Popup está vinculado à aba da janela de abertura');
 const popupShot=await call('Page.captureScreenshot',{format:'png'},popup.session);fs.writeFileSync(path.join(out,'popup-transparencia.png'),Buffer.from(popupShot.data,'base64'));
 assert.deepEqual(await appearance(a),baseline.a);assert.deepEqual(await appearance(b),baseline.b);for(const v of [a,b])assert.equal(await content(v,'fixtureOriginalHud===fixtureHudController.container'),true);
 const manual=await evaluate(popup.session,'chrome.runtime.sendMessage({type:"HUD_GLOBAL_CREATE"})');assert.equal(manual.success,true);assert.deepEqual(await appearance(peer),beforePopupC,'criar tarefa não abre HUD alheio');const jobId=manual.state.activeTaskId;await evaluate(popup.session,'chrome.runtime.sendMessage('+JSON.stringify({type:'HUD_GLOBAL_COMMAND',payload:{jobId,action:'edit',text:'Tarefa global preservada entre janelas.',expectedText:''}})+')');
 const windowsBeforeTask=await evaluate(worker,'chrome.windows.getAll().then(w=>w.length)'),taskPresentation=await appearance(b);
 await evaluate(popup.session,'document.querySelector('+JSON.stringify('[data-job-id="'+jobId+'"] [data-action=maximize]')+').click()');
 await until('Popup abre tarefa dentro da aba vinculada',()=>content(b,'!!document.querySelector("#ext-tts-stt-task-host")?.shadowRoot.querySelector(".fm-task-float")'));
 assert.equal(await content(a,'!!document.querySelector("#ext-tts-stt-task-host")?.shadowRoot.querySelector(".fm-task-float")'),false);assert.deepEqual(await appearance(b),taskPresentation);assert.equal(await evaluate(worker,'chrome.windows.getAll().then(w=>w.length)'),windowsBeforeTask);
 await content(b,'document.querySelector("#ext-tts-stt-task-host").shadowRoot.querySelector(".fm-task-close").click()');await until('fecha apresentação sem parar tarefa nem alterar HUD',()=>content(b,'!document.querySelector("#ext-tts-stt-task-host").shadowRoot.querySelector(".fm-task-float")'));assert.deepEqual(await appearance(b),taskPresentation);
 pass('↗ no Popup abre na aba da janela correta, sem janela Chrome extra ou mudança do HUD');
 await focus(a);try{await call('Target.closeTarget',{targetId:popup.targetId});}catch(error){if(!/No target with given id/.test(error.message))throw error;}await until('popup fechado ao mudar foco',async()=>!(await call('Target.getTargets')).targetInfos.some(t=>t.targetId===popup.targetId));
 const reopened=await openPopup(b);assert.equal(await evaluate(reopened.session,'document.querySelector("#hud-transparency").value'),'100');assert.equal(await evaluate(reopened.session,'document.querySelector("#hud-content-transparency").value'),'0');await focus(b);try{await call('Target.closeTarget',{targetId:reopened.targetId});}catch(error){if(!/No target with given id/.test(error.message))throw error;}await until('segunda saída do popup',async()=>!(await call('Target.getTargets')).targetInfos.some(t=>t.targetId===reopened.targetId));
 pass('slider nativo altera fundos estruturais ao vivo, preserva cards/blur/instâncias e restaura valor ao reabrir Popup');
 const beforeWindowChange=await appearance(a);await evaluate(worker,'chrome.windows.update('+a.windowId+',{state:"minimized"})');const local=await appearance(b);await click(b,control);await until('segunda janela com primeira minimizada',async()=>(await appearance(b)).minimized!==local.minimized);assert.deepEqual(await appearance(a),beforeWindowChange);
 await evaluate(worker,'chrome.windows.update('+a.windowId+',{state:"normal"})');await focus(a);await send(a,'HUD_GLOBAL_GET');await focus(b);await send(b,'HUD_GLOBAL_GET');assert.deepEqual(await appearance(a),beforeWindowChange);
 await send(b,'HUD_CAPTURE_STATE',{jobId:captureId,microphoneReleased:true});await send(b,'STT_LIVE_CANCEL',{jobId:captureId,playerId:captureId});await sleep(5300);assert.equal((await appearance(b)).visible,true);
 await evaluate(worker,'chrome.windows.remove('+a.windowId+')');const remaining=await appearance(b);await click(b,control);await until('segunda janela após fechar primeira',async()=>(await appearance(b)).minimized!==remaining.minimized);
 const jobs=(await send(b,'HUD_GLOBAL_GET')).state.jobs;assert.equal(jobs.find(j=>j.jobId===jobId).text,'Tarefa global preservada entre janelas.');
 await click(b,'[data-action=panic]');await until('pânico confirmado',()=>hud(b,'h.querySelector("[data-action=panic]").getAttribute("aria-busy")==="false"'));await click(b,'#ext-btn-close');await until('ocultação explícita',async()=>!(await appearance(b)).visible);
 pass('foco/minimização/fechamento da primeira janela não transferem controle; tarefas e abertura manual preservadas');
 const trace=await evaluate(worker,'fixtureUiTrace');fs.writeFileSync(path.join(out,'trace-primeiro-processo.json'),JSON.stringify({windows:[a,b],trace},null,2));
 const savedDimensions=await evaluate(worker,'chrome.storage.local.get("hudSize").then(s=>s.hudSize)');
 const exited=new Promise(resolve=>chrome.once('exit',resolve));await call('Browser.close');await exited;assert.equal(pending.size,0);launch();
 let loaded;try{loaded=await call('Extensions.loadUnpacked',{path:extension});}catch(error){if(!(await call('Target.getTargets')).targetInfos.some(t=>t.url===base+'background.js'))throw error;loaded={id};}assert.equal(loaded.id,id);
 worker=await attach((await until('worker após reiniciar Chrome',async()=>(await call('Target.getTargets')).targetInfos.find(t=>t.url===base+'background.js'))).targetId);
 await until('preferência após reinício real',()=>evaluate(worker,'typeof chrome!=="undefined"&&chrome.storage.local.get("hudTransparency").then(s=>s.hudTransparency===100)'));
 const c=await openWindow('apos-reinicio');await until('novo HUD restaura material',async()=>(await color(c)).level==='100');const restored=await openPopup(c);assert.equal(await evaluate(restored.session,'document.querySelector("#hud-transparency").value'),'100');assert.equal(await evaluate(restored.session,'document.querySelector("#hud-content-transparency").value'),'0');
 await until('tamanho global persiste após reiniciar Chrome',()=>content(c,'fixtureHudController.hudSize?.width==='+savedDimensions.width+'&&fixtureHudController.hudSize?.height==='+savedDimensions.height));
 assert.deepEqual(await evaluate(worker,'chrome.storage.local.get("hudSize").then(s=>s.hudSize)'),savedDimensions);
 pass('dimensões globais restauradas em HUD novo após reinício real do Chrome');
 pass('preferência persiste após encerrar e reiniciar o processo Chrome com o mesmo perfil');
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({version,windows:[a,b],checks},null,2));console.log('Artefatos: '+out);
 }finally{server.close();if(chrome){const exit=chrome.exitCode===null?new Promise(r=>chrome.once('exit',r)):Promise.resolve();try{await call('Browser.close');}catch{chrome.kill();}await exit;}for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('encerrado'));}fs.rmSync(path.join(out,'profile'),{recursive:true,force:true});}
})().catch(error=>{console.error(error.stack||error);console.error('Artefatos: '+out);process.exitCode=1;});
