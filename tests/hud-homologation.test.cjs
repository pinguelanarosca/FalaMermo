'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=process.env.FALAMERMO_HUD_SOURCE||path.resolve(__dirname,'..');
const Jobs=require(path.join(root,'global-jobs.js'));
function controller(extra={}){
 const context=vm.createContext({console,GlobalHud:{},...extra});
 vm.runInContext(fs.readFileSync(path.join(root,'content.js'),'utf8').replace('__require("extension/src/content/entrypoint.ts");','globalThis.modules=__modules;'),context);
 const m={exports:{}};context.modules['extension/src/content/ui/hudController.ts'](m,m.exports,()=>({}));return m.exports.hud;
}
function clock(){
 let now=1000,serial=0;const timers=new Map(),data={};
 const services={now:()=>now,setTimeout(fn,ms){const id=++serial;timers.set(id,{fn,at:now+ms});return id;},clearTimeout:id=>timers.delete(id),storage:{get:async key=>({[key]:structuredClone(data[key])}),set:async values=>Object.assign(data,structuredClone(values))}};
 const registry=Jobs.create(services);return{registry,services,async advance(ms){now+=ms;for(const[id,t]of [...timers])if(t.at<=now){timers.delete(id);t.fn();}await registry.get();}};
}
const origin={tabId:7,frameId:0,documentId:'page-7'};
test('barra recebe só atributos visuais da tarefa em execução e volta ao neutro',()=>{
 const hud=controller({GlobalHud:require('../global-hud.js')});hud.rail={dataset:{}};
 const jobs=[{jobId:'recording',type:'STT',status:'recording',createdAt:1},{jobId:'playing',type:'TTS',status:'playing',createdAt:2}];hud.applyGlobalState({revision:1,visible:true,minimized:true,jobs,hudTaskId:'recording'});assert.equal(hud.rail.dataset.taskType,'narration');assert.equal(hud.rail.dataset.borderJobId,'playing');assert.equal(hud.rail.dataset.taskRunning,'true');
 hud.applyGlobalState({revision:2,visible:true,minimized:true,jobs:jobs.map(j=>({...j,status:'paused'}))});assert.equal(hud.rail.dataset.taskType,'neutral');assert.equal(hud.rail.dataset.taskRunning,'false');assert.equal(hud.rail.dataset.borderJobId,'');
});
test('abertura antecipada do content aguarda estado autoritativo compacto e não marca decisão manual',async()=>{
 const e=clock(),r=e.registry;await r.attachHud(origin);const messages=[];
 const hud=controller({chrome:{runtime:{sendMessage:async message=>{messages.push(message);return{success:true,state:Jobs.forHud(await r.ui(message.payload,7),7)};}}}});
 let localReveal=false;hud.container={classList:{remove:()=>{localReveal=true;}}};hud.applyGlobalState=()=>{};
 await hud.show({tabOnly:true,expand:true});assert.equal(localReveal,false);assert.equal(messages.length,1);assert.equal(messages[0].payload.automatic,true);assert.equal(messages[0].payload.minimized,true);assert.equal(Jobs.forHud(await r.get(),7).minimized,true);
 await r.ui({toggleMinimized:true},7);await hud.show();assert.equal(Jobs.forHud(await r.get(),7).minimized,false);
 await r.start({jobId:'next',type:'STT',origin});assert.equal(Jobs.forHud(await r.get(),7).minimized,false);
 await r.ui({visible:false},7);await hud.show({manual:true,expand:true});assert.equal(Jobs.forHud(await r.get(),7).minimized,true,'mostrar o HUD não expande o painel; expansão exige raio');
});
test('contexto invalidado mantém aviso local acessível sem expandir painel compacto',async()=>{
 const hud=controller({chrome:{runtime:{sendMessage:async()=>{throw Error('Extension context invalidated.');}}}}),attrs={},body={},notices=[];
 let revealed=false;hud.globalMinimized=false;hud.container={setAttribute:(key,value)=>attrs[key]=value,classList:{contains:()=>true,remove:()=>{revealed=true;}},querySelectorAll:()=>[body]};hud.globalView={notice:text=>notices.push(text)};
 await hud.show();assert.equal(revealed,true);assert.equal(hud.container.inert,false);assert.equal(attrs['data-minimized'],'true');assert.equal(body.hidden,true);assert.match(notices.at(-1),/F5/);
});
test('abertura manual sobrevive a novos ditados, fim, timer e reinício do registry',async()=>{
 const e=clock(),r=e.registry;await r.attachHud(origin);await r.ui({visible:true},7);
 for(let i=0;i<2;i++){
  const jobId='dictation-'+i;await r.start({jobId,type:'STT',origin});await r.event({jobId,event:'setup-complete',eventSeq:1});assert.equal(Jobs.forHud(await r.get(),7).visible,true);
  await r.event({jobId,event:'stt-final',text:'Texto preservado.',eventSeq:2});await r.insertion({jobId,inserted:true},origin);await e.advance(6000);assert.equal(Jobs.forHud(await r.attachHud(origin),7).visible,true);
 }
 const restarted=Jobs.create(e.services);assert.equal(Jobs.forHud(await restarted.attachHud(origin),7).visible,true);await restarted.ui({visible:false},7);assert.equal(Jobs.forHud(await restarted.get(),7).visible,false);
});
test('mudança global de apresentação não perde documentId nem fecha HUD ao recuperar foco',async()=>{
 const e=clock(),r=e.registry;await r.attachHud(origin);await r.ui({visible:true},7);await r.ui({minimized:true});
 assert.equal((await r.get()).tabHud[7].documentId,origin.documentId);assert.equal(Jobs.forHud(await r.attachHud(origin),7).visible,true);
 await r.ui({minimized:false});await r.ui({visible:false,automatic:true},7);assert.equal(Jobs.forHud(await r.attachHud(origin),7).visible,true);
 await r.ui({visible:false},7);assert.equal(Jobs.forHud(await r.attachHud(origin),7).visible,false);
});
test('restrição da viewport é idempotente mesmo com gutter e contendo medidas diferentes',()=>{
 const style={right:'60px',bottom:'30px'},hud=controller({window:{innerWidth:1000,innerHeight:800},document:{documentElement:{clientWidth:985,clientHeight:800}}});
 hud.panel={};hud.notices={style:{},getBoundingClientRect:()=>({width:280,height:0})};hud.container={style,getBoundingClientRect:()=>({left:1000-Number.parseFloat(style.right)-448,right:1000-Number.parseFloat(style.right),top:800-Number.parseFloat(style.bottom)-320,bottom:800-Number.parseFloat(style.bottom),width:448,height:320})};hud.posX=60;hud.posY=30;
 for(let i=0;i<100;i++)hud.constrainPosition();assert.equal(Number.parseFloat(style.right),60);assert.equal(Number.parseFloat(style.bottom),30);
});
test('contenção do arraste usa superfícies visíveis em vez da altura persistente vazia',()=>{
 const style={right:'24px',bottom:'24px'},hud=controller({window:{innerWidth:1000,innerHeight:800},document:{documentElement:{clientWidth:985,clientHeight:800}}});
 const rect=()=>({left:985-parseFloat(style.right)-448,right:985-parseFloat(style.right),top:800-parseFloat(style.bottom)-700,bottom:800-parseFloat(style.bottom),width:448,height:700});
 hud.container={style,dataset:{minimized:'false'},getBoundingClientRect:rect};hud.panel={offsetLeft:0,offsetTop:480,offsetWidth:392,offsetHeight:220};hud.rail={getBoundingClientRect:()=>{const r=rect();return{left:r.right-46,right:r.right,top:r.bottom-250,bottom:r.bottom,width:46,height:250};}};hud.notices={style:{},getBoundingClientRect:()=>({width:280,height:0})};hud.posX=24;hud.posY=24;hud.reducedMotion=true;
 hud.moveHud(-70,-180);assert.equal(parseFloat(style.right),94);assert.equal(parseFloat(style.bottom),204,'área vazia do envelope não bloqueia subida');
 for(let i=0;i<30;i++)hud.constrainPosition();assert.equal(parseFloat(style.bottom),204);
 hud.moveHud(0,-1000);const r=hud.rail.getBoundingClientRect();assert.equal(r.top,12,'barra continua limitada à viewport');
});
test('clique é capturado no HUD inteiro, sem depender do botão alvo ou de foco',async()=>{
 const events=[],sent=[],hud=controller({chrome:{runtime:{sendMessage:async message=>{sent.push(message);return{success:true};}}}});
 hud.setupListeners({addEventListener:(type,fn,capture)=>events.push({type,fn,capture}),querySelector:()=>null});
 const click=events.find(e=>e.type==='click');assert.ok(click);assert.equal(click.capture,true);for(const target of ['texto','cartão','indicador','vazio','barra'])await click.fn({target});assert.equal(sent.length,5);assert.ok(sent.every(m=>m.payload.interaction===true&&m.payload.scope==='tab'));assert.ok(events.every(e=>e.type!=='focus'&&e.type!=='blur'));
});
test('aviso de microfone dura 8s sem duplicar, reiniciar ou ser apagado por status; pode ser dispensado',()=>{
 const timers=new Map(),messages=[],span={},notice={hidden:true,querySelector:()=>span},capture={};let serial=0;
 const hud=controller({setTimeout:(fn,ms)=>{const id=++serial;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),chrome:{runtime:{sendMessage:async()=>({success:true})}}});
 hud.container={querySelector:selector=>selector==='#ext-microphone-notice'?notice:capture};hud.updateGlobalUi=payload=>messages.push(payload);
 hud.showMicrophoneBusyNotice('O microfone já está em uso na aba “ChatGPT”.');const timer=[...timers.values()][0];assert.equal(timer.ms,8000);assert.equal(notice.hidden,false);
 hud.showMicrophoneBusyNotice('Conflito repetido');hud.setCaptureNotice('');hud.setStatus('loading','Conectando ditado');assert.equal(timers.size,1);assert.equal(span.textContent,'O microfone já está em uso na aba “ChatGPT”.');assert.equal(notice.hidden,false);
 timer.fn();assert.equal(notice.hidden,true);assert.equal(timers.size,0);hud.showMicrophoneBusyNotice();assert.match(span.textContent,/O microfone já está sendo usado por outro ditado/);hud.dismissMicrophoneNotice();assert.equal(notice.hidden,true);assert.equal(timers.size,0);assert.ok(messages.every(p=>p.visible===true));
});
test('contêiner não monta mais nenhuma waveform global',()=>{
 const source=fs.readFileSync(path.join(root,'content.js'),'utf8');assert.doesNotMatch(source,/class="ext-hud-waveform"/);
});
test('telemetria é encaminhada ao job no canal de captura, sem apagar avisos',async()=>{
 const messages=[],hud=controller({chrome:{runtime:{sendMessage:async m=>{messages.push(m);return{success:true};}}}});
 const sample={jobId:'one',sileroProbability:.123456789,tenProbability:.987654321,confirmed:false,recoveries:7};
 await hud.setCaptureTelemetry(sample);assert.deepEqual(JSON.parse(JSON.stringify(messages[0])),{type:'HUD_CAPTURE_STATE',payload:{jobId:'one',captureTelemetry:sample}});
 await hud.setCaptureTelemetry(null);assert.equal(messages.length,1);
});
test('viewport pequena limita apenas o CSS, preservando a dimensão global preferida',()=>{
 const values=new Map(),hud=controller({document:{documentElement:{clientWidth:360,clientHeight:300}}});hud.container={dataset:{},style:{setProperty:(k,v)=>values.set(k,v)}};hud.queueLayout=()=>{};
 hud.applySize({width:640,height:720});assert.equal(hud.hudSize.width,640);assert.equal(hud.hudSize.height,720);assert.equal(values.get('--hud-width'),'336px');assert.equal(values.get('--hud-height'),'252px');
});
