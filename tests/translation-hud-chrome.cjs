'use strict';
// Chrome/MV3, seleção, microfone, VAD e AudioWorklets reais em perfil descartável.
// Gemini HTTP/WebSocket e o callback do menu são simulados; headless também usa callback do comando.
// Teclado nativo: FALAMERMO_HEADED=1 xvfb-run -a node tests/translation-hud-chrome.cjs
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),os=require('node:os'),path=require('node:path');
const {spawn,execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'falamermo-translation-hud-')),extension=path.join(temp,'extension');
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),pending=new Map(),contexts=new Map();
const original='Good morning. Keep code A-42.',translated='Bom dia. Mantenha o código A-42.';
let chrome,sequence=0,worker,held=[],httpMode='hold',httpCount=0;
const server=http.createServer((_req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><title>Tradução/HUD</title><textarea style="width:600px;height:160px">'+original+'</textarea>');});
function call(method,params={},sessionId){return new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('Timeout '+method));},15000);pending.set(id,{resolve,reject,timer});chrome.stdio[3].write(JSON.stringify({id,method,params,sessionId})+'\0');});}
async function evaluate(session,expression,contextId){const r=await call('Runtime.evaluate',{expression,contextId,awaitPromise:true,returnByValue:true,userGesture:true},session);if(r.exceptionDetails)throw Error(r.result.description||r.exceptionDetails.text);return r.result.value;}
async function waitFor(label,fn,timeout=15000){const end=Date.now()+timeout;do{const result=await fn();if(result)return result;await sleep(40);}while(Date.now()<end);throw Error('Estado não encontrado: '+label);}
async function attach(id){const {sessionId}=await call('Target.attachToTarget',{targetId:id,flatten:true});await call('Runtime.enable',{},sessionId);return sessionId;}
async function locate(url){return(await call('Target.getTargets')).targetInfos.find(t=>t.url===url);}
async function respond(event,session){const body=JSON.parse(event.request.postData);assert.equal(body.contents[0].parts[0].text,original);assert.match(body.systemInstruction.parts[0].text,/PT-BR/);httpCount++;if(httpMode==='hold'){held.push({event,session});return;}await call('Fetch.fulfillRequest',{requestId:event.requestId,responseCode:httpMode==='error'?503:200,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:translated}]}}]})).toString('base64')},session);}
function providerFixture(){
 const Native=globalThis.AudioContext;globalThis.AudioContext=class extends Native{constructor(options){super({...options,sinkId:{type:'none'}});}};
 globalThis.fixtureTurns=[];globalThis.fixtureTtsTexts=[];globalThis.fixtureSockets=[];
 globalThis.fixturePcm=()=>{const frames=new Int16Array(24000);for(let i=0;i<frames.length;i++)frames[i]=Math.sin(i*Math.PI*440/24000)*1000;const bytes=new Uint8Array(frames.buffer);let raw='';for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));return{modelTurn:{parts:[{inlineData:{mimeType:'audio/pcm;rate=24000',data:btoa(raw)}}]}};};
 globalThis.WebSocket=class{
  readyState=0;bufferedAmount=0;
  constructor(){fixtureSockets.push(this);queueMicrotask(()=>{this.readyState=1;this.onopen();});}
  receive(content){if(this.readyState===1)this.onmessage({data:JSON.stringify({serverContent:content})});}
  send(raw){const packet=JSON.parse(raw);if(packet.setup){this.fixtureSetup=packet.setup;this.dictation=Boolean(packet.setup.inputAudioTranscription);this.onmessage({data:JSON.stringify({setupComplete:{}})});return;}
   if(!this.dictation&&packet.clientContent){fixtureTtsTexts.push(packet.clientContent);fixtureTurns.push(this);return;}
   const input=packet.realtimeInput;if(this.dictation&&input?.audio&&!this.partial){this.partial=true;this.receive({interimInputTranscription:{text:'Ditado de teste'}});}
   if(this.dictation&&(input?.activityEnd||input?.audioStreamEnd)){this.partial=false;queueMicrotask(()=>this.receive({inputTranscription:{text:'Ditado de teste.',finished:true},turnComplete:true,interactionStatus:'IDLE'}));}
  }
  close(code,reason){this.readyState=3;queueMicrotask(()=>this.onclose?.({code,reason}));}
 };
}

(async()=>{
 fs.mkdirSync(extension);for(const name of fs.readdirSync(root))if(/\.(js|html|css|json)$/.test(name))fs.copyFileSync(path.join(root,name),path.join(extension,name));
 for(const name of ['icons','vad-assets'])fs.cpSync(path.join(root,name),path.join(extension,name),{recursive:true});
 if(process.argv.includes('--isolation')||process.argv.includes('--hud-controls')){const file=path.join(extension,'content.js');fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('exports.stt = new SttController();','globalThis.fixtureStt=exports.stt = new SttController();'));}
 if(process.argv.includes('--hud-notices')){const file=path.join(extension,'content.js');fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('exports.hud = HudController.getInstance();','globalThis.fixtureHudController=exports.hud = HudController.getInstance();'));}
 const manifest=JSON.parse(fs.readFileSync(path.join(extension,'manifest.json'),'utf8'));manifest.host_permissions.push('<all_urls>');fs.writeFileSync(path.join(extension,'manifest.json'),JSON.stringify(manifest));
 fs.writeFileSync(path.join(extension,'translation-provider.js'),'('+providerFixture.toString()+')();');const offscreenFile=path.join(extension,'offscreen.html');fs.writeFileSync(offscreenFile,fs.readFileSync(offscreenFile,'utf8').replace('<body>','<body><script src="translation-provider.js"></script>'));
 // Registra menus reais e guarda o callback para exercitar a mesma rota sem UI nativa headless.
 const background=path.join(extension,'background.js');fs.writeFileSync(background,`globalThis.fixtureMenus=[];const nativeCreate=chrome.contextMenus.create.bind(chrome.contextMenus);chrome.contextMenus.create=(item,...args)=>{fixtureMenus.push(item);return nativeCreate(item,...args);};const nativeListen=chrome.contextMenus.onClicked.addListener.bind(chrome.contextMenus.onClicked);chrome.contextMenus.onClicked.addListener=listener=>{globalThis.fixtureMenuClick=listener;nativeListen(listener);};const nativeCommand=chrome.commands.onCommand.addListener.bind(chrome.commands.onCommand);chrome.commands.onCommand.addListener=listener=>{globalThis.fixtureCommand=listener;nativeCommand(listener);};\n`+fs.readFileSync(background,'utf8'));
 const voice=Buffer.concat([fs.readFileSync(path.join(__dirname,'vad-go-sintetico.pcm')),Buffer.alloc(16000)]),header=Buffer.alloc(44);header.write('RIFF');header.writeUInt32LE(36+voice.length,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(16000,24);header.writeUInt32LE(32000,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(voice.length,40);const microphone=path.join(temp,'microphone.wav');fs.writeFileSync(microphone,Buffer.concat([header,voice]));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 chrome=spawn(process.env.FALAMERMO_CHROME||'google-chrome',[...(process.env.FALAMERMO_HEADED?['--ozone-platform=x11']:['--headless']),'--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--remote-debugging-pipe','--enable-unsafe-extension-debugging','--autoplay-policy=no-user-gesture-required','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--use-file-for-fake-audio-capture='+microphone,'--user-data-dir='+path.join(temp,'profile'),'about:blank'],{stdio:['ignore','ignore','pipe','pipe','pipe']});
 chrome.stderr.pipe(fs.createWriteStream(path.join(temp,'chrome.log')));let buffer='';chrome.stdio[4].on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\0'))>=0){const m=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);if(m.method==='Runtime.executionContextCreated'){const list=contexts.get(m.sessionId)||[];list.push(m.params.context);contexts.set(m.sessionId,list);}if(m.method==='Fetch.requestPaused')void respond(m.params,m.sessionId).catch(error=>{console.error(error);process.exitCode=1;});const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}}});
 console.log((await call('Browser.getVersion')).product);
 const {id}=await call('Extensions.loadUnpacked',{path:extension}),base='chrome-extension://'+id+'/';worker=await attach((await waitFor('service worker',()=>locate(base+'background.js'))).targetId);
 await waitFor('storage',()=>evaluate(worker,'typeof chrome!=="undefined"&&chrome.storage.local.get("agents").then(s=>!!s.agents)'));
 await evaluate(worker,'chrome.storage.local.set('+JSON.stringify({api:{apiKeys:Array.from({length:9},(_,i)=>'fixture-translation-'+i)},agents:{activeAgentId:'narrator',customAgents:[]},ui:{dictationInsertion:'final'}})+')');
 const menus=await evaluate(worker,'fixtureMenus');assert.ok(menus.length>0);assert.ok(menus.every(item=>item.title==='Narrar'&&!item.parentId));assert.equal((await evaluate(worker,'chrome.commands.getAll()')).find(command=>command.name==='translate_selection').shortcut,'Alt+Shift+Y');
 await call('Fetch.enable',{patterns:[{urlPattern:'https://generativelanguage.googleapis.com/*:generateContent*',requestStage:'Request'}]},worker);
 const pageUrl='http://127.0.0.1:'+server.address().port,{targetId}=await call('Target.createTarget',{url:pageUrl}),page=await attach(targetId);
 const isolated=await waitFor('content script',async()=>{for(const c of contexts.get(page)||[])if(!c.auxData?.isDefault&&await evaluate(page,'chrome.runtime?.id==='+JSON.stringify(id),c.id))return c.id;});
 const content=expression=>evaluate(page,expression,isolated),state=()=>evaluate(worker,'chrome.storage.session.get("falamermo.globalJobs.v1").then(s=>s["falamermo.globalJobs.v1"])');
 const hud=expression=>content('(()=>{const hud=document.querySelector("#ext-tts-stt-host").shadowRoot;return '+expression+'})()');
 const visible=()=>hud('!hud.querySelector(".ext-hud-card").classList.contains("hidden")');
 const minimized=()=>hud('hud.querySelector(".ext-hud-card").dataset.minimized==="true"');
 const compact=async label=>{await waitFor(label,async()=>await visible()&&await minimized());assert.deepEqual(await content('fixtureUnexpectedExpanded'),[],label+' não pode exibir o painel antes do estado compacto');};
 const expand=async()=>{await hud('hud.querySelector("#ext-btn-toggle").click()');await waitFor('expansão manual pelo raio',async()=>!await minimized());};
 const close=()=>hud('hud.querySelector("#ext-btn-close").click()');
 // Target ID CDP difere do ID inteiro da aba Chrome.
 const tabId=await evaluate(worker,'chrome.tabs.query({}).then(tabs=>tabs.find(t=>t.url?.startsWith('+JSON.stringify(pageUrl)+')).id)');
 const toggle=()=>evaluate(worker,'chrome.tabs.sendMessage('+tabId+',{type:"TOGGLE_HUD"})');
 const menu=async title=>{await content('document.querySelector("textarea").focus();document.querySelector("textarea").select()');await evaluate(worker,'void fixtureMenuClick({menuItemId:'+JSON.stringify('read_selection_menu')+',selectionText:'+JSON.stringify(original)+'},{id:'+tabId+',url:'+JSON.stringify(pageUrl)+'})');};
 const latest=async()=>((await state())?.jobs||[])[0];
 let audioSession,audioTarget;const audio=async()=>{const target=await waitFor('offscreen',()=>locate(base+'offscreen.html'));if(audioTarget!==target.targetId){audioTarget=target.targetId;audioSession=await attach(audioTarget);await waitFor('provider fixture',()=>evaluate(audioSession,'typeof fixtureTurns!=="undefined"'));}return audioSession;};
 const finishAudio=async jobId=>{await waitFor('turno TTS',async()=>evaluate(await audio(),'fixtureTurns.some(socket=>socket.readyState===1)'));await evaluate(await audio(),'fixtureTurns.splice(0).filter(socket=>socket.readyState===1).forEach(socket=>socket.receive({...fixturePcm(),turnComplete:true,interactionStatus:"IDLE"}))');let played=false;await waitFor('TTS concluído',async()=>{const job=(await state()).jobs.find(j=>j.jobId===jobId);if(job?.status==='playing'){played=true;assert.equal(await hud('hud.querySelector(".ext-hud-waveform,.fm-hud-player-wave")'),null);}if(job?.status==='error')throw Error(job.error);return job?.status==='completed';});assert.equal(played,true,'O PCM deve efetivamente entrar em reprodução antes da conclusão');};
 await waitFor('HUD montado',()=>hud('!!hud.querySelector(".fm-global-jobs")'));assert.equal(await visible(),false);
 await content('globalThis.fixtureUnexpectedExpanded=[];new MutationObserver(()=>{const h=document.querySelector("#ext-tts-stt-host").shadowRoot.querySelector(".ext-hud-card");if(!h.classList.contains("hidden")&&h.dataset.minimized!=="true")fixtureUnexpectedExpanded.push(h.dataset.minimized);}).observe(document.querySelector("#ext-tts-stt-host").shadowRoot.querySelector(".ext-hud-card"),{attributes:true,attributeFilter:["class","data-minimized"]})');
 let isolationCheck=async()=>{},originSwitchCheck=async()=>{},conflictCheck=async()=>{};
 if(process.argv.includes('--isolation')){
  const {targetId:aid}=await call('Target.createTarget',{url:pageUrl+'/witness'}),ap=await attach(aid);
  const created=await evaluate(worker,'chrome.windows.create({url:'+JSON.stringify(pageUrl+'/other-window')+'})');
  const cp=await attach((await waitFor('outra janela',()=>locate(pageUrl+'/other-window'))).targetId);
  const isolatedFor=async session=>waitFor('content isolado',async()=>{for(const c of contexts.get(session)||[])if(!c.auxData?.isDefault&&await evaluate(session,'chrome.runtime?.id==='+JSON.stringify(id),c.id))return c.id;});
  const ac=await isolatedFor(ap),cc=await isolatedFor(cp);
  if(process.argv.includes('--hud-notices'))conflictCheck=()=>require('./hud-conflict-chrome.cjs')({page,isolated,worker,tabId,views:[{session:ap,context:ac,url:pageUrl+'/witness'},{session:cp,context:cc,url:pageUrl+'/other-window'}],call,evaluate,waitFor,state,out:temp});
  const witness=async session=>evaluate(session,`(async()=>{const count=48000*120,b=new ArrayBuffer(44+count*2),v=new DataView(b),str=(at,s)=>[...s].forEach((c,i)=>v.setUint8(at+i,c.charCodeAt(0)));str(0,'RIFF');v.setUint32(4,36+count*2,true);str(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,48000,true);v.setUint32(28,96000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,count*2,true);for(let i=0;i<count;i++)v.setInt16(44+i*2,Math.sin(i*440*2*Math.PI/48000)*4,true);globalThis.witnessAudio=new Audio(URL.createObjectURL(new Blob([b],{type:'audio/wav'})));witnessAudio.volume=.23;await witnessAudio.play();await new Promise(r=>setTimeout(r,100));globalThis.witnessChanges=[];for(const e of ['volumechange','pause','playing','emptied'])witnessAudio.addEventListener(e,()=>witnessChanges.push(e));return witnessAudio.paused;})()`);
  assert.equal(await witness(ap),false);assert.equal(await witness(cp),false);
  await evaluate(ap,'chrome.runtime.sendMessage({type:"HUD_GLOBAL_UI_SET",payload:{visible:true}})',ac);
  isolationCheck=async()=>{for(const session of [ap,cp]){const a=await evaluate(session,'({volume:witnessAudio.volume,muted:witnessAudio.muted,paused:witnessAudio.paused,time:witnessAudio.currentTime,changes:witnessChanges})');assert.equal(a.volume,.23);assert.equal(a.muted,false);assert.equal(a.paused,false);assert.ok(a.time>0);assert.deepEqual(a.changes,[]);}assert.equal(await evaluate(ap,'!document.querySelector("#ext-tts-stt-host").shadowRoot.querySelector(".ext-hud-card").classList.contains("hidden")',ac),true);assert.equal(await evaluate(cp,'document.querySelector("#ext-tts-stt-host").shadowRoot.querySelector(".ext-hud-card").classList.contains("hidden")',cc),true);};
  originSwitchCheck=async()=>{const previous=(await latest()).jobId;const cid=await evaluate(worker,'chrome.tabs.query({}).then(t=>t.find(x=>x.url==='+JSON.stringify(pageUrl+'/other-window')+').id)');await evaluate(worker,'chrome.tabs.sendMessage('+cid+',{type:"CMD_READ_SELECTION",payload:{text:"Narração na outra janela."}})');const j=await waitFor('origem alternada',async()=>{const j=await latest();return j.jobId!==previous&&j;});assert.equal(j.origin.tabId,cid);assert.equal(await visible(),false);assert.equal(await evaluate(cp,'!document.querySelector("#ext-tts-stt-host").shadowRoot.querySelector(".ext-hud-card").classList.contains("hidden")',cc),true);await finishAudio(j.jobId);await waitFor('fechamento local na outra janela',()=>evaluate(cp,'document.querySelector("#ext-tts-stt-host").shadowRoot.querySelector(".ext-hud-card").classList.contains("hidden")',cc));await isolationCheck();console.log('VERIFICADO: origem alternada entre janelas; HUD secundário manual preservado; áudio HTML externo com volume .23 e reprodução contínua em ambas as janelas.');};
  await isolationCheck();
 }

 if(!process.argv.includes('--cycles-only')){
 await content('document.querySelector("textarea").focus();document.querySelector("textarea").select()');await call('Page.bringToFront',{},page);
 if(process.env.FALAMERMO_HEADED){
  // Entrada nativa no display isolado do xvfb-run; CDP não aciona comandos Chrome headless.
  execFileSync('python3',['-c',`import ctypes as c,time
x=c.CDLL('libX11.so.6');t=c.CDLL('libXtst.so.6')
x.XOpenDisplay.restype=c.c_void_p;x.XStringToKeysym.argtypes=[c.c_char_p];x.XStringToKeysym.restype=c.c_ulong;x.XKeysymToKeycode.argtypes=[c.c_void_p,c.c_ulong];x.XKeysymToKeycode.restype=c.c_uint;x.XFlush.argtypes=[c.c_void_p];t.XTestFakeKeyEvent.argtypes=[c.c_void_p,c.c_uint,c.c_int,c.c_ulong]
d=x.XOpenDisplay(None)
assert d,'Display X11 indisponível'
x.XDefaultRootWindow.argtypes=[c.c_void_p];x.XDefaultRootWindow.restype=c.c_ulong
x.XQueryTree.argtypes=[c.c_void_p,c.c_ulong,c.POINTER(c.c_ulong),c.POINTER(c.c_ulong),c.POINTER(c.POINTER(c.c_ulong)),c.POINTER(c.c_uint)]
x.XInternAtom.argtypes=[c.c_void_p,c.c_char_p,c.c_int];x.XInternAtom.restype=c.c_ulong
x.XGetWindowProperty.argtypes=[c.c_void_p,c.c_ulong,c.c_ulong,c.c_long,c.c_long,c.c_int,c.c_ulong,c.POINTER(c.c_ulong),c.POINTER(c.c_int),c.POINTER(c.c_ulong),c.POINTER(c.c_ulong),c.POINTER(c.c_void_p)]
x.XSetInputFocus.argtypes=[c.c_void_p,c.c_ulong,c.c_int,c.c_ulong];x.XRaiseWindow.argtypes=[c.c_void_p,c.c_ulong]
root=x.XDefaultRootWindow(d);r=c.c_ulong();parent=c.c_ulong();children=c.POINTER(c.c_ulong)();count=c.c_uint();x.XQueryTree(d,root,c.byref(r),c.byref(parent),c.byref(children),c.byref(count))
focused=False;titles=[]
for index in range(count.value):
 kind=c.c_ulong();fmt=c.c_int();n=c.c_ulong();remaining=c.c_ulong();value=c.c_void_p();x.XGetWindowProperty(d,children[index],x.XInternAtom(d,b'_NET_WM_NAME',0),0,1024,0,0,c.byref(kind),c.byref(fmt),c.byref(n),c.byref(remaining),c.byref(value))
 title=c.string_at(value,n.value) if value.value else b'';titles.append(title)
 if b'HUD' in title:
  x.XRaiseWindow(d,children[index]);x.XSetInputFocus(d,children[index],1,0);x.XFlush(d);focused=True;break
assert focused,repr(titles)
time.sleep(.2)
keys=[x.XKeysymToKeycode(d,x.XStringToKeysym(name)) for name in [b'Alt_L',b'Shift_L',b'y']]
for key in keys:t.XTestFakeKeyEvent(d,key,1,0);x.XFlush(d);time.sleep(.05)
for key in reversed(keys):t.XTestFakeKeyEvent(d,key,0,0);x.XFlush(d);time.sleep(.05)
`]);
 }else await evaluate(worker,'void fixtureCommand("translate_selection",{id:'+tabId+',url:'+JSON.stringify(pageUrl)+'})');
 const translation=await waitFor('traduzindo',async()=>{const j=await latest();return j?.status==='translating'&&j;});
 await compact('tradução abre somente a barra');assert.equal(translation.collapsed,false);await waitFor('requisições de tradução',()=>held.length>0);
 const requests=held.splice(0);httpMode='success';for(const request of requests)await respond(request.event,request.session).catch(()=>{});
 await waitFor('tradução alimenta TTS',async()=>evaluate(await audio(),'fixtureTtsTexts.length>0'));assert.ok(JSON.stringify(await evaluate(await audio(),'fixtureTtsTexts')).includes(translated));assert.equal(await content('document.querySelector("textarea").value'),original);await finishAudio(translation.jobId);assert.equal((await state()).jobs.length,1);
 await isolationCheck();console.log('VERIFICADO: somente Narrar no menu, sem submenu; '+(process.env.FALAMERMO_HEADED?'teclado nativo Alt+Shift+Y':'comando translate_selection (callback)')+' aciona tradução; traduzindo → conectando → reprodução → concluído; uma tarefa e campo preservado.');
 await close();await menu('Narrar');let narration=await waitFor('Narrar com HUD fechado',async()=>{const j=await latest();return j.jobId!==translation.jobId&&j;});await compact('narração abre somente a barra');assert.equal(narration.collapsed,false);assert.ok((await state()).jobs.filter(j=>j.jobId!==narration.jobId).every(j=>j.collapsed));await expand();await finishAudio(narration.jobId);
 for(let i=0;i<4;i++){const previous=narration.jobId;await menu('Narrar');narration=await waitFor('narração '+i,async()=>{const j=await latest();return j.jobId!==previous&&j;}).catch(async e=>{console.error(JSON.stringify((await state()).jobs.slice(0,2).map(j=>({status:j.status,error:j.error,jobId:j.jobId}))));throw e;});assert.equal(await minimized(),false,'nova narração preserva expansão manual');await finishAudio(narration.jobId);}
 console.log('VERIFICADO: tradução e narração abrem compactas sem expansão transitória; novas narrações preservam expansão explícita pelo raio.');
 assert.equal((await state()).jobs.length,6);assert.equal(await hud('hud.querySelectorAll(".fm-global-card:not([hidden])").length'),4);
 assert.deepEqual(await hud('[...hud.querySelectorAll(".fm-global-card:not([hidden])")].map(n=>n.dataset.jobId)'),(await state()).jobs.slice(0,4).map(j=>j.jobId));
 await hud('hud.querySelector(".fm-global-card [data-action=collapse]").click()');await waitFor('expansão manual',async()=>!(await latest()).collapsed);await hud('hud.querySelector(".fm-global-card [data-action=collapse]").click()');await waitFor('recolhimento manual',async()=>(await latest()).collapsed);
 const {targetId:optionsId}=await call('Target.createTarget',{url:base+'options.html'}),optionsSession=await attach(optionsId);await waitFor('histórico nas Opções',()=>evaluate(optionsSession,'document.querySelectorAll("#historyList .list-item").length>=6||document.querySelector("#historyList")?.textContent.includes("Good morning")'));assert.equal(await evaluate(worker,'chrome.storage.local.get("history").then(s=>s.history.recentItems.length)'),6);
 await isolationCheck();console.log('VERIFICADO: Narrar preservado; quatro cards e seis tarefas/resultados no histórico; expansão/recolhimento manual.');
 const firstPrevious=narration.jobId;await menu('Narrar');const simultaneousA=await waitFor('primeira simultânea',async()=>{const j=await latest();return j.jobId!==firstPrevious&&j;});await menu('Narrar');const simultaneousB=await waitFor('segunda simultânea',async()=>{const j=await latest();return j.jobId!==simultaneousA.jobId&&j;});assert.equal(simultaneousB.collapsed,false);assert.equal((await state()).jobs.find(j=>j.jobId===simultaneousA.jobId).collapsed,true);
 await close();await evaluate(await audio(),'chrome.runtime.sendMessage({type:"LIVE_OFFSCREEN_EVENT",payload:'+JSON.stringify({jobId:translation.jobId,event:'play',eventSeq:999})+'})');assert.equal(await visible(),false);await finishAudio(simultaneousB.jobId);const previousAudio=(await state()).jobs.find(j=>j.jobId===simultaneousA.jobId);if(previousAudio.status==='paused')await content('chrome.runtime.sendMessage({type:"HUD_GLOBAL_COMMAND",payload:'+JSON.stringify({jobId:simultaneousA.jobId,requestId:previousAudio.requestId,action:'resume'})+'})');await waitFor('primeira simultânea concluída',async()=>(await state()).jobs.find(j=>j.jobId===simultaneousA.jobId).status==='completed');assert.equal(await visible(),false);narration=await latest();
 await isolationCheck();console.log('VERIFICADO: tarefas simultâneas, destaque da mais nova, fechamento manual e evento atrasado sem reabertura.');

 const previous=narration.jobId;await menu('Narrar');narration=await waitFor('nova atividade cancela timer',async()=>{const j=await latest();return j.jobId!==previous&&j;});await sleep(5200);assert.equal(await visible(),true);await finishAudio(narration.jobId);const deadline=(await state()).hudAutomation.closeAt;assert.ok(deadline>Date.now());await sleep(Math.max(0,deadline-Date.now()-300));assert.equal(await visible(),true);await waitFor('fechamento após 5s',async()=>!await visible());
 assert.ok(Date.now()>=deadline);await toggle();await waitFor('consulta manual confirmada pelo serviço',visible);await sleep(5200);assert.equal(await visible(),true);
 await isolationCheck();console.log('VERIFICADO: timer cancelado por nova tarefa, HUD permanece durante geração, fecha após 5s e consulta manual permanece aberta.');
 await call('Page.bringToFront',{},page);await close();await waitFor('ocultação confirmada antes do ditado',async()=>!await visible());await content('fixtureUnexpectedExpanded=[];document.querySelector("textarea").value="";document.querySelector("textarea").focus()');
 await evaluate(worker,'chrome.tabs.sendMessage('+tabId+',{type:"CMD_START_DICTATION"})');const stt=await waitFor('gravação STT',async()=>{const j=await latest();return j?.type==='STT'&&j.status==='recording'&&j;},30000);
 await compact('ditado abre somente a barra');assert.equal(stt.collapsed,false);await expand();await waitFor('waveform reage à captura real',()=>hud('hud.querySelector('+JSON.stringify('[data-job-id="'+stt.jobId+'"] .fm-hud-task-wave')+').dataset.active==="true"'));
 if(process.argv.includes('--task-floats'))await require('./task-float-stt-chrome.cjs')({stage:'recording',stt,call,evaluate,page,content,hud,state,worker,tabId,audio,waitFor});
 await conflictCheck();
 if(process.argv.includes('--hud-controls')){
  await waitFor('microfone e AudioWorklet em captura',()=>content('fixtureStt.isRecording&&fixtureStt.liveCapture?.context?.state==="running"&&fixtureStt.liveCapture.stream.getTracks().every(t=>t.readyState==="live")'),30000);
  assert.equal(await hud('hud.querySelector("[data-job-id=\\"'+stt.jobId+'\\"] .fm-hud-metrics").open'),false);
  await waitFor('telemetria do VAD real',()=>hud('!!hud.querySelector("[data-job-id=\\"'+stt.jobId+'\\"] [data-field=\\"vad.sileroProbability\\"]")'),30000);
  await hud('hud.querySelector("[data-job-id=\\"'+stt.jobId+'\\"] .fm-hud-metrics summary").click()');
  const position=await hud('({right:hud.querySelector(".ext-hud-card").style.right,bottom:hud.querySelector(".ext-hud-card").style.bottom})'),cards=(await state()).jobs.map(j=>[j.jobId,j.collapsed]);
  for(const minimized of [true,false]){await hud('hud.querySelector("#ext-btn-toggle").click()');await waitFor('raio durante microfone ativo',()=>hud('hud.querySelector(".ext-hud-card").dataset.minimized==='+JSON.stringify(String(minimized))));assert.equal(await content('fixtureStt.isRecording&&fixtureStt.liveCapture.stream.getTracks().every(t=>t.readyState==="live")'),true);assert.equal((await state()).jobs.find(j=>j.jobId===stt.jobId).status,'recording');}
  assert.deepEqual(await hud('({right:hud.querySelector(".ext-hud-card").style.right,bottom:hud.querySelector(".ext-hud-card").style.bottom})'),position);assert.deepEqual((await state()).jobs.map(j=>[j.jobId,j.collapsed]),cards);
  console.log('VERIFICADO: raio minimiza/restaura durante captura real com microfone virtual, sem encerrar trilhas, mudar cartões ou alterar posição.');
 }
 await sleep(5200);assert.equal(await visible(),true);
 await waitFor('pacotes reais visíveis no card',()=>hud('Number(hud.querySelector('+JSON.stringify('[data-job-id="'+stt.jobId+'"] .fm-hud-chip[data-field="capturedChunks"]')+')?.textContent)>0'));
 assert.equal(await hud('hud.querySelector(".fm-global-partial").parentNode.className'),'fm-hud-transcript');
 await evaluate(worker,'chrome.tabs.sendMessage('+tabId+',{type:"CMD_START_DICTATION"})');await waitFor('STT finalizado e inserido',async()=>{const j=(await state()).jobs.find(j=>j.jobId===stt.jobId);return j.status==='completed'&&j.insertion?.inserted;},30000);assert.match(await content('document.querySelector("textarea").value'),/Ditado de teste/);
 if(process.argv.includes('--task-floats'))await require('./task-float-stt-chrome.cjs')({stage:'completed',stt,call,evaluate,page,content,hud,state,worker,tabId,audio,waitFor});
 await waitFor('waveform encerra com captura',()=>hud('hud.querySelector('+JSON.stringify('[data-job-id="'+stt.jobId+'"] .fm-hud-task-wave')+').dataset.active==="false"'));await sleep(5200);assert.equal(await visible(),true);await close();await waitFor('somente ocultação explícita fecha HUD',async()=>!await visible());assert.equal((await state()).jobs.length,10);
 if(process.argv.includes('--hud-controls'))assert.equal(await hud('hud.querySelector("[data-job-id=\\"'+stt.jobId+'\\"] .fm-hud-metrics").open'),true,'fim do ditado preserva expansão explícita');
 await isolationCheck();console.log('VERIFICADO: STT com HUD fechado, microfone/VAD reais de teste, gravação além de 5s, waveform encerrada, HUD manual persistente, inserção e histórico preservados.');
 }
 if(process.argv.includes('--isolation')){
  for(const mode of ['normal','cancel','context-close']){
   await content('document.querySelector("textarea").focus();fixtureStt.startLiveRecording("narrator")');await waitFor('ciclo de captura '+mode,()=>content('fixtureStt.isRecording'),30000);await isolationCheck();await sleep(1200);
   if(mode==='normal')await content('fixtureStt.stopLiveRecording()');else if(mode==='cancel')await content('fixtureStt.cancelRecording()');else await content('fixtureStt.liveCapture.context.close()');
   await waitFor('liberação '+mode,()=>content('!fixtureStt.liveCapture'),30000);await waitFor('terminal '+mode,async()=>['completed','cancelled','error'].includes((await latest()).status),30000);await isolationCheck();
  }
  await waitFor('HUD após ciclos',async()=>!await visible()).catch(async e=>{console.error(JSON.stringify((await state()).jobs.slice(0,3).map(j=>({status:j.status,progress:j.progress,microphoneReleased:j.microphoneReleased,captureAdmission:j.captureAdmission}))));throw e;});console.log('VERIFICADO: áudio externo preservado em ciclos STT normal, cancelado e AudioContext interrompido.');
 }
 await originSwitchCheck();
 const proof=path.join(temp,'translation-hud.png'),shot=await call('Page.captureScreenshot',{format:'png'},page);fs.writeFileSync(proof,Buffer.from(shot.data,'base64'));fs.writeFileSync(path.join(temp,'results.json'),JSON.stringify({provider:'fixture',httpCount,jobs:(await state()).jobs.map(j=>({jobId:j.jobId,type:j.type,status:j.status,text:j.text})),proof},null,2));console.log('Artefatos: '+temp);
})().catch(error=>{console.error(error.stack||error);console.error('Artefatos: '+temp);process.exitCode=1;}).finally(async()=>{server.close();if(chrome){const exited=chrome.exitCode===null&&chrome.signalCode===null?new Promise(resolve=>chrome.once('exit',resolve)):Promise.resolve();try{await call('Browser.close');}catch{chrome.kill();}await exited;}fs.rmSync(path.join(temp,'profile'),{recursive:true,force:true});for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Chrome encerrado'));}pending.clear();});
