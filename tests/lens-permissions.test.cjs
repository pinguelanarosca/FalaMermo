const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),flush=()=>new Promise(r=>setImmediate(r));
const url='https://example.test/page',nativePermissionError="Either the '<all_urls>' or 'activeTab' permission is required.";
function bundle(state={}){
 const data={},notifications=[],playbacks=[],captures=[],pages=[],vision=[],logs=[],history=[],target={id:5,windowId:7,active:true,url};let reads=0;
 const chrome={storage:{session:{async get(key){return{[key]:data[key]};},async set(value){Object.assign(data,structuredClone(value));}}},runtime:{getURL:file=>'chrome-extension://test/'+file,async sendMessage(message){notifications.push(message);return{success:true};}},permissions:{request(){throw Error('request proibido no background');}},tabs:{async get(id){assert.equal(id,5);return state.tab?.(++reads,{...target})||target;},async captureVisibleTab(windowId,options){captures.push({windowId,options});if(state.denied)throw Error(nativePermissionError);return'data:image/jpeg;base64,aW1hZ2Vt';},async create(properties){pages.push(properties);return{id:9};}}};
 const context=vm.createContext({chrome,structuredClone,AbortController,console,setTimeout:(callback,ms)=>{if(state.timers&&ms===30000){state.timers.push(callback);return {fixtureTimer:true};}return setTimeout(callback,ms);},clearTimeout:timer=>{if(!timer?.fixtureTimer)clearTimeout(timer);},Date});
 vm.runInContext(require('./load-background.cjs')(path.join(root,'background.js')).replace('__require("extension/src/background/index.ts");','globalThis.factories=__modules;'),context);
 const cache={};const overrides={
  'extension/src/services/storage/chromeStorageAdapter.ts':{chromeStorage:{async getMany(){return{api:{apiKey:'fake-only'},audio:{},agents:{customAgents:[{metadata:{id:'custom'},instructions:{lensInspectionInstruction:'Instrução preservada'},modelPreferences:{visionModelId:'vision-preserved'}}]},models:{}};},async get(){return{enabled:true,maxEntries:50,recentItems:[]};},async update(_key,callback){history.push(callback({recentItems:[]}));}}},
  'extension/src/services/backgroundPlayback.ts':{hasDocument:async()=>false,async handlePlaybackCommand(payload){playbacks.push(payload);return{success:true};}},
  'extension/src/services/diagnosticLogger.ts':{async logDiagnostic(packet){logs.push(packet);}},
  'extension/src/services/geminiDirectClient.ts':{geminiDirectClient:{async inspectVisionContext(...args){vision.push(args);if(state.vision) return state.vision(...args);return'Descrição existente';}}},
 };
 function load(id){if(overrides[id])return overrides[id];if(cache[id])return cache[id].exports;const module=cache[id]={exports:{}};context.factories[id](module,module.exports,load);return module.exports;}
 const router=load('extension/src/background/messageRouter.ts');
 return{data,notifications,playbacks,router,captures,pages,vision,logs,history,run:()=>router.handleExtensionMessage({type:'LENS_ANALYZE_REQUEST',payload:{agentId:'custom'}},{url,tab:target})};
}
test('manifest declara all_urls somente como host opcional, preservando obrigatórias',()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));assert.deepEqual(manifest.optional_host_permissions,['<all_urls>']);assert.deepEqual(manifest.host_permissions,['https://generativelanguage.googleapis.com/*']);assert.ok(manifest.permissions.includes('activeTab'));assert.ok(!manifest.permissions.includes('<all_urls>'));
});
test('recusa de permissão simulada encaminha para UI própria, sem request no background/imagem Gemini',async()=>{
 const env=bundle({denied:true}),result=await env.run();assert.equal(result.code,'LENS_CAPTURE_PERMISSION_REQUIRED');assert.equal(result.success,false);assert.equal(env.vision.length,0);assert.equal(env.captures[0].windowId,7);assert.equal(env.pages.length,1);assert.equal(env.pages[0].url,'chrome-extension://test/lens-permission.html?tabId=5');assert.equal(env.pages[0].windowId,7);assert.equal(env.logs.some(x=>x.level==='error'),false);assert.equal(env.history.length,0);assert.ok(!result.error.includes(nativePermissionError));
});
test('captura autorizada mantém imagem, instrução, chave/modelo e análise existente',async()=>{
 const env=bundle(),result=await env.run();assert.equal(result.success,true);assert.equal(result.data,'Descrição existente');assert.equal(env.pages.length,0);assert.equal(env.captures.length,1);assert.equal(env.captures[0].windowId,7);assert.deepEqual(JSON.parse(JSON.stringify(env.captures[0].options)),{format:'jpeg',quality:90});const [...args]=env.vision[0];const {signal,...visionOptions}=args.pop();assert.equal(signal.aborted,false);args.push(visionOptions);assert.deepEqual(JSON.parse(JSON.stringify(args)),['aW1hZ2Vt',require('../live-config.js').LITERAL_SELECTION_OCR,{apiKey:'fake-only'},'vision-preserved',{selectionMode:'literal',literalOcr:true,agentId:'custom',mimeType:'image/jpeg'}]);
});
test('aba inativa/navegando/mudada não é capturada nem enviada',async()=>{
 for(const override of [{active:false},{url:'https://other.test/'},{pendingUrl:'https://other.test/'}]){const env=bundle({tab:(_n,t)=>({...t,...override})}),result=await env.run();assert.equal(result.code,'LENS_TAB_CHANGED');assert.equal(env.captures.length,0);assert.equal(env.vision.length,0);assert.equal(env.pages.length,0);}
});
test('troca de aba após captureVisibleTab descarta imagem sem chamar Gemini',async()=>{
 for(const override of [{active:false},{url:'https://other.test/'},{windowId:8}]){const env=bundle({tab:(n,t)=>n===1?t:{...t,...override}}),result=await env.run();assert.equal(result.code,'LENS_TAB_CHANGED');assert.equal(env.captures.length,1);assert.equal(env.vision.length,0);}
});
test('autorização concedida continua funcionando após recriar o worker',async()=>{
 const state={denied:true};assert.equal((await bundle(state).run()).code,'LENS_CAPTURE_PERMISSION_REQUIRED');state.denied=false;const reloaded=bundle(state);assert.equal((await reloaded.run()).success,true);assert.equal(reloaded.pages.length,0);
});
function permissionPage(allowed=false,denied=false){
 const elements=Object.fromEntries(['grant','back','status'].map(id=>[id,{disabled:true,textContent:'',handlers:{},addEventListener(type,fn){this.handlers[type]=fn;}}])),requests=[],updates=[];let gesture=false;
 const context=vm.createContext({URL,location:{href:'chrome-extension://test/lens-permission.html?tabId=5'},document:{querySelector:id=>elements[id.slice(1)]},chrome:{permissions:{contains:async()=>allowed,request(packet){assert.equal(gesture,true,'request precisa acontecer diretamente no clique');requests.push(packet);return Promise.resolve(!denied);}},tabs:{async update(...args){updates.push(args);}}}});
 vm.runInContext(fs.readFileSync(path.join(root,'lens-permission.js'),'utf8'),context);
 return{elements,requests,updates,click(id){gesture=true;try{return elements[id].handlers.click();}finally{gesture=false;}}};
}
test('UI solicita somente no clique próprio, sem await antes; concede sem capturar',async()=>{
 const page=permissionPage();await flush();assert.equal(page.requests.length,0);assert.equal(page.elements.grant.disabled,false);page.click('grant');assert.equal(page.requests.length,1);assert.deepEqual(JSON.parse(JSON.stringify(page.requests[0])),{origins:['<all_urls>']});await flush();assert.match(page.elements.status.textContent,/Nenhuma imagem foi capturada/);assert.equal(page.elements.grant.disabled,true);assert.equal(page.updates.length,0);await page.click('back');assert.deepEqual(JSON.parse(JSON.stringify(page.updates)),[[5,{active:true}]]);
});
test('UI trata negação e autorização já existente sem solicitar novamente',async()=>{
 const denied=permissionPage(false,true);await flush();denied.click('grant');await flush();assert.match(denied.elements.status.textContent,/Permissão não concedida/);assert.match(denied.elements.status.textContent,/Nenhuma imagem/);assert.equal(denied.elements.grant.disabled,false);
 const allowed=permissionPage(true);await flush();assert.equal(allowed.elements.grant.disabled,true);assert.equal(allowed.requests.length,0);assert.match(allowed.elements.status.textContent,/Autorização concedida/);
});

test('seleção é registrada antes da visão e a mesma tarefa recebe texto e narração',async()=>{
 let release;
 const env=bundle({vision:()=>new Promise(resolve=>{release=resolve;})});
 const running=env.run();await flush();
 const initial=env.data['falamermo.globalJobs.v1'].jobs[0];
 assert.equal(initial.source,'lens');assert.equal(initial.status,'analyzing');assert.equal(initial.text,'');
 assert.equal(env.playbacks.length,0);
 release('  Texto da área.  ');const result=await running;
 assert.equal(result.success,true);assert.equal(result.jobId,initial.jobId);
 const jobs=env.data['falamermo.globalJobs.v1'].jobs;
 assert.equal(jobs.length,1);assert.equal(jobs[0].status,'connecting');assert.equal(jobs[0].text,'Texto da área.');
 assert.equal(env.playbacks.length,1);assert.equal(env.playbacks[0].jobId,initial.jobId);assert.equal(env.playbacks[0].text,'Texto da área.');
 assert.equal(env.playbacks[0].agentId,'custom');
});

test('erro de visão conclui a tarefa com erro sem iniciar narração',async()=>{
 const env=bundle({vision:()=>{throw Error('HTTP 503');}});const result=await env.run();
 assert.equal(result.success,false);assert.equal(env.playbacks.length,0);
 const [job]=env.data['falamermo.globalJobs.v1'].jobs;assert.equal(job.status,'error');assert.match(job.error,/HTTP 503/);
});

test('Stop durante análise aborta a visão e descarta resultado tardio',async()=>{
 let release,signal;
 const env=bundle({vision:(...args)=>{signal=args.at(-1).signal;return new Promise(resolve=>{release=resolve;});}});
 const running=env.run();await flush();const [job]=env.data['falamermo.globalJobs.v1'].jobs;
 const stopped=await env.router.handleExtensionMessage({type:'HUD_GLOBAL_COMMAND',payload:{jobId:job.jobId,action:'stop'}},{url:'chrome-extension://test/popup.html'});
 assert.equal(stopped.success,true);assert.equal(signal.aborted,true);
 release('Resposta tardia');assert.equal((await running).cancelled,true);
 assert.equal(env.data['falamermo.globalJobs.v1'].jobs[0].status,'cancelled');assert.equal(env.playbacks.length,0);
});

test('seleção sem texto termina sem síntese nem tarefa fantasma',async()=>{
 const env=bundle({vision:()=>''});const result=await env.run();
 assert.equal(result.success,true);assert.equal(result.data,'');assert.equal(env.playbacks.length,0);
 assert.equal(env.data['falamermo.globalJobs.v1'].jobs[0].status,'completed');
});

test('deadline global aborta requisição de visão e registra erro na tarefa',async()=>{
 let release,signal;const timers=[];
 const env=bundle({timers,vision:(...args)=>{signal=args.at(-1).signal;return new Promise(resolve=>{release=resolve;});}});
 const running=env.run();await flush();assert.equal(timers.length,1);
 timers[0]();const result=await running;
 assert.equal(signal.aborted,true);assert.equal(result.success,false);
 const [job]=env.data['falamermo.globalJobs.v1'].jobs;assert.equal(job.status,'error');assert.match(job.error,/30s/);
 release('Não narrar depois do timeout');await flush();assert.equal(env.playbacks.length,0);
});
