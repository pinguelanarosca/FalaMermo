'use strict';
// Chrome/MV3, seleção, captura, recorte e AudioWorklet reais.
// Por padrão só os provedores HTTP/WebSocket são simulados; --live usa configuração temporária.
const assert=require('node:assert/strict');
const fs=require('node:fs'),http=require('node:http'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'falamermo-selection-'));
const extension=path.join(temp,'extension'),live=process.argv.includes('--live'),twoModes=process.argv.includes('--two-modes'),literalOnly=process.argv.includes('--literal-only')||twoModes;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const pending=new Map(),contexts=new Map(),snapshots=[];let chrome,sequence=0,worker,held=[],httpMode='hold',visionRequests=0;
const input='Qual é a pergunta?\nNão responda: leia literalmente.\n\nValor: R$ 12,50 — Código A-42.';
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html lang="pt-BR"><title>Seleção FalaMermo</title><style>body{font:24px sans-serif;padding:32px}textarea{width:750px;height:100px;font:24px sans-serif}#text{width:340px;min-height:100px;font:20px sans-serif;white-space:pre-wrap}</style><h1>Seleção FalaMermo</h1><textarea aria-label="Texto para seleção">'+input+'</textarea><p id="text">'+input+'</p></html>');});
function call(method,params={},sessionId){return new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('Timeout '+method));},15000);pending.set(id,{resolve,reject,timer});chrome.stdio[3].write(JSON.stringify({id,method,params,sessionId})+'\0');});}
async function evaluate(session,expression,contextId){const r=await call('Runtime.evaluate',{expression,contextId,awaitPromise:true,returnByValue:true,userGesture:true},session);if(r.exceptionDetails)throw Error(r.result.description||r.exceptionDetails.text);return r.result.value;}
async function waitFor(label,fn,timeout=12000){const end=Date.now()+timeout;do{const value=await fn();if(value)return value;await sleep(40);}while(Date.now()<end);throw Error('Estado não encontrado: '+label);}
async function attach(id){const {sessionId}=await call('Target.attachToTarget',{targetId:id,flatten:true});await call('Runtime.enable',{},sessionId);return sessionId;}
async function locate(url){return(await call('Target.getTargets')).targetInfos.find(t=>t.url===url);}
async function fulfill(event,session,released=false){if(!released)visionRequests++;const request=JSON.parse(event.request.postData);assert.equal(request.contents[0].parts[0].inlineData.mimeType,'image/jpeg');assert.ok(request.contents[0].parts[0].inlineData.data.length>100);if(request.generationConfig?.responseMimeType==='application/json')assert.equal(request.systemInstruction.parts[0].text,require('../live-config.js').LITERAL_SELECTION_OCR);else assert.ok(twoModes);if(httpMode==='hold'){held.push({event,session});return;}const error=httpMode==='error';await call('Fetch.fulfillRequest',{requestId:event.requestId,responseCode:error?503:200,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify(error?{error:{message:'fixture unavailable'}}:{candidates:[{content:{parts:[{text:request.generationConfig?.responseMimeType==='application/json'?JSON.stringify({text:httpMode==='empty'?'':input}):(request.systemInstruction.parts[0].text.includes('Análise B:')?'Análise B: Explicação objetiva da pergunta e do valor.':'Análise A: A pergunta pede esclarecimento; o valor é uma quantia monetária.')}]}}]})).toString('base64')},session);}
function providerFixture(){
 const Native=globalThis.AudioContext;
 globalThis.AudioContext=class extends Native{constructor(opts){super({...opts,sinkId:{type:'none'}});}};
 globalThis.fixtureTexts=[];globalThis.fixtureSockets=[];
 globalThis.WebSocket=class{
  readyState=0;bufferedAmount=0;
  constructor(){fixtureSockets.push(this);queueMicrotask(()=>{this.readyState=1;this.onopen();});}
  send(raw){const p=JSON.parse(raw);if(p.setup){this.fixtureSetup=p.setup;this.onmessage({data:JSON.stringify({setupComplete:{}})});return;}if(p.clientContent){fixtureTexts.push(p.clientContent);const frames=new Int16Array(24000);for(let i=0;i<frames.length;i++)frames[i]=Math.sin(i*Math.PI*440/24000)*1000;const bytes=new Uint8Array(frames.buffer);let data='';for(let i=0;i<bytes.length;i+=8192)data+=String.fromCharCode(...bytes.subarray(i,i+8192));setTimeout(()=>this.onmessage?.({data:JSON.stringify({serverContent:{modelTurn:{parts:[{inlineData:{mimeType:'audio/pcm;rate=24000',data:btoa(data)}}]},turnComplete:true,interactionStatus:'IDLE'}})}),150);}}
  close(code,reason){this.readyState=3;queueMicrotask(()=>this.onclose?.({code,reason}));}
 };
}
(async()=>{
 fs.mkdirSync(extension);
 for(const name of fs.readdirSync(root))if(/\.(js|html|css|json)$/.test(name))fs.copyFileSync(path.join(root,name),path.join(extension,name));
 const manifestFile=path.join(extension,'manifest.json'),manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));manifest.host_permissions.push('<all_urls>');fs.writeFileSync(manifestFile,JSON.stringify(manifest));
 fs.cpSync(path.join(root,'icons'),path.join(extension,'icons'),{recursive:true});
 if(!live){fs.writeFileSync(path.join(extension,'selection-provider-fixture.js'),'('+providerFixture.toString()+')();');const f=path.join(extension,'offscreen.html');fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace('<body>','<body><script src="selection-provider-fixture.js"></script>'));}
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 chrome=spawn(process.env.FALAMERMO_CHROME||'google-chrome',['--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--remote-debugging-pipe','--enable-unsafe-extension-debugging','--autoplay-policy=no-user-gesture-required','--user-data-dir='+path.join(temp,'profile'),'about:blank'],{stdio:['ignore','ignore','pipe','pipe','pipe']});
 chrome.stderr.pipe(fs.createWriteStream(path.join(temp,'chrome.log')));let buffer='';
 chrome.stdio[4].on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\0'))>=0){const m=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);if(m.method==='Runtime.executionContextCreated'){const list=contexts.get(m.sessionId)||[];list.push(m.params.context);contexts.set(m.sessionId,list);}if(m.method==='Fetch.requestPaused')void fulfill(m.params,m.sessionId).catch(error=>{console.error(error.message);process.exitCode=1;});const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}}});
 console.log((await call('Browser.getVersion')).product);
 const {id}=await call('Extensions.loadUnpacked',{path:extension}),base='chrome-extension://'+id+'/';
 worker=await attach((await waitFor('service worker',()=>locate(base+'background.js'))).targetId);
 await waitFor('worker inicializado',()=>evaluate(worker,'typeof chrome !== "undefined" && typeof GlobalJobs !== "undefined"'));
 await waitFor('storage instalado',()=>evaluate(worker,'chrome.storage.local.get("agents").then(s=>!!s.agents)'));
 const config=live?JSON.parse(fs.readFileSync(process.env.FALAMERMO_SELECTION_CONFIG,'utf8')):{api:{apiKey:'fixture-initial-1',apiKeys:Array.from({length:9},(_,i)=>'fixture-initial-'+(i+1))}};
 // Usa a persona de desenvolvimento no perfil isolado; preferências pessoais não são gravadas.
 config.agents={...(config.agents||{}),activeAgentId:'developer'};
 config.ui={...(config.ui||{}),shortcuts:{...(config.ui?.shortcuts||{}),lensSelection:'Ctrl+Shift+L',readSelection:'Ctrl+B'}};
 if(twoModes){config.agents.customAgents=[...(config.agents.customAgents||[]),...['a','b'].map(id=>({metadata:{id:'lens-mode-'+id,name:'Persona Lens '+id,isBuiltIn:false},voice:{preferredVoice:'Puck',volume:1,rateMultiplier:1,pitchMultiplier:1},instructions:{ttsSystemInstruction:'Explique tecnicamente.',sttFormattingInstruction:'Preserve o ditado.',lensInspectionInstruction:'Instrução legada '+id},modelPreferences:{visionModelId:config.models?.visionModelId||'gemini-3.5-flash-lite'}}))];config.agents.activeAgentId='lens-mode-a';}
 await evaluate(worker,'chrome.storage.local.set('+JSON.stringify(config)+')');
 let optionsSession;
 const reading=id=>'Leia com naturalidade, '+(id==='a'?'ritmo calmo e pausas claras.':'entonação expressiva e fluidez.');
 const interpretation=id=>'Interprete o conteúdo da imagem em português em duas frases. Comece exatamente com "Análise '+id.toUpperCase()+':". Explique a pergunta e os números presentes; não transcreva integralmente.';
 async function chooseAgent(id){await evaluate(optionsSession,'selectAgent('+JSON.stringify('lens-mode-'+id)+')');}
 if(twoModes){
  const {targetId:optionsId}=await call('Target.createTarget',{url:base+'options.html'});optionsSession=await attach(optionsId);
  await waitFor('editor de agentes',()=>evaluate(optionsSession,'typeof currentAgent!=="undefined"&&!!currentAgent'));
  for(const id of ['a','b']){
   await chooseAgent(id);
   assert.equal(await evaluate(optionsSession,'document.querySelector("#lensInstruction").value'),'Instrução legada '+id);
   assert.equal(await evaluate(optionsSession,'document.querySelector("#lensReadingInstruction").value'),require('../live-config.js').DEFAULT_LENS_READING);
   await evaluate(optionsSession,'(()=>{for(const [selector,value] of '+JSON.stringify([['#lensReadingInstruction',reading(id)],['#lensInstruction',interpretation(id)]])+'){const f=document.querySelector(selector);f.value=value;f.dispatchEvent(new Event("change",{bubbles:true}));}document.querySelector("#saveAgent").click();})()');
   await waitFor('personas salvas '+id,()=>evaluate(worker,'chrome.storage.local.get("agents").then(s=>s.agents.customAgents.find(a=>a.metadata.id==='+JSON.stringify('lens-mode-'+id)+').instructions.lensReadingInstruction==='+JSON.stringify(reading(id))+')'));
  }
  await evaluate(optionsSession,'globalThis.fixtureBeforeReload=true');await call('Page.reload',{},optionsSession);await waitFor('editor recarregado',()=>evaluate(optionsSession,'typeof fixtureBeforeReload==="undefined"&&typeof selectAgent==="function"&&typeof currentAgent!=="undefined"&&!!currentAgent'));
  for(const id of ['a','b']){await chooseAgent(id);assert.equal(await evaluate(optionsSession,'document.querySelector("#lensReadingInstruction").value'),reading(id));assert.equal(await evaluate(optionsSession,'document.querySelector("#lensInstruction").value'),interpretation(id));}
  await evaluate(optionsSession,'document.querySelector("#createAgent").click()');
  await waitFor('duplicação preserva instruções',()=>evaluate(worker,'chrome.storage.local.get("agents").then(s=>s.agents.customAgents.some(a=>a.metadata.id.startsWith("custom-")&&a.instructions.lensReadingInstruction==='+JSON.stringify(reading('b'))+'&&a.instructions.lensInspectionInstruction==='+JSON.stringify(interpretation('b'))+'))'));
  await chooseAgent('a');console.log('Opções: migração, edição, salvamento, recarga, alternância e duplicação preservam ambas as instruções.');
 }

 if(!live)await call('Fetch.enable',{patterns:[{urlPattern:'https://generativelanguage.googleapis.com/*:generateContent*',requestStage:'Request'}]},worker);
 const {targetId}=await call('Target.createTarget',{url:'http://127.0.0.1:'+server.address().port});
 const page=await attach(targetId);
 const isolated=await waitFor('content script',async()=>{for(const c of contexts.get(page)||[])if(!c.auxData?.isDefault&&await evaluate(page,'chrome.runtime?.id === '+JSON.stringify(id),c.id))return c.id;});
 const content=expression=>evaluate(page,expression,isolated);
 const state=()=>evaluate(worker,'chrome.storage.session.get("falamermo.globalJobs.v1").then(r=>r["falamermo.globalJobs.v1"])');
 const latest=async()=>{const s=await state();snapshots.push(s);return s.jobs[0];};
 const hud=expression=>content('(()=>{const hud=document.querySelector("#ext-tts-stt-host").shadowRoot;return '+expression+'})()');
 await waitFor('HUD',()=>hud('!!hud.querySelector(".fm-global-jobs")'));
 // O perfil descartável já autoriza a captura; a UI de permissão tem testes próprios.
 await call('Page.bringToFront',{},page);
 let lastCapture=0;
 async function selectArea(direct=false,mode='literal'){
  // O Chrome permite somente duas capturas por segundo, inclusive no perfil de teste.
  await sleep(Math.max(0,650-(Date.now()-lastCapture)));lastCapture=Date.now();
  const rect=await content('(()=>{const r=document.querySelector("#text").getBoundingClientRect();return{x:r.x,y:r.y,width:Math.min(760,r.width),height:r.height}})()');
  if(!direct){for(const type of ['rawKeyDown','keyUp'])await call('Input.dispatchKeyEvent',{type,key:'L',code:'KeyL',windowsVirtualKeyCode:76,modifiers:10},page);await waitFor('overlay Lens',()=>hud('hud.textContent.includes("Clique e arraste")'));}
  const modifiers=direct?(mode==='interpret'?9:10):0;
  await call('Input.dispatchMouseEvent',{type:'mousePressed',x:rect.x-3,y:rect.y-3,button:'left',clickCount:1,modifiers},page);
  await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:rect.x+rect.width,y:rect.y+rect.height+4,buttons:1,modifiers},page);
  await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:rect.x+rect.width,y:rect.y+rect.height+4,button:'left',clickCount:1,modifiers},page);
 }
 await selectArea(twoModes);
 const first=await waitFor('tarefa da seleção',async()=>{const j=await latest();return j?.source==='lens'&&j;});
 const firstId=first.jobId;assert.equal(first.status,'analyzing');
 assert.equal(await hud('hud.querySelector(`[data-job-id="'+firstId+'"]`).textContent.includes("Analisando seleção")'),true);
 if(!live){
  await waitFor('duas análises paralelas',()=>held.length===2);
  assert.notEqual(new URL(held[0].event.request.url).searchParams.get('key'),new URL(held[1].event.request.url).searchParams.get('key'));
  assert.equal(held[0].event.request.postData,held[1].event.request.postData);
  httpMode='success';const winner=held.splice(1,1)[0];await fulfill(winner.event,winner.session,true);
 }

 let played=false;
 await waitFor('seleção narrada e concluída',async()=>{const j=(await state()).jobs.find(j=>j.jobId===firstId);snapshots.push({jobs:[j]});if(j.status==='playing')played=true;if(j.status==='error')throw Error('Seleção terminou com erro: '+j.error);return j.status==='completed';},live?90000:15000);
 assert.equal(played,true);assert.ok(snapshots.some(s=>s.jobs.some(j=>j.jobId===firstId&&j.status==='connecting')),'Conectando deve ser observado antes da reprodução');const completed=(await state()).jobs.find(j=>j.jobId===firstId);assert.equal(completed.text,input,'OCR deve preservar a fonte literal, inclusive pontuação e quebras');
 assert.equal(await hud('hud.querySelector(`[data-job-id="'+firstId+'"]`).textContent.includes("Concluído")'),true);
 assert.equal(await content('document.querySelector("textarea").value'),input,'Lens deve narrar sem substituir o campo');
 assert.equal((await state()).jobs.length,1,'Análise e narração devem usar uma tarefa');
 assert.ok(await evaluate(worker,'chrome.storage.local.get("history").then(s=>s.history.recentItems.some(j=>j.jobId==='+JSON.stringify(firstId)+'&&j.text))'));
 console.log('Seleção por atalho: analyzing → connecting → playing → completed; uma tarefa, texto no HUD, narração e destino preservado.');
 if(!live&&!literalOnly){
  for(const h of held.splice(0))await fulfill(h.event,h.session,true).catch(()=>{});
  await sleep(200);assert.equal((await state()).jobs.length,1);
  console.log('Conta #2 vence; mesma imagem em duas chaves, uma tarefa e resposta perdedora ignorada.');
  const fixturePool=async label=>evaluate(worker,'chrome.storage.local.set('+JSON.stringify({api:{apiKey:'fixture-'+label+'-1',apiKeys:Array.from({length:9},(_,i)=>'fixture-'+label+'-'+(i+1))}})+')');
  await fixturePool('first-wins');httpMode='hold';held=[];await selectArea();
  const second=await waitFor('segunda corrida',async()=>{const j=await latest();return j.jobId!==firstId&&j.status==='analyzing'&&j;});
  await waitFor('duas contas da segunda corrida',()=>held.length===2);httpMode='success';const first=held.shift();await fulfill(first.event,first.session,true);
  await waitFor('conta #1 concluída',async()=>(await latest()).status==='completed');
  for(const h of held.splice(0))await fulfill(h.event,h.session,true).catch(()=>{});
  assert.equal((await latest()).jobId,second.jobId);assert.equal((await state()).jobs.length,2);
  console.log('Conta #1 vence em ordem inversa; sem duplicação de tarefa.');
  await fixturePool('replacement');httpMode='hold';held=[];await selectArea();
  const replacement=await waitFor('corrida com substituição',async()=>{const j=await latest();return j.jobId!==second.jobId&&j.status==='analyzing'&&j;});
  await waitFor('duas contas iniciais da substituição',()=>held.length===2);
  const unavailable=held.shift();await call('Fetch.fulfillRequest',{requestId:unavailable.event.requestId,responseCode:503,body:Buffer.from('{}').toString('base64')},unavailable.session);
  await waitFor('terceira conta repõe vaga',()=>held.length===2);
  assert.equal(new URL(held[0].event.request.url).searchParams.get('key'),'fixture-replacement-2');
  const limited=held.shift();await call('Fetch.fulfillRequest',{requestId:limited.event.requestId,responseCode:429,responseHeaders:[{name:'Retry-After',value:'60'}],body:Buffer.from('{}').toString('base64')},limited.session);
  await waitFor('quarta conta repõe segunda vaga',()=>held.length===2);httpMode='success';const substitute=held.shift();await fulfill(substitute.event,substitute.session,true);
  await waitFor('substituta conclui',async()=>(await latest()).status==='completed');
  for(const h of held.splice(0))await fulfill(h.event,h.session,true).catch(()=>{});
  assert.equal((await latest()).jobId,replacement.jobId);assert.equal((await state()).jobs.length,3);
  console.log('503 e 429: duas contas substituídas progressivamente, apenas duas tentativas por seleção.');
  await fixturePool('all-errors');httpMode='error';await selectArea(true);
  const failed=await waitFor('erro da visão no HUD',async()=>{const j=await latest();return j.jobId!==firstId&&j.status==='error'&&j;});assert.match(failed.error,/503/);
  assert.equal(await hud('hud.querySelector(`[data-job-id="'+failed.jobId+'"]`).textContent.includes("503")'),true);
  console.log('Ctrl+Shift+arrastar: erro HTTP 503 aparece na tarefa, sem narração.');
  await fixturePool('stop');httpMode='hold';held=[];await selectArea();
  const cancel=await waitFor('nova análise',async()=>{const j=await latest();return j.jobId!==failed.jobId&&j.status==='analyzing'&&j;});
  await waitFor('duas visões em voo',()=>held.length===2);
  await content('document.querySelector("#ext-tts-stt-host").shadowRoot.querySelector(`[data-job-id="'+cancel.jobId+'"] [data-action="stop"]`).click()');
  await waitFor('Stop confirmado',async()=>(await latest()).status==='cancelled');
  httpMode='success';for(const h of held.splice(0))await fulfill(h.event,h.session,true).catch(()=>{});
  await sleep(400);assert.equal((await latest()).status,'cancelled');assert.equal((await latest()).text,'');
  console.log('Stop no HUD aborta análise e não aceita resposta tardia.');
  await fixturePool('global');httpMode='hold';held=[];const globalIds=[];
  for(let i=0;i<3;i++){const previous=(await latest()).jobId;await selectArea();const j=await waitFor('seleção concorrente '+i,async()=>{const j=await latest();return j.jobId!==previous&&j.status==='analyzing'&&j;});globalIds.push(j.jobId);}
  await waitFor('quatro requisições globais',()=>held.length===4);await sleep(250);assert.equal(held.length,4);
  assert.equal(new Set(held.map(h=>new URL(h.event.request.url).searchParams.get('key'))).size,4);
  const stopJob=id=>content('document.querySelector("#ext-tts-stt-host").shadowRoot.querySelector(`[data-job-id="'+id+'"] [data-action="stop"]`).click()');
  await stopJob(globalIds[0]);held.splice(0,2);await waitFor('fila usa vagas liberadas',()=>held.length===4);
  for(const id of globalIds.slice(1))await stopJob(id);
  await waitFor('três seleções canceladas',async()=>globalIds.every(id=>(snapshots.at(-1)?.jobs||[]).find(j=>j.jobId===id)?.status==='cancelled')||((snapshots.push(await state())),false));
  httpMode='success';for(const h of held.splice(0))await fulfill(h.event,h.session,true).catch(()=>{});
  console.log('Três seleções: teto global de quatro requisições, contas distintas e fila liberada pelo Stop.');
  await fixturePool('deadline');httpMode='hold';held=[];const beforeDeadline=(await latest()).jobId;await selectArea();
  const timedOut=await waitFor('prazo global de 30s',async()=>{const j=await latest();return j.jobId!==beforeDeadline&&j.status==='error'&&j;},40000);
  assert.match(timedOut.error,/30s/);assert.ok(held.length<=4);held=[];
  console.log('Prazo global real de 30s aborta duas contas e o fallback; nenhuma narração tardia.');

  // A seleção de texto existente continua independente do Lens.
  const ctrlBText='Texto de regressão do Ctrl+B.';
  await content('document.querySelector("textarea").value='+JSON.stringify(ctrlBText)+';document.querySelector("textarea").focus();document.querySelector("textarea").select()');
  for(const type of ['rawKeyDown','keyUp'])await call('Input.dispatchKeyEvent',{type,key:'b',code:'KeyB',windowsVirtualKeyCode:66,modifiers:2},page);
  await waitFor('leitura de texto concluída',async()=>{const j=await latest();return !j.source&&j.status==='completed';});
  assert.equal((await latest()).text,ctrlBText);console.log('Ctrl+B continua narrando a seleção de texto.');
 }
 const modeResults=[{agent:'a',mode:'literal',text:completed.text,status:completed.status}];
 if(twoModes){
  const artifact=process.env.FALAMERMO_SELECTION_ARTIFACTS||temp;fs.mkdirSync(artifact,{recursive:true});
  const shot=await call('Page.captureScreenshot',{format:'png'},page);fs.writeFileSync(path.join(artifact,'two-modes-literal.png'),Buffer.from(shot.data,'base64'));
  for(const [id,mode] of [['a','interpret'],['b','interpret'],['b','literal']]){
   await chooseAgent(id);await call('Page.bringToFront',{},page);httpMode='success';const previous=(await latest()).jobId;
   await selectArea(true,mode);
   const result=await waitFor('resultado '+id+' '+mode,async()=>{const j=await latest();if(j.jobId===previous)return false;if(j.status==='error')throw Error(j.error);return j.status==='completed'&&j;},live?90000:15000);
   assert.equal(result.lensMode,mode);assert.equal(result.lensReadingInstruction,reading(id));
   if(mode==='literal')assert.equal(result.text,input);else{assert.ok(result.text.startsWith('Análise '+id.toUpperCase()+':'));assert.notEqual(result.text,input);}
   assert.equal(await hud('hud.querySelector(`[data-job-id="'+result.jobId+'"]`).textContent.includes('+JSON.stringify(mode==='literal'?'Leitura':'Análise')+')'),true);
   modeResults.push({agent:id,mode,text:result.text,status:result.status});
   const shot=await call('Page.captureScreenshot',{format:'png'},page);fs.writeFileSync(path.join(artifact,'two-modes-'+mode+'-'+id+'.png'),Buffer.from(shot.data,'base64'));
  }
  console.log('Mesma região e duas personas: Ctrl+Shift retorna OCR literal; Alt+Shift aplica interpretação A/B; quatro tarefas independentes concluídas.');
 }
 let noText;
 if(live||literalOnly){
  httpMode='empty';held=[];const previousCount=(await state()).jobs.length,previous=(await latest()).jobId;
  await content('document.querySelector("#text").textContent=""');await selectArea();
  noText=await waitFor('ausência de texto sem narração',async()=>{const j=await latest();if(j.jobId===previous)return false;if(j.status==='error')throw Error(j.error);return j.status==='completed'&&j;},live?40000:12000);
  assert.equal(noText.text,'');assert.equal(noText.warning,require('../live-config.js').SELECTION_NO_TEXT);
  assert.equal(await hud('hud.querySelector(`[data-job-id="'+noText.jobId+'"]`).textContent.includes("Nenhum texto legível")'),true);
  assert.equal((await state()).jobs.length,previousCount+1);
  await content('document.querySelector("#text").textContent='+JSON.stringify(input));
  console.log('Persona developer: OCR literal mantém perguntas, pontuação e quebras; região vazia informa ausência sem narração.');
 }
 const screenshot=await call('Page.captureScreenshot',{format:'png'},page);
 const proof=path.join(process.env.FALAMERMO_SELECTION_ARTIFACTS||temp,live?'selection-live.png':'selection-chrome.png');fs.mkdirSync(path.dirname(proof),{recursive:true});fs.writeFileSync(proof,Buffer.from(screenshot.data,'base64'));
 if(!live&&!literalOnly){
  await evaluate(worker,'chrome.storage.local.set('+JSON.stringify({api:{apiKeys:Array.from({length:9},(_,i)=>'fixture-detached-'+i)}})+')');
  httpMode='hold';held=[];const previous=(await latest()).jobId;await selectArea();
  const detached=await waitFor('análise antes de fechar origem',async()=>{const j=await latest();return j.jobId!==previous&&j.status==='analyzing'&&j;});
  await waitFor('duas imagens enviadas antes do fechamento',()=>held.length===2);
  await call('Target.closeTarget',{targetId});httpMode='success';for(const h of held.splice(0))await fulfill(h.event,h.session,true).catch(()=>{});
  await waitFor('narração concluída sem callback da página',async()=>{const j=(await state()).jobs.find(j=>j.jobId===detached.jobId);if(j.status==='error')throw Error(j.error);return j.status==='completed';});
  assert.equal((await state()).jobs.find(j=>j.jobId===detached.jobId).text,input);
  console.log('Fechar a aba após enviar a imagem conserva resultado e conclui narração no background.');
 }
 const evidence={mode:live?'live':'fixture',twoModes,modeResults,literalOnly,noText:noText?{status:noText.status,text:noText.text,warning:noText.warning}:undefined,jobId:firstId,statuses:[...new Set(snapshots.flatMap(s=>s.jobs.filter(j=>j.jobId===firstId).map(j=>j.status)))],result:completed.text,originalField:input,visionRequests:live?undefined:visionRequests};
 fs.writeFileSync(proof.replace(/\.png$/,'.json'),JSON.stringify(evidence,null,2));
 console.log('VERIFICADO; captura: '+proof);
})().catch(error=>{console.error(error.stack||error);console.error('Artefatos: '+temp);process.exitCode=1;}).finally(async()=>{server.close();if(chrome){const exited=chrome.exitCode===null&&chrome.signalCode===null?new Promise(resolve=>chrome.once('exit',resolve)):Promise.resolve();try{await call('Browser.close');}catch{chrome.kill();}await exited;}fs.rmSync(path.join(temp,'profile'),{recursive:true,force:true});for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Chrome encerrado'));}pending.clear();});
