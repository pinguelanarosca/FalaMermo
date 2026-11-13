/* One MV3 job registry. UI snapshots omit transport data; archive settings use a credential-scrubbed allowlist. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.GlobalJobs=api;})(globalThis,function(){
'use strict';
const STORAGE_KEY='falamermo.globalJobs.v1',SESSION_BUDGET=4*1024*1024;
const TERMINAL=new Set(['completed','error','cancelled','ready']);
const STATUSES=new Set(['analyzing','connecting','recording','flushing','waiting','transforming','inserting','playing','paused','cancelling',...TERMINAL]);
const HUD_FIELDS=['visible','minimized'];
function forHud(state,tabId){const {tabHud,...shared}=state;return{...shared,...tabHud?.[tabId]};}
const PROGRESS=['currentTime','duration','availableStart','availableEnd','blocks','totalBlocks','completedBlocks','capturedChunks','capturedBytes','forwardedChunks','forwardedBytes','pendingChunks','volume','playbackRate','positionFrame','controlSeq'];
const clone=value=>JSON.parse(JSON.stringify(value));
const id=value=>typeof value==='string'&&value.length>0&&value.length<=160?value:null;
const text=value=>typeof value==='string'?value:'';
function bytes(value){let size=0;for(const character of JSON.stringify(value)){const code=character.codePointAt(0);size+=code<128?1:code<2048?2:code<65536?3:4;}return size;}
const TASK_SETTING_FIELDS=['agentSnapshot','modelId','models','voiceName','transformInstruction','transformModels','thinkingLevel','thinkingBudget','sttRecognition','speechConfig','generationConfig','responseModalities','inputAudioTranscription','outputAudioTranscription','outputAudioFormat','chunkSize','parallelism','systemInstruction','ttsConfig','voiceConfig','jsonMode','advancedJson','sampleRate','playbackRate','volume'];
function safeTaskSettings(raw){const secrets=Array.isArray(raw?.apiKeys)?raw.apiKeys.filter(value=>typeof value==='string'&&value.length):[];const scrub=value=>{if(typeof value==='string')return secrets.reduce((safe,key)=>safe.split(key).join('[segredo removido]'),value);if(Array.isArray(value))return value.map(scrub);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!/(api.?key|token|secret|authorization)/i.test(key)).map(([key,item])=>[key,scrub(item)]));return value;};return Object.fromEntries(TASK_SETTING_FIELDS.filter(key=>raw?.[key]!==undefined).map(key=>[key,scrub(raw[key])]));}
function origin(value={}){return{tabId:Number.isInteger(value.tabId)?value.tabId:0,frameId:Number.isInteger(value.frameId)?value.frameId:0,...(typeof value.documentId==='string'?{documentId:value.documentId}:{}),...(typeof value.page==='string'&&['options.html','popup.html'].includes(value.page)?{page:value.page}:{})};}
function progress(raw={}){const result=Object.fromEntries(PROGRESS.filter(key=>Number.isFinite(raw[key])&&raw[key]>=0).map(key=>[key,raw[key]]));if(['running','suspended','closed','interrupted'].includes(raw.contextState))result.contextState=raw.contextState;for(const key of ['workletPaused','outputMuted','outputActive'])if(typeof raw[key]==='boolean')result[key]=raw[key];return result;}
function textBoundaries(value,length){
 if(!Array.isArray(value)||value.length>10000)return undefined;
 let previous=0,end=0;
 for(const pair of value){
  if(!Array.isArray(pair)||pair.length!==2||!Number.isSafeInteger(pair[0])||pair[0]<=previous||!Number.isSafeInteger(pair[1])||pair[1]<end||pair[1]>length)return undefined;
  [previous,end]=pair;
 }
 return value.map(pair=>[...pair]);
}
function normalizeJob(raw,now){if(!id(raw?.jobId)||!['STT','TTS'].includes(raw.type))return null;return{jobId:raw.jobId,type:raw.type,...(raw.source==='lens'?{source:'lens',lensMode:raw.lensMode==='interpret'?'interpret':'literal',...(typeof raw.lensReadingInstruction==='string'?{lensReadingInstruction:raw.lensReadingInstruction}:{})}:{}),origin:origin(raw.origin),playerId:id(raw.playerId)||raw.jobId,requestId:id(raw.requestId)||raw.jobId,agentId:typeof raw.agentId==='string'?raw.agentId.slice(0,80):'narrator',status:STATUSES.has(raw.status)?raw.status:'connecting',manual:raw.manual===true,collapsed:raw.collapsed!==false,hidden:raw.hidden===true,pinned:raw.pinned===true,...(Number.isFinite(raw.lastOpenedAt)?{lastOpenedAt:raw.lastOpenedAt}:{}),pausedAt:Number.isFinite(raw.pausedAt)?raw.pausedAt:0,...(raw.type==='STT'&&raw.narration?{narration:{status:STATUSES.has(raw.narration.status)?raw.narration.status:'ready',requestId:id(raw.narration.requestId)||raw.requestId,eventSeq:raw.narration.eventSeq||0,pausedAt:raw.narration.pausedAt||0,progress:progress(raw.narration.progress),...(raw.narration.warning?{warning:text(raw.narration.warning).slice(0,500)}:{})}}:{}),...(typeof raw.workingText==='string'?{workingText:raw.workingText}:{}),text:text(raw.text),...(textBoundaries(raw.textBoundaries,text(raw.text).length)?{textBoundaries:textBoundaries(raw.textBoundaries,text(raw.text).length)}:{}),partialText:text(raw.partialText),progress:progress(raw.progress),createdAt:Number.isFinite(raw.createdAt)?raw.createdAt:now,updatedAt:Number.isFinite(raw.updatedAt)?raw.updatedAt:now,eventSeq:Number.isInteger(raw.eventSeq)?raw.eventSeq:0,...(raw.editorDelivery===true?{editorDelivery:true,textRevision:raw.textRevision||0,textSequence:raw.textSequence,publishedAt:raw.publishedAt,transcriptFinal:raw.transcriptFinal===true}:{}),originAvailable:raw.originAvailable!==false,incomplete:raw.incomplete===true,microphoneReleased:raw.microphoneReleased===true,...(['reserved','active'].includes(raw.captureAdmission)?{captureAdmission:raw.captureAdmission}:{}),...(['saved','disabled','failed'].includes(raw.historyStatus)?{historyStatus:raw.historyStatus}:{}),...(raw.capacityWarning===true?{capacityWarning:true}:{}),...(raw.insertion?{insertion:{inserted:raw.insertion.inserted===true,reason:typeof raw.insertion.reason==='string'?raw.insertion.reason.slice(0,120):'',...(Number.isSafeInteger(raw.insertion.revision)?{revision:raw.insertion.revision,final:raw.insertion.final===true,characters:raw.insertion.characters||0}:{})}}:{}),...(typeof raw.warning==='string'?{warning:raw.warning.slice(0,500)}:{}),...(typeof raw.error==='string'?{error:raw.error.slice(0,500)}:{})};}
function audioJob(job){return job.type==='STT'?{...job,type:'TTS',status:'ready',progress:{},pausedAt:0,error:undefined,warning:undefined,...job.narration,text:job.workingText??job.text}:job;}
function holdsMicrophone(job){return job.type==='STT'&&Boolean(job.captureAdmission)&&!job.microphoneReleased;}
function hasAudio(job){return !TERMINAL.has(audioJob(job).status);}
function controls(job){const audio=audioJob(job),done=TERMINAL.has(audio.status),available=job.type==='TTS'||TERMINAL.has(job.status);return{stop:job.status==='cancelling'||audio.status==='cancelling'?false:available?!done:!['inserting','flushing'].includes(job.status),pause:available&&['playing','connecting'].includes(audio.status),resume:available&&audio.status==='paused',play:available&&done&&!!audio.text.trim(),edit:TERMINAL.has(job.status)&&done,seek:available&&!done&&Number.isFinite(audio.progress.availableEnd),volume:available,playbackRate:available,copy:Boolean(job.text||job.partialText),remove:true};}

function create(services={}){
 const now=services.now||Date.now,jobs=new Map(),protections=new Map(),tabHud=new Map(),taskSettings=new Map();
 let revision=0,visible=false,minimized=false,ready=null,queue=Promise.resolve(),historyLimit=50,retentionDays=365,activeTaskId=null,pausedSelection=null,globalVolume=1,archiveNotice='',archiveNoticeId=0,archiveNoticeTimer=null;
 const store=services.storage;
 const archiveable=job=>TERMINAL.has(job.status)&&job.status!=='ready'&&!holdsMicrophone(job)&&!hasAudio(job)&&job.pinned!==true;
 const oldestArchiveable=()=>[...jobs.values()].filter(archiveable).sort((a,b)=>(a.status==='completed'?0:1)-(b.status==='completed'?0:1)||a.createdAt-b.createdAt||a.jobId.localeCompare(b.jobId))[0];
 function noteArchived(count,label='tarefa'){if(!count)return;const plural=count!==1,noun=label==='tarefa'?(plural?'tarefas':'tarefa'):label==='resultado'?(plural?'resultados':'resultado'):(plural?'recuperações de áudio':'recuperação de áudio');archiveNotice=`${count} ${noun} ${plural?'foram arquivados':'foi arquivado'} automaticamente. Consulte Opções > Histórico.`;if(label==='tarefa'||label==='recuperação de áudio')archiveNotice=`${count} ${noun} ${plural?'foram arquivadas':'foi arquivada'} automaticamente. Consulte Opções > Histórico.`;archiveNoticeId++;clearTimeout(archiveNoticeTimer);archiveNoticeTimer=setTimeout(()=>{archiveNotice='';void serial(()=>publish()).catch(()=>{});},5000);}
 async function captureTaskSettings(jobId,raw){const settings=safeTaskSettings(raw);if(!Object.keys(settings).length)return;taskSettings.set(jobId,settings);try{await services.taskArchive?.putTaskSettings?.(jobId,settings);}catch{}}
 async function archiveJob(job){if(!services.taskArchive?.putTask)throw new Error('Arquivo persistente de tarefas indisponível; nenhum resultado foi removido.');const settings=taskSettings.get(job.jobId)||await services.taskArchive.getTaskSettings?.(job.jobId)||{};await services.taskArchive.putTask(clone(job),settings);jobs.delete(job.jobId);taskSettings.delete(job.jobId);try{await services.taskArchive.deleteTaskSettings?.(job.jobId);}catch{}if(activeTaskId===job.jobId)activeTaskId=null;return true;}
 async function ensureCapacity(candidate){let archived=0;while(jobs.size+1>256||bytes([...jobs.values(),candidate])>SESSION_BUDGET){const next=oldestArchiveable();if(!next)throw new Error('Não há tarefa concluída e não fixada que possa ser arquivada; as tarefas em andamento foram preservadas.');await archiveJob(next);archived++;}noteArchived(archived);}
 const nextCreatedAt=()=>Math.max(now(),...[...jobs.values()].map(job=>job.createdAt+1));
 const snapshot=()=>({revision,visible,minimized,tabHud:Object.fromEntries(tabHud),activeTaskId,playback:{volume:globalVolume,selectedJobId:pausedSelection},...(archiveNotice?{notice:archiveNotice,noticeId:archiveNoticeId}:{}),jobs:[...jobs.values()].sort((a,b)=>b.createdAt-a.createdAt||b.jobId.localeCompare(a.jobId)).map(job=>({...clone(job),controls:controls(job)}))});
 function setHud(payload,tabId){
  const fields=HUD_FIELDS.filter(key=>typeof payload?.[key]==='boolean');
  if(!fields.length)return;
  if(tabId>0){
   tabHud.set(tabId,{...tabHud.get(tabId),...Object.fromEntries(fields.map(key=>[key,payload[key]]))});
   return;
  }
  if(fields.includes('visible'))visible=payload.visible;
  if(fields.includes('minimized'))minimized=payload.minimized;
  for(const [id,current] of tabHud){
   const remaining=HUD_FIELDS.filter(key=>key in current&&!fields.includes(key));
   if(remaining.length)tabHud.set(id,Object.fromEntries(remaining.map(key=>[key,current[key]])));
   else tabHud.delete(id);
  }
 }
 async function init(){if(ready)return ready;ready=(async()=>{const raw=(await store?.get?.(STORAGE_KEY))?.[STORAGE_KEY];if(raw){revision=Number.isInteger(raw.revision)?raw.revision:0;visible=raw.visible===true;minimized=raw.minimized===true;for(const [key,value] of Object.entries(raw.tabHud||{})){const tabId=Number(key);if(Number.isSafeInteger(tabId)&&tabId>0)setHud(value,tabId);}activeTaskId=id(raw.activeTaskId);pausedSelection=id(raw.playback?.selectedJobId);if(Number.isFinite(raw.playback?.volume))globalVolume=Math.max(0,Math.min(1,raw.playback.volume));for(const rawJob of raw.jobs||[]){const job=normalizeJob(rawJob,now());if(job)jobs.set(job.jobId,job);}for(const p of raw.protections||[])if(Number.isInteger(p.tabId))protections.set(p.tabId,{previous:p.previous!==false});}if(!jobs.has(activeTaskId))activeTaskId=jobs.keys().next().value||null;const history=await services.getHistory?.();historyLimit=Math.max(1,Math.min(5000,history?.maxEntries||50));retentionDays=Math.max(1,Math.min(3650,history?.retentionDays||365));})();return ready;}
 function serial(work){const next=queue.catch(()=>{}).then(async()=>{await init();return work();});queue=next;return next;}
 async function trim(){let archived=0;while(true){const done=[...jobs.values()].filter(archiveable),expired=done.filter(job=>now()-Math.max(job.updatedAt,job.lastOpenedAt||0)>=retentionDays*86400000),candidates=done.length>historyLimit?done:expired;if(!candidates.length)break;const job=candidates.sort((a,b)=>(a.status==='completed'?0:1)-(b.status==='completed'?0:1)||a.createdAt-b.createdAt||a.jobId.localeCompare(b.jobId))[0];await archiveJob(job);archived++;}while(bytes(snapshot())>SESSION_BUDGET){const job=oldestArchiveable();if(!job)break;await archiveJob(job);archived++;}noteArchived(archived);}
 async function protect(tabId){if(!tabId||protections.has(tabId)||!services.getTab||!services.updateTab)return;try{const tab=await services.getTab(tabId);protections.set(tabId,{previous:tab.autoDiscardable!==false});await services.updateTab(tabId,{autoDiscardable:false});}catch{/* The origin may have closed between registering and protecting. */}}
 async function releaseOrphans(){for(const[tabId,p]of protections){if([...jobs.values()].some(job=>!TERMINAL.has(job.status)&&job.originAvailable&&job.origin.tabId===tabId))continue;try{await services.updateTab?.(tabId,{autoDiscardable:p.previous});}catch{/* Closed tabs cannot be restored. */}protections.delete(tabId);}}
 async function publish(){await trim();if(!jobs.has(activeTaskId))activeTaskId=[...jobs.values()].find(job=>job.type==='TTS'&&!TERMINAL.has(job.status))?.jobId||jobs.keys().next().value||null;await releaseOrphans();const active=[...jobs.values()].filter(job=>!TERMINAL.has(job.status)),overBudget=bytes(snapshot())>SESSION_BUDGET;for(const job of active){if(overBudget)job.capacityWarning=true;else delete job.capacityWarning;}revision++;const state=snapshot();await store?.set?.({[STORAGE_KEY]:{...state,protections:[...protections].map(([tabId,p])=>({tabId,...p}))}});await services.notify?.(state);return state;}
 function nextHistory(history,entry){const retention=Math.max(1,history.retentionDays||365)*86400000,limit=Math.max(1,history.maxEntries||50),items=[entry,...(history.recentItems||[]).filter(item=>item.jobId!==entry.jobId&&item.id!==entry.id&&(item.pinned===true||now()-(item.timestamp||now())<retention))],evicted=[];while(items.length>limit){let index=-1;for(let i=items.length-1;i>0;i--)if(items[i].pinned!==true){index=i;break;}if(index<0)break;evicted.push(items.splice(index,1)[0]);}let updated={...history,recentItems:items};while(bytes(updated)>6*1024*1024){let index=-1;for(let i=items.length-1;i>0;i--)if(items[i].pinned!==true){index=i;break;}if(index<0)break;evicted.push(items.splice(index,1)[0]);updated={...history,recentItems:items};}return{updated,evicted};}
 async function saveHistory(job){if(!TERMINAL.has(job.status)||!job.text&&!job.partialText||!services.updateHistory)return;let disabled=false;try{const history=await services.getHistory?.();if(history?.enabled===false){disabled=true;job.historyStatus='disabled';return;}const previous=(history?.recentItems||[]).find(item=>item.jobId===job.jobId),content=job.type==='STT'&&previous?.text?previous.text:job.text||job.partialText,entry={id:'job-'+job.jobId,jobId:job.jobId,createdAt:job.createdAt,timestamp:job.updatedAt,type:job.type.toLowerCase(),...(job.source==='lens'?{source:'lens',lensMode:job.lensMode,lensReadingInstruction:job.lensReadingInstruction}:{}),agentId:job.agentId,pinned:job.pinned===true,previewText:content.slice(0,80),text:content,status:job.status==='error'?'error':job.status==='cancelled'?'cancelled':'success',incomplete:job.incomplete||!job.text,insertion:job.insertion},planned=nextHistory(history||{},entry);if(bytes(planned.updated)>6*1024*1024)throw new Error('Orçamento do histórico excedido.');let archivedHistory=0;for(const old of planned.evicted){if(old.jobId&&(jobs.has(old.jobId)||await services.taskArchive?.getTask?.(old.jobId)))continue;if(services.taskArchive?.putHistory)await services.taskArchive.putHistory(old);else throw new Error('Arquivo persistente de histórico indisponível.');archivedHistory++;}if(archivedHistory)noteArchived(archivedHistory,'resultado');await services.updateHistory(current=>{if(current.enabled===false){disabled=true;return;}return nextHistory(current,entry).updated;});job.historyStatus=disabled?'disabled':'saved';}catch{job.historyStatus='failed';services.warn?.('Não foi possível salvar o histórico. O resultado completo permanece na sessão ou no arquivo de tarefas.');}}
 function getMutable(jobId){const job=jobs.get(jobId);if(!job)throw new Error('Tarefa não encontrada ou já removida.');return job;}
 function sameOrigin(job,sender){const o=job.origin;return o.tabId===sender.tabId&&o.frameId===(sender.frameId||0)&&(!o.documentId||o.documentId===sender.documentId)&&(!o.page||o.page===sender.page);}
 function applyEvent(job,event){
  if(job.status==='cancelling')return false;
  if(event.requestId&&event.requestId!==job.requestId)return false;
  if(job.type==='STT'&&event.microphoneReleased===true)job.microphoneReleased=true;
  if(Number.isInteger(event.eventSeq)){if(event.eventSeq<=job.eventSeq)return false;job.eventSeq=event.eventSeq;}
  if(TERMINAL.has(job.status))return Number.isInteger(event.eventSeq)||event.microphoneReleased===true;
  if(job.type==='STT'&&job.editorDelivery&&job.transcriptFinal)return event.microphoneReleased===true;
  const name=event.event;
  if(['stt-partial','stt-segment','stt-final'].includes(name)){
   const boundaries=textBoundaries(event.textBoundaries,text(event.confirmedText??event.text).length);
   if(boundaries)job.textBoundaries=boundaries;
   else if(name==='stt-final')delete job.textBoundaries;
  }
  if(job.editorDelivery&&['stt-partial','stt-segment','stt-final'].includes(name)){
   job.textRevision=event.eventSeq;
   job.textSequence=event.sequence;
   job.publishedAt=event.publishedAt;
   job.transcriptFinal=name==='stt-final';
  }
  if(event.progress)job.progress={...job.progress,...progress(event.progress)};
  if(typeof event.status==='object')job.progress={...job.progress,...progress(event.status)};
  if(Number.isFinite(event.blocks))job.progress.totalBlocks=event.blocks;
  if(name==='setup-complete'&&job.type==='STT'&&!job.microphoneReleased)job.status='recording';
  if(name==='play'||name==='first-playback')job.status='playing';
  if(name==='buffering'&&job.type==='TTS')job.status='connecting';
  if(name==='pause'){job.status='paused';job.pausedAt=now();}
  if(name==='stt-partial'){if(typeof event.confirmedText==='string')job.text=text(event.confirmedText);job.partialText=typeof event.partialText==='string'?text(event.partialText):event.confirmed?'':text(event.text);}
  if(name==='stt-segment'){job.text=typeof event.confirmedText==='string'?text(event.confirmedText):[job.text,text(event.text)].filter(Boolean).join(' ');job.partialText='';}
  if(name==='stt-status'){const value=String(event.status||'');if(!job.microphoneReleased||!/Gravando/i.test(value))job.status=/Transform/i.test(value)?'transforming':/Gravando/i.test(value)?'recording':/envio/i.test(value)?'flushing':/Inser/i.test(value)?'inserting':'waiting';}
  if(name==='stt-warning'&&job.type==='STT'){job.incomplete=job.incomplete||event.incomplete!==false;job.error=text(event.warning).slice(0,500);}
  if(name==='stt-final'){job.text=text(event.text);job.partialText='';job.incomplete=event.incomplete===true;job.status=job.originAvailable?'inserting':'completed';if(!job.originAvailable&&(job.editorDelivery||!job.insertion?.inserted))job.insertion={inserted:false,reason:'ORIGIN_LOST'};}
  if(name==='block-complete'){if(Number.isFinite(event.completed))job.progress.completedBlocks=event.completed;if(Number.isFinite(event.blocks))job.progress.totalBlocks=event.blocks;}
  if(name==='ended'){job.status='completed';job.incomplete=false;job.pausedAt=0;job.progress={volume:job.progress.volume??1,playbackRate:job.progress.playbackRate??1};}
  if(name==='playback-warning'){job.warning=text(event.warning).slice(0,500);job.capacityWarning=true;}
  if(name==='error'||name==='stt-error'){job.status='error';job.error=text(event.error).slice(0,500);job.incomplete=job.type==='STT';}
  if(name==='cancelled'||name==='stt-cancelled'){job.status='cancelled';job.incomplete=job.type==='STT';}
  job.updatedAt=now();return true;
 }
 return{
  get:()=>serial(async()=>{const before=jobs.size;await trim();return jobs.size!==before?publish():snapshot();}),
  hasOrigin:(jobId,sender)=>serial(async()=>{const job=jobs.get(jobId);return Boolean(job&&sameOrigin(job,sender));}),
  find:(query)=>serial(async()=>{const job=query.jobId?jobs.get(query.jobId):[...jobs.values()].find(job=>job.playerId===query.playerId&&job.origin.tabId===query.tabId&&job.origin.frameId===(query.frameId||0)&&!TERMINAL.has(job.status));return job?clone(job):null;}),
  start:(raw,admission,signal)=>serial(async()=>{
   signal?.throwIfAborted();
   const existing=jobs.get(raw.jobId);
   if(admission==='start-stt'&&existing?.captureAdmission==='reserved'&&
      !existing.microphoneReleased&&existing.originAvailable&&!TERMINAL.has(existing.status)&&sameOrigin(existing,raw.origin)){
    existing.captureAdmission='active';
    existing.agentId=raw.agentId;
    await captureTaskSettings(existing.jobId,raw);
    if(raw.editorDelivery===true){
     existing.editorDelivery=true;
     existing.textRevision=0;
     existing.transcriptFinal=false;
    }
    await publish();
    return clone(existing);
   }
   if(existing)throw new Error('jobId já registrado.');
   const blocker=admission&&[...jobs.values()].find(holdsMicrophone);
   if(blocker)throw Object.assign(new Error('Já existe um ditado em andamento. Aguarde a finalização para iniciar outro.'),{
    code:'STT_CAPTURE_BUSY',
    otherTab:blocker.origin.tabId>0&&raw.origin?.tabId>0&&blocker.origin.tabId!==raw.origin.tabId,
   });
   const active=[...jobs.values()].filter(job=>!TERMINAL.has(job.status));if(active.length>=256)throw new Error('Há tarefas demais em execução.');const job=normalizeJob({...raw,...(admission?{captureAdmission:admission==='reserve-stt'?'reserved':'active',microphoneReleased:false}:{}),status:raw.source==='lens'?'analyzing':'connecting',createdAt:nextCreatedAt(),updatedAt:now(),eventSeq:0},now());if(!job)throw new Error('Identidade da tarefa inválida.');await ensureCapacity(job);await captureTaskSettings(job.jobId,raw);jobs.set(job.jobId,job);activeTaskId=job.jobId;if(job.type==='TTS')setHud({visible:true});await protect(job.origin.tabId);await publish();return clone(job);}),
  event:event=>serial(async()=>{const job=jobs.get(event.jobId);if(!job)return{changed:false};if(job.type==='STT'&&event.narration){if(!job.narration)return{changed:false};const audio=audioJob(job);if(!applyEvent(audio,event))return{changed:false};job.narration=Object.fromEntries(['status','requestId','eventSeq','progress','pausedAt','warning','capacityWarning','error'].filter(key=>audio[key]!==undefined).map(key=>[key,audio[key]]));}else{if(!applyEvent(job,event))return{changed:false};await saveHistory(job);}if(['play','first-playback'].includes(event.event))pausedSelection=null;await publish();return{changed:true};}),
  fail:(jobId,reason)=>serial(async()=>{const job=getMutable(jobId);if(TERMINAL.has(job.status)||job.status==='cancelling')return;job.status='error';job.error=text(reason).slice(0,500);job.incomplete=job.type==='STT';job.updatedAt=now();await saveHistory(job);await publish();}),
  ui:(payload,tabId)=>serial(async()=>{setHud(payload,tabId);if(payload.activeTaskId!==undefined){const selected=getMutable(payload.activeTaskId);activeTaskId=payload.activeTaskId;if(audioJob(selected).status==='paused')pausedSelection=selected.jobId;}return publish();}),
  draft:raw=>serial(async()=>{if(jobs.has(raw.jobId))throw new Error('jobId já registrado.');const job=normalizeJob({...raw,type:'TTS',status:'ready',text:'',createdAt:nextCreatedAt(),updatedAt:now()},now());if(!job)throw new Error('Identidade da tarefa inválida.');job.manual=true;job.collapsed=false;await ensureCapacity(job);jobs.set(job.jobId,job);activeTaskId=job.jobId;setHud({visible:true});return publish();}),
  edit:payload=>serial(async()=>{const job=getMutable(payload.jobId);if(!TERMINAL.has(job.status)||hasAudio(job))throw new Error('Pare a reprodução antes de editar.');if(typeof payload.text!=='string')throw new Error('Texto inválido.');if(payload.expectedText!==undefined&&payload.expectedText!==(job.type==='STT'?job.workingText??job.text:job.text))throw new Error('Texto alterado em outro painel. Copie sua edição e reabra a tarefa.');const size=bytes(payload.text),field=job.type==='STT'?'workingText':'text',growth=bytes({[field]:payload.text})-bytes({[field]:job[field]})+(field in job?0:1);if(size>SESSION_BUDGET||bytes(snapshot())+growth>SESSION_BUDGET)throw new Error('Texto excede o limite de sessão.');if(job.type==='STT')job.workingText=payload.text;else{job.text=payload.text;job.status='ready';delete job.historyStatus;}job.updatedAt=now();return publish();}),
  collapse:payload=>serial(async()=>{const job=getMutable(payload.jobId);job.collapsed=payload.collapsed===true;return publish();}),
  selectionResult:(raw,signal)=>serial(async()=>{
   signal?.throwIfAborted();
   const job=getMutable(raw.jobId);
   if(job.source!=='lens'||job.status!=='analyzing')throw new Error('Seleção não está em análise.');
   const result=text(raw.text).trim();
   if(bytes(snapshot())+bytes({text:result})-bytes({text:job.text})>SESSION_BUDGET)throw new Error('Texto da seleção excede o limite de sessão.');
   job.text=result;job.agentId=raw.agentId||job.agentId;
   if(typeof raw.lensReadingInstruction==='string')job.lensReadingInstruction=raw.lensReadingInstruction;
   if(raw.warning)job.warning=text(raw.warning).slice(0,500);else delete job.warning;
   job.status=result?'analyzing':'completed';
   job.updatedAt=now();await saveHistory(job);await publish();return clone(job);
  }),
  preparePlayback:(raw,signal)=>serial(async()=>{signal?.throwIfAborted();const job=getMutable(raw.jobId),audio=audioJob(job);if((!TERMINAL.has(job.status)||!TERMINAL.has(audio.status))&&!(job.source==='lens'&&job.status==='analyzing')||!audio.text.trim())throw new Error('Tarefa não está pronta para reprodução.');const next={status:'connecting',requestId:raw.requestId,eventSeq:0,pausedAt:0,progress:{volume:raw.volume??audio.progress.volume??1,playbackRate:raw.playbackRate??audio.progress.playbackRate??1}};if(job.type==='STT')job.narration=next;else{Object.assign(job,next);job.partialText='';delete job.error;delete job.warning;delete job.capacityWarning;delete job.historyStatus;}if(typeof raw.agentId==='string')job.agentId=raw.agentId;job.updatedAt=now();activeTaskId=job.jobId;await publish();return clone(job);}),
  globalSettings:payload=>serial(async()=>{if(Number.isFinite(payload.volume))globalVolume=Math.max(0,Math.min(1,payload.volume));return publish();}),
  settings:payload=>serial(async()=>{const job=getMutable(payload.jobId);if(job.type==='STT'&&!TERMINAL.has(job.status))throw new Error('Controle indisponível para ditado em andamento.');const audio=audioJob(job);for(const[key,min,max]of [['volume',0,1],['playbackRate',.5,2]])if(Number.isFinite(payload[key]))audio.progress[key]=Math.max(min,Math.min(max,payload[key]));if(job.type==='STT')job.narration={...job.narration,status:audio.status,progress:audio.progress};return publish();}),
  beginPanic:()=>serial(async()=>{
   const affected=[];
   for(const job of jobs.values()){
    const stopJob=!TERMINAL.has(job.status)||holdsMicrophone(job);
    const stopNarration=job.type==='STT'&&hasAudio(job);
    if(!stopJob&&!stopNarration)continue;
    if(stopJob&&!TERMINAL.has(job.status))job.status='cancelling';
    if(stopNarration)job.narration.status='cancelling';
    affected.push(clone(job));
   }
   if(affected.length){
    pausedSelection=null;
    await publish().catch(()=>services.warn?.('Não foi possível persistir o início da parada global.'));
   }
   return affected;
  }),
  finishPanic:(target,{remoteStopped,captureReleased})=>serial(async()=>{
   const job=jobs.get(target.jobId);
   if(!job||job.requestId!==target.requestId)return;
   if(captureReleased)job.microphoneReleased=true;
   const resetAudio=audio=>({volume:audio.progress.volume??1,playbackRate:audio.progress.playbackRate??1});
   if(remoteStopped&&job.status==='cancelling'&&!holdsMicrophone(job)&&(!job.editorDelivery||captureReleased)){
    job.status='cancelled';
    if(job.type==='STT')job.incomplete=true;
    else{job.progress=resetAudio(job);job.pausedAt=0;}
   }
   if(remoteStopped&&job.narration?.status==='cancelling'&&job.narration.requestId===target.narration?.requestId){
    job.narration.progress=resetAudio(job.narration);
    job.narration.status='cancelled';
    job.narration.pausedAt=0;
   }
   await publish();
  }),
  capture:(payload,sender)=>serial(async()=>{
   const job=getMutable(payload.jobId);
   if(job.type!=='STT'||!sameOrigin(job,sender))throw new Error('Captura não pertence a este documento.');
   const released=payload.microphoneReleased===true&&!job.microphoneReleased;
   if(released)job.microphoneReleased=true;
   if(['cancelling','cancelled'].includes(job.status))return released?publish():snapshot();
   const status={'finalizing-send':'flushing','awaiting-gemini':'waiting'}[payload.status]||payload.status;
   if(!job.transcriptFinal&&!TERMINAL.has(job.status)&&STATUSES.has(status)&&!(job.microphoneReleased&&['connecting','recording'].includes(status)))job.status=status;
   job.progress={...job.progress,...progress(payload)};
   if(payload.originLost===true)job.originAvailable=false;
   job.updatedAt=now();await saveHistory(job);return publish();
  }),
  insertion:(payload,sender)=>serial(async()=>{
   const job=getMutable(payload.jobId);
   if(job.type!=='STT'||!sameOrigin(job,sender))throw new Error('Inserção não pertence a este documento.');
   if(['cancelling','cancelled'].includes(job.status))return snapshot();
   const revisioned=job.editorDelivery;
   if(revisioned&&(!Number.isSafeInteger(payload.revision)||payload.revision!==job.textRevision||
      payload.revision<=(job.insertion?.revision||0)||payload.final!==job.transcriptFinal||TERMINAL.has(job.status)))return snapshot();
   if(!revisioned&&job.insertion?.inserted&&TERMINAL.has(job.status)&&payload.inserted!==true)return snapshot();
   job.insertion={inserted:payload.inserted===true,reason:text(payload.reason).slice(0,120),
    ...(revisioned?{revision:payload.revision,final:payload.final,characters:Math.max(0,Math.min(1000000,Number(payload.characters)||0))}:{})};
   if(revisioned?payload.final:job.status==='inserting')job.status='completed';
   job.updatedAt=now();await saveHistory(job);return publish();
  }),
  stopped:(jobId,status='flushing',narration=false)=>serial(async()=>{const job=getMutable(jobId);if(narration&&job.type==='STT'){if(job.narration)job.narration={...job.narration,status:'cancelled',pausedAt:0,warning:undefined,capacityWarning:undefined,progress:{volume:job.narration.progress.volume??1,playbackRate:job.narration.progress.playbackRate??1}};return publish();}if(TERMINAL.has(job.status)||job.status==='cancelling'||job.type==='STT'&&['transforming','inserting'].includes(job.status))return snapshot();if(job.type==='TTS'){job.pausedAt=0;delete job.warning;delete job.capacityWarning;job.progress={volume:job.progress.volume??1,playbackRate:job.progress.playbackRate??1};}job.status=job.type==='STT'?(status==='waiting'?'waiting':'flushing'):'cancelled';job.incomplete=job.type==='STT';job.updatedAt=now();await saveHistory(job);return publish();}),
  remove:jobId=>serial(async()=>{const job=getMutable(jobId);job.hidden=true;return publish();}),
  reopen:jobId=>serial(async()=>{
   let job=jobs.get(jobId),fromArchive=false,settingsStored=true;
   if(!job){
    const archived=await services.taskArchive?.getTask(jobId);
    if(archived?.task){job=normalizeJob(archived.task,now());if(archived.settings&&typeof archived.settings==='object'){taskSettings.set(jobId,archived.settings);try{await services.taskArchive?.putTaskSettings?.(jobId,archived.settings);}catch{settingsStored=false;}}fromArchive=true;}
    else{const history=await services.getHistory?.(),archivedHistory=(await services.taskArchive?.listHistory?.())||[],entry=history?.recentItems?.find(item=>item.jobId===jobId)||archivedHistory.find(item=>item.jobId===jobId)?.item;if(!entry)throw new Error('Resultado não disponível no histórico arquivado.');if(archivedHistory.some(item=>item.jobId===jobId))fromArchive=true;job=normalizeJob({jobId,type:entry.type.toUpperCase(),source:entry.source,lensMode:entry.lensMode,lensReadingInstruction:entry.lensReadingInstruction,agentId:entry.agentId,text:entry.text||entry.previewText,status:entry.status==='error'?'error':entry.status==='cancelled'?'cancelled':'completed',createdAt:entry.createdAt||entry.timestamp,updatedAt:entry.timestamp,originAvailable:false,insertion:entry.insertion,incomplete:entry.incomplete,pinned:entry.pinned,historyStatus:'saved'},now());}
    if(!job)throw new Error('Histórico incompatível.');await ensureCapacity(job);jobs.set(jobId,job);
   }
   job.hidden=false;job.collapsed=false;job.lastOpenedAt=now();setHud({visible:true});activeTaskId=jobId;const state=await publish();if(fromArchive&&settingsStored&&state.jobs.some(item=>item.jobId===jobId)){try{await services.taskArchive?.deleteTask(jobId);for(const item of(await services.taskArchive?.listHistory?.())||[])if(item.jobId===jobId)await services.taskArchive?.deleteHistory?.(item.id);}catch{}}return state;
  }),
  pin:(jobId,pinned)=>serial(async()=>{const job=jobs.get(jobId);if(job){job.pinned=pinned===true;job.updatedAt=now();await saveHistory(job);return publish();}const archived=await services.taskArchive?.setTaskPinned(jobId,pinned);if(archived){await services.updateHistory?.(current=>({...current,recentItems:(current.recentItems||[]).map(item=>item.jobId===jobId?{...item,pinned:pinned===true}:item)}));return publish();}const history=await services.getHistory?.(),entry=history?.recentItems?.find(item=>item.jobId===jobId);if(entry)await services.updateHistory?.(current=>({...current,recentItems:(current.recentItems||[]).map(item=>item.jobId===jobId?{...item,pinned:pinned===true}:item)}));await services.taskArchive?.setHistoryPinned?.(entry?.id||jobId,pinned);return publish();}),
  clearHistory:()=>serial(async()=>{await services.updateHistory?.(history=>({...history,recentItems:[]}));await services.taskArchive?.clearTasks?.();for(const [jobId,job]of jobs)if(TERMINAL.has(job.status)&&!holdsMicrophone(job)&&!hasAudio(job)&&job.status!=='ready'){jobs.delete(jobId);taskSettings.delete(jobId);}return publish();}),
  originLost:query=>serial(async()=>{if(query.tabClosed)tabHud.delete(query.tabId);const affected=[];for(const job of jobs.values()){if((query.jobId&&job.jobId!==query.jobId)||job.origin.tabId!==query.tabId||(query.frameId!==undefined&&job.origin.frameId!==query.frameId)||(query.documentId&&job.origin.documentId!==query.documentId))continue;if(!job.originAvailable){if(query.captureGone&&holdsMicrophone(job))job.microphoneReleased=true;continue;}job.originAvailable=false;if(query.captureGone&&holdsMicrophone(job))job.microphoneReleased=true;job.updatedAt=now();if(job.type==='STT'&&job.status!=='cancelling'&&!TERMINAL.has(job.status)){if(job.editorDelivery||!job.insertion?.inserted)job.insertion={inserted:false,reason:'ORIGIN_LOST'};job.incomplete=true;if(job.captureAdmission==='reserved'){job.status='cancelled';continue;}if(job.status==='inserting'&&(!job.editorDelivery||job.transcriptFinal)){job.status='completed';await saveHistory(job);}else{job.status='waiting';affected.push(clone(job));}}}await publish();return affected;}),
  reconcile:rawJobs=>serial(async()=>{const available=new Set();for(const raw of rawJobs||[]){const job=jobs.get(raw.jobId);if(!job)continue;if(job.type==='STT'&&raw.narration){if(!job.narration||raw.requestId!==job.narration.requestId)continue;available.add(job.jobId);if(raw.eventSeq>=job.narration.eventSeq&&job.narration.status!=='cancelling'&&!TERMINAL.has(job.narration.status))job.narration={...job.narration,status:raw.status,eventSeq:raw.eventSeq,pausedAt:raw.pausedAt||0,progress:TERMINAL.has(raw.status)?{volume:raw.progress?.volume??job.narration.progress.volume??1,playbackRate:raw.progress?.playbackRate??job.narration.progress.playbackRate??1}:{...job.narration.progress,...progress(raw.progress)},...(raw.warning?{warning:text(raw.warning)}:{})};continue;}if(raw.requestId&&raw.requestId!==job.requestId)continue;available.add(job.jobId);if(Number.isInteger(raw.eventSeq)&&raw.eventSeq<job.eventSeq)continue;job.eventSeq=Math.max(job.eventSeq,raw.eventSeq||0);if(TERMINAL.has(job.status)||job.status==='cancelling')continue;if(STATUSES.has(raw.status))job.status=raw.status;if(Number.isFinite(raw.pausedAt))job.pausedAt=raw.pausedAt;if(job.editorDelivery&&raw.textRevision>=job.textRevision){job.textRevision=raw.textRevision;job.textSequence=raw.textSequence;job.publishedAt=raw.publishedAt;job.transcriptFinal=raw.transcriptFinal===true;}if(typeof raw.text==='string')job.text=text(raw.text);if(textBoundaries(raw.textBoundaries,job.text.length))job.textBoundaries=textBoundaries(raw.textBoundaries,job.text.length);if(typeof raw.partialText==='string')job.partialText=text(raw.partialText);if(typeof raw.incomplete==='boolean')job.incomplete=raw.incomplete;job.progress=job.type==='TTS'&&TERMINAL.has(job.status)?{volume:raw.progress?.volume??job.progress.volume??1,playbackRate:raw.progress?.playbackRate??job.progress.playbackRate??1}:{...job.progress,...progress(raw.progress)};if(raw.warning)job.warning=text(raw.warning);job.updatedAt=now();if(job.type==='STT'&&job.status==='completed'&&job.originAvailable)job.status='inserting';if(job.type==='STT'&&job.status==='inserting'&&!job.originAvailable){job.status='completed';if(!job.insertion?.inserted)job.insertion={inserted:false,reason:'ORIGIN_LOST'};}await saveHistory(job);}for(const job of jobs.values()){if(job.type==='STT'&&job.narration&&job.narration.status!=='cancelling'&&!TERMINAL.has(job.narration.status)&&!available.has(job.jobId)){job.narration.status='error';job.narration.warning='O contexto de reprodução foi encerrado.';}if(job.status!=='cancelling'&&!TERMINAL.has(job.status)&&!(job.editorDelivery&&job.transcriptFinal)&&job.captureAdmission!=='reserved'&&!available.has(job.jobId)){job.status='error';job.error='O contexto de execução foi encerrado antes da conclusão.';job.incomplete=job.type==='STT';job.updatedAt=now();await saveHistory(job);}}return publish();}),
  historyChanged:value=>serial(async()=>{const history=typeof value==='function'?await value():value;historyLimit=Math.max(1,Math.min(5000,history?.maxEntries||50));retentionDays=Math.max(1,Math.min(3650,history?.retentionDays||365));return publish();}),
  recoveryArchived:count=>serial(async()=>{noteArchived(Math.max(1,Math.min(256,Number(count)||1)),'recuperação de áudio');return publish();}),
  restoreProtections:()=>serial(async()=>{const active=new Set([...jobs.values()].filter(job=>!TERMINAL.has(job.status)&&job.originAvailable).map(job=>job.origin.tabId).filter(Boolean));for(const tabId of active){if(protections.has(tabId)){try{await services.updateTab?.(tabId,{autoDiscardable:false});}catch{/* A navigation may destroy the origin during recovery. */}}else await protect(tabId);}return publish();}),
 };
}
return{create,audioJob,holdsMicrophone,forHud,STORAGE_KEY,TERMINAL,STATUSES,origin,SESSION_BUDGET};
});
