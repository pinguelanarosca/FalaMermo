/* Persistent archive for completed HUD tasks and closed STT recoveries. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.TaskArchive=api;})(globalThis,function(){
'use strict';
const DB_NAME='falamermo-task-archive-v1',DB_VERSION=2;
const clone=value=>JSON.parse(JSON.stringify(value));
class ArchiveStore{
 constructor({indexedDB}={}){this.indexedDB=indexedDB;}
 open(){if(this.opening)return this.opening;const provider=this.indexedDB||globalThis.indexedDB;if(!provider)return Promise.reject(new Error('IndexedDB de arquivamento indisponível.'));return this.opening=new Promise((resolve,reject)=>{const request=provider.open(DB_NAME,DB_VERSION);request.onupgradeneeded=()=>{const db=request.result;for(const [name,keyPath]of [['tasks','jobId'],['history','id'],['recoveries','jobId'],['taskSettings','jobId']])if(!db.objectStoreNames.contains(name))db.createObjectStore(name,{keyPath});const audio=db.objectStoreNames.contains('recoveryAudio')?request.transaction.objectStore('recoveryAudio'):db.createObjectStore('recoveryAudio',{keyPath:['jobId','packetSequence']});if(!audio.indexNames.contains('jobId'))audio.createIndex('jobId','jobId');};request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();this.opening=null;};resolve(db);};request.onerror=()=>{this.opening=null;reject(request.error||new Error('Não foi possível abrir o arquivo de tarefas.'));};request.onblocked=()=>{this.opening=null;reject(new Error('Arquivo de tarefas bloqueado por outra página.'));};});}
 transaction(stores,work){return this.open().then(db=>new Promise((resolve,reject)=>{const tx=db.transaction(stores,'readwrite');let value,error;tx.oncomplete=()=>resolve(value);tx.onabort=tx.onerror=()=>reject(error||tx.error||new Error('Falha ao atualizar o arquivo de tarefas.'));const fail=reason=>{error=reason;try{tx.abort();}catch{}};try{work(tx,result=>value=result,fail);}catch(reason){fail(reason);}}));}
 async read(store,key){const db=await this.open();return new Promise((resolve,reject)=>{const request=db.transaction(store).objectStore(store).get(key);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error||new Error('Falha ao consultar o arquivo de tarefas.'));});}
 async all(store){const db=await this.open();return new Promise((resolve,reject)=>{const request=db.transaction(store).objectStore(store).getAll();request.onsuccess=()=>resolve(request.result||[]);request.onerror=()=>reject(request.error||new Error('Falha ao listar o arquivo de tarefas.'));});}
 async putTask(task,settings={}){if(!task?.jobId)throw new Error('Tarefa sem identificador não pode ser arquivada.');await this.transaction(['tasks'],(tx,done)=>{const store=tx.objectStore('tasks'),current=store.get(task.jobId);current.onsuccess=()=>{const previous=current.result;store.put({jobId:task.jobId,archivedAt:Date.now(),pinned:task.pinned===true,task:clone(task),settings:settings&&Object.keys(settings).length?clone(settings):previous?.settings||{}});done({jobId:task.jobId});};});const stored=await this.getTask(task.jobId);if(!stored||JSON.stringify(stored.task)!==JSON.stringify(task)||Object.keys(settings||{}).length&&JSON.stringify(stored.settings)!==JSON.stringify(settings))throw new Error('A verificação da tarefa arquivada não confirmou conteúdo e configurações.');return{jobId:task.jobId};}
 putTaskSettings(jobId,settings){if(!jobId||!settings||!Object.keys(settings).length)return Promise.resolve(false);return this.transaction(['taskSettings'],(tx,done)=>{tx.objectStore('taskSettings').put({jobId,settings:clone(settings),updatedAt:Date.now()});done(true);});}
 getTaskSettings(jobId){return this.read('taskSettings',jobId).then(record=>record?.settings||{});}
 deleteTaskSettings(jobId){return this.transaction(['taskSettings'],(tx,done)=>{tx.objectStore('taskSettings').delete(jobId);done({removed:true});});}
 getTask(jobId){return this.read('tasks',jobId);}
 deleteTask(jobId){return this.transaction(['tasks'],(tx,done)=>{tx.objectStore('tasks').delete(jobId);done({removed:true});});}
 listTasks(){return this.all('tasks').then(items=>items.sort((a,b)=>(b.archivedAt||0)-(a.archivedAt||0)));}
 setTaskPinned(jobId,pinned){return this.transaction(['tasks'],(tx,done)=>{const store=tx.objectStore('tasks'),request=store.get(jobId);request.onsuccess=()=>{if(!request.result)return done(false);const item=request.result;item.pinned=pinned===true;item.task.pinned=item.pinned;store.put(item);done(true);};});}
 async putHistory(item){const id=item?.id||item?.jobId;if(!id)throw new Error('Histórico sem identificador não pode ser arquivado.');await this.transaction(['history'],(tx,done)=>{tx.objectStore('history').put({id,jobId:item.jobId||null,archivedAt:Date.now(),pinned:item.pinned===true,item:clone(item)});done({id});});const stored=await this.read('history',id);if(!stored||JSON.stringify(stored.item)!==JSON.stringify(item))throw new Error('A verificação do resultado arquivado falhou.');return{id};}
 listHistory(){return this.all('history').then(items=>items.sort((a,b)=>(b.archivedAt||0)-(a.archivedAt||0)));}
 getHistory(id){return this.read('history',id);}
 deleteHistory(id){return this.transaction(['history'],(tx,done)=>{tx.objectStore('history').delete(id);done({removed:true});});}
 setHistoryPinned(id,pinned){return this.transaction(['history'],(tx,done)=>{const store=tx.objectStore('history'),request=store.get(id);request.onsuccess=()=>{if(!request.result)return done(false);const item=request.result;item.pinned=pinned===true;item.item.pinned=item.pinned;store.put(item);done(true);};});}
 clearTasks(){return this.transaction(['tasks','history','taskSettings'],(tx,done)=>{tx.objectStore('tasks').clear();tx.objectStore('history').clear();tx.objectStore('taskSettings').clear();done({cleared:true});});}
 async archiveRecovery(job,packets){
  if(!job?.jobId||job.state==='recording'||job.pinned===true)throw new Error('Recuperação ativa ou fixada não pode ser arquivada.');
  const records=[];
  for(const packet of packets){const raw=new Uint8Array(packet.pcm),copy=raw.slice();let codec='raw',data=copy.buffer;
   if(typeof CompressionStream==='function'&&typeof Blob!=='undefined'&&typeof Response!=='undefined')try{const stream=new Blob([copy]).stream().pipeThrough(new CompressionStream('gzip'));data=await new Response(stream).arrayBuffer();codec='gzip';if(data.byteLength>=copy.byteLength){data=copy.buffer;codec='raw';}}catch{/* O PCM sem compressão continua íntegro no arquivo separado. */}
   const{pcm,...metadata}=packet;records.push({jobId:job.jobId,packetSequence:packet.packetSequence,metadata:clone(metadata),codec,data,rawBytes:copy.byteLength});
  }
  const archived={...clone(job),archivedAt:Date.now(),pinned:job.pinned===true};
  await this.transaction(['recoveries','recoveryAudio'],(tx,done)=>{const recoveries=tx.objectStore('recoveries'),audio=tx.objectStore('recoveryAudio');recoveries.put(archived);for(const record of records)audio.put(record);done({jobId:job.jobId,packets:records.length});});
  const verify=await this.read('recoveries',job.jobId),stored=await this.rawPackets(job.jobId),source=[...packets].sort((a,b)=>a.packetSequence-b.packetSequence);
  let exact=Boolean(verify&&stored.length===source.length&&stored.reduce((sum,p)=>sum+p.rawBytes,0)===(job.bytes||0));
  for(const key of Object.keys(job))if(JSON.stringify(verify?.[key])!==JSON.stringify(job[key]))exact=false;
  for(let i=0;exact&&i<source.length;i++){const before=new Uint8Array(source[i].pcm),after=await this.decodePacket(stored[i]),beforeMeta=Object.fromEntries(Object.entries(source[i]).filter(([key])=>key!=='pcm')),afterMeta=Object.fromEntries(Object.entries(stored[i].metadata).filter(([key])=>key!=='pcm'));if(JSON.stringify(beforeMeta)!==JSON.stringify(afterMeta)||before.length!==after.length){exact=false;break;}for(let n=0;n<before.length;n++)if(before[n]!==after[n]){exact=false;break;}}
  if(!exact)throw new Error('A verificação do áudio arquivado não confirmou amostras idênticas.');
  return{jobId:job.jobId,packets:stored.length,bytes:job.bytes};
 }
 listRecoveries(){return this.all('recoveries').then(items=>items.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)));}
 getRecovery(jobId){return this.read('recoveries',jobId);}
 async rawPackets(jobId,sequence){const db=await this.open();return new Promise((resolve,reject)=>{const request=db.transaction('recoveryAudio').objectStore('recoveryAudio').index('jobId').getAll(jobId);request.onsuccess=()=>resolve(request.result.filter(row=>sequence===undefined||row.metadata.sequence===sequence).sort((a,b)=>a.packetSequence-b.packetSequence));request.onerror=()=>reject(request.error||new Error('Falha ao ler áudio arquivado.'));});}
 async decodePacket(row){let pcm=row.data;if(row.codec==='gzip'){const stream=new Blob([row.data]).stream().pipeThrough(new DecompressionStream('gzip'));pcm=await new Response(stream).arrayBuffer();}return new Uint8Array(pcm);}
 async packets(jobId,sequence){const rows=await this.rawPackets(jobId,sequence),out=[];for(const row of rows)out.push({...row.metadata,pcm:await this.decodePacket(row)});return out;}
 removeRecovery(jobId){return this.transaction(['recoveries','recoveryAudio'],(tx,done)=>{tx.objectStore('recoveries').delete(jobId);const store=tx.objectStore('recoveryAudio').index('jobId'),cursor=store.openCursor(jobId);let packets=0;cursor.onsuccess=()=>{const row=cursor.result;if(row){packets++;row.delete();row.continue();}else done({removed:true,packets});};});}
 setRecoveryPinned(jobId,pinned){return this.transaction(['recoveries'],(tx,done)=>{const store=tx.objectStore('recoveries'),request=store.get(jobId);request.onsuccess=()=>{if(!request.result)return done(false);const item=request.result;item.pinned=pinned===true;store.put(item);done(true);};});}
}
let singleton;
return{create:options=>new ArchiveStore(options),getDefault:()=>singleton||(singleton=new ArchiveStore()),ArchiveStore};
});
