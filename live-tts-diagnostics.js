(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.LiveTtsDiagnostics=api;})(globalThis,function(root){
'use strict';
const STORAGE_KEY='liveTtsDiagnosticsV1',MAX_JOBS=8,MAX_EVENTS=120,MAX_SESSIONS=12,TTL_MS=24*60*60*1000;
const stages=new Set(['offscreen-command-received','socket-created','socket-open','setup-sent','setup-complete','turn-sent','first-pcm','turn-complete','turn-error','interaction-status','socket-error','socket-close','server-error','message-parse-error','worklet-ready','destination-connected','context-running','pcm-received','player-enqueue','first-frame-consumed','first-playback','generation-complete','ended','paused','resumed','seeked','control-error','settings-applied','stopped','error','protocol-diagnostic']);
const enums={model:['gemini-3.8-live','gemini-3.8-live-extended-thinking','gemini-3.1-flash-live-preview','gemini-2.5-flash-native-audio-preview-12-2025'],schema:['BidiGenerateContentSetup'],family:['native-audio','level','budget'],phase:['created','connecting','socket-open','awaiting-setup-complete','ready','awaiting-first-pcm','streaming'],contextState:['suspended','running','closed','interrupted'],interactionStatus:['IN_PROGRESS','IDLE'],encoding:['PCM signed Int16'],endianness:['little']};
const numberFields=['blockId','bytes','frames','sampleRate','channels','bitDepth','contextSampleRate','sourceBytes','volume','playbackRate','elapsedMs','readyState','code','blocks','socketOpenMs','setupCompleteMs','systemInstructionCharacters','textCharacters','wireTextCharacters','controlSeq','positionFrame','currentTime','availableStart','availableEnd'];
const booleanFields=['muted','paused','local','socketOpen','setupCompleteReceived','systemInstructionPresent','workletPaused','outputMuted'];
const validJob=id=>typeof id==='string'&&/^(?:job|manual)-\d{13}-[a-z0-9]{1,20}$/.test(id);
const validSession=id=>typeof id==='string'&&/^live-\d{13}-[a-z0-9]{1,20}$/.test(id);
function fields(input={}){
 const out={};for(const [key,values] of Object.entries(enums))if(values.includes(input[key]))out[key]=input[key];
 for(const key of numberFields)if(typeof input[key]==='number'&&Number.isFinite(input[key])&&input[key]>=0&&input[key]<=1e15)out[key]=input[key];
 for(const key of booleanFields)if(typeof input[key]==='boolean')out[key]=input[key];
 if(/^key#[1-9]$/.test(input.keyId||''))out.keyId=input.keyId;
 if(root.LiveConfig?.VOICES.includes(input.voiceName))out.voiceName=input.voiceName;
 if(typeof input.agentId==='string'&&/^[a-zA-Z0-9_.-]{1,160}$/.test(input.agentId))out.agentId=input.agentId;
 for(const [key,allowed]of [['setupFields',['model','generationConfig','systemInstruction','inputAudioTranscription','outputAudioTranscription','realtimeInputConfig','sessionResumption']],['generationFields',['responseModalities','speechConfig','thinkingConfig','translationConfig','temperature','topP','topK','maxOutputTokens','candidateCount','presencePenalty','frequencyPenalty']]])if(Array.isArray(input[key]))out[key]=[...new Set(input[key].filter(field=>allowed.includes(field)))];
 if(typeof input.mimeType==='string'&&/^audio\/pcm(?:;rate=\d{1,6})?(?:;channels=1)?$/i.test(input.mimeType))out.mimeType=input.mimeType;
 return out;
}
function sanitize(packet){
 if(!packet||!validJob(packet.jobId)||!stages.has(packet.stage))return null;
 const out={jobId:packet.jobId,stage:packet.stage,...fields(packet)};
 if(validSession(packet.sessionId))out.sessionId=packet.sessionId;
 if(packet.protocol){const p=packet.protocol;out.protocol=fields(p);if(validSession(p.sessionId))out.protocol.sessionId=p.sessionId;out.protocol.milestones={};for(const stage of ['socket-open','setup-sent','setup-complete','turn-sent','first-pcm','turn-complete','turn-error'])if(p.milestones?.[stage]===true)out.protocol.milestones[stage]=true;}
 return out;
}
function emit(packet){const safe=sanitize(packet);if(!safe||!root.chrome?.runtime?.sendMessage)return;try{Promise.resolve(root.chrome.runtime.sendMessage({type:'LIVE_TTS_DIAGNOSTIC',payload:safe})).catch(()=>{});}catch{/* Diagnóstico nunca interrompe áudio. */}}
function captureProtocol(snapshot){
 if(!snapshot)return;const event=snapshot.events?.at(-1);if(!event||!stages.has(event.event))return;
 const protocol={...fields(snapshot),...fields(snapshot.setup||{}),...fields(snapshot.turn||{}),sessionId:snapshot.sessionId,milestones:Object.fromEntries((snapshot.events||[]).map(e=>[e.event,true]))};
 emit({jobId:snapshot.jobId,sessionId:snapshot.sessionId,blockId:snapshot.blockId,stage:event.event,model:snapshot.model,keyId:snapshot.keyId,...fields(event),protocol});
}
function capturePlayback(snapshot){const event=snapshot?.events?.at(-1);if(event)emit({...event,stage:event.stage,jobId:snapshot.jobId});}
function captureEvent(payload,event,extra={}){
 if(payload?.operation!=='TTS_LIVE_START')return;
 emit({jobId:payload.jobId,stage:event,...fields(extra),model:extra.modelId,keyId:extra.keyLabel});
}
let queue=Promise.resolve();
function enqueue(work){const pending=queue.then(work);queue=pending.catch(()=>{});return pending;}
function storage(){const area=root.chrome?.storage?.session;if(!area)throw new Error('chrome.storage.session indisponível para diagnóstico Live.');return area;}
function clean(raw,now){
 const jobs=[];for(const item of Array.isArray(raw?.jobs)?raw.jobs:[]){
  if(!validJob(item.jobId)||!Number.isFinite(item.updatedAt)||item.updatedAt<now-TTL_MS||item.updatedAt>now)continue;
  const events=(Array.isArray(item.events)?item.events:[]).map(e=>{const safe=sanitize({...e,jobId:item.jobId});return safe&&Number.isFinite(e.at)?{...safe,at:Math.min(now,e.at)}:null;}).filter(Boolean).slice(-MAX_EVENTS);
  const sessions=(Array.isArray(item.sessions)?item.sessions:[]).map(p=>sanitize({jobId:item.jobId,stage:'setup-complete',protocol:p})?.protocol).filter(p=>p?.sessionId).slice(-MAX_SESSIONS);
  const milestones={};for(const stage of stages)if(item.milestones?.[stage]===true)milestones[stage]=true;
  jobs.push({jobId:item.jobId,updatedAt:item.updatedAt,events,sessions,milestones});
 }
 return{version:1,jobs:jobs.sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,MAX_JOBS)};
}
async function load(now){return clean((await storage().get(STORAGE_KEY))[STORAGE_KEY],now);}
function record(packet){const safe=sanitize(packet);if(!safe)return Promise.resolve({success:false});return enqueue(async()=>{
 const now=Date.now(),state=await load(now);let job=state.jobs.find(j=>j.jobId===safe.jobId);if(!job){job={jobId:safe.jobId,updatedAt:now,events:[],sessions:[],milestones:{}};state.jobs.unshift(job);}
 job.updatedAt=now;job.milestones[safe.stage]=true;job.events.push({...safe,at:now});job.events=job.events.slice(-MAX_EVENTS);
 if(safe.protocol?.sessionId){const index=job.sessions.findIndex(s=>s.sessionId===safe.protocol.sessionId);if(index>=0){safe.protocol.milestones={...job.sessions[index].milestones,...safe.protocol.milestones};job.sessions.splice(index,1);}job.sessions.push(safe.protocol);job.sessions=job.sessions.slice(-MAX_SESSIONS);}
 await storage().set({[STORAGE_KEY]:clean(state,now)});return{success:true};
});}
function read(){return enqueue(async()=>{const state=await load(Date.now());await storage().set({[STORAGE_KEY]:state});return state;});}
async function get(){const response=await root.chrome.runtime.sendMessage({type:'LIVE_TTS_DIAGNOSTICS_GET'});if(!response?.success)throw new Error('Não foi possível ler os diagnósticos TTS Live.');return response.diagnostics;}
return{captureProtocol,capturePlayback,captureEvent,record,read,get,sanitize,STORAGE_KEY,MAX_JOBS,MAX_EVENTS,MAX_SESSIONS,TTL_MS};
});
