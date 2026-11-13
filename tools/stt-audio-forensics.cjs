#!/usr/bin/env node
'use strict';
// Runner real. Não importa fixtures e não substitui WebSocket/getUserMedia/VAD.
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {EventEmitter,once}=require('node:events');
const {spawn}=require('node:child_process');
const http=require('node:http');
const {performance}=require('node:perf_hooks');
const {Evidence,instrument,hash}=require('./stt-forensics/core.cjs');
const root=path.resolve(__dirname,'..');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

class Cdp extends EventEmitter{
    constructor(browser,secrets=[]){super();this.browser=browser;this.secrets=secrets;this.pending=new Map();this.next=0;let buffer='';
        browser.stdio[4].on('data',chunk=>{
            buffer+=chunk;let end;
            while((end=buffer.indexOf('\0'))>=0){const raw=buffer.slice(0,end);buffer=buffer.slice(end+1);let m;
                try{m=JSON.parse(raw);}catch{this.emit('fault',Error('Resposta CDP inválida.'));continue;}
                const p=this.pending.get(m.id);
                if(p){this.pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error('CDP '+p.method+': '+m.error.code)):p.resolve(m.result);}
                else if(m.method)this.emit('event',m);
            }
        });
        const closed=()=>{this.closed=true;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('Canal do Chrome encerrado.'));}this.pending.clear();};
        browser.on('exit',closed);browser.on('error',closed);
        browser.stdio[3].on('error',closed);browser.stdio[4].on('error',closed);
    }
    call(method,params={},sessionId,timeoutMs=15000){
        if(this.closed)return Promise.reject(Error('Chrome encerrado.'));
        return new Promise((resolve,reject)=>{const id=++this.next,timer=setTimeout(()=>{this.pending.delete(id);reject(Error('Timeout CDP '+method));},timeoutMs);
            this.pending.set(id,{method,resolve,reject,timer});this.browser.stdio[3].write(JSON.stringify({id,method,params,sessionId})+'\0');});
    }
    async evaluate(sessionId,expression,contextId,label='avaliação remota'){
        const r=await this.call('Runtime.evaluate',{expression,contextId,returnByValue:true,awaitPromise:true,userGesture:true},sessionId,20000);
        if(r.exceptionDetails){
            let detail=r.exceptionDetails.exception?.description||r.exceptionDetails.text||'Exceção sem detalhes.';
            for(const secret of this.secrets)if(secret)detail=detail.split(secret).join('[credencial omitida]');
            detail=detail.replace(/AIza[0-9A-Za-z_-]{20,}/g,'[credencial omitida]').slice(0,500);
            const error=Error('Chrome '+label+': '+detail);error.stage=label;throw error;
        }
        return r.result?.value;
    }
    async attach(targetId){const {sessionId}=await this.call('Target.attachToTarget',{targetId,flatten:true});
        await this.call('Runtime.enable',{},sessionId);await this.call('Runtime.addBinding',{name:'__falamermoForensicSink'},sessionId);return sessionId;}
}
function argumentsFor(args){
    const result={duration:180,out:'/tmp/falamermo-prova',chrome:process.env.FALAMERMO_CHROME||'google-chrome',headless:false,preflight:false,noSandbox:false};
    for(let i=0;i<args.length;i++){
        const a=args[i];
        if(['--duration','--out','--chrome'].includes(a)){if(!args[i+1]||args[i+1].startsWith('--'))throw Error('Valor ausente: '+a);result[a.slice(2)]=args[++i];}
        else if(a==='--headless')result.headless=true;
        else if(a==='--preflight')result.preflight=true;
        else if(a==='--no-sandbox')result.noSandbox=true;
        else if(a==='--help')result.help=true;
        else throw Error('Argumento desconhecido: '+a);
    }
    result.duration=Number(result.duration);result.out=path.resolve(result.out);
    if(!Number.isFinite(result.duration)||result.duration<1||result.duration>1800)throw Error('--duration deve estar entre 1 e 1800 segundos.');
    const relative=path.relative(root,result.out);
    if(relative===''||!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative))throw Error('--out deve ficar fora do repositório.');
    return result;
}
function parseGeminiKeys(line){
    if(typeof line!=='string'||/\s/.test(line))throw Error('Formato inválido: use nove chaves sem espaços, separadas por ponto e vírgula.');
    const value=line.endsWith(';')?line.slice(0,-1):line,keys=value.split(';');
    if(keys.length!==9||keys.some(key=>!key||key.length>256))throw Error('Formato inválido: informe exatamente nove chaves não vazias.');
    if(new Set(keys).size!==9)throw Error('Formato inválido: informe nove chaves distintas.');
    return keys;
}
function readHiddenLine(reader){
    if(reader.lines.length)return Promise.resolve(reader.lines.shift());
    if(reader.error)return Promise.reject(reader.error);
    return new Promise((resolve,reject)=>{reader.waiter={resolve,reject};});
}
async function credentials({input=process.stdin,output=process.stdout}={}){
    if(!input.isTTY||typeof input.setRawMode!=='function')throw Error('A entrada das nove chaves exige um terminal interativo.');
    const wasRaw=!!input.isRaw;
    const reader={input,lines:[],current:'',overflow:false,waiter:null,error:null};
    const deliver=()=>{if(reader.waiter&&reader.lines.length){const {resolve}=reader.waiter;reader.waiter=null;resolve(reader.lines.shift());}};
    const onData=chunk=>{
        const text=Buffer.isBuffer(chunk)?chunk.toString('utf8'):String(chunk);
        for(let i=0;i<text.length;i++){
            const ch=text[i];
            if(ch==='\x03'||ch==='\x04'){reader.current='';reader.lines.length=0;reader.error=Error('Entrada de credenciais cancelada.');if(reader.waiter){const {reject}=reader.waiter;reader.waiter=null;reject(reader.error);}return;}
            if(ch==='\r'||ch==='\n'){
                if(ch==='\r'&&text[i+1]==='\n')i++;
                reader.lines.push({line:reader.current,overflow:reader.overflow});reader.current='';reader.overflow=false;deliver();continue;
            }
            if(ch==='\x7f'||ch==='\b'){
                const chars=Array.from(reader.current);chars.pop();reader.current=chars.join('');reader.overflow=false;continue;
            }
            if(ch==='\x15'){reader.current='';reader.overflow=false;continue;}
            if(reader.current.length<4096)reader.current+=ch;else reader.overflow=true;
        }
    };
    const onEnd=()=>{reader.error=Error('Entrada de credenciais encerrada.');if(reader.waiter){const {reject}=reader.waiter;reader.waiter=null;reject(reader.error);}};
    input.on('data',onData);input.once('end',onEnd);
    try{
        input.setRawMode(true);input.resume();
        while(true){
            output.write('Cole as 9 chaves Gemini separadas por ponto e vírgula: ');
            const {line,overflow}=await readHiddenLine(reader);
            output.write('\n');
            try{if(overflow)throw Error('Entrada longa demais.');return parseGeminiKeys(line);}
            catch{output.write('Formato inválido. Confira as nove chaves, sem espaços, separadas por ponto e vírgula, e tente novamente.\n');}
        }
    }finally{
        input.removeListener('data',onData);input.removeListener('end',onEnd);
        if(reader.waiter){reader.waiter.reject(Error('Entrada de credenciais cancelada.'));reader.waiter=null;}
        reader.current='';reader.lines.length=0;reader.error=null;
        input.setRawMode(wasRaw);input.pause();
    }
}
// Somente nesta cópia: material de autenticação fica em RAM, fora dos artefatos/perfil.
const credentialBridge=`(() => {
 'use strict';let secrets=[];
 const scrub=value=>{
  if(typeof value==='string')return secrets.reduce((s,k)=>s.split(k).join('[credencial omitida]'),value);
  if(Array.isArray(value))return value.map(scrub);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!/^apiKeys?$|password|credential|accessToken|refreshToken/i.test(k)).map(([k,v])=>[k,scrub(v)]));
  return value;
 };
 globalThis.FalamermoForensicsCredentials=keys=>{secrets=keys.slice();return secrets.length;};
 const area=chrome.storage.local,get=area.get.bind(area);
 const merge=(requested,result)=>{
  const wants=requested==null||requested==='api'||Array.isArray(requested)&&requested.includes('api')||typeof requested==='object'&&!Array.isArray(requested)&&'api' in requested;
  return wants&&secrets.length?{...result,api:{...result.api,apiKeys:secrets.slice()}}:result;
 };
 area.get=(requested,callback)=>typeof callback==='function'?get(requested,result=>callback(merge(requested,result))):get(requested).then(result=>merge(requested,result));
 for(const storage of [chrome.storage.local,chrome.storage.session]){
  const set=storage.set.bind(storage);storage.set=(items,callback)=>set(scrub(items),callback);
 }
})();`;

function makeCopy(directory){
    const {runtimeFiles}=require('./verify-publication.cjs');const sourceHashes={};
    for(const file of runtimeFiles){const bytes=fs.readFileSync(path.join(root,file));sourceHashes[file]=hash(bytes);const target=path.join(directory,file);fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
        fs.writeFileSync(target,file.endsWith('.js')?instrument(file,bytes.toString('utf8')):bytes,{mode:0o600});}
    fs.copyFileSync(path.join(__dirname,'stt-forensics/browser.js'),path.join(directory,'forensic-browser.js'));
    fs.writeFileSync(path.join(directory,'forensic-credentials.js'),credentialBridge,{mode:0o600});
    const bg=path.join(directory,'background.js');fs.writeFileSync(bg,"import './forensic-credentials.js';\n"+fs.readFileSync(bg,'utf8'),{mode:0o600});
    const manifestFile=path.join(directory,'manifest.json'),manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
    for(const entry of manifest.content_scripts){const at=entry.js.indexOf('content.js');if(at>=0)entry.js.splice(at,0,'forensic-browser.js');}
    fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2),{mode:0o600});
    const off=path.join(directory,'offscreen.html');fs.writeFileSync(off,fs.readFileSync(off,'utf8').replace('<script src="offscreen.js">','<script src="forensic-browser.js"></script><script src="offscreen.js">'),{mode:0o600});
    return sourceHashes;
}
const page=`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>FalaMermo · prova acústica real</title><style>body{font:18px system-ui;max-width:950px;margin:36px auto;padding:20px;background:#101720;color:#edf4ff}textarea{width:100%;height:240px;font:18px system-ui}button{padding:12px}output{display:block;margin:20px 0}</style><h1>Prova acústica real do STT</h1><p>Microfone físico → Silero híbrido → Gemini Live → editor. Áudio e transcrições serão salvos localmente. Use períodos de fala, silêncio e ruído; as fontes não são rotuladas automaticamente.</p><output id="state">Preparando a extensão…</output><textarea autofocus aria-label="Editor da prova acústica"></textarea><p>O terminal informa quando a gravação começa. Ctrl+C encerra e descarrega o áudio.</p></html>`;

async function main(args=process.argv.slice(2)){
    const opts=argumentsFor(args);
    if(opts.help){console.log('node tools/stt-audio-forensics.cjs --duration 180 --out /tmp/falamermo-prova\nNa inicialização, cole as nove chaves Gemini em uma linha; entrada oculta e mantida apenas em memória.\nOpções: --chrome CAMINHO, --headless, --preflight (sem STT), --no-sandbox (somente ambiente que exija).\nO destino deve ser novo e ficar fora do repositório.');return;}
    const keys=opts.preflight?[]:await credentials();
    process.umask(0o077);
    fs.mkdirSync(opts.out,{mode:0o700});for(const dir of ['segments','sessions','network'])fs.mkdirSync(path.join(opts.out,dir),{mode:0o700});
    const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'falamermo-forensics-'));fs.chmodSync(temporary,0o700);
    const extension=path.join(temporary,'extension');fs.mkdirSync(extension,{mode:0o700});
    let evidence,browser,cdp,server,contentSession,contentContext,offscreenSession,workerSession,workerContext,jobId,summary;
    let stopping=false,force=false,stopReason='initialization',runError=null,stopped=false,currentStage='preparando cópia diagnóstica';
    const contexts=new Map();const run={startedAt:new Date().toISOString(),requestedSeconds:opts.duration,preflight:opts.preflight};
    const evaluate=(label,sessionId,expression,contextId)=>{currentStage=label;return cdp.evaluate(sessionId,expression,contextId,label);};
    const requestStop=()=>{if(stopping)force=true;stopping=true;stopReason='signal';console.log(force?'Cancelamento solicitado; preservando o material coletado.':'Encerrando captura e aguardando respostas/buffers…');};
    process.on('SIGINT',requestStop);process.on('SIGTERM',requestStop);
    async function waitFor(label,condition,timeout=20000){
        const end=Date.now()+timeout;
        while(Date.now()<end){if(force)throw Error('Encerramento forçado solicitado.');if(runError)throw runError;const result=await condition();if(result)return result;await sleep(100);}
        throw Error('Timeout: '+label);
    }
    async function flushObservers(){
        if(!cdp||cdp.closed)return;
        for(const [session,context] of [[contentSession,contentContext],[offscreenSession,undefined]]){
            if(!session)continue;await evaluate('flush dos observadores',session,'globalThis.FalamermoForensics?.flush()',context).catch(()=>{});
        }
        await sleep(250);
    }
    try{
        run.sourceHashes=makeCopy(extension);run.observerSha256=hash(fs.readFileSync(path.join(__dirname,'stt-forensics/browser.js')));
        evidence=new Evidence(opts.out,keys);
        server=http.createServer((req,res)=>{
            if(req.url!=='/probe'){res.writeHead(404).end();return;}
            res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; script-src 'none'"});res.end(page);
        });
        await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
        const flags=['--no-first-run','--no-default-browser-check',
            '--enable-unsafe-extension-debugging','--remote-debugging-pipe','--disable-breakpad','--disable-crash-reporter','--disable-logging',
            '--autoplay-policy=no-user-gesture-required','--use-fake-ui-for-media-stream','--user-data-dir='+path.join(temporary,'profile'),'about:blank'];
        if(opts.headless)flags.unshift('--headless');if(opts.noSandbox)flags.unshift('--no-sandbox');
        browser=spawn(opts.chrome,flags,{stdio:['ignore','ignore','ignore','pipe','pipe']});
        cdp=new Cdp(browser,keys);
        cdp.on('fault',e=>{runError=e;});
        cdp.on('event',event=>{
            try{
                if(event.method==='Runtime.executionContextCreated'){const list=contexts.get(event.sessionId)||[];list.push(event.params.context);contexts.set(event.sessionId,list);}
                if(event.method==='Runtime.bindingCalled'&&event.params.name==='__falamermoForensicSink')evidence.consume(JSON.parse(event.params.payload));
                if(event.sessionId===offscreenSession)evidence.networkEvent(event.method,event.params,keys);
                if(event.method==='Runtime.exceptionThrown')evidence.log({kind:'runtime-exception',session:event.sessionId,description:event.params.exceptionDetails.exception?.description||event.params.exceptionDetails.text});
            }catch(error){runError=error;stopping=true;}
        });
        currentStage='identificando Chrome';run.chrome=(await cdp.call('Browser.getVersion')).product;
        currentStage='carregando extensão diagnóstica';const {id}=await cdp.call('Extensions.loadUnpacked',{path:extension});const base='chrome-extension://'+id+'/';
        const locate=async url=>(await cdp.call('Target.getTargets')).targetInfos.find(t=>t.url===url);
        currentStage='aguardando service worker';const workerTarget=await waitFor('background da extensão',()=>locate(base+'background.js'));
        run.extensionApiTarget={type:workerTarget.type,url:workerTarget.url};
        workerSession=await cdp.attach(workerTarget.targetId);
        workerContext=await waitFor('execution context do service worker',()=>
            (contexts.get(workerSession)||[]).find(context=>context.origin===base+'background.js'));
        run.extensionApiExecutionContext={id:workerContext.id,origin:workerContext.origin,name:workerContext.name};
        await waitFor('API Chrome disponível no service worker',()=>evaluate('aguardando APIs da extensão',workerSession,
            'typeof chrome!=="undefined"&&!!chrome.storage?.local&&typeof chrome.runtime?.sendMessage==="function"&&typeof globalThis.FalamermoForensicsCredentials==="function"',workerContext.id));
        await waitFor('migração inicial',()=>evaluate('leitura de inicialização da extensão',workerSession,'chrome.storage.local.get("agents").then(s=>!!s.agents)',workerContext.id));
        await evaluate('injeção temporária de credenciais em memória',workerSession,'FalamermoForensicsCredentials('+JSON.stringify(keys)+')',workerContext.id);
        // Preferências explícitas apenas no perfil descartável; algoritmos/parâmetros intactos.
        await evaluate('configuração do perfil isolado',workerSession,'chrome.storage.local.set({sttVadDetector:"hybrid",ui:{dictationInsertion:"realtime"}})',workerContext.id);
        await evaluate('criação do documento offscreen',workerSession,`chrome.offscreen.hasDocument().then(exists=>exists||chrome.offscreen.createDocument({url:"offscreen.html",reasons:["AUDIO_PLAYBACK","BLOBS","WORKERS"],justification:"Observação temporária do STT real"}))`,workerContext.id);
        currentStage='aguardando documento offscreen';offscreenSession=await cdp.attach((await waitFor('offscreen real',()=>locate(base+'offscreen.html'))).targetId);
        await cdp.call('Network.enable',{},offscreenSession);
        const prepare=await evaluate('preparação do Silero híbrido',workerSession,'chrome.runtime.sendMessage({type:"STT_VAD_OFFSCREEN",target:"offscreen",payload:{operation:"prepare",warm:true}})',workerContext.id);
        if(!prepare?.ok)throw Error('Modelo Silero não preparou no runtime real.');run.sileroPrepared=true;
        const {targetId}=await cdp.call('Target.createTarget',{url:'about:blank'});contentSession=await cdp.attach(targetId);
        await cdp.call('Page.enable',{},contentSession);
        await cdp.call('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/probe'},contentSession);
        currentStage='aguardando content script';contentContext=await waitFor('content script observado',async()=>{
            for(const c of contexts.get(contentSession)||[]){if(!c.auxData?.isDefault){
                try{if(await evaluate('detecção dos observadores no editor',contentSession,'!!globalThis.FalamermoForensics?.controller',c.id))return c.id;}catch{/* contexto ainda iniciando */}
            }}return false;
        });
        run.preflightReady=true;
        if(opts.preflight)stopReason='preflight-complete';
        console.log(run.chrome+' · Silero preparado · perfil isolado · chaves apenas em memória.');
        if(!opts.preflight){
            currentStage='inicializando microfone e sessão STT';
            const start=await evaluate('início e confirmação da captura no content script',contentSession,'(async()=>{const c=FalamermoForensics.controller;document.querySelector("textarea").focus();await c.startLiveRecording("narrator");return {recording:c.isRecording,jobId:c.liveJobId};})()',contentContext);
            if(!start?.recording||!start.jobId){await flushObservers();throw Error('O FalaMermo não iniciou a gravação; consulte capture-start-error em events.jsonl.');}
            jobId=start.jobId;
            run.jobId=jobId;const captureStartedAt=Date.now(),deadline=performance.now()+opts.duration*1000;
            run.captureStartedAt=new Date(captureStartedAt).toISOString();run.recordingDeadlineAt=new Date(captureStartedAt+opts.duration*1000).toISOString();
            currentStage='captura ativa';
            console.log('GRAVANDO por '+opts.duration+' s. Fale e faça pausas. Ctrl+C encerra normalmente.');
            await evaluate('atualização do estado da captura',contentSession,'document.querySelector("#state").textContent="Gravando áudio real. O texto abaixo vem do Gemini Live."',contentContext);
            let last=performance.now();
            while(performance.now()<deadline&&!stopping){
                if(runError)throw runError;if(cdp.closed)throw Error('Chrome fechou durante a gravação.');
                const state=await evaluate('monitoramento da captura',contentSession,'(()=>{const c=FalamermoForensics.controller;return {recording:c.isRecording,state:c.getJobState('+JSON.stringify(jobId)+')}})()',contentContext);
                if(!state.recording){run.captureStoppedEarly=state.state;run.incomplete=true;stopReason='capture-stopped-early';runError=Error('A captura parou antes do prazo solicitado (estado: '+(state.state||'desconhecido')+').');break;}
                if(performance.now()-last>=15000){last=performance.now();console.log('Restam aproximadamente '+Math.max(0,Math.ceil((deadline-performance.now())/1000))+' s.');}
                await sleep(250);
            }
            if(!stopping&&!runError&&performance.now()>=deadline)stopReason='duration';
            currentStage='finalizando microfone';
            await evaluate('parada e flush do microfone',contentSession,'globalThis.forensicLastCapture=FalamermoForensics.controller.liveCapture;void FalamermoForensics.controller.stopLiveRecording()',contentContext);
            stopped=true;run.captureStoppedAt=new Date().toISOString();
            await waitFor('flush do microfone',()=>evaluate('confirmação do flush do microfone',contentSession,'!FalamermoForensics.controller.liveCapture',contentContext),20000);
            console.log('Áudio encerrado; aguardando finalização real do Gemini (até 100 s)…');
            const until=Date.now()+100000;
            currentStage='aguardando finalização Gemini';
            while(Date.now()<until&&!force){
                if(runError)throw runError;
                const state=await evaluate('leitura do resultado Gemini',workerSession,'chrome.storage.session.get("falamermo.globalJobs.v1").then(s=>s["falamermo.globalJobs.v1"]?.jobs.find(j=>j.jobId==='+JSON.stringify(jobId)+'))',workerContext.id);
                if(state&&['completed','error','cancelled','insertion-failed'].includes(state.status)){
                    run.jobResult={status:state.status,text:state.text,partialText:state.partialText,incomplete:state.incomplete,error:state.error};run.serverDrainFinished=true;break;
                }
                await sleep(250);
            }
            if(!run.serverDrainFinished){run.incomplete=true;runError=Error('Finalização do Gemini não confirmada no prazo.');}
            currentStage='conferindo métricas de captura';
            run.capture=await evaluate('leitura das métricas finais',contentSession,'(()=>{const c=globalThis.forensicLastCapture;return c&&{capturedBytes:c.metrics.capturedBytes,flushAcknowledged:c.flushAcknowledged,released:c.released,vadMode:c.vad?.mode,vadMetrics:c.vad?.metrics,segments:c.chunker.sequence,sourceRate:c.context.sampleRate};})()',contentContext);
        }
    }catch(error){runError=error;run.failureStage=error.stage||currentStage;run.incomplete=true;if(stopReason==='initialization')stopReason=run.jobId?'recording-error':'initialization-error';}
    finally{
        if(cdp&&!cdp.closed&&contentSession&&contentContext){
            if(!stopped)await evaluate('limpeza da captura',contentSession,'void FalamermoForensics.controller.stopLiveRecording()',contentContext).catch(()=>{});
            if(force||runError)await evaluate('cancelamento seguro da captura',contentSession,'FalamermoForensics.controller.cancelRecording(true,"user-cancel")',contentContext).catch(()=>{});
            await flushObservers();
        }
        run.endedAt=new Date().toISOString();run.stopReason=stopReason;run.lastStage=currentStage;
        if(runError)run.error=''+runError.message;
        if(evidence){
            if(run.capture?.capturedBytes!==undefined&&evidence.wavs.get('input.wav')?.bytes!==run.capture.capturedBytes)evidence.issues.push('PCM integral não coincide com capturedBytes da captura real.');
            if(run.incomplete)evidence.issues.push('Encerramento incompleto; consulte o estado da sessão.');
            try{summary=await evidence.finish(run);}catch(error){console.error('Falha ao finalizar os arquivos. Material parcial mantido em '+opts.out);process.exitCode=1;}
        }
        if(cdp&&!cdp.closed)await cdp.call('Browser.close',{},undefined,5000).catch(()=>browser.kill());
        if(browser&&browser.exitCode===null&&browser.signalCode===null){await Promise.race([once(browser,'exit'),sleep(5000)]);if(browser.exitCode===null&&browser.signalCode===null)browser.kill('SIGKILL');}
        if(server)await new Promise(resolve=>server.close(resolve));
        fs.rmSync(temporary,{recursive:true,force:true});keys.fill('');
        process.removeListener('SIGINT',requestStop);process.removeListener('SIGTERM',requestStop);
    }
    if(summary){
        console.log('Resultado: '+summary.verification.status+' · '+summary.inputSamples+' amostras de entrada · '+summary.sessions.length+' sessões com áudio.');
        console.log('Ouvir e confrontar: '+path.join(opts.out,'index.html'));
        if(opts.preflight)console.log('PRÉ-VOO: STT/Gemini não foram executados.');
        else if(summary.verification.status!=='VERIFIED')process.exitCode=2;
    }
    if(runError){console.error(evidence?JSON.parse(evidence.redact({error:runError.message})).error:'Falha de inicialização.');process.exitCode=1;}
}
module.exports={argumentsFor,parseGeminiKeys,credentials,makeCopy,credentialBridge,Cdp,main};
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
