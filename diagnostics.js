/* View state never controls collection. Polls do not run on the audio path. */
(()=>{
 'use strict';
 const $=id=>document.getElementById(id),view=new DiagnosticsCore.View();
 let events=[],cursor=0,sourceId=null,busy=false,configured=false,lastSnapshot=null,renderedSource=null;
 const send=message=>chrome.runtime.sendMessage(message);
 const filters=()=>({component:$('component').value,severity:$('severity').value,jobId:$('jobId').value.trim()});
 function render(){
  view.events=events;const rows=view.visible(filters()).slice(-500),body=$('events'),previous=Array.from(body.children),fragment=document.createDocumentFragment();
  const start=rows.length?previous.findIndex(row=>Number(row.dataset.sequence)===rows[0].sequence):-1;
  const retained=start>=0&&renderedSource===sourceId&&previous.slice(start).every((row,index)=>Number(row.dataset.sequence)===rows[index]?.sequence)?previous.length-start:0;
  if(retained){for(let i=0;i<start;i++)previous[i].remove();}else body.replaceChildren();
  for(const event of rows.slice(retained)){
   const row=document.createElement('tr');row.dataset.severity=event.severity;row.dataset.sequence=event.sequence;row.title=(event.sourceId||'')+' · sequência de origem '+(event.sourceSeq||'—');
   for(const value of [new Date(event.at||event.receivedAt).toLocaleTimeString('pt-BR',{hour12:false})+'.'+String((event.at||event.receivedAt)%1000).padStart(3,'0')+' · #'+event.sequence,event.component+' / '+(event.context||'background')+' · '+event.severity,event.category+' / '+event.stage,event.durationMs===undefined?'—':event.durationMs.toFixed(2)+' ms',[event.jobId,event.chunkId,event.sessionId,event.requestId].filter(Boolean).join('\n')||'—',JSON.stringify({...event.details,...(event.code?{code:event.code,message:event.message}:{})})]){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}
   fragment.append(row);
  }
  body.append(fragment);renderedSource=sourceId;
  $('status').textContent=(view.paused?'Visualização pausada. ':'')+(lastSnapshot?`${lastSnapshot.retained} eventos no coletor · ${rows.length} exibidos · ${(lastSnapshot.bytes/1024).toFixed(0)} KiB contabilizados · ${lastSnapshot.dropped} descartados pelo limite · ${lastSnapshot.aggregateLost} agregados não retidos · ${lastSnapshot.failures} falhas de telemetria · modo ${lastSnapshot.config.mode}`:'');
 }
 async function poll(){
  if(busy||view.paused)return;busy=true;
  try{
   let snapshot=await send({type:'DIAGNOSTICS_GET',after:cursor,export:!sourceId});if(!snapshot?.success)throw Error('Coletor indisponível.');
   const changed=cursor!==snapshot.cursor||sourceId!==snapshot.sourceId||lastSnapshot?.config.mode!==snapshot.config.mode||lastSnapshot?.config.capacity!==snapshot.config.capacity||lastSnapshot?.dropped!==snapshot.dropped;
   if(sourceId&&sourceId!==snapshot.sourceId){events=[];cursor=0;view.after=0;snapshot=await send({type:'DIAGNOSTICS_GET',after:0,export:true});if(!snapshot?.success)throw Error();}
   sourceId=snapshot.sourceId;lastSnapshot=snapshot;
   if(snapshot.events.length){cursor=snapshot.events.at(-1).sequence;events=events.concat(snapshot.events).slice(-snapshot.config.capacity);}
   else cursor=snapshot.cursor;
   view.cursor=cursor;
   if(!configured){$('mode').value=snapshot.config.mode;$('capacity').value=snapshot.config.capacity;configured=true;}
   if(changed){$('tasks').replaceChildren(...[...new Set(events.map(e=>e.jobId).filter(Boolean))].slice(-256).map(id=>{const option=document.createElement('option');option.value=id;return option;}));render();}
  }catch{$('status').textContent='Conexão com o coletor indisponível. Tentando novamente…';}finally{busy=false;}
 }
 $('pause').addEventListener('click',()=>{view.paused=!view.paused;$('pause').textContent=view.paused?'Retomar visualização':'Pausar visualização';render();if(!view.paused)void poll();});
 $('clear').addEventListener('click',()=>{view.clear();render();});
 for(const id of ['component','severity','jobId'])$(id).addEventListener(id==='jobId'?'input':'change',render);
 $('configure').addEventListener('click',async()=>{try{const result=await send({type:'DIAGNOSTICS_CONFIG',config:{mode:$('mode').value,capacity:Number($('capacity').value)}});if(!result?.success)throw Error();$('capacity').value=result.config.capacity;configured=false;await poll();}catch{$('status').textContent='Não foi possível alterar a coleta.';}});
 $('save').addEventListener('click',async()=>{
  $('save').disabled=true;
  try{
   const result=await send({type:'DIAGNOSTICS_GET',export:true});if(!result?.success)throw Error();
   const output={...result,exportedAt:new Date().toISOString(),ordering:'collector-receipt; original at/monotonicMs/sourceId/sourceSeq retained',privacy:'No audio, text, credentials or raw exception messages'};
   delete output.success;
   const url=URL.createObjectURL(new Blob([JSON.stringify(output,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='falamermo-diagnostico-'+Date.now()+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch{$('status').textContent='Não foi possível exportar os logs.';}finally{$('save').disabled=false;}
 });
 setInterval(()=>{void poll();},500);void poll();
})();
