// Política compartilhada de ranking, timeout e execução TTS. Não faz probes.
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./tts-config.js'):root.TtsConfig);if(typeof module==='object'&&module.exports)module.exports=api;else root.TtsAdaptive=api;})(globalThis,function(config){
'use strict';
const STORAGE_KEY='ttsAdaptiveData',MAX_PAIRS=36,MIN_TIMEOUT=8000,MAX_TIMEOUT=120000,DEFAULT_TIMEOUT=30000;
const CLASSES={SUCCESS:'SUCCESS',UNKNOWN:'UNKNOWN',TRANSIENT:'TRANSIENT',QUOTA:'QUOTA',AUTH:'AUTH',MODEL:'MODEL',REQUEST:'REQUEST',CANCELLED:'CANCELLED'};
// SHA-256 apenas para identidade estável das chaves. Nunca persiste a credencial.
function keyId(key){
 const bytes=Array.from(unescape(encodeURIComponent(key)),c=>c.charCodeAt(0)),length=bytes.length;
 bytes.push(128);while(bytes.length%64!==56)bytes.push(0);
 const bits=length*8;for(let i=7;i>=0;i--)bytes.push(i<4?(bits>>>i*8)&255:0);
 const k=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
 const h=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19],rot=(x,n)=>(x>>>n)|(x<<(32-n));
 for(let offset=0;offset<bytes.length;offset+=64){const w=[];for(let i=0;i<16;i++)w[i]=(bytes[offset+i*4]<<24)|(bytes[offset+i*4+1]<<16)|(bytes[offset+i*4+2]<<8)|bytes[offset+i*4+3];for(let i=16;i<64;i++){const a=w[i-15],b=w[i-2];w[i]=(w[i-16]+(rot(a,7)^rot(a,18)^(a>>>3))+w[i-7]+(rot(b,17)^rot(b,19)^(b>>>10)))|0;}let [a,b,c,d,e,f,g,j]=h;for(let i=0;i<64;i++){const t1=(j+(rot(e,6)^rot(e,11)^rot(e,25))+((e&f)^(~e&g))+k[i]+w[i])|0,t2=((rot(a,2)^rot(a,13)^rot(a,22))+((a&b)^(a&c)^(b&c)))|0;j=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a;a=(t1+t2)|0;}[a,b,c,d,e,f,g,j].forEach((n,i)=>h[i]=(h[i]+n)|0);}
 return 'sha256:'+h.map(n=>(n>>>0).toString(16).padStart(8,'0')).join('');
}
const id=pair=>pair.model+'|'+pair.keyId;
function catalog(models,keys){const ids=keys.map(keyId);return models.flatMap(model=>ids.map((keyId,index)=>({model,keyId,keyIndex:index+1}))).slice(0,MAX_PAIRS);}
function fresh(pair){return {model:pair.model,keyId:pair.keyId,successCount:0,failureCount:0,consecutiveSuccesses:0,consecutiveFailures:0,lastSuccessAt:0,lastFailureAt:0,lastUsedAt:0,latencyEma:null,latencySamples:0,headersEma:null,lastHttpStatus:null,lastErrorType:null,quotaState:'OK',authState:'OK',healthState:'UNKNOWN',cooldownUntil:0,score:4000};}
function normalize(raw,pair){
 const next=fresh(pair);if(!raw)return next;
 const allowed={healthState:['HEALTHY','UNKNOWN','TRANSIENT','QUOTA','MODEL','AUTH'],quotaState:['OK','LIMITED'],authState:['OK','INVALID','DENIED'],lastErrorType:[null,'TRANSIENT','TIMEOUT','DEMAND','QUOTA','AUTH','MODEL','MODEL_NOT_FOUND','MODEL_PERMISSION']};
 for(const name of Object.keys(next)){
  if(['model','keyId'].includes(name))continue;
  const value=raw[name];
  if(allowed[name]){if(allowed[name].includes(value))next[name]=value;}
  else if(name==='lastHttpStatus'){if(Number.isInteger(value)&&value>=100&&value<=599)next[name]=value;}
  else if(name==='latencyEma'||name==='headersEma'){if(Number.isFinite(value)&&value>=0)next[name]=Math.min(86400000,value);}
  else if(name==='score'){if(Number.isFinite(value))next[name]=value;}
  else if(Number.isFinite(value)&&value>=0){const cap=/^consecutive/.test(name)?1000:/Count$|latencySamples/.test(name)?1000000:Number.MAX_SAFE_INTEGER;next[name]=Math.min(cap,value);}
 }
 return next;
}
function effectiveState(pair,now){
 if(!pair.lastErrorType||pair.healthState==='HEALTHY'||pair.healthState==='UNKNOWN')return pair.healthState;
 const age=Math.max(0,now-pair.lastFailureAt),recovery=pair.healthState==='TRANSIENT'?300000:pair.healthState==='QUOTA'?0:86400000;
 if(now>=pair.cooldownUntil&&age>=recovery)return pair.successCount?'HEALTHY':'UNKNOWN';
 return pair.healthState;
}
function calculatePairScore(pair,now=Date.now()){
 const state=effectiveState(pair,now),tier={HEALTHY:5000,UNKNOWN:4000,TRANSIENT:3000,QUOTA:2000,MODEL:1000,AUTH:0}[state]??4000;
 const successes=pair.successCount||0,failures=pair.failureCount||0,rate=(successes+1)/(successes+failures+2),speed=pair.latencyEma==null?0:1/(1+pair.latencyEma/1000),recent=pair.lastSuccessAt?Math.exp(-Math.max(0,now-pair.lastSuccessAt)/86400000):0;
 const penalty=Math.min(150,(pair.consecutiveFailures||0)*30)*Math.exp(-Math.max(0,now-(pair.lastFailureAt||0))/300000);
 return Math.round((tier+rate*350+speed*350+Math.min(10,pair.consecutiveSuccesses||0)*10+recent*80-penalty-(pair.cooldownUntil>now?10000:0))*100)/100;
}
function orderPairs(data,pairs,now=Date.now()){
 return pairs.map(pair=>{const state=normalize(data?.pairs?.[id(pair)],pair);return {...state,keyIndex:pair.keyIndex,healthState:effectiveState(state,now),score:calculatePairScore(state,now),eligible:state.cooldownUntil<=now};}).sort((a,b)=>b.score-a.score||pairs.findIndex(p=>id(p)===id(a))-pairs.findIndex(p=>id(p)===id(b)));
}
function adaptiveTimeout(pair,states,textLength){
 const margin=Math.min(60000,Math.max(0,textLength)*1.5),history=states.filter(p=>p.model===pair.model&&p.latencySamples>0&&p.latencyEma!=null),samples=history.reduce((n,p)=>n+p.latencySamples,0),modelEma=samples?history.reduce((n,p)=>n+p.latencyEma*p.latencySamples,0)/samples:null;
 const ema=pair.latencySamples>0?pair.latencyEma:samples>=3?modelEma:null;
 const base=ema==null?DEFAULT_TIMEOUT:Math.max(pair.latencySamples>0?MIN_TIMEOUT:15000,ema*3+2000);
 return {timeoutMs:Math.round(Math.min(MAX_TIMEOUT,Math.max(MIN_TIMEOUT,base+margin))),timeoutReason:(ema==null?'sem histórico; base conservadora 30 s':`${pair.latencySamples>0?'EMA do par':'EMA do modelo'} ${(ema/1000).toFixed(2)} s × 3 + margem 2 s`)+`; texto ${textLength} caracteres, margem ${(margin/1000).toFixed(2)} s`,textLength};
}
function retryAfterMs(value,message='',now=Date.now()){
 if(value!==undefined&&value!==null&&value!==''){const seconds=Number(value);if(Number.isFinite(seconds))return Math.max(0,seconds*1000);const date=Date.parse(value);if(Number.isFinite(date))return Math.max(0,date-now);}
 for(const candidate of [value?'retryDelay: '+value:'',message]){
  const source=candidate.match(/(?:retryDelay["\s:]+|retry\s+(?:in|after)\s+)(.*)/i)?.[1];
  if(!source)continue;
  let remaining=source,total=0,count=0;
  // Aceita RetryInfo compacto e mensagens legíveis, sem inferir duração de texto vago.
  while(true){
   const part=remaining.match(/^\s*(\d+(?:\.\d+)?)\s*(hours?|h|minutes?|m|seconds?|s)(?![a-z])/i);
   if(!part)break;
   const factor=part[2][0].toLowerCase()==='h'?3600:part[2][0].toLowerCase()==='m'?60:1;
   total+=Number(part[1])*factor;count++;remaining=remaining.slice(part[0].length);
  }
  if(count&&Number.isFinite(total))return Math.round(total*1000);
 }
 return null;
}
function classify(error){
 const status=error?.httpStatus,message=error?.message||String(error);
 if(error?.cancelled||/cancelad|interrompid/i.test(message))return {type:'CANCELLED',label:'CANCELLED',reason:'cancelado; sem penalidade'};
 if(/API_KEY_INVALID|API key (?:not valid|invalid)|invalid api key|key (?:has been )?revoked|credential.*revoked/i.test(message))return {type:'AUTH',label:'AUTH',keyWide:true,reason:'credencial inteira inválida; evitar esta chave nos demais modelos'};
 if(error?.ttsFatal||status===400||status===422||/INVALID_ARGUMENT/i.test(message))return {type:'REQUEST',label:'INVALID_ARGUMENT',reason:'requisição encerrada; fallback de chave NÃO; ranking preservado'};
 if(status===401)return {type:'AUTH',label:'AUTH',keyWide:true,reason:'credencial rejeitada; próximo candidato'};
 if(status===403){
  // O prefixo de diagnóstico contém o modelo mesmo quando a API informa apenas Permission denied.
  const apiMessage=message.replace(/^\s*(?:Falha HTTP \(\d+\) no modelo [^:]+|HTTP \d+):\s*/i,'');
  if(/\bmodels?\b[^\n]*\b(?:access|permission|denied|not\s+(?:allowed|permitted))\b|\b(?:access|permission|denied|not\s+(?:allowed|permitted))\b[^\n]*\bmodels?\b/i.test(apiMessage))return {type:'MODEL',label:'MODEL_PERMISSION',reason:'permissão específica do modelo; próximo candidato'};
  return {type:'AUTH',label:'AUTH',keyWide:false,reason:'permissão rejeitada neste par; próximo candidato'};
 }
 if(status===404)return {type:'MODEL',label:'MODEL_NOT_FOUND',reason:'modelo indisponível neste par; próximo candidato'};
 if(status===429)return {type:'QUOTA',label:'QUOTA',reason:'quota/rate limit; cooldown e próximo candidato'};
 return {type:'TRANSIENT',label:/timeout/i.test(message)?'TIMEOUT':status===503?'DEMAND':'TRANSIENT',reason:'par penalizado temporariamente; próximo candidato'};
}
function updatePair(previous,event,now){
 const next={...previous};if(event.type==='REQUEST'||event.type==='CANCELLED')return next;
 next.lastUsedAt=now;next.lastHttpStatus=event.httpStatus??null;next.lastErrorType=event.type==='SUCCESS'?null:event.label||event.type;
 if(event.type==='SUCCESS'){
  const sample=Math.max(0,event.durationMs);next.latencyEma=next.latencySamples?next.latencyEma*.7+sample*.3:sample;next.headersEma=Number.isFinite(event.headersMs)?(next.headersEma==null?event.headersMs:next.headersEma*.7+event.headersMs*.3):next.headersEma;
  next.latencySamples=Math.min(1000000,next.latencySamples+1);next.successCount=Math.min(1000000,next.successCount+1);next.consecutiveSuccesses=Math.min(1000,next.consecutiveSuccesses+1);next.consecutiveFailures=0;next.lastSuccessAt=now;next.healthState='HEALTHY';next.quotaState='OK';next.authState='OK';next.cooldownUntil=0;
 }else{
  next.failureCount=Math.min(1000000,next.failureCount+1);next.consecutiveFailures=Math.min(1000,next.consecutiveFailures+1);next.consecutiveSuccesses=0;next.lastFailureAt=now;next.healthState=event.type;
  let cooldown;
  if(event.type==='TRANSIENT')cooldown=Math.min(120000,15000*2**Math.min(3,next.consecutiveFailures-1));
  else if(event.type==='QUOTA'){next.quotaState='LIMITED';cooldown=Number.isFinite(event.retryAfterMs)&&event.retryAfterMs>=0?Math.min(86400000,event.retryAfterMs):Math.min(3600000,60000*2**Math.min(6,next.consecutiveFailures-1));}
  else if(event.type==='AUTH'){next.authState=event.keyWide?'INVALID':'DENIED';cooldown=3600000;}
  else cooldown=1800000;
  next.cooldownUntil=now+cooldown;
 }
 next.score=calculatePairScore(next,now);return next;
}
function createStore(storage){
 let queue=Promise.resolve(),memory={};
 const access=(method,arg)=>!storage?Promise.resolve(method==='get'?{[STORAGE_KEY]:memory}:void(memory=arg[STORAGE_KEY])):new Promise((resolve,reject)=>{try{const result=storage[method](arg,value=>{const error=globalThis.chrome?.runtime?.lastError;if(error)reject(new Error(error.message));else resolve(value);});if(result?.then)result.then(resolve,reject);}catch(error){reject(error);}});
 const serial=fn=>{const next=queue.catch(()=>{}).then(fn);queue=next;return next;};
 async function read(pairs){const raw=(await access('get',STORAGE_KEY))?.[STORAGE_KEY]||{},data={version:1,epoch:Number.isSafeInteger(raw.epoch)?raw.epoch:0,pairs:{}};for(const pair of pairs.slice(0,MAX_PAIRS))if(raw.pairs?.[id(pair)])data.pairs[id(pair)]=normalize(raw.pairs[id(pair)],pair);return data;}
 return {
  snapshot:pairs=>serial(()=>read(pairs)),
  record:(pairs,pair,event,epoch,now=Date.now())=>serial(async()=>{
   const data=await read(pairs);if(data.epoch!==epoch||!pairs.some(p=>id(p)===id(pair))||event.type==='REQUEST'||event.type==='CANCELLED')return {data,ignored:true};
   const before=orderPairs(data,pairs,now),old=normalize(data.pairs[id(pair)],pair),updated=updatePair(old,event,now);data.pairs[id(pair)]=updated;
   if(event.type==='AUTH'&&event.keyWide){for(const other of pairs.filter(p=>p.keyId===pair.keyId&&id(p)!==id(pair))){const state=normalize(data.pairs[id(other)],other);Object.assign(state,{authState:'INVALID',healthState:'AUTH',lastFailureAt:now,cooldownUntil:updated.cooldownUntil,lastErrorType:'AUTH'});state.score=calculatePairScore(state,now);data.pairs[id(other)]=state;}}
   await access('set',{[STORAGE_KEY]:data});return {data,previousEma:old.latencyEma,newEma:updated.latencyEma,rankBefore:before.findIndex(p=>id(p)===id(pair))+1,rankAfter:orderPairs(data,pairs,now).findIndex(p=>id(p)===id(pair))+1};
  }),
  reset:pairs=>serial(async()=>{const old=await read(pairs),data={version:1,epoch:old.epoch+1,pairs:{}};await access('set',{[STORAGE_KEY]:data});return data;})
 };
}
let sharedStore;function getStore(){return sharedStore||(sharedStore=createStore(globalThis.chrome?.storage?.local));}
async function run({models,keys,text,trace,signal,snapshot,record,prepare,execute,log=()=>{},diagnostic}){
 const pairs=catalog(models,keys),attemptedPairs=new Set(),errors=[];let attempt=0,data=await snapshot(pairs),epoch=data.epoch;
 const emit=entry=>{try{Promise.resolve(log(entry)).catch(()=>{});}catch{}};
 const safe=value=>config.redactTtsSecrets(value,keys);
 while(true){
  if(signal?.aborted)throw signal.reason||new Error('TTS cancelado.');
  const ordered=orderPairs(data,pairs),pair=diagnostic?pairs.find(p=>p.model===diagnostic.model&&p.keyIndex===diagnostic.keyIndex):ordered.find(p=>p.eligible&&!attemptedPairs.has(id(p)));
  if(!pair||attemptedPairs.has(id(pair)))break;
  attemptedPairs.add(id(pair));
  const state=normalize(data.pairs[id(pair)],pair),timeout=adaptiveTimeout(state,ordered,text.length),info={modelId:pair.model,keyIndex:pair.keyIndex,attempt:++attempt,...timeout,delayMs:0,startedAt:new Date().toISOString()};
  let value;
  try{value=await prepare(pair.model);}catch(error){error.ttsFatal=true;emit({level:'error',source:'TTS',operation:'TTS_ADAPTIVE_ERROR',modelId:pair.model,message:safe('INVALID_ARGUMENT: '+error.message+'; requisição encerrada; ranking preservado')});throw error;}
  trace.mark('ATTEMPT_START',info);emit({level:'info',source:'TTS',operation:'MODEL_ATTEMPT',modelId:pair.model,message:`${pair.model} · key#${pair.keyIndex} · tentativa ${attempt} · timeout ${(timeout.timeoutMs/1000).toFixed(2)} s · ${timeout.timeoutReason}`});
  const started=config.performanceStamp().now;
  try{
   if(signal?.aborted)throw signal.reason||new Error('TTS cancelado.');
   const response=await execute(pair,info,value),durationMs=response.metrics.durationMs,event={type:'SUCCESS',httpStatus:200,...response.metrics};
   let learned={};if(!diagnostic)try{learned=await record(pairs,pair,event,epoch);data=learned.data;}catch(error){emit({level:'error',source:'TTS',operation:'TTS_RANKING_STORAGE_ERROR',message:safe(error.message)});}
   const message=`${pair.model} · key#${pair.keyIndex} · tentativa ${attempt} · SUCCESS · latência API ${(durationMs/1000).toFixed(2)} s · EMA ${learned.previousEma==null?'—':(learned.previousEma/1000).toFixed(2)} → ${learned.newEma==null?'—':(learned.newEma/1000).toFixed(2)} s · ranking #${learned.rankBefore??'—'} → #${learned.rankAfter??'—'} · timeout ${timeout.timeoutMs} ms`;
   trace.mark('ATTEMPT_END',{...info,durationMs,httpStatus:200,reason:'success',resultClass:'SUCCESS'});emit({level:'info',source:'TTS',operation:'MODEL_SUCCESS',modelId:pair.model,durationMs,message});
   return {...response.value,modelUsed:pair.model};
  }catch(error){
   if(signal?.aborted)error.cancelled=true;
   const decision=classify(error),durationMs=error.apiDurationMs??config.performanceStamp().now-started,message=safe(error?.message||String(error));
   const event={...decision,durationMs,httpStatus:error.httpStatus,retryAfterMs:retryAfterMs(error.retryAfter,message)};
   if(!diagnostic&&decision.type!=='REQUEST'&&decision.type!=='CANCELLED')try{const learned=await record(pairs,pair,event,epoch);data=learned.data;}catch(storageError){emit({level:'error',source:'TTS',operation:'TTS_RANKING_STORAGE_ERROR',message:safe(storageError.message)});}
   trace.mark('ATTEMPT_END',{...info,durationMs,httpStatus:error.httpStatus,error:message,reason:decision.reason,resultClass:decision.label});
   emit({level:'error',source:'TTS',operation:'MODEL_ERROR',modelId:pair.model,durationMs,httpStatus:error.httpStatus,message:`${pair.model} · key#${pair.keyIndex} · tentativa ${attempt} · ${decision.label} · latência ${(durationMs/1000).toFixed(2)} s · timeout ${timeout.timeoutMs} ms · ${message} · ação: ${diagnostic?'diagnóstico isolado; sem fallback':decision.reason} · backoff 0 ms`});
   errors.push(`${pair.model} · key#${pair.keyIndex}: ${message}`);
   if(diagnostic||decision.type==='REQUEST'||decision.type==='CANCELLED'){const failure=new Error(message);failure.ttsFatal=true;failure.httpStatus=error.httpStatus;failure.trace=trace.snapshot();throw failure;}
  }
 }
 const failure=new Error(errors.length?'Fallback TTS esgotado: '+errors.join(' | '):'Nenhum par TTS elegível: aguarde o cooldown ou confira as chaves.');failure.trace=trace.snapshot();emit({level:'error',source:'TTS',operation:'TTS_ADAPTIVE_EXHAUSTED',message:safe(failure.message)});throw failure;
}
return {STORAGE_KEY,MAX_PAIRS,MIN_TIMEOUT,MAX_TIMEOUT,DEFAULT_TIMEOUT,CLASSES,keyId,catalog,fresh,id,calculatePairScore,orderPairs,adaptiveTimeout,retryAfterMs,classify,updatePair,createStore,getStore,run};
});
