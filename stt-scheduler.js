// STT-only admission. No PCM queue, payload builder, account login or inference retry.
(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.SttScheduler=api;})(globalThis,function(root){
'use strict';
const STORAGE_KEY='falamermo.sttScheduler.v1',WINDOW=60000,TTL=86400000;
const MODELS=Object.freeze([...(root.LiveConfig||require('./live-config.js')).LIVE_MODEL_PRIORITY]);
// Approximate audio input rate, not a billing/quota guarantee. See docs/RELEASE-v1.0.3.md.
const DEFAULTS=Object.freeze({maxSessions:9,maxPerAccount:1,maxWaiting:9,waitMs:2000,setupMs:25000,headroom:.8,tokensPerSecond:25,horizonSeconds:12,setupTokens:64});
const REASONS=new Set(['AVAILABLE','LOWER_LOAD','COOLDOWN','AUTH','TPM','BUSY','ADMISSION_TIMEOUT','SETUP_TIMEOUT','QUOTA','TRANSIENT','MODEL','NETWORK','UNKNOWN','REQUEST','CANCELLED','INVALIDATED_CONTEXT','BACKPRESSURE','CHUNK_TIMEOUT','RELEASED']);
const finite=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const error=(message,code)=>Object.assign(Error(message),{code});
const cancelled=()=>Object.assign(error('Ditado cancelado.','CANCELLED'),{cancelled:true});
function policy(raw={}){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))raw={};
 const out={...DEFAULTS,limits:{},accountLimits:{}};
 for(const [name,min,max]of [['maxSessions',1,9],['maxPerAccount',1,9],['maxWaiting',1,9],['waitMs',0,2000],['setupMs',1,25000],['headroom',.1,1],['tokensPerSecond',1,1000],['horizonSeconds',1,12],['setupTokens',0,100000]])if(finite(raw[name])&&raw[name]>=min&&raw[name]<=max&&(name==='headroom'||Number.isInteger(raw[name])))out[name]=raw[name];
 for(const model of MODELS)if(finite(raw.limits?.[model])&&raw.limits[model]>0)out.limits[model]=raw.limits[model];
 for(const [id,limits]of Object.entries(raw.accountLimits||{}).slice(0,72))if(/^acct-[a-f0-9]{64}$/.test(id)){out.accountLimits[id]={};for(const model of MODELS)if(finite(limits?.[model])&&limits[model]>0)out.accountLimits[id][model]=limits[model];}
 return out;
}
// Allowlist shared by the service worker persistence endpoint. No arbitrary strings/content.
function sanitize(raw,now=Date.now()){
 const out={version:1,at:now,accounts:[],operations:[]};
 for(const op of (Array.isArray(raw?.operations)?raw.operations:[]).slice(-512))if(/^op-[a-f0-9]{64}$/.test(op?.id||'')&&finite(op.at)&&now-op.at<TTL&&op.at<=now+5000)out.operations.push({id:op.id,at:op.at});
 for(const a of (Array.isArray(raw?.accounts)?raw.accounts:[]).slice(-72)){
  if(!/^acct-[a-f0-9]{64}$/.test(a?.id||'')||!finite(a.at)||now-a.at>TTL||a.at>now+5000)continue;
  const account={id:a.id,at:a.at,authUntil:finite(a.authUntil)?Math.min(a.authUntil,now+TTL):0,models:[]};
  if(/^key#[1-9]$/.test(a.label||''))account.label=a.label;
  for(const m of (Array.isArray(a.models)?a.models:[]).slice(0,4)){
   if(!MODELS.includes(m?.modelId))continue;
   const model={modelId:m.modelId,entries:[],tpmLimit:finite(m.tpmLimit)&&m.tpmLimit>0?m.tpmLimit:null};
   for(const n of ['cooldownUntil','quota429','authErrors','failures','admitted','latencyMs','latencySamples','chunkLatencyMs','chunkLatencySamples','usageMessages','lastUsedAt','estimateCheckpoint'])if(finite(m[n]))model[n]=Math.min(m[n],n==='cooldownUntil'?now+TTL:1e12);
   model.reason=REASONS.has(m.reason)?m.reason:'UNKNOWN';
   model.choiceReason=REASONS.has(m.choiceReason)?m.choiceReason:'UNKNOWN';
   for(const e of (Array.isArray(m.entries)?m.entries:[]).slice(-1024))if(finite(e?.at)&&now-e.at<WINDOW&&e.at<=now+5000)model.entries.push({at:e.at,estimated:finite(e.estimated)?Math.min(e.estimated,1e9):0,input:finite(e.input)?Math.min(e.input,1e9):0,output:finite(e.output)?Math.min(e.output,1e9):0,thoughts:finite(e.thoughts)?Math.min(e.thoughts,1e9):0});
   account.models.push(model);
  }
  out.accounts.push(account);
 }
 return out;
}
async function identity(key){
 if(typeof key!=='string'||!key.trim())throw error('Chave STT ausente.','REQUEST');
 const digest=await root.crypto.subtle.digest('SHA-256',new TextEncoder().encode(key));
 return 'acct-'+Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
}
function summarize(raw,now=Date.now()){
 const state=sanitize(raw,now);return{version:1,at:now,activeJobs:0,accounts:state.accounts.map(a=>({account:a.label||'unknown',activeJobs:0,models:a.models.map(m=>{const t=m.entries.reduce((sum,e)=>({estimated:sum.estimated+e.estimated,input:sum.input+e.input,output:sum.output+e.output,thoughts:sum.thoughts+e.thoughts}),{estimated:0,input:0,output:0,thoughts:0});return{modelId:m.modelId,estimatedTpm:Math.ceil(t.estimated),observedInputTpm:Math.ceil(t.input),effectiveTpm:Math.ceil(Math.max(t.estimated,t.input+Math.max(0,t.estimated-(m.estimateCheckpoint||0)))),outputTokens60s:t.output,thoughtTokens60s:t.thoughts,reservedTokens:0,quota429:m.quota429||0,authErrors:m.authErrors||0,cooldownUntil:Math.max(m.cooldownUntil||0,a.authUntil||0),setupLatencyMs:Math.round(m.latencyMs||0),selectionReason:m.choiceReason||m.reason,statusReason:m.reason,chunkLatencyMs:Math.round(m.chunkLatencyMs||0),chunkLatencySamples:m.chunkLatencySamples||0,usageMessages:m.usageMessages||0,tpmLimit:m.tpmLimit,budgetState:m.tpmLimit?'CONFIGURED':'UNKNOWN',accounting:'ESTIMATED_GENERATION_HIGH_WATER'};})}))};
}
function create(services={}){
 const now=services.now||Date.now,setTimer=services.setTimer||setTimeout,clearTimer=services.clearTimer||clearTimeout;
 const accounts=new Map(),jobs=new Map(),operations=new Map(),waiters=new Set();let sequence=0,waiting=0,saveTimer=null,writes=Promise.resolve(),storageHealthy=true;
 async function storageCall(work){let timer;try{return await Promise.race([Promise.resolve().then(work),new Promise((_,reject)=>{timer=setTimer(()=>reject(error('Timeout do armazenamento STT.','STORAGE_TIMEOUT')),2000);})]);}finally{clearTimer(timer);}}
 const ready=Promise.resolve().then(()=>services.load?storageCall(services.load):undefined).then(raw=>{const state=sanitize(raw,now());for(const a of state.accounts)accounts.set(a.id,{...a,active:0,models:new Map(a.models.map(m=>[m.modelId,m]))});for(const op of state.operations)operations.set(op.id,op.at);}).catch(()=>{storageHealthy=false;services.onStorageFailure?.();});
 function modelFor(a,id){let m=a.models.get(id);if(!m){m={modelId:id,entries:[],cooldownUntil:0,quota429:0,authErrors:0,failures:0,admitted:0,latencyMs:0,latencySamples:0,lastUsedAt:0,reason:'UNKNOWN'};a.models.set(id,m);}m.entries=m.entries.filter(e=>now()-e.at<WINDOW);
  // Bound telemetry without dropping debit or invalidating live turn/usage references.
  if(m.entries.length>1024){const pinned=new Set([...jobs.values()].flatMap(j=>j.metric===m?[j.turn,j.usage]:[]));while(m.entries.length>1024){const i=m.entries.findIndex(e=>!pinned.has(e)),k=m.entries.findIndex((e,n)=>n>i&&!pinned.has(e));if(i<0||k<0)break;const left=m.entries[i],right=m.entries[k],combined={at:Math.max(left.at,right.at)};for(const field of ['estimated','input','output','thoughts'])combined[field]=left[field]+right[field];m.entries[i]=combined;m.entries.splice(k,1);}}
  return m;
 }
 function totals(m){const values=m.entries.reduce((r,e)=>({estimated:r.estimated+e.estimated,input:r.input+e.input,output:r.output+e.output,thoughts:r.thoughts+e.thoughts}),{estimated:0,input:0,output:0,thoughts:0});return{...values,effective:Math.max(values.estimated,values.input+Math.max(0,values.estimated-(m.estimateCheckpoint||0)))};}
 function reservations(a,id){let n=0;for(const j of jobs.values())if(!j.released&&j.account===a&&j.modelId===id)n+=j.reserved||0;return n;}
 function room(a,m,cfg,extra=0){m.tpmLimit=cfg.accountLimits[a.id]?.[m.modelId]||cfg.limits[m.modelId]||null;return !m.tpmLimit||totals(m).effective+reservations(a,m.modelId)+extra<=m.tpmLimit*cfg.headroom;}
 function exportState(){return sanitize({operations:[...operations].map(([id,at])=>({id,at})),accounts:[...accounts.values()].map(a=>({...a,models:[...a.models.keys()].map(id=>({...modelFor(a,id)}))}))},now());}
 function prune(){const used=new Set([...jobs.values()].map(j=>j.account?.id));for(const[id,a]of accounts)if(!a.active&&!used.has(id)&&now()-a.at>TTL)accounts.delete(id);while(accounts.size>72){const old=[...accounts].find(([id,a])=>!a.active&&!used.has(id));if(!old)break;accounts.delete(old[0]);}}
 function changed(){prune();if(!services.save||saveTimer!==null)return;saveTimer=setTimer(()=>{saveTimer=null;void flush();},250);}
 function flush(){if(saveTimer!==null){clearTimer(saveTimer);saveTimer=null;}const state=exportState();writes=writes.catch(()=>{}).then(()=>services.save?storageCall(()=>services.save(state)):undefined).catch(()=>{storageHealthy=false;services.onStorageFailure?.();});return writes;}
 function wake(){for(const notify of [...waiters])notify();}
 function pause(signal,deadline){return new Promise((resolve,reject)=>{let timer;const done=()=>{clearTimer(timer);waiters.delete(done);signal?.removeEventListener('abort',abort);resolve();},abort=()=>{done();reject(cancelled());};waiters.add(done);signal?.addEventListener('abort',abort,{once:true});timer=setTimer(done,Math.max(0,deadline-now()));if(signal?.aborted)abort();});}
 function markFailure(j,e,kind){
  const a=j.account,m=j.metric;if(!a||!m)return;
  const status=e?.httpStatus||e?.cause?.httpStatus;
  m.reason=REASONS.has(kind)?kind:'UNKNOWN';if(!['CANCELLED','REQUEST','INVALIDATED_CONTEXT'].includes(kind))m.failures++;
  if(kind==='QUOTA'){m.quota429++;const delay=finite(e?.retryAfterMs)?e.retryAfterMs:finite(e?.retryDelayMs)?e.retryDelayMs:60000;m.cooldownUntil=now()+Math.min(TTL,delay);}
  else if(kind==='AUTH'){m.authErrors++;m.cooldownUntil=now()+3600000;if(status===401||e?.keyInvalid===true||/api[_ ]key[_ ]invalid|invalid api.?key|api.?key (?:is )?not valid/i.test(e?.message||''))a.authUntil=now()+3600000;}
  else if(!['REQUEST','CANCELLED','INVALIDATED_CONTEXT','TPM'].includes(kind))m.cooldownUntil=now()+15000;
  a.at=now();changed();
 }
 function release(j,reason='RELEASED'){
  if(!j||j.released)return;j.released=true;j.reserved=0;if(j.account){j.account.active=Math.max(0,j.account.active-1);j.account.at=now();}
  if(jobs.get(j.jobId)===j)jobs.delete(j.jobId);if(j.operationId)operations.set(j.operationId,now());j.signal?.removeEventListener('abort',j.abort);if(j.metric)j.metric.reason=REASONS.has(reason)?reason:'UNKNOWN';changed();wake();
 }
 async function opening(j,open){
  let timer,onAbort,accepted=false;const controller=new AbortController();
  const pair={keyIndex:j.keyIndex,modelId:j.modelId,signal:controller.signal};
  const work=Promise.resolve().then(()=>{if(controller.signal.aborted)throw cancelled();return open(pair);});
  // A cancelled/timed-out acquire may still resolve. It never becomes an admitted lane.
  void work.then(value=>{if(controller.signal.aborted||j.released)services.retire?.(value);},()=>{});
  try{const session=await Promise.race([work,new Promise((_,reject)=>{timer=setTimer(()=>reject(error('Timeout no setup STT.','SETUP_TIMEOUT')),j.cfg.setupMs);onAbort=()=>reject(cancelled());j.signal?.addEventListener('abort',onAbort,{once:true});if(j.signal?.aborted)onAbort();})]);accepted=true;return session;}
  finally{clearTimer(timer);j.signal?.removeEventListener('abort',onAbort);if(!accepted)controller.abort(cancelled());}
 }
 async function admit({jobId,generation=0,keys,models,signal,config,onAttempt=()=>{},onAttemptError=()=>{},open}){
  if(jobs.has(jobId))throw error('Sessão STT duplicada.','REQUEST');
  if(waiting>=policy(config).maxWaiting)throw error('Fila de admissão STT cheia.','BACKPRESSURE');
  const j={jobId,generation,epoch:++sequence,signal,cfg:policy(config),attempted:new Set(),reserved:0,released:false,admitted:false,context:0,audioStarted:false,usageEpoch:0};jobs.set(jobId,j);waiting++;
  j.abort=()=>{release(j,'CANCELLED');wake();};signal?.addEventListener('abort',j.abort,{once:true});
  try{
   await ready;if(signal?.aborted)throw cancelled();
   if(typeof jobId!=='string'||!jobId||jobId.length>160)throw error('Identidade STT inválida.','REQUEST');
   j.operationId=(await identity('stt-job:'+jobId)).replace('acct-','op-');
   if(operations.has(j.operationId)){j.operationId=null;throw error('jobId STT já processado; nenhum replay foi iniciado.','REQUEST');}
   operations.set(j.operationId,now());while(operations.size>512)operations.delete(operations.keys().next().value);await flush();
   if(j.released||signal?.aborted)throw cancelled();
   if(!Array.isArray(keys)||!keys.length||keys.length>9)throw error('Configure entre uma e nove chaves STT.','REQUEST');
   const refs=await Promise.all(keys.map(async(key,index)=>({id:await identity(key),keyIndex:index+1})));
   let last;
   for(const id of models){
    if(!MODELS.includes(id))throw error('Modelo STT inválido.','REQUEST');
    const deadline=now()+j.cfg.waitMs;
    while(true){
     if(j.released||signal?.aborted)throw cancelled();
     let busy=false;const eligible=[];
     for(const ref of refs){
      if(j.attempted.has(id+'|'+ref.id))continue;
      let a=accounts.get(ref.id);if(!a){a={id:ref.id,at:now(),active:0,authUntil:0,models:new Map()};accounts.set(ref.id,a);}const m=modelFor(a,id);a.at=now();a.label='key#'+ref.keyIndex;
      if(a.authUntil>now()){m.reason='AUTH';continue;}if(m.cooldownUntil>now()){m.reason='COOLDOWN';continue;}
      const reservation=j.cfg.setupTokens+j.cfg.tokensPerSecond*j.cfg.horizonSeconds;
      if(!room(a,m,j.cfg,reservation)){m.reason='TPM';continue;}
      const active=[...jobs.values()].filter(x=>!x.released&&x.account).length;
      if(a.active>=j.cfg.maxPerAccount||active>=j.cfg.maxSessions){m.reason='BUSY';busy=true;continue;}
      eligible.push({a,m,ref,reservation,load:totals(m).effective+reservations(a,id)});
     }
     eligible.sort((x,y)=>x.a.active-y.a.active||x.load-y.load||(x.m.admitted||0)-(y.m.admitted||0)||x.m.lastUsedAt-y.m.lastUsedAt||x.ref.keyIndex-y.ref.keyIndex);
     const pick=eligible[0];
     if(!pick){changed();if(busy){if(now()>=deadline)throw error('Contas STT ocupadas; tente iniciar novamente.','ADMISSION_TIMEOUT');await pause(signal,deadline);continue;}break;}
     // No await between selection and reservation: simultaneous jobs cannot steal this slot.
     Object.assign(j,{account:pick.a,metric:pick.m,modelId:id,keyIndex:pick.ref.keyIndex,reserved:pick.reservation});pick.a.active++;pick.m.reason=eligible.length>1?'LOWER_LOAD':'AVAILABLE';j.selectionReason=pick.m.reason;pick.m.choiceReason=pick.m.reason;pick.m.lastUsedAt=now();j.attempted.add(id+'|'+pick.ref.id);changed();
     const began=now();
     try{
      onAttempt({modelId:id,keyIndex:j.keyIndex});const session=await opening(j,open);
      if(session.closed===true)throw error('WebSocket STT fechado durante admissão.','NETWORK');
      if(j.released||signal?.aborted){services.retire?.(session);throw cancelled();}
      j.session=session;j.admitted=true;pick.m.admitted++;pick.m.latencyMs=pick.m.latencySamples?pick.m.latencyMs*.8+(now()-began)*.2:now()-began;pick.m.latencySamples++;changed();return j;
     }catch(e){
      const kind=e.code==='SETUP_TIMEOUT'?'TRANSIENT':services.classify(e);markFailure(j,e,kind);onAttemptError({modelId:id,keyIndex:j.keyIndex,error:e});
      if(j.account&&!j.released)j.account.active=Math.max(0,j.account.active-1);j.account=null;j.metric=null;j.reserved=0;wake();
      if(j.released||signal?.aborted||['REQUEST','CANCELLED','INVALIDATED_CONTEXT'].includes(kind))throw e;last=e;
     }
    }
   }
   throw last||error('Nenhuma conta/modelo STT elegível; confira cooldown e orçamento.','STT_UNAVAILABLE');
  }catch(e){release(j,e.code||'UNKNOWN');throw e;}finally{waiting--;}
 }
 function assertLease(j){if(!j||j.released||!j.admitted||jobs.get(j.jobId)!==j||j.signal?.aborted)throw cancelled();}
 function sendAudio(j,bytes,send){
  assertLease(j);const a=j.account,m=modelFor(a,j.modelId),cfg=j.cfg;
  if(a.authUntil>now()||m.cooldownUntil>now())throw error('Conta STT indisponível durante o ditado.','STT_ACCOUNT_UNAVAILABLE');
  const tokens=bytes.byteLength/32000*cfg.tokensPerSecond;
  if(!j.turn){j.turn={at:now(),estimated:cfg.setupTokens+j.context,input:0,output:0,thoughts:0};m.entries.push(j.turn);j.reserved=Math.max(0,cfg.tokensPerSecond*cfg.horizonSeconds);}
  if(!m.entries.includes(j.turn))m.entries.push(j.turn);
  j.turn.at=now();j.turn.estimated+=tokens;j.reserved=Math.max(0,j.reserved-tokens);
  if(!room(a,m,cfg)){j.turn.estimated-=tokens;throw error('Orçamento TPM STT estimado esgotado; ditado interrompido sem replay.','STT_TPM_LIMIT');}
  // Mark before sending: a throwing socket may already have accepted part of the wire.
  j.audioStarted=true;j.context+=tokens;send(bytes);changed();
 }
 function endAudio(j,end){assertLease(j);end();j.turn=null;j.reserved=0;changed();}
 function observe(j,msg){
  if(!j||j.released)return;const m=modelFor(j.account,j.modelId),u=msg.usageMetadata;
  if(u){m.usageMessages=(m.usageMessages||0)+1;if(!j.usage||!m.entries.includes(j.usage)){j.usage={at:now(),estimated:0,input:0,output:0,thoughts:0};m.entries.push(j.usage);}const e=j.usage;e.at=now();const increased=finite(u.promptTokenCount)&&u.promptTokenCount>e.input;for(const [field,name]of [['promptTokenCount','input'],['responseTokenCount','output'],['thoughtsTokenCount','thoughts']])if(finite(u[field]))e[name]=Math.max(e[name],u[field]);if(increased)m.estimateCheckpoint=totals(m).estimated;changed();}
  // High water within one server generation; next generation charges full prompt again.
  if(msg.serverContent?.turnComplete){j.usage=null;j.usageEpoch++;}
 }
 function fail(j,e){if(!j||j.released)return;const kind=e.code==='STT_TPM_LIMIT'?'TPM':services.classify(e);markFailure(j,e,kind);release(j,kind);}
 function recordChunk(j,latency){if(!j||j.released||!finite(latency))return;const m=j.metric;m.chunkLatencyMs=m.chunkLatencySamples?m.chunkLatencyMs*.8+latency*.2:latency;m.chunkLatencySamples=(m.chunkLatencySamples||0)+1;changed();}
 function snapshot(){
  prune();return{version:1,at:now(),storageHealthy,waiting,activeJobs:[...jobs.values()].filter(j=>j.admitted&&!j.released).length,accounts:[...accounts.values()].filter(a=>a.label).map(a=>({account:a.label,activeJobs:a.active,models:[...a.models.values()].map(raw=>{const m=modelFor(a,raw.modelId),t=totals(m);return{modelId:m.modelId,estimatedTpm:Math.ceil(t.estimated),observedInputTpm:Math.ceil(t.input),effectiveTpm:Math.ceil(t.effective),outputTokens60s:t.output,thoughtTokens60s:t.thoughts,reservedTokens:reservations(a,m.modelId),quota429:m.quota429||0,authErrors:m.authErrors||0,cooldownUntil:Math.max(m.cooldownUntil||0,a.authUntil||0),setupLatencyMs:Math.round(m.latencyMs||0),selectionReason:m.choiceReason||m.reason,statusReason:m.reason,chunkLatencyMs:Math.round(m.chunkLatencyMs||0),chunkLatencySamples:m.chunkLatencySamples||0,usageMessages:m.usageMessages||0,tpmLimit:m.tpmLimit||null,budgetState:m.tpmLimit?'CONFIGURED':'UNKNOWN',accounting:'ESTIMATED_GENERATION_HIGH_WATER'};})}))};
 }
 return{admit,assertLease,sendAudio,endAudio,observe,fail,release,recordChunk,snapshot,exportState,flush,ready};
}
return{create,sanitize,summarize,policy,DEFAULTS,MODELS,STORAGE_KEY,WINDOW,TTL};
});
