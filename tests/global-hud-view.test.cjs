const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const GlobalHud=require('../global-hud.js');

function dom(){
  const doc={activeElement:null,defaultView:{navigator:{}}};
  class Element{
    constructor(tag){this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.dataset={};this.attributes={};this.textContent='';this.hidden=false;this.disabled=false;this.value='';}
    append(...nodes){for(const node of nodes){if(node.parentNode)node.remove();this.children.push(node);node.parentNode=this;}}
    setAttribute(name,value){this.attributes[name]=value;}
    insertBefore(node,before){if(node===before)return;if(node.parentNode)node.remove();const index=this.children.indexOf(before);this.children.splice(index<0?this.children.length:index,0,node);node.parentNode=this;}
    focus(){doc.activeElement=this;}
    remove(){if(this.parentNode){this.parentNode.children=this.parentNode.children.filter(node=>node!==this);this.parentNode=null;}}
  }
  doc.createElement=tag=>new Element(tag);
  const container=new Element('div');
  function all(node=container){return[node,...node.children.flatMap(child=>all(child))];}
  return{doc,container,all,find:predicate=>all().find(predicate),card:id=>all().find(node=>node.dataset.jobId===id),button:(id,action)=>all(all().find(node=>node.dataset.jobId===id)).find(node=>node.dataset.action===action)};
}
function state(revision=1){return{revision,visible:true,minimized:false,activeTaskId:'tts-one',jobs:[
  {jobId:'tts-one',type:'TTS',origin:{tabId:4,frameId:0},status:'playing',text:'Texto público da narração.',progress:{currentTime:2,duration:20},controls:{stop:true,pause:true,volume:true,playbackRate:true,copy:true}},
  {jobId:'stt-two',type:'STT',origin:{tabId:9,frameId:2},status:'recording',text:'Segmento confirmado.',partialText:'Palavra provisória',controls:{stop:true,copy:true}},
  {jobId:'tts-three',type:'TTS',origin:{tabId:12,frameId:0},status:'paused',text:'Outra narração.',controls:{stop:true,resume:true,copy:true}},
]};}
function fixture({initial=state(),clipboard={writeText:async()=>{}},send,jobId}={}){
  const d=dom(),requests=[];const transport=async message=>{requests.push(message);return send?send(message):{success:true,state:initial};};
  const view=GlobalHud.mount(d.container,{send:transport,clipboard,jobId});return{...d,view,requests};
}

test('HUD recupera todos os jobs sem iniciar sessões, usa cartões independentes e comandos isolados',async()=>{
  let current=state();const e=fixture({send:async message=>{
    if(message.type==='HUD_GLOBAL_COMMAND'){current={...current,revision:current.revision+1,jobs:current.jobs.map(job=>job.jobId===message.payload.jobId?{...job,status:'cancelled',controls:{copy:true,remove:true}}:job)};}
    return{success:true,state:current};
  }});await e.view.ready;
  assert.deepEqual(e.requests.map(m=>m.type),['HUD_GLOBAL_GET']);assert.equal(e.all().filter(n=>n.dataset.jobId).length,3);
  const tts=e.card('tts-one'),third=e.card('tts-three');await e.button('stt-two','stop').onclick();
  assert.equal(e.requests[1].type,'HUD_GLOBAL_COMMAND');assert.deepEqual(e.requests[1].payload,{jobId:'stt-two',action:'stop'});
  assert.equal(e.card('tts-one'),tts);assert.equal(e.card('tts-three'),third);assert.equal(e.button('tts-one','pause'),undefined);assert.equal(e.button('tts-three','resume'),undefined);assert.equal(e.find(n=>n.dataset.action==='toggle').textContent,'⏸');assert.equal(e.button('stt-two','stop').hidden,true);
});

test('duas representações recebem o mesmo estado sem inserir texto na aba visualizadora',async()=>{
  let current=state();const a=fixture({initial:current}),b=fixture({initial:current});await Promise.all([a.view.ready,b.view.ready]);
  current={...current,revision:2,jobs:current.jobs.map(job=>job.jobId==='stt-two'?{...job,status:'completed',text:'Transcrição final.',partialText:'',controls:{copy:true,remove:true}}:job)};
  a.view.update(current);b.view.update(current);
  assert.equal(a.card('stt-two').children[3].children[1].textContent,'Transcrição final.');assert.equal(b.card('stt-two').children[3].children[1].textContent,'Transcrição final.');
  assert.equal(a.requests.length,1);assert.equal(b.requests.length,1);
  const commands=fs.readFileSync(require.resolve('../global-hud.js'),'utf8');assert.doesNotMatch(commands,/injectTranscribedText|STT_LIVE_START|TTS_LIVE_START|execCommand\(/);
});

test('revisões antigas e duplicadas não apagam progresso nem texto; GET tardio não vence broadcast',async()=>{
  let resolve;const initial=new Promise(r=>resolve=r);const e=fixture({send:()=>initial});
  e.view.update({...state(9),jobs:[{jobId:'new',type:'STT',status:'completed',text:'Recebido agora.',controls:{copy:true}}]});
  resolve({success:true,state:state(1)});await e.view.ready;
  assert.equal(e.card('tts-one'),undefined);assert.ok(e.card('new'));assert.equal(e.view.update(state(9)),false);assert.equal(e.view.update(state(8)),false);assert.ok(e.card('new'));
});

test('cópia exige clique, copia somente texto e mantém provisório explicitamente rotulado',async()=>{
  const copied=[],e=fixture({jobId:'tts-one',clipboard:{writeText:async value=>copied.push(value)}}),s=fixture({jobId:'stt-two',clipboard:{writeText:async value=>copied.push(value)}});await s.view.ready;await e.view.ready;
  assert.deepEqual(copied,[]);await e.button('tts-one','copy').onclick();await s.button('stt-two','copy').onclick();
  assert.deepEqual(copied,['Texto público da narração.','Segmento confirmado. Palavra provisória']);assert.ok(s.all(s.card('stt-two')).some(node=>node.textContent==='Transcrição provisória'));
  assert.ok(s.all(s.card('stt-two')).some(node=>node.textContent==='Texto copiado.'));
  assert.ok(e.all().find(node=>node.tagName==='STYLE').textContent.includes('user-select:text!important'));
  assert.ok(e.all().every(node=>!node.onpointerdown&&!node.onmousedown));
});

test('falha de clipboard preserva texto e orienta seleção; parcial sozinho continua recuperável',async()=>{
  const initial={...state(),jobs:[{jobId:'partial',type:'STT',status:'error',text:'',partialText:'Só o resultado realmente recebido.',incomplete:true,originAvailable:false,controls:{copy:true,remove:true}}]},e=fixture({initial,jobId:'partial',clipboard:{writeText:async()=>{throw Error('negado');}}});await e.view.ready;
  await assert.doesNotReject(e.button('partial','copy').onclick());assert.equal(e.button('partial','copy').disabled,false);
  assert.ok(e.all().some(node=>node.textContent.includes('Selecione o texto e use Ctrl+C')));assert.ok(e.all().some(node=>node.textContent==='Só o resultado realmente recebido.'));assert.ok(e.all().some(node=>node.textContent.includes('nenhum texto será inserido nesta aba')));
  assert.equal(e.button('partial','copyPartial'),undefined);
});

test('minimização esconde o corpo; painel continua acessível e cópia fica só na janela',async()=>{
  let current=state();const e=fixture({send:async message=>{if(message.type==='HUD_GLOBAL_UI_SET')current={...current,...message.payload,revision:current.revision+1};return{success:true,state:current};}});await e.view.ready;
  await e.find(node=>node.textContent==='Minimizar').onclick();const root=e.find(node=>node.className==='fm-global-hud');
  assert.equal(root.dataset.minimized,'true');assert.equal(e.button('stt-two','stop').hidden,false);assert.equal(e.button('tts-one','copy'),undefined);assert.equal(root.hidden,false);
  await e.find(node=>node.textContent==='Ocultar HUD').onclick();assert.equal(root.hidden,true);assert.deepEqual(e.requests.at(-1).payload,{visible:false});
  const d=dom(),panel=GlobalHud.mount(d.container,{panel:true,send:async()=>({success:true,state:current})});await panel.ready;assert.equal(d.find(node=>node.className==='fm-global-hud').hidden,false);assert.equal(d.button('stt-two','stop').hidden,false);
});

test('atualizações preservam DOM selecionável, removem só job indicado e controles TTS não cruzam tarefas',async()=>{
  let current=state();const e=fixture({send:async message=>{if(message.type==='HUD_GLOBAL_COMMAND')current={...current,revision:current.revision+1};return{success:true,state:current};}});await e.view.ready;
  const first=e.card('tts-one'),body=first.children[3].children[1],volume=e.find(n=>n.dataset.control==='volume');volume.value='.35';await volume.oninput();assert.deepEqual(e.requests.at(-1).payload,{jobId:'tts-one',action:'set',volume:.35});
  current={...current,revision:3,jobs:current.jobs.map(job=>({...job,progress:{forwardedChunks:90,pendingChunks:2}}))};e.view.update(current);assert.equal(e.card('tts-one'),first);assert.equal(e.card('tts-one').children[3].children[1],body);assert.equal(body.textContent,'Texto público da narração.');
  e.view.update({...current,revision:4,jobs:current.jobs.filter(job=>job.jobId!=='stt-two')});assert.equal(e.card('stt-two'),undefined);assert.equal(e.card('tts-one'),first);assert.ok(e.card('tts-three'));
});

test('comando recusado não produz rejeição perdida nem altera outros cartões; destroy tolera resposta tardia',async()=>{
  const e=fixture({send:async message=>message.type==='HUD_GLOBAL_GET'?{success:true,state:state()}:{success:false,error:'negado'}});await e.view.ready;
  await assert.doesNotReject(e.button('stt-two','stop').onclick());assert.equal(e.button('stt-two','stop').disabled,false);assert.ok(e.card('tts-one'));assert.ok(e.all().some(node=>node.textContent.includes('Não foi possível aplicar o comando')));
  let resolve;const deferred=new Promise(r=>resolve=r),late=fixture({send:()=>deferred});late.view.destroy();resolve({success:true,state:state()});await late.view.ready;assert.equal(late.container.children.length,0);assert.equal(late.view.update(state(20)),false);
});

test('popup carrega renderer e controla estado global mesmo em página protegida, sem iniciar jobs',()=>{
  const html=fs.readFileSync(require.resolve('../popup.html'),'utf8'),source=fs.readFileSync(require.resolve('../popup.js'),'utf8');
  assert.match(html,/<section id="globalTasks"/);assert.ok(html.indexOf('src="global-hud.js"')<html.indexOf('src="popup.js"'));
  assert.match(source,/GlobalHud\.mount\([^\n]+panel:true/);assert.match(source,/HUD_GLOBAL_STATE/);assert.doesNotMatch(source,/CMD_READ_SELECTION|CMD_START_DICTATION|chrome\.tabs|chrome\.scripting|TOGGLE_HUD/);assert.doesNotMatch(html,/id="read"|id="dictate"/);assert.match(fs.readFileSync(require.resolve('../global-hud.js'),'utf8'),/HUD_GLOBAL_UI_SET/);
});

test('callback de estado sincroniza wrapper sem GET duplicado ou recursão em mesma revisão',async()=>{
  const d=dom();let seen=[],view;
  view=GlobalHud.mount(d.container,{send:async()=>({success:true,state:state(3)}),onState:s=>{seen.push(s.revision);view?.update(s);}});
  await view.ready;assert.deepEqual(seen,[3]);assert.equal(view.update(state(3)),false);assert.deepEqual(seen,[3]);
  assert.equal(view.update(state(4)),true);assert.deepEqual(seen,[3,4]);
});

test('volume e velocidade refletem o snapshot normalizado do registro global',async()=>{
  const initial=state();initial.jobs[0].progress={volume:.35,playbackRate:1.4};const e=fixture({initial});await e.view.ready;
  assert.equal(e.find(n=>n.dataset.control==='volume').value,'0.35');assert.equal(e.find(n=>n.dataset.control==='playbackRate').value,'1.4');
});
test('falha e limites de armazenamento são visíveis sem ocultar o texto recuperável',async()=>{
  const initial={...state(),jobs:[{jobId:'failed',type:'STT',origin:{tabId:0},status:'error',text:'Texto recuperável.',error:'Envio sem confirmação.',historyStatus:'failed',capacityWarning:true,controls:{copy:true}}]},e=fixture({initial});await e.view.ready;
  assert.ok(e.all().some(n=>n.textContent==='Origem: painel da extensão'));const note=e.all().find(n=>n.className==='fm-global-note').textContent;assert.match(note,/Envio sem confirmação/);assert.match(note,/Não foi possível salvar o histórico/);assert.match(note,/ultrapassou o orçamento/);assert.equal(e.button('failed','copy'),undefined);
});

test('player global usa comando único independente da seleção e nunca inicia concluídos',async()=>{
 let current={...state(),activeTaskId:'stt-two'};
 const e=fixture({send:async message=>{if(message.type==='HUD_GLOBAL_TOGGLE'){const playing=current.jobs.some(j=>j.status==='playing');current={...current,revision:current.revision+1,jobs:current.jobs.map(j=>j.type==='TTS'?{...j,status:playing?'paused':'completed'}:j)};}return{success:true,state:current};}});await e.view.ready;
 const toggle=e.find(n=>n.dataset.action==='toggle');assert.equal(toggle.textContent,'⏸');await toggle.onclick();assert.equal(e.requests.at(-1).type,'HUD_GLOBAL_TOGGLE');assert.deepEqual(e.requests.at(-1).payload,{action:'pause'});assert.equal(toggle.textContent,'▶');await toggle.onclick();assert.equal(toggle.disabled,true);
 assert.equal(e.all().filter(n=>n.dataset.action==='toggle').length,1);assert.ok(!e.requests.some(m=>m.payload?.action==='play'));
});

test('tarefa manual edita, cola, sincroniza, expande/recolhe e inicia no motor existente',async()=>{
 const r=require('../global-jobs.js').create();let count=0;const d=dom(),requests=[];
 const view=GlobalHud.mount(d.container,{panel:true,send:async message=>{requests.push(message);if(message.type==='HUD_GLOBAL_CREATE')return{success:true,state:await r.draft({jobId:'manual-'+(++count),agentId:'custom',origin:{}})};const p=message.payload||{};if(message.type==='HUD_GLOBAL_COMMAND'){if(p.action==='edit')await r.edit(p);if(p.action==='collapse')await r.collapse(p);if(p.action==='play'){await r.preparePlayback({jobId:p.jobId,requestId:'play-1'});await r.event({jobId:p.jobId,requestId:'play-1',event:'play',eventSeq:1});}}return{success:true,state:await r.get()};}});await view.ready;
 await d.find(n=>n.dataset.action==='create').onclick();const editor=d.find(n=>n.tagName==='TEXTAREA');assert.equal(editor.disabled,false);editor.value='Texto digitado.';await editor.oninput();await editor.onchange();editor.value+='\nTexto colado com <tag> e símbolos.';await editor.oninput();assert.equal((await r.get()).jobs[0].text,editor.value);
 await d.button('manual-1','collapse').onclick();assert.equal(d.card('manual-1').children[3].hidden,true);await d.button('manual-1','collapse').onclick();assert.equal(d.card('manual-1').children[3].hidden,false);
 assert.equal(d.find(n=>n.dataset.action==='toggle').disabled,true);await d.button('manual-1','playPause').onclick();assert.equal((await r.get()).jobs[0].status,'playing');assert.equal(editor.disabled,true);assert.equal((await r.get()).jobs[0].agentId,'custom');assert.ok(!requests.some(m=>/CMD_|STT_LIVE|LENS/.test(m.type)));assert.equal(d.all().filter(n=>n.dataset.control==='volume').length,1);view.destroy();
});

test('edição rejeitada preserva rascunho local e não inicia áudio com texto divergente',async()=>{
 const initial={revision:1,visible:true,activeTaskId:'manual',jobs:[{jobId:'manual',type:'TTS',manual:true,status:'ready',text:'Original.',controls:{edit:true,play:true,remove:true}}]},e=fixture({initial,send:async message=>message.type==='HUD_GLOBAL_GET'?{success:true,state:initial}:{success:false,error:'Texto alterado em outro painel.'}});await e.view.ready;
 const editor=e.find(n=>n.tagName==='TEXTAREA');editor.value='Minha edição.';await editor.oninput();await e.button('manual','playPause').onclick();assert.equal(editor.value,'Minha edição.');assert.ok(e.all().some(n=>n.textContent.includes('Texto alterado em outro painel')));assert.ok(!e.requests.some(m=>m.payload?.action==='play'));
});

test('seek não simula palavras por tempo nem dispara geração/cancelamento oculto',async()=>{
 const e=fixture();await e.view.ready;const count=e.requests.length;assert.equal(e.find(n=>n.dataset.action==='previous').disabled,true);assert.equal(e.find(n=>n.dataset.action==='next').disabled,true);await e.view.seekWords(5);await e.view.seekWords(-3);assert.equal(e.requests.length,count);assert.ok(e.all().some(n=>n.textContent.includes(GlobalHud.SEEK_LIMITATION)));assert.match(e.find(n=>n.dataset.action==='previous').title,/PCM/);
});

test('Play imediatamente após digitar espera save em voo e não envia Pause a rascunho vazio',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve),requests=[];let current={revision:1,visible:true,activeTaskId:'manual',jobs:[{jobId:'manual',type:'TTS',manual:true,status:'ready',text:'',controls:{edit:true,play:false,remove:true}}]};
 const e=fixture({send:async message=>{requests.push(message);if(message.payload?.action==='edit'){await gate;current={...current,revision:2,jobs:[{...current.jobs[0],text:message.payload.text,controls:{edit:true,play:true,remove:true}}]};}if(message.payload?.action==='play')current={...current,revision:3,jobs:[{...current.jobs[0],status:'playing',controls:{pause:true,stop:true}}]};return{success:true,state:current};}});await e.view.ready;
 const editor=e.find(n=>n.tagName==='TEXTAREA');editor.value='Texto recém-digitado.';const saving=editor.oninput(),playing=e.button('manual','playPause').onclick();assert.ok(!requests.some(m=>m.payload?.action==='play'));release();await Promise.all([saving,playing]);assert.deepEqual(requests.filter(m=>m.type==='HUD_GLOBAL_COMMAND').map(m=>m.payload.action),['edit','play']);assert.equal(e.find(n=>n.dataset.action==='toggle').textContent,'⏸');
});

test('cartão recolhido deixa somente cabeçalho e três controles; ordem segue createdAt em quatro views',async()=>{
 const initial={...state(),jobs:state().jobs.map((j,i)=>({...j,createdAt:i+1,collapsed:true}))},views=Array.from({length:4},()=>fixture({initial}));await Promise.all(views.map(e=>e.view.ready));
 for(const e of views){const card=e.card('tts-one');for(const child of card.children.slice(1))assert.equal(child.hidden,true);assert.deepEqual(card.children[0].children.find(n=>n.className==='fm-global-card-tools').children.map(n=>n.dataset.action),['collapse','maximize','remove']);assert.equal(e.button('tts-one','copy'),undefined);assert.deepEqual(e.find(n=>n.className==='fm-global-jobs').children.map(n=>n.dataset.jobId),['tts-three','stt-two','tts-one']);}
 const next={...initial,revision:2,jobs:initial.jobs.map(j=>({...j,updatedAt:100,progress:{currentTime:1}}))};views.forEach(e=>e.view.update(next));assert.ok(views.every(e=>e.find(n=>n.className==='fm-global-jobs').children[0].dataset.jobId==='tts-three'));
});
test('janela usa mesmo job e cópia STT editável separada; conflito preserva buffer local',async()=>{
 const initial={...state(),jobs:[{jobId:'s',type:'STT',status:'completed',text:'Original <img onerror=alert(1)>',workingText:'Cópia.',controls:{edit:true}}]},e=fixture({initial,jobId:'s',send:async m=>m.type==='HUD_GLOBAL_GET'?{success:true,state:initial}:{success:false,error:'Texto alterado em outro painel.'}});await e.view.ready;
 assert.equal(e.card('s').children[3].children[1].textContent,initial.jobs[0].text);assert.equal(e.button('s','playPause').hidden,true);const editor=e.find(n=>n.tagName==='TEXTAREA');assert.equal(editor.value,'Cópia.');editor.value='Pendente.';await editor.oninput();e.view.update({...initial,revision:3,jobs:[{...initial.jobs[0],workingText:'Outro painel.'}]});assert.equal(editor.value,'Pendente.');assert.ok(e.all().some(n=>n.textContent.includes('outro painel')));assert.equal(e.button('s','copy').hidden,false);
});
test('setas enfileiram todos os cliques de 5 segundos, sem geração nem stop',async()=>{
 const initial=state();initial.jobs[0].controls.seek=true;initial.jobs[0].progress.availableEnd=30;const e=fixture({initial});await e.view.ready;await Promise.all([e.view.seekWords(1),e.view.seekWords(1),e.view.seekWords(-1)]);assert.deepEqual(e.requests.filter(m=>m.type==='HUD_GLOBAL_COMMAND').map(m=>m.payload),[{jobId:'tts-one',action:'seek',deltaSeconds:5},{jobId:'tts-one',action:'seek',deltaSeconds:5},{jobId:'tts-one',action:'seek',deltaSeconds:-5}]);
});
test('cada cartão TTS e janela contém transporte próprio, sem aumentar cabeçalho ou controlar STT',async()=>{
 const initial=state();initial.jobs[0].controls.seek=true;initial.jobs[0].progress={currentTime:12,duration:40,availableStart:0,availableEnd:40};
 for(const jobId of [undefined,'tts-one']){const e=fixture({initial,jobId});await e.view.ready;const actions=e.all(e.card('tts-one')).filter(n=>['previous','playPause','next','stop'].includes(n.dataset.action));assert.deepEqual(actions.map(n=>n.textContent),['⏪','⏸','⏩','■']);assert.ok(actions.every(n=>n.parentNode.className==='fm-global-actions'));await Promise.all([e.button('tts-one','previous').onclick(),e.button('tts-one','next').onclick()]);assert.deepEqual(e.requests.filter(m=>m.type==='HUD_GLOBAL_COMMAND').map(m=>m.payload),[{jobId:'tts-one',action:'seek',deltaSeconds:-5},{jobId:'tts-one',action:'seek',deltaSeconds:5}]);}
 const e=fixture({initial});await e.view.ready;assert.ok(['previous','playPause','next'].every(action=>e.button('stt-two',action).hidden));assert.deepEqual(e.find(n=>n.className==='fm-global-player-buttons').children.slice(0,3).map(n=>n.textContent),['⏪','⏸','⏩']);
});
test('toggle individual espera ACK, não altera ícone otimista nem duplica comando em voo',async()=>{
 let release;const e=fixture({send:message=>message.type==='HUD_GLOBAL_COMMAND'?new Promise(r=>release=r):Promise.resolve({success:true,state:state()})});await e.view.ready;const button=e.button('tts-one','playPause'),pending=button.onclick();await new Promise(r=>setImmediate(r));assert.equal(button.textContent,'⏸');assert.equal(button.disabled,true);await button.onclick();assert.equal(e.requests.filter(m=>m.type==='HUD_GLOBAL_COMMAND').length,1);release({success:false,error:'Player não confirmou.'});await pending;assert.equal(button.textContent,'⏸');assert.equal(button.disabled,false);
});
test('HUD minimizado mantém os mesmos três botões globais acessíveis, sem duplicar handlers',async()=>{
 const d=dom(),mini=d.doc.createElement('div'),requests=[];d.container.append(mini);const view=GlobalHud.mount(d.container,{embedded:true,compactControls:mini,send:async message=>{requests.push(message);return{success:true,state:state()};}});await view.ready;
 const toggle=d.find(n=>n.dataset.action==='toggle');view.update({...state(2),minimized:true});assert.equal(mini.hidden,false);assert.deepEqual(mini.children.map(n=>n.textContent),['⏪','⏸','⏩']);assert.equal(mini.children[1],toggle);await toggle.onclick();assert.equal(requests.at(-1).type,'HUD_GLOBAL_TOGGLE');assert.deepEqual(requests.at(-1).payload,{action:'pause'});
 view.update({...state(3),minimized:false});assert.equal(mini.hidden,true);assert.equal(mini.children.length,0);assert.equal(toggle.parentNode.className,'fm-global-player-buttons');assert.equal(d.all().filter(n=>n.dataset.action==='toggle').length,1);view.destroy();
});
test('perda de origem após inserção não cria alerta contraditório; prévia Options não é destino perdido',async()=>{
 const initial={...state(),jobs:[{jobId:'s',type:'STT',status:'completed',text:'Inserido.',originAvailable:false,insertion:{inserted:true},controls:{}},{jobId:'p',type:'STT',status:'completed',text:'Prévia.',origin:{page:'options.html'},insertion:{inserted:false,reason:'OPTIONS_PREVIEW'},controls:{}}]},e=fixture({initial});await e.view.ready;assert.ok(e.all().filter(n=>n.className==='fm-global-note').every(n=>!n.textContent.includes('inser')));
});
test('reconexão por foco/visibility faz GET, rejeita revisão antiga e remove listeners no destroy',async()=>{
 const d=dom(),events={},runtimeListeners=[],removed=[];d.doc.defaultView.addEventListener=(name,fn)=>events[name]=fn;d.doc.defaultView.removeEventListener=(name)=>removed.push(name);d.doc.addEventListener=(name,fn)=>events[name]=fn;d.doc.removeEventListener=name=>removed.push(name);
 const previous=global.chrome;global.chrome={runtime:{onMessage:{addListener:fn=>runtimeListeners.push(fn),removeListener:fn=>removed.push(fn)}}};let count=0;const view=GlobalHud.mount(d.container,{send:async()=>({success:true,state:state(++count)})});try{await view.ready;events.focus();await new Promise(r=>setImmediate(r));assert.equal(count,2);runtimeListeners[0]({type:'HUD_GLOBAL_STATE',state:state(8)});assert.equal(view.update(state(7)),false);events.visibilitychange();await new Promise(r=>setImmediate(r));assert.equal(count,3);view.destroy();assert.ok(removed.includes(runtimeListeners[0]));assert.ok(removed.includes('focus'));}finally{global.chrome=previous;}
});
test('wrapper minimizado oculta corpo inteiro, atualiza badge global e preserva posição',()=>{
 const vm=require('node:vm'),source=fs.readFileSync(require.resolve('../content.js'),'utf8'),context=vm.createContext({console,GlobalHud:{}});vm.runInContext(source.replace('__require("extension/src/content/entrypoint.ts");','globalThis.modules=__modules;'),context);
 const m={exports:{}};context.modules['extension/src/content/ui/hudController.ts'](m,m.exports,()=>({}));const hud=m.exports.hud,body={},badge={dataset:{}},button={setAttribute(){}},style={right:'33px',bottom:'44px'};hud.container={style,classList:{toggle(){}},querySelectorAll:()=>[body],querySelector:selector=>selector==='#ext-badge'?badge:button};hud.badgeElement=badge;
 hud.applyGlobalState({...state(1),minimized:true});assert.equal(body.hidden,true);assert.equal(badge.textContent,'1 gravando · 1 narrando');hud.setStatus('idle','Mensagem local atrasada');assert.equal(badge.textContent,'1 gravando · 1 narrando');
 hud.applyGlobalState({...state(2),minimized:false,jobs:[]});assert.equal(body.hidden,false);assert.equal(badge.textContent,'Pronto');assert.deepEqual(style,{right:'33px',bottom:'44px'});hud.applyGlobalState({...state(1),minimized:true});assert.equal(body.hidden,false);
 const css=fs.readFileSync(require.resolve('../content.css'),'utf8');assert.match(css,/\.ext-hud-body\[hidden\]\{display:none!important\}/);assert.match(source,/ext-hud-body\[hidden\]/);
});
test('renderer não usa polling; contexto invalidado orienta F5 sem reenviar mensagens',async()=>{
 const d=dom();let intervals=0,calls=0;d.doc.defaultView.setInterval=()=>{intervals++;};const view=GlobalHud.mount(d.container,{send:async()=>{calls++;throw Error('Extension context invalidated.');}});await view.ready;assert.equal(intervals,0);assert.ok(d.all().some(n=>n.textContent.includes('(F5)')));await view.refresh();assert.equal(calls,1);view.destroy();
});
test('minimização pertence só ao HUD: popup, opções e janela ignoram esse modo',async()=>{
 const initial={...state(),minimized:true,jobs:state().jobs.map(j=>({...j,collapsed:false}))};for(const surface of ['popup','options','task']){const d=dom(),view=GlobalHud.mount(d.container,{panel:true,surface,...(surface==='task'?{jobId:'tts-one'}:{}),send:async()=>({success:true,state:initial})});await view.ready;const root=d.find(n=>n.className==='fm-global-hud');assert.equal(root.dataset.minimized,'false');assert.equal(d.card('tts-one').children[3].hidden,false);assert.ok(d.find(n=>n.textContent==='Expandir').hidden);view.destroy();}
});
test('erro local anterior ao registro do job não desaparece no renderer global',()=>{
 const vm=require('node:vm'),source=fs.readFileSync(require.resolve('../content.js'),'utf8'),context=vm.createContext({console,GlobalHud:{}});vm.runInContext(source.replace('__require("extension/src/content/entrypoint.ts");','globalThis.modules=__modules;'),context);const m={exports:{}};context.modules['extension/src/content/ui/hudController.ts'](m,m.exports,()=>({}));const hud=m.exports.hud,notices=[];hud.globalRevision=1;hud.globalView={notice:text=>notices.push(text)};hud.setStatus('idle','Falha no STT Live');hud.setTextPreview('Permissão do microfone negada.');assert.equal(notices.at(-1),'Permissão do microfone negada.');hud.setStatus('loading','Conectando ditado');assert.equal(notices.at(-1),'');
});
