'use strict';
// Real capture, registry, editor insertion, PCM playback and history; provider/mic input are fixtures.
const assert=require('node:assert/strict');
module.exports=async({stage,stt,call,evaluate,page,content,hud,state,worker,audio,waitFor})=>{
 const id=stt.jobId,selector='[data-task-id="'+id+'"]',job=async()=>(await state()).jobs.find(j=>j.jobId===id);
 const floating=expression=>content('(()=>{const h=document.querySelector("#ext-tts-stt-task-host")?.shadowRoot;return '+expression+'})()');
 const targets=(await call('Target.getTargets')).targetInfos.filter(t=>t.type==='page').length;
 const before=await hud('({visible:!hud.querySelector(".ext-hud-card").classList.contains("hidden"),minimized:hud.querySelector(".ext-hud-card").dataset.minimized})');
 await hud('hud.querySelector('+JSON.stringify('[data-job-id="'+id+'"] [data-action=maximize]')+').click()');
 await waitFor('ditado na apresentação flutuante',()=>floating('!!h?.querySelector('+JSON.stringify(selector+' textarea')+')'));
 assert.equal((await call('Target.getTargets')).targetInfos.filter(t=>t.type==='page').length,targets);
 if(stage==='recording'){
  assert.equal(await floating('h.querySelector('+JSON.stringify(selector+' textarea')+').disabled'),true);assert.equal((await job()).status,'recording');
  assert.equal(await content('fixtureStt.isRecording&&fixtureStt.liveCapture.stream.getTracks().every(t=>t.readyState==="live")'),true);
 }else{
  const original=(await job()).text,input=await content('document.querySelector("textarea").value'),copy='Cópia revisada na tarefa flutuante.';
  assert.equal(await floating('h.querySelector('+JSON.stringify(selector+' textarea')+').disabled'),false);
  await floating('(()=>{const e=h.querySelector('+JSON.stringify(selector+' textarea')+');e.value='+JSON.stringify(copy)+';e.dispatchEvent(new Event("input",{bubbles:true}))})()');await waitFor('cópia de trabalho salva',async()=>(await job()).workingText===copy);
  assert.equal((await job()).text,original);assert.equal(await content('document.querySelector("textarea").value'),input);
  await floating('h.querySelector('+JSON.stringify(selector+' [data-action=narrate]')+').click()');await waitFor('narração da cópia no mesmo job',async()=>(await job()).narration?.status==='connecting');
  const offscreen=await audio();await waitFor('provider recebeu cópia revisada',()=>evaluate(offscreen,'fixtureTurns.some(s=>s.readyState===1)'));assert.ok(JSON.stringify(await evaluate(offscreen,'fixtureTtsTexts')).includes(copy));
  await evaluate(offscreen,'fixtureTurns.splice(0).filter(s=>s.readyState===1).forEach(s=>s.receive({...fixturePcm(),turnComplete:true,interactionStatus:"IDLE"}))');let played=false;
  await waitFor('narração da cópia concluída',async()=>{const j=await job();if(j.narration?.status==='playing')played=true;return j.narration?.status==='completed';});assert.equal(played,true);
  assert.equal((await job()).text,original);assert.equal(await content('document.querySelector("textarea").value'),input);assert.equal(await evaluate(worker,'chrome.storage.local.get("history").then(s=>s.history.recentItems.find(j=>j.jobId==='+JSON.stringify(id)+')?.text)'),original);
 }
 await floating('h.querySelector('+JSON.stringify(selector+' .fm-task-close')+').click()');await waitFor('fecha somente apresentação do ditado',()=>floating('!h.querySelector('+JSON.stringify(selector)+')'));
 assert.deepEqual(await hud('({visible:!hud.querySelector(".ext-hud-card").classList.contains("hidden"),minimized:hud.querySelector(".ext-hud-card").dataset.minimized})'),before);
 assert.equal((await job()).status,stage==='recording'?'recording':'completed');
 console.log('VERIFICADO: tarefa flutuante STT '+(stage==='recording'?'preserva captura ativa e alvo original ao abrir/fechar.':'edita/narra cópia no mesmo job com PCM real; transcrição, inserção e histórico originais preservados.'));
};
