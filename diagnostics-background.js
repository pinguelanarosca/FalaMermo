/* The background owns the one canonical ring. Existing Live summaries are projections. */
(function(root){
 'use strict';
 const d=root.FalaDiagnostics,core=root.DiagnosticsCore,runtime=root.chrome?.runtime;
 if(!d||!core||root.DiagnosticsHub||typeof root.document!=='undefined')return;
 const sources=new Map();let checkpointBusy=false,lastCheckpoint=0,dirty=false,restored=false;
 const page=sender=>sender.url?.split(/[?#]/)[0];
 const privileged=sender=>sender.id===runtime.id&&['diagnostics.html','options.html'].some(file=>page(sender)===runtime.getURL(file));
 const origin=sender=>page(sender)===runtime.getURL('offscreen.html')?'offscreen':page(sender)===runtime.getURL('options.html')?'options':page(sender)===runtime.getURL('diagnostics.html')?'central':page(sender)===runtime.getURL('popup.html')?'popup':page(sender)===runtime.getURL('task.html')?'task':page(sender)===runtime.getURL('lens-permission.html')?'lens':sender.tab?'content':null;
 function project(type){
  d.flush();const adapter=type==='stt'?root.LiveSttDiagnostics:root.LiveTtsDiagnostics, jobs=new Map();
  for(const e of d.snapshot(0,20000).events.reverse()){
   if(e.legacyType!==type)continue;
   const packet=adapter.sanitize({...e.details,stage:e.stage,jobId:e.jobId,sessionId:e.sessionId,chunkId:e.chunkId});if(!packet)continue;
   let job=jobs.get(e.jobId);
   if(!job){if(jobs.size>=adapter.MAX_JOBS)continue;job={jobId:e.jobId,updatedAt:e.at||e.receivedAt,events:[],segments:[],sessions:[],milestones:{}};jobs.set(e.jobId,job);}
   if(job.events.length<adapter.MAX_EVENTS)job.events.unshift({...packet,at:e.at||e.receivedAt});
   if(type==='stt'){
    const previous=job[packet.scope];
    if(!previous)job[packet.scope]=packet;
    else if(packet.scope!=='editor'&&(packet.scope!=='transport'||previous.sessionId===packet.sessionId))job[packet.scope]={...packet,...previous};
    if(packet.stage==='chunk-created'&&packet.chunkId&&job.segments.length<32&&!job.segments.some(s=>s.sequence===packet.sequence))job.segments.unshift(packet);
    if(packet.sessionId&&job.sessions.length<64&&!job.sessions.some(s=>s.sessionId===packet.sessionId))job.sessions.unshift(packet);
    if(packet.scope==='editor'&&packet.characters>0&&(packet.stage==='editor-delivery-exhausted'||packet.stage==='editor-apply'&&packet.inserted===false&&!['EMPTY_TEXT','WAITING_FINAL','SUPERSEDED','CANCELLED','MANUAL_EDIT_PRESERVED'].includes(packet.editorReason)))job.firstEditorDivergence={...packet,at:e.at||e.receivedAt};
   }else{
    job.milestones[packet.stage]=true;
    if(packet.protocol?.sessionId&&!job.sessions.some(s=>s.sessionId===packet.protocol.sessionId)&&job.sessions.length<12)job.sessions.unshift(packet.protocol);
   }
  }
  return adapter.clean({version:1,jobs:[...jobs.values()]},Date.now());
 }
 async function restore(){
  try{
   const stored=await root.chrome.storage.session.get(core.CHECKPOINT_KEY),old=stored[core.CHECKPOINT_KEY];
   if(old?.version===1&&Array.isArray(old.events)){
    for(const raw of old.events.slice(-256)){const safe=core.sanitize(raw);if(safe){d.append(safe);if(safe.sourceId&&safe.sourceSeq){let source=sources.get(safe.sourceId);if(!source){if(sources.size>=128)sources.delete(sources.keys().next().value);source={last:0,context:safe.context,seen:Date.now()};sources.set(safe.sourceId,source);}source.last=Math.max(source.last,safe.sourceSeq);}}}
    d.event({component:'diagnostics',category:'lifecycle',stage:'collector-resumed',severity:'info',details:{count:old.events.length}});
   }
   const value=await root.chrome.storage.local.get(core.CONFIG_KEY);if(value[core.CONFIG_KEY])d.configure(value[core.CONFIG_KEY]);
  }catch{d.event({component:'diagnostics',category:'telemetry',stage:'telemetry-failure',severity:'warn',code:'TELEMETRY_FAILED'});}finally{restored=true;}
 }
 const ready=restore();
 d.event({component:'diagnostics',category:'lifecycle',stage:'collector-started'});
 runtime.onMessage.addListener((message,sender,reply)=>{
  if(!message?.type?.startsWith('DIAGNOSTICS_'))return false;
  if(sender.id!==runtime.id){reply({success:false});return false;}
  if(message.type==='DIAGNOSTICS_BATCH'){
   const context=origin(sender),p=message.payload;
   if(!context||!p||p.context!==context||typeof p.sourceId!=='string'||!new RegExp('^'+context+'-\\d{13}-[a-z0-9]{1,12}$').test(p.sourceId)||!Array.isArray(p.events)||p.events.length>128){reply({success:false});return false;}
   let source=sources.get(p.sourceId);
   if(!source){if(sources.size>=128)sources.delete(sources.keys().next().value);source={last:0,context,tabId:sender.tab?.id,frameId:sender.frameId,documentId:sender.documentId,seen:Date.now()};for(const[id,old]of sources)if(old.tabId===source.tabId&&source.tabId&&old.frameId===source.frameId&&old.documentId&&source.documentId&&old.documentId!==source.documentId)sources.delete(id);sources.set(p.sourceId,source);}
   source.seen=Date.now();source.tabId??=sender.tab?.id;
   if(Number.isSafeInteger(p.dropped)&&p.dropped>(source.dropped||0)){d.event({component:'diagnostics',category:'telemetry',stage:'telemetry-overflow',severity:'warn',details:{count:p.dropped-(source.dropped||0),context}});source.dropped=p.dropped;}
   if(Number.isSafeInteger(p.failures)&&p.failures>(source.failures||0)){d.event({component:'diagnostics',category:'telemetry',stage:'telemetry-failure',severity:'warn',code:'TELEMETRY_FAILED',details:{count:p.failures-(source.failures||0),context}});source.failures=p.failures;}
   for(const raw of p.events){
    const safe=core.sanitize(raw);
    if(!safe||safe.sourceId!==p.sourceId||safe.context!==context||!safe.sourceSeq||safe.sourceSeq<=source.last)continue;
    source.last=safe.sourceSeq;d.append(safe);dirty=true;
   }
   reply({success:true,config:d.settings});return false;
  }
  if(!privileged(sender)){reply({success:false});return false;}
  if(message.type==='DIAGNOSTICS_GET'){
   void ready.then(()=>{d.flush();reply({success:true,...d.snapshot(Number.isSafeInteger(message.after)?message.after:0,message.export?20000:500),restored,checkpointEvents:256});}).catch(()=>reply({success:false}));return true;
  }
  if(message.type==='DIAGNOSTICS_CONFIG'){
   void ready.then(async()=>{const settings=d.configure(message.config||{});await root.chrome.storage.local.set({[core.CONFIG_KEY]:settings});reply({success:true,config:settings});}).catch(()=>reply({success:false}));return true;
  }
  reply({success:false});return false;
 });
 async function checkpoint(){
  if(checkpointBusy||!restored||d.mode==='off')return;
  d.flush();const snapshot=d.snapshot(0,20000);
  if(!dirty&&snapshot.cursor===lastCheckpoint)return;
  checkpointBusy=true;dirty=false;lastCheckpoint=snapshot.cursor;
  const events=[];let bytes=0;for(const e of snapshot.events.slice(-256).reverse()){const size=JSON.stringify(e).length*2;if(bytes+size>512*1024)break;events.unshift(e);bytes+=size;}
  try{await root.chrome.storage.session.set({[core.CHECKPOINT_KEY]:{version:1,at:Date.now(),events}});}catch{dirty=true;d.event({component:'diagnostics',category:'telemetry',stage:'telemetry-failure',severity:'warn',code:'TELEMETRY_FAILED'});}finally{checkpointBusy=false;}
 }
 // Checkpoints are bounded and infrequent, never on a packet or audio transaction.
 root.setInterval(()=>{void checkpoint();},5000);
 root.chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes[core.CONFIG_KEY])d.configure(changes[core.CONFIG_KEY].newValue||{});});
 root.chrome.tabs?.onRemoved?.addListener(tabId=>{
  let count=0;for(const[id,source]of sources)if(source.tabId===tabId){sources.delete(id);count++;}
  if(count)d.event({component:'chrome',category:'lifecycle',stage:'context-ending',severity:'info',details:{count,context:'content',tabId}});
 });
 root.addEventListener?.('error',e=>d.exception(e,{extensionUrl:runtime.getURL(''),operation:'script-error'}));
 root.addEventListener?.('unhandledrejection',e=>d.exception(e,{extensionUrl:runtime.getURL(''),operation:'promise-rejection'}));
 root.DiagnosticsHub={ready,checkpoint,project};
})(globalThis);
