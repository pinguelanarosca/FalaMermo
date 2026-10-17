const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),flush=()=>new Promise(r=>setImmediate(r));
const url='https://example.test/page',nativePermissionError="Either the '<all_urls>' or 'activeTab' permission is required.";
function bundle(state={}){
 const captures=[],pages=[],vision=[],logs=[],history=[],target={id:5,windowId:7,active:true,url};let reads=0;
 const chrome={runtime:{getURL:file=>'chrome-extension://test/'+file},permissions:{request(){throw Error('request proibido no background');}},tabs:{async get(id){assert.equal(id,5);return state.tab?.(++reads,{...target})||target;},async captureVisibleTab(windowId,options){captures.push({windowId,options});if(state.denied)throw Error(nativePermissionError);return'data:image/jpeg;base64,aW1hZ2Vt';},async create(properties){pages.push(properties);return{id:9};}}};
 const context=vm.createContext({chrome,structuredClone,AbortController,console,setTimeout,clearTimeout,Date});
 vm.runInContext(require('./load-background.cjs')(path.join(root,'background.js')).replace('__require("extension/src/background/index.ts");','globalThis.factories=__modules;'),context);
 const cache={};const overrides={
  'extension/src/services/storage/chromeStorageAdapter.ts':{chromeStorage:{async getMany(){return{api:{apiKey:'fake-only'},agents:{customAgents:[{metadata:{id:'custom'},instructions:{lensInspectionInstruction:'Instrução preservada'},modelPreferences:{visionModelId:'vision-preserved'}}]},models:{}};},async update(_key,callback){history.push(callback({recentItems:[]}));}}},
  'extension/src/services/diagnosticLogger.ts':{async logDiagnostic(packet){logs.push(packet);}},
  'extension/src/services/geminiDirectClient.ts':{geminiDirectClient:{async inspectVisionContext(...args){vision.push(args);return'Descrição existente';}}},
 };
 function load(id){if(overrides[id])return overrides[id];if(cache[id])return cache[id].exports;const module=cache[id]={exports:{}};context.factories[id](module,module.exports,load);return module.exports;}
 const router=load('extension/src/background/messageRouter.ts');
 return{captures,pages,vision,logs,history,run:()=>router.handleExtensionMessage({type:'LENS_ANALYZE_REQUEST',payload:{agentId:'custom'}},{url,tab:target})};
}
test('manifest declara all_urls somente como host opcional, preservando obrigatórias',()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));assert.deepEqual(manifest.optional_host_permissions,['<all_urls>']);assert.deepEqual(manifest.host_permissions,['https://generativelanguage.googleapis.com/*']);assert.ok(manifest.permissions.includes('activeTab'));assert.ok(!manifest.permissions.includes('<all_urls>'));
});
test('recusa de permissão simulada encaminha para UI própria, sem request no background/imagem Gemini',async()=>{
 const env=bundle({denied:true}),result=await env.run();assert.equal(result.code,'LENS_CAPTURE_PERMISSION_REQUIRED');assert.equal(result.success,false);assert.equal(env.vision.length,0);assert.equal(env.captures[0].windowId,7);assert.equal(env.pages.length,1);assert.equal(env.pages[0].url,'chrome-extension://test/lens-permission.html?tabId=5');assert.equal(env.pages[0].windowId,7);assert.equal(env.logs.some(x=>x.level==='error'),false);assert.equal(env.history.length,0);assert.ok(!result.error.includes(nativePermissionError));
});
test('captura autorizada mantém imagem, instrução, chave/modelo e análise existente',async()=>{
 const env=bundle(),result=await env.run();assert.equal(result.success,true);assert.equal(result.data,'Descrição existente');assert.equal(env.pages.length,0);assert.equal(env.captures.length,1);assert.equal(env.captures[0].windowId,7);assert.deepEqual(JSON.parse(JSON.stringify(env.captures[0].options)),{format:'jpeg',quality:90});assert.deepEqual(JSON.parse(JSON.stringify(env.vision[0])),['aW1hZ2Vt','Instrução preservada','fake-only','vision-preserved',{agentId:'custom',mimeType:'image/jpeg'}]);
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
