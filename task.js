'use strict';
const jobId=new URLSearchParams(location.search).get('jobId');
if(!jobId){document.querySelector('#taskStatus').textContent='Tarefa não informada.';}
else{
 const view=GlobalHud.mount(document.querySelector('#task'),{panel:true,jobId,send:message=>chrome.runtime.sendMessage(message),onState:state=>{document.querySelector('#taskStatus').textContent=state.jobs.some(job=>job.jobId===jobId)?'':'Resultado não disponível nesta sessão. Consulte o histórico nas Opções.';}});
 window.addEventListener('pagehide',()=>view.destroy(),{once:true});
}
