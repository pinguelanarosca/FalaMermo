(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.GlobalHud=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const STATUS={translating:'Traduzindo',analyzing:'Analisando seleção',ready:'Pronto',connecting:'Conectando',recording:'Gravando',flushing:'Finalizando envio',waiting:'Aguardando Gemini',transforming:'Transformando',inserting:'Inserindo',playing:'Reproduzindo',paused:'Pausado',completed:'Concluído',error:'Erro',cancelled:'Cancelado',cancelling:'Encerrando',stopped:'Parado'};
  const RUNNING=new Set(['connecting','translating','analyzing','flushing','waiting','transforming','inserting','playing']);
  function taskRunning(job){
    const audio=job.type==='STT'?job.narration:job;
    const executing=audio&&RUNNING.has(audio.status)&&!(audio.status==='playing'&&(audio.progress?.workletPaused===true||['suspended','closed','interrupted'].includes(audio.progress?.contextState)));
    return Boolean(executing||job.type==='STT'&&(RUNNING.has(job.status)||job.status==='recording'&&(job.microphoneReleased!==true||(job.progress?.pendingChunks||0)>0)));
  }
  function taskType(job){return job.source==='lens'?'lens':job.type==='STT'?'dictation':job.type==='TTS'&&!job.manual&&!job.source?'narration':'neutral';}
  function activeBorder(jobs=[]){
    // Use activity start, not progress timestamps: telemetry must not change the winning task.
    const started=job=>job.hudStartedAt??job.createdAt??0;
    const job=jobs.filter(taskRunning).sort((a,b)=>started(b)-started(a)||(b.createdAt||0)-(a.createdAt||0)||String(b.jobId||'').localeCompare(String(a.jobId||'')))[0];
    return{jobId:job?.jobId||'',type:job?taskType(job):'neutral',running:!!job};
  }
  const SEEK_LIMITATION='Setas: 5 s de PCM já recebido (até 60 s de retrocesso). Seek por palavra indisponível.';
  const AGENTS=[['narrator','Narrador Fluido'],['translator','Tradutor Simultâneo'],['summarizer','Resumidor Executivo'],['editor','Revisor Gramatical & Ditado'],['explainer','Professor Didático'],['developer','Assistente de Código & Dev'],['podcast','Estilo Podcast'],['accessibility','Leitor de Acessibilidade']];
  const CSS=`
  .fm-global-hud{font:12px/1.4 system-ui,sans-serif;color:#e2e8f0;min-width:0;user-select:text;-webkit-user-select:text}
  .fm-global-hud[hidden],.fm-global-hud [hidden]{display:none!important}
  .fm-global-hud,.fm-global-hud *{scrollbar-width:none!important;scrollbar-gutter:auto!important}.fm-global-hud *{box-sizing:border-box}.fm-global-head,.fm-global-actions,.fm-global-settings{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
  .fm-global-head{justify-content:space-between;padding:8px 0}.fm-global-heading{font-weight:650}.fm-global-toolbar{display:flex;gap:4px}
  .fm-global-hud button{appearance:none;width:auto;border:1px solid #475569;border-radius:6px;background:#1e293b;color:#f8fafc;padding:5px 8px;font:inherit;cursor:pointer;user-select:none;-webkit-user-select:none}
  .fm-global-hud button:hover{background:#334155}.fm-global-hud button:disabled{opacity:.5;cursor:default}.fm-global-hud button:focus-visible,.fm-global-hud input:focus-visible{outline:2px solid #60a5fa;outline-offset:2px}
  .fm-global-mini-controls{display:flex;gap:3px;flex:none}.fm-global-mini-controls[hidden]{display:none!important}.fm-global-mini-controls button{width:27px;height:26px;padding:0;border:1px solid #475569;border-radius:5px;background:#1e293b;color:#f8fafc;cursor:pointer}.fm-global-mini-controls button:disabled{opacity:.5;cursor:default}.fm-global-mini-controls button:focus-visible{outline:2px solid #60a5fa}
  .fm-global-hud button.fm-global-panic,button.fm-global-panic{color:#fca5a5;border:1px solid #b91c1c;background:#450a0a;border-radius:6px;font-size:13px;cursor:pointer}
  button.fm-global-panic:hover{background:#7f1d1d}button.fm-global-panic[aria-busy="true"]{opacity:.7}
  .fm-global-jobs{display:grid;align-content:start;grid-auto-rows:max-content;gap:8px;max-height:min(56vh,520px);overflow:auto;overscroll-behavior:contain;min-height:0}.fm-global-hud::-webkit-scrollbar,.fm-global-hud ::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}
  .fm-global-card{border:1px solid #334155;background:#0f172a;border-radius:8px;padding:9px;min-width:0;align-self:start}
  .fm-global-card[data-collapsed="true"]{padding:6px 8px;min-height:0;height:auto}.fm-global-card[data-collapsed="true"]>:not(.fm-global-card-header){display:none!important}
  .fm-global-card-header{display:flex;align-items:center;justify-content:space-between;gap:6px;white-space:nowrap}.fm-global-kind{font-weight:650;flex:none}.fm-global-description{flex:1;min-width:0;max-width:12ch;overflow:hidden;text-overflow:ellipsis;color:#94a3b8;font-size:10px}.fm-global-status{color:#93c5fd;min-width:0;max-width:14ch;overflow:hidden;text-overflow:ellipsis}.fm-global-origin,.fm-global-progress,.fm-global-label,.fm-global-note{font-size:11px;color:#94a3b8;margin-top:3px;overflow-wrap:anywhere}
  .fm-global-text{white-space:pre-wrap;overflow-wrap:anywhere;max-height:150px;overflow:auto;margin:5px 0 7px;user-select:text!important;-webkit-user-select:text!important;cursor:text}
  .fm-global-label{margin-top:7px}.fm-global-partial{color:#cbd5e1}.fm-global-actions{margin-top:7px}.fm-global-settings{margin-top:7px}.fm-global-settings label{display:flex;gap:5px;align-items:center;flex:1;min-width:120px}.fm-global-settings input{width:85px;flex:1;min-width:35px}.fm-global-feedback,.fm-global-message{min-height:1.3em;font-size:11px;color:#cbd5e1;margin-top:4px}.fm-global-message:empty,.fm-global-feedback:empty{display:none}
  .fm-global-empty{color:#94a3b8;padding:9px 0}.fm-global-hud[data-minimized="true"]>:not(.fm-global-head){display:none}
  .fm-hud-capture-notice{flex:none;padding:0 12px 8px}
  .fm-global-card[data-active="true"]{border-color:#60a5fa;background:#132039}.fm-global-card:focus-visible{outline:2px solid #60a5fa;outline-offset:1px}
  .fm-global-card-tools{display:flex;gap:4px;align-items:center;flex:none}.fm-global-card-tools button{padding:2px 7px;min-width:26px}.fm-global-summary{color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:4px}
  .fm-global-editor{display:block;resize:vertical;width:100%;min-height:88px;max-height:180px;padding:7px;background:#111827;color:#f1f5f9;border:1px solid #475569;border-radius:6px;font:inherit;user-select:text;-webkit-user-select:text}
  .fm-global-player{border-top:1px solid #334155;margin-top:9px;padding-top:8px}.fm-global-player-buttons{display:grid;grid-template-columns:1fr 1.3fr 1fr 1fr;gap:6px}.fm-global-player-buttons button{min-height:32px;padding:4px}.fm-global-player-buttons [data-action="toggle"]{background:#2563eb;border-color:#3b82f6;font-size:16px}.fm-global-player .fm-global-settings{display:grid;grid-template-columns:1fr 1fr;gap:8px}.fm-global-player .fm-global-settings label{min-width:0}.fm-global-player .fm-global-settings input{width:50px;accent-color:#60a5fa}
  .fm-global-agent-row{display:flex;gap:6px;margin-bottom:6px}.fm-global-agent-row select{min-width:0;flex:1;background:#1e293b;color:#f8fafc;border:1px solid #475569;border-radius:6px;padding:5px;font:inherit}.fm-global-player-state{font-size:11px;color:#93c5fd;margin-bottom:5px}.fm-global-seek-note{font-size:10px;color:#94a3b8;margin-top:5px}.fm-global-head button{padding:3px 6px;font-size:11px}
  @media(max-width:340px){.fm-global-head{gap:4px}.fm-global-jobs{max-height:42vh}.fm-global-heading{font-size:11px}}
  `;

/* Visual transplant from visualstttts: CSS-only glass skin. All task state and commands stay authoritative. */
const GLASS_SKIN_CSS=String.raw`
  .ext-hud-card {
    width:min(440px,calc(100vw - 24px));
    background:linear-gradient(158deg,rgba(23,32,53,.57),rgba(9,15,28,.49) 82%);
    border:1px solid rgba(228,239,255,.17);border-radius:19px;
    backdrop-filter:blur(28px) saturate(150%);-webkit-backdrop-filter:blur(28px) saturate(150%);
    box-shadow:inset 0 1px rgba(255,255,255,.17),0 19px 48px rgba(0,0,0,.36),0 4px 14px rgba(0,0,0,.2);
  }
  .ext-hud-card::before {
    content:"";position:absolute;inset:0;pointer-events:none;border-radius:inherit;
    background:radial-gradient(ellipse 95% 65% at 12% 0%,rgba(92,123,205,.13),transparent 72%);
  }
  .ext-hud-card>.ext-hud-header,.ext-hud-card>.ext-hud-body,.ext-hud-card>.fm-hud-capture-notice {position:relative;z-index:1}
  .ext-hud-header {
    position:relative;isolation:isolate;overflow:hidden;
    background:linear-gradient(100deg,rgba(255,255,255,.052),rgba(255,255,255,.012));
    border-bottom:1px solid rgba(255,255,255,.09);padding:10px 13px;
  }
  .ext-hud-header::after {
    content:"";position:absolute;left:0;right:0;top:0;height:1px;pointer-events:none;
    background:linear-gradient(90deg,transparent 2%,rgba(122,182,255,.18) 28%,rgba(196,227,255,.72) 48%,rgba(135,151,254,.2) 70%,transparent 98%);
    background-size:190% 100%;opacity:.65;
  }
  .ext-hud-card:has(.ext-hud-badge.recording) .ext-hud-header::after{
    background:linear-gradient(90deg,transparent,rgba(251,113,133,.28),rgba(254,202,202,.85),rgba(251,113,133,.28),transparent);
    background-size:190% 100%;animation:fm-glass-sweep 4.8s linear infinite;opacity:.9;
  }
  .ext-hud-card:has(.ext-hud-badge.playing) .ext-hud-header::after{
    animation:fm-glass-sweep 5.2s linear infinite;opacity:.85;
  }
  .ext-hud-title{color:#e2e8f0;letter-spacing:.01em}
  .ext-hud-badge{border:1px solid rgba(255,255,255,.12);backdrop-filter:blur(9px);text-transform:none;padding:3px 8px}
  .ext-hud-badge.idle{background:rgba(148,163,184,.10);color:#c1ccdd}
  .ext-hud-badge.playing{background:rgba(56,189,248,.14);border-color:rgba(56,189,248,.23);color:#7dd3fc}
  .ext-hud-badge.recording{background:rgba(244,63,94,.13);border-color:rgba(251,113,133,.23);color:#fda4af}
  .ext-hud-body{padding:9px 11px 11px}
  .fm-global-hud{color:#e7edf9;font-size:12px}
  .fm-global-head{padding:5px 1px 9px;color:#d5dfef}
  .fm-global-heading{font-size:11px;font-weight:650;color:#bbcadf}
  .fm-global-agent-row select,.fm-global-hud button{
    border:1px solid rgba(224,240,255,.13);border-radius:10px;
    background:rgba(255,255,255,.055);color:#f1f5fb;
    box-shadow:inset 0 1px rgba(255,255,255,.05);
  }
  .fm-global-hud button:hover{background:rgba(255,255,255,.12);border-color:rgba(174,207,255,.25)}
  .fm-global-hud button:focus-visible{outline:2px solid #7dd3fc}
  .fm-global-jobs{gap:8px;max-height:min(48vh,490px);overscroll-behavior:contain}
  .fm-global-card{
    position:relative;isolation:isolate;overflow:hidden;padding:10px 11px;border-radius:14px;
    border:1px solid rgba(211,228,255,.11);
    background:linear-gradient(150deg,rgba(47,63,98,.34),rgba(18,27,48,.33) 58%,rgba(34,23,66,.26));
    box-shadow:inset 0 1px rgba(255,255,255,.075),0 7px 18px rgba(0,0,0,.13);
    backdrop-filter:blur(15px) saturate(135%);-webkit-backdrop-filter:blur(15px) saturate(135%);
  }
  .fm-global-card[data-active="true"]{
    border-color:rgba(125,185,255,.33);
    background:linear-gradient(145deg,rgba(45,68,111,.38),rgba(18,29,53,.37) 52%,rgba(58,36,96,.27));
  }
  .fm-global-card[data-active="true"]::before{
    content:"";position:absolute;inset:0 auto auto 6%;width:78%;height:1px;pointer-events:none;
    background:linear-gradient(90deg,transparent,rgba(159,208,255,.60),rgba(180,151,255,.30),transparent);
    opacity:.7;
  }
  .fm-global-card-header{gap:7px}
  .fm-global-kind{color:#eff6ff}
  .fm-global-status{color:#a5d8ff}
  .fm-global-origin,.fm-global-progress{
    display:block;width:fit-content;max-width:100%;border:1px solid rgba(210,229,255,.10);
    background:rgba(255,255,255,.045);padding:4px 7px;border-radius:8px;color:#bbcade;
    font-size:10px;margin-top:6px;line-height:1.45;
  }
  .fm-global-label{color:#a5bbdc}
  .fm-global-text{
    max-height:142px;overflow:auto;padding:9px 10px;border:1px solid rgba(210,228,255,.07);
    border-radius:10px;background:rgba(4,10,22,.20);line-height:1.5;color:#e7eefc;
  }
  .fm-global-partial{color:#afc4e1}
  .fm-global-editor{
    border-radius:10px;background:rgba(5,11,24,.30);
    border-color:rgba(214,231,255,.16);color:#f1f5fd;
  }
  .fm-global-player{
    padding:10px 9px 8px;margin-top:9px;border:1px solid rgba(209,230,255,.10);
    border-radius:13px;background:rgba(5,12,26,.23);
  }
  .fm-global-player-buttons [data-action="toggle"]{
    background:rgba(37,99,235,.48);border-color:rgba(125,185,255,.42);
    box-shadow:inset 0 1px rgba(255,255,255,.13);
  }
  .fm-global-player-state{color:#9cc8f7}
  .fm-global-settings input[type="range"]{accent-color:#7dd3fc}
  .fm-global-hud button.fm-global-panic{background:rgba(127,29,29,.43);border-color:rgba(252,165,165,.38);color:#fecaca}
  @keyframes fm-glass-sweep {from{background-position:190% 0}to{background-position:-190% 0}}
  @media(max-width:480px){
    .ext-hud-card{width:min(380px,calc(100vw - 24px))}
    .fm-global-description{max-width:10ch}
    .fm-global-jobs{max-height:38vh}
  }
  @media(prefers-reduced-motion:reduce){
    .ext-hud-header::after{animation:none!important}
  }
`;
  function text(value){return typeof value==='string'?value:'';}
  function number(value){return typeof value==='number'&&Number.isFinite(value)?value:null;}
  function can(job,action){const c=job.controls;return Array.isArray(c)?c.includes(action):!!(c&&c[action]);}
  function audioJob(job){return job?.type==='STT'?{...job,type:'TTS',status:'ready',progress:{},pausedAt:0,error:undefined,warning:undefined,...job.narration}:job;}
  function audioAvailable(job){return job?.type==='TTS'||['ready','completed','cancelled','error'].includes(job?.status);}
  function availableText(job){return text(job.text)||text(job.partialText);}
  function seekReason(job,delta){job=audioAvailable(job)?audioJob(job):null;if(job?.type!=='TTS')return 'Selecione uma narração TTS para navegar.';if(!can(job,'seek')||!(job.progress?.availableEnd>0))return 'PCM desta reprodução indisponível; inicie ou aguarde o áudio.';const p=job.progress;if(delta<0&&p.currentTime<=p.availableStart)return 'Início do PCM retido alcançado (até 60 s de retrocesso).';if(delta>0&&p.currentTime>=p.availableEnd)return 'Fim do PCM recebido; aguarde mais áudio ou retroceda.';return '';}
  function progressLabel(progress){
    if(typeof progress==='number'&&Number.isFinite(progress))return `${Math.round(Math.min(1,Math.max(0,progress))*100)}%`;
    if(!progress||typeof progress!=='object')return '';
    const labels=[];
    if(number(progress.currentTime)!==null&&number(progress.duration)!==null&&progress.duration>0)labels.push(`${Math.floor(progress.currentTime)} / ${Math.ceil(progress.duration)} s recebidos`);
    if(number(progress.completedBlocks)!==null&&number(progress.totalBlocks)!==null&&progress.totalBlocks>0)labels.push(`${progress.completedBlocks} / ${progress.totalBlocks} blocos`);
    if(number(progress.forwardedChunks)!==null)labels.push(`${progress.forwardedChunks} blocos enviados`);
    if(number(progress.pendingChunks)!==null&&progress.pendingChunks>0)labels.push(`${progress.pendingChunks} pendentes`);
    if(progress.contextState)labels.push(`AudioContext: ${progress.contextState}`);
    if(typeof progress.workletPaused==='boolean')labels.push(`worklet: ${progress.workletPaused?'pausado':'ativo'}`);
    if(number(progress.controlSeq)!==null)labels.push(`ACK ${progress.controlSeq} · PCM ${Math.floor(progress.positionFrame||0)}`);
    return labels.join(' · ');
  }
  function mount(container,options={}){
    if(!container||!container.ownerDocument)throw new TypeError('Container do HUD indisponível');
    const doc=container.ownerDocument,send=options.send;
    if(typeof send!=='function')throw new TypeError('Transporte do HUD indisponível');
    const element=(tag,className,value)=>{const el=doc.createElement(tag);if(className)el.className=className;if(value)el.textContent=value;return el;};
    const setText=(el,value)=>{value=String(value??'');if(el.textContent!==value)el.textContent=value;};
    // The new HUD skin lives in its Shadow DOM stylesheet. Keep the existing
    // skin byte-for-byte for popup, options and dedicated task windows.
    const style=element('style');style.textContent=CSS+(options.embedded?'':GLASS_SKIN_CSS);
    const root=element('section','fm-global-hud');root.setAttribute('aria-label',options.taskOverlay?'Tarefa expandida FalaMermo':'Tarefas globais FalaMermo');root.dataset.surface=options.taskOverlay?'hud':options.jobId?'task':options.embedded?'hud':options.surface||'panel';root.dataset.layout='compact-2';if(options.jobId)root.dataset.dedicated='true';
    const head=element('div','fm-global-head'),heading=element('span','fm-global-heading','Tarefas globais'),toolbar=element('div','fm-global-toolbar');
    const minimize=element('button','','Minimizar'),visibility=element('button','','Ocultar HUD');minimize.type=visibility.type='button';
    toolbar.append(minimize,visibility);head.append(heading,toolbar);
    const message=element('div','fm-global-message');message.setAttribute('role','status');message.setAttribute('aria-live','polite');
    const localNotice=element('div','fm-global-message');localNotice.setAttribute('role','status');localNotice.setAttribute('aria-live','polite');
    const list=element('div','fm-global-jobs');list.setAttribute('tabindex','0');list.setAttribute('aria-label','Lista de tarefas');const empty=element('div','fm-global-empty','Nenhuma tarefa disponível.');
    const player=element('div','fm-global-player'),playerState=element('div','fm-global-player-state','Selecione uma narração'),playerButtons=element('div','fm-global-player-buttons'),playerSettings=element('div','fm-global-settings'),seekNote=element('div','fm-global-seek-note',SEEK_LIMITATION);
    player.append(...(options.embedded?[]:[playerState]),playerButtons,playerSettings,seekNote);
    root.append(...(options.embedded?[]:[head]),message,localNotice,empty,list,player);container.append(style,root);
    if(options.embedded&&options.noticeContainer)options.noticeContainer.append(message,localNotice);
    let presentationTabId=0;const cards=new Map();let revision=-1,state={visible:false,minimized:false,jobs:[]},destroyed=false,contextExpired=false,seenNoticeId=0,noticeTimer=null;
    async function request(type,payload){
      if(contextExpired)throw new Error('Extensão atualizada. Atualize esta página (F5) para usar os controles.');
      let response;try{response=await send({type,payload:payload||{}});}catch(error){if(/extension context invalidated/i.test(error?.message||String(error))){contextExpired=true;setText(message,'Extensão atualizada. Atualize esta página (F5) para usar os controles.');}throw error;}
      if(!response||response.success===false)throw new Error(response?.error||'Comando não confirmado');
      if(response.state)update(response.state);
      return response;
    }
    const panicNotice=options.panicNotice||element('div','fm-global-message');
    if(options.surface==='popup'){panicNotice.setAttribute('role','status');root.insertBefore(panicNotice,localNotice);}
    const panic=element('button','fm-global-panic',options.embedded?'■':'🛑');
    panic.type='button';panic.title='Parar todas as operações';
    panic.setAttribute('aria-label',panic.title);panic.dataset.action='panic';
    let panicSending=false,panicAwaiting=false;
    function renderPanic(){
      const closing=state.jobs.some(job=>job.status==='cancelling'||job.narration?.status==='cancelling');
      panic.setAttribute('aria-busy',String(panicSending||closing||panicAwaiting));
      if(panicSending||closing||panicAwaiting)setText(panicNotice,'Encerrando operações…');
      else if(panicNotice.textContent==='Encerrando operações…')setText(panicNotice,'');
    }
    if(options.panicContainer||options.surface==='popup'){
      (options.panicContainer||toolbar).append(panic);
      panic.onclick=async event=>{
        event.stopPropagation();
        if(panicSending)return;
        panicSending=true;panicAwaiting=false;renderPanic();
        try{
          const result=await request('HUD_GLOBAL_PANIC');
          panicAwaiting=result.remoteStopped===false;
        }catch(error){setText(panicNotice,error.message);}
        finally{panicSending=false;renderPanic();}
      };
    }
    async function ui(payload,button){
      if(destroyed)return;button.disabled=true;
      try{await request('HUD_GLOBAL_UI_SET',payload);setText(message,'');}
      catch{if(!destroyed)setText(message,'Não foi possível atualizar o HUD. Reabra o painel ou atualize a página.');}
      finally{if(!destroyed)button.disabled=false;}
    }
    minimize.onclick=()=>ui({minimized:!state.minimized},minimize);
    visibility.onclick=()=>ui({toggleVisible:true},visibility);
    if(options.embedded||options.jobId){toolbar.hidden=true;}
    minimize.hidden=options.panel===true;
    let agentListener=null;
    if(options.agentSelector&&globalThis.chrome?.storage?.local){
      const row=element('div','fm-global-agent-row'),select=element('select'),settings=element('button','','⚙');select.setAttribute('aria-label','Agente ativo');settings.type='button';settings.title='Configurações';settings.setAttribute('aria-label','Configurações');row.append(select,settings);root.insertBefore(row,list);
      const load=async()=>{try{const {agents={}}=await chrome.storage.local.get('agents');if(destroyed)return;select.replaceChildren();for(const[id,name]of [...AGENTS,...(agents.customAgents||[]).map(a=>[a.metadata?.id,'★ '+(a.metadata?.name||a.metadata?.id)])]){if(!id)continue;const option=element('option','',name);option.value=id;select.append(option);}select.value=agents.activeAgentId||'narrator';}catch{setText(message,'Não foi possível ler o agente ativo.');}};
      select.onchange=async()=>{try{const {agents={}}=await chrome.storage.local.get('agents');await chrome.storage.local.set({agents:{...agents,activeAgentId:select.value}});}catch{setText(message,'Não foi possível alterar o agente.');}};
      settings.onclick=async event=>{event.stopPropagation();try{await request('HUD_OPEN_OPTIONS');}catch{setText(message,'Não foi possível abrir as configurações.');}};
      agentListener=(changes,area)=>{if(area==='local'&&changes.agents)void load();};chrome.storage.onChanged?.addListener(agentListener);void load();
    }
    const playerControls={};let playerBusy=0;const pendingSettings=new Map();let settingTask=null;
    function setPlayerSettings(name,value){if(!Number.isFinite(value)||destroyed)return Promise.resolve();if(name==='volume')return request('HUD_GLOBAL_SET',{volume:value}).catch(error=>setText(message,error.message));const job=playbackJob();if(!job)return Promise.resolve();pendingSettings.set(job.jobId,{...pendingSettings.get(job.jobId),...(job.requestId?{requestId:job.requestId}:{}),[name]:value});if(settingTask)return settingTask;settingTask=(async()=>{try{while(pendingSettings.size&&!destroyed){const[id,values]=pendingSettings.entries().next().value;pendingSettings.delete(id);try{await request('HUD_GLOBAL_COMMAND',{jobId:id,action:'set',...values});}catch(error){setText(message,error.message||'Não foi possível ajustar a reprodução.');}}}finally{settingTask=null;}})();return settingTask;}
    function activeJob(){return state.jobs.find(job=>job.jobId===(options.jobId||((options.embedded||options.surface==='popup'||!options.panel)&&state.hudTaskId)||state.activeTaskId))||state.jobs.find(job=>job.type==='TTS')||state.jobs[0];}
    function playbackActive(job){return job?.status==='playing'||job?.status==='connecting'&&job.progress?.outputActive===true;}
    function playbackJob(){const audio=state.jobs.filter(audioAvailable).map(audioJob);return audio.find(job=>job.status==='playing')||audio.find(playbackActive)||audio.find(job=>job.jobId===state.playback?.selectedJobId&&job.status==='paused')||audio.filter(job=>job.status==='paused').sort((a,b)=>(b.pausedAt||0)-(a.pausedAt||0)||(b.updatedAt||0)-(a.updatedAt||0))[0];}
    async function playerCommand(action,values={}){
      const job=playbackJob();if(!job||playerBusy&&action!=='seek'||destroyed)return;playerBusy++;renderPlayer();
      try{const card=cards.get(job.jobId);if(action==='play'&&card?.dirty&&!await saveDraft(card))return;await request('HUD_GLOBAL_COMMAND',{jobId:job.jobId,action,...(job.requestId?{requestId:job.requestId}:{}),...values});setText(message,'');}
      catch(error){if(!destroyed)setText(message,error.message||'Não foi possível controlar esta tarefa.');}
      finally{playerBusy--;if(!destroyed)renderPlayer();}
    }
    for(const[action,label,title]of [['previous','⏪','Retroceder 5 segundos'],['toggle','▶','Retomar último pausado'],['next','⏩','Avançar 5 segundos'],['create','+','Criar nova tarefa']]){
      const button=element('button',options.embedded&&action!=='create'?'fm-hud-transport':'',options.embedded&&action==='previous'?'◀◀':options.embedded&&action==='next'?'▶▶':label);button.type='button';button.dataset.action=action;button.title=title;button.setAttribute('aria-label',title);playerButtons.append(button);playerControls[action]=button;
    }
    playerControls.toggle.onclick=async()=>{
      const job=playbackJob();
      if(!job||playerBusy||destroyed)return;
      playerBusy++;renderPlayer();
      try{
        await request('HUD_GLOBAL_TOGGLE',{action:playbackActive(job)?'pause':'resume',jobId:job.jobId,...(job.requestId?{requestId:job.requestId}:{})});
        setText(message,'');
      }catch(error){setText(message,error.message);}
      finally{playerBusy--;if(!destroyed)renderPlayer();}
    };
    playerControls.previous.onclick=()=>seekWords(-1);playerControls.next.onclick=()=>seekWords(1);
    function seekWords(delta){if(!Number.isInteger(delta)||!delta||seekReason(playbackJob(),delta))return Promise.resolve(false);return playerCommand('seek',{deltaSeconds:delta<0?-5:5});}
    playerControls.create.onclick=async()=>{if(playerControls.create.disabled)return;playerControls.create.disabled=true;try{await request('HUD_GLOBAL_CREATE');setText(message,'');const card=cards.get(state.activeTaskId);card?.editor.focus?.();}catch(error){setText(message,error.message||'Não foi possível criar a tarefa.');}finally{if(!destroyed)playerControls.create.disabled=false;}};
    for(const[name,title,min,max,step]of [['volume','Volume',0,1,.05],['playbackRate','Velocidade',.5,2,.1]]){
      const label=element('label','',title),input=element('input');input.type='range';input.min=String(min);input.max=String(max);input.step=String(step);input.dataset.control=name;input.setAttribute('aria-label',name==='volume'?'Volume global':title+' da narração ativa');label.append(input);playerSettings.append(label);playerControls[name]=input;input.oninput=()=>{input.title=input.value;return setPlayerSettings(name,Number(input.value));};input.onchange=input.oninput;
    }
    function renderPlayer(){
      const job=playbackJob(),tts=!!job,playing=playbackActive(job),resumable=job?.status==='paused';
      const display=job||state.jobs.filter(audioAvailable).map(audioJob).find(item=>item.status==='connecting');
      if(options.compactControls){options.compactControls.hidden=!state.minimized;for(const action of ['previous','toggle','next']){const button=playerControls[action];if(state.minimized){if(button.parentNode!==options.compactControls)options.compactControls.append(button);}else if(button.parentNode!==playerButtons)playerButtons.insertBefore(button,playerControls.create);}}
      if(!options.embedded)setText(playerState,display?(display.manual?'Tarefa manual · ':'Narração · ')+(STATUS[display.status]||'Processando'):'Nenhuma tarefa ativa');
      setText(playerControls.toggle,playing?'⏸':'▶');const label=playing?'Pausar narração ativa':'Retomar narração pausada';playerControls.toggle.title=label;playerControls.toggle.setAttribute('aria-label',label);playerControls.toggle.disabled=playerBusy||!(playing||resumable);
      for(const [name,delta]of [['previous',-5],['next',5]]){const reason=seekReason(job,delta),label=(delta<0?'Retroceder':'Avançar')+' 5 segundos';playerControls[name].disabled=!!reason;playerControls[name].title=reason||label;playerControls[name].setAttribute('aria-label',reason||label);}setText(seekNote,[seekReason(job,0),SEEK_LIMITATION].filter(Boolean).join(' '));seekNote.hidden=options.embedded===true;if(options.embedded)player.setAttribute('aria-description',SEEK_LIMITATION);player.hidden=!!options.jobId;
      for(const name of ['volume','playbackRate']){const input=playerControls[name];input.disabled=name!=='volume'&&!tts;if(doc.activeElement!==input)input.value=String(name==='volume'?(number(state.playback?.volume)??1):(number(job?.[name]??job?.progress?.[name])??1));input.title=input.value;}
    }
    async function saveDraft(card){if(!card.dirty)return Promise.resolve(true);if(card.saving)return card.saving;card.saving=(async()=>{try{while(card.dirty&&!destroyed){const value=card.editor.value,expectedText=card.editBase;await request('HUD_GLOBAL_COMMAND',{jobId:card.job.jobId,action:'edit',text:value,expectedText});card.editBase=value;if(card.editor.value===value)card.dirty=false;}return !card.dirty;}catch(error){if(!destroyed)setText(card.feedback,error.message||'Edição não salva. Copie seu texto antes de fechar.');return false;}finally{card.saving=null;if(!destroyed){renderCard(card,card.job);renderPlayer();}}})();return card.saving;}
    function createCard(id){
      const node=element('article','fm-global-card');node.dataset.jobId=id;
      const header=element('div','fm-global-card-header'),kind=element('span','fm-global-kind'),description=element('span','fm-global-description'),status=element('span','fm-global-status'),tools=element('div','fm-global-card-tools');header.append(kind,description,status,tools);node.setAttribute('tabindex','0');node.setAttribute('aria-label','Selecionar tarefa');
      const origin=element('div','fm-global-origin'),progress=element('div','fm-global-progress');
      const detail=element('div','fm-global-detail'),label=element('div','fm-global-label'),body=element('div','fm-global-text'),partialLabel=element('div','fm-global-label','Transcrição provisória'),partial=element('div','fm-global-text fm-global-partial');
      const editor=element('textarea','fm-global-editor');editor.setAttribute('aria-label','Texto da tarefa manual');editor.placeholder='Digite ou cole o texto para narrar';editor.hidden=true;
      let transcript=null,metrics=null,metricDetail=null,metricValues=null;
      if(options.embedded){
        transcript=element('div','fm-hud-transcript');transcript.setAttribute('tabindex','0');transcript.setAttribute('aria-label','Texto confirmado e provisório');
        body.setAttribute('aria-label','Texto confirmado');partial.setAttribute('aria-label','Transcrição provisória');
        transcript.append(label,body,partialLabel,partial);detail.append(transcript,editor);
        progress.className='fm-global-progress fm-hud-chips';
        progress.setAttribute('tabindex','0');progress.setAttribute('role','group');progress.setAttribute('aria-label','Indicadores da tarefa');
        metricDetail=element('details','fm-hud-metrics');const title=element('summary','','Detalhes da tarefa');metricValues=element('div','fm-hud-metric-values');metricDetail.append(title,metricValues);metrics=new Map();
      }else{body.setAttribute('tabindex','0');partial.setAttribute('tabindex','0');detail.append(label,body,partialLabel,partial,editor);}
      const note=element('div','fm-global-note'),actions=element('div','fm-global-actions'),settings=element('div','fm-global-settings'),feedback=element('div','fm-global-feedback');feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');
      let waveform=null;
      if(options.embedded){waveform=element('div','fm-hud-task-wave');waveform.setAttribute('role','img');waveform.innerHTML='<svg viewBox="0 0 400 24" preserveAspectRatio="none" aria-hidden="true"><path d="M0 12 Q10 1 20 12 T40 12 T60 12 T80 12 T100 12 T120 12 T140 12 T160 12 T180 12 T200 12 T220 12 T240 12 T260 12 T280 12 T300 12 T320 12 T340 12 T360 12 T380 12 T400 12"/></svg>';}
      node.append(...(waveform?[waveform]:[]),header,origin,progress,detail,note,actions,settings,feedback);if(metricDetail)node.append(metricDetail);list.append(node);
      const summary=element('div','fm-global-summary');node.append(summary);
      const card={node,waveform,kind,description,status,origin,progress,label,body,partialLabel,partial,note,feedback,buttons:{},actions,settings,detail,summary,editor,transcript,metrics,metricDetail,metricValues,dirty:false,editBase:'',saving:null,job:null,busy:new Set()};
      function button(action,label,handler){const b=element('button','',label);b.type='button';b.dataset.action=action;b.onclick=handler;actions.append(b);card.buttons[action]=b;return b;}
      async function command(action,values={}){
        if(destroyed||card.busy.has(action)&&action!=='seek')return;
        if(['remove','maximize'].includes(action)&&card.dirty&&!await saveDraft(card))return;
        card.busy.add(action);renderCard(card,card.job);
        try{const result=await request('HUD_GLOBAL_COMMAND',{jobId:id,action,...(['stop','pause','resume','seek','set'].includes(action)&&audioJob(card.job).requestId?{requestId:audioJob(card.job).requestId}:{}),...(['play','narrate'].includes(action)?{expectedText:card.editBase}:{}),...values});if(result.openTaskId)await (options.openTask?options.openTask(result.openTaskId):openTask(result.openTaskId,{doc,send}));if(!destroyed)setText(feedback,'');}
        catch(error){if(!destroyed)setText(feedback,'Não foi possível aplicar o comando a esta tarefa. '+error.message+' O texto disponível foi preservado.');}
        finally{card.busy.delete(action);if(!destroyed&&cards.has(id))renderCard(card,card.job);}
      }
      async function copy(partialOnly=false){
        const content=partialOnly?text(card.job.partialText):card.dirty?card.editor.value:card.job.type==='STT'?card.job.workingText??[card.job.text,card.job.partialText].filter(Boolean).join(' '):!card.editor.hidden?card.editor.value:availableText(card.job),action=partialOnly?'copyPartial':'copy';
        if(!content||card.busy.has(action)||destroyed)return;
        card.busy.add(action);renderCard(card,card.job);
        try{
          const clipboard=options.clipboard||(doc.defaultView&&doc.defaultView.navigator&&doc.defaultView.navigator.clipboard)||(typeof navigator!=='undefined'&&navigator.clipboard);
          let copied=false;
          try{if(clipboard&&typeof clipboard.writeText==='function'){await clipboard.writeText(content);copied=true;}}catch(error){if(!options.taskOverlay)throw error;}
          if(!copied&&options.taskOverlay&&typeof doc.execCommand==='function'){
            // The former extension page had a secure clipboard context. Keep
            // Copy usable in page overlays where Clipboard API is unavailable.
            const active=container.getRootNode?.().activeElement||doc.activeElement,input=element('textarea');input.value=content;input.setAttribute('readonly','');input.setAttribute('aria-hidden','true');input.setAttribute('style','position:fixed;left:-10000px;top:0;opacity:0');container.append(input);
            try{input.focus({preventScroll:true});input.select();copied=doc.execCommand('copy');}finally{input.remove();if(active?.isConnected!==false)active?.focus?.({preventScroll:true});}
          }
          if(!copied)throw new Error('Clipboard indisponível');
          if(!destroyed)setText(feedback,partialOnly?'Texto provisório copiado.':'Texto copiado.');
        }catch{if(!destroyed)setText(feedback,'Não foi possível copiar. Selecione o texto e use Ctrl+C.');}
        finally{card.busy.delete(action);if(!destroyed&&cards.has(id))renderCard(card,card.job);}
      }
      button('previous','⏪',()=>seekReason(card.job,-5)?undefined:command('seek',{deltaSeconds:-5}));
      button('playPause','▶',async()=>{if(card.dirty&&!await saveDraft(card))return;const status=audioJob(card.job).status;return command(['playing','connecting'].includes(status)?'pause':status==='paused'?'resume':'play');});
      button('next','⏩',()=>seekReason(card.job,5)?undefined:command('seek',{deltaSeconds:5}));const stop=button('stop','■',()=>command('stop'));stop.title='Parar esta tarefa';stop.setAttribute('aria-label',stop.title);if(options.jobId){button('copy','Copiar texto',()=>copy());button('narrate','Narrar cópia de trabalho',async()=>{if(card.dirty&&!await saveDraft(card))return;return command('narrate');});}
      const volumeLabel=element('label','','Volume'),volume=element('input');volume.type='range';volume.min='0';volume.max='1';volume.step='.05';volume.dataset.cardControl='volume';volume.setAttribute('aria-label','Volume desta tarefa');volumeLabel.append(volume);settings.append(volumeLabel);card.volume=volume;volume.oninput=()=>{const value=Number(volume.value);card.pendingVolume=value;if(card.volumeTask)return card.volumeTask;card.volumeTask=(async()=>{try{while(card.pendingVolume!==undefined&&!destroyed){const next=card.pendingVolume;card.pendingVolume=undefined;await command('set',{volume:next});}}finally{card.volumeTask=null;}})();return card.volumeTask;};volume.onchange=volume.oninput;
      const collapse=button('collapse','⌃',()=>command('collapse',{collapsed:!card.job.collapsed})),maximize=button('maximize','↗',()=>command('maximize')),remove=button('remove','×',()=>command('remove'));tools.append(collapse,maximize,remove);maximize.title='Expandir tarefa nesta aba';maximize.setAttribute('aria-label',maximize.title);remove.title='Ocultar cartão sem parar a tarefa';remove.setAttribute('aria-label',remove.title);
      if(options.embedded){for(const action of ['previous','playPause','next']){card.buttons[action].className='fm-hud-transport';if(action!=='playPause')setText(card.buttons[action],action==='previous'?'◀◀':'▶▶');}const alert=button('alert','!',()=>card.job.collapsed?command('collapse',{collapsed:false}):card.note.scrollIntoView?.({block:'nearest'}));alert.className='fm-hud-alert';tools.insertBefore(alert,collapse);alert.hidden=true;}
      node.onclick=event=>{if(event?.target?.closest?.('button,input,textarea,select,a'))return;return command('select');};node.onkeydown=event=>{if(event.target===node&&(event.key==='Enter'||event.key===' ')){event.preventDefault();void command('select');}};
      editor.oninput=()=>{card.dirty=true;renderPlayer();return saveDraft(card);};editor.onchange=()=>saveDraft(card);
      return card;
    }
    function renderHudMetrics(card,job){
      const present=new Set(),primary=new Set(['currentTime','duration','forwardedChunks','pendingChunks','completedBlocks','totalBlocks','capturedChunks','blocks']);
      const labels={currentTime:'Posição (s)',duration:'Áudio recebido (s)',availableStart:'PCM inicial (s)',availableEnd:'PCM final (s)',blocks:'Blocos',completedBlocks:'Finalizados',totalBlocks:'Total de blocos',forwardedChunks:'Enviados',pendingChunks:'Pendentes',capturedChunks:'Pacotes capturados',capturedBytes:'Bytes capturados',forwardedBytes:'Bytes encaminhados',volume:'Volume',playbackRate:'Velocidade',contextState:'AudioContext',workletPaused:'Worklet pausado',outputMuted:'Saída muda',outputActive:'Saída ativa',controlSeq:'ACK',positionFrame:'Posição PCM (frames)'};
      function metric(key,label,value,chip=false){
        if(value===undefined||value===null||typeof value==='number'&&!Number.isFinite(value))return;
        present.add(key);let node=card.metrics.get(key);if(!node){node=element('span',chip?'fm-hud-chip':'fm-hud-metric');node.dataset.field=key;if(chip)node.setAttribute('role','img');(chip?card.progress:card.metricValues).append(node);card.metrics.set(key,node);}
        const display=typeof value==='number'&&/(?:^|\.)(?:currentTime|duration)$/.test(key)?value.toLocaleString('pt-BR',{maximumFractionDigits:1}):typeof value==='boolean'?(value?'sim':'não'):value;const icons={forwardedChunks:'↥',pendingChunks:'≡',completedBlocks:'✓',totalBlocks:'▦',currentTime:'◷',duration:'◴'};if(chip){node.dataset.icon=key.split('.').at(-1);setText(node,display);}else setText(node,label+': '+display);node.title=label+': '+value;node.setAttribute('aria-label',node.title);node.hidden=false;
      }
      for(const [prefix,p]of [['',job.progress],['narration.',job.narration?.progress]])if(p&&typeof p==='object')for(const [key,label]of Object.entries(labels))metric(prefix+key,(prefix?'Narração · ':'')+label,p[key],primary.has(key));
      for(const [key,label,value]of [['jobId','Tarefa',job.jobId],['requestId','Requisição',job.requestId],['playerId','Player',job.playerId],['agentId','Agente',job.agentId],['documentId','Documento',job.origin?.documentId],['page','Página',job.origin?.page],['captureAdmission','Captura',job.captureAdmission],['microphoneReleased','Microfone liberado',job.type==='STT'?job.microphoneReleased:undefined],['originAvailable','Origem disponível',job.originAvailable],['incomplete','Resultado incompleto',job.incomplete],['historyStatus','Histórico',job.historyStatus],['insertionReason','Inserção',job.insertion?.reason]])metric(key,label,value);
      metric('origin','Origem',job.origin?.tabId>0?'aba '+job.origin.tabId+(job.origin.frameId?' · frame '+job.origin.frameId:''):'painel da extensão');
      if(job.type==='STT'&&job.captureTelemetry){const t=job.captureTelemetry;for(const [key,label,value]of [['sileroProbability','Silero',t.sileroProbability],['tenProbability','TEN',t.tenProbability],['confirmed','Dupla confirmação',t.confirmed],['recoveries','Recuperações',t.recoveries]]){
        metric('vad.'+key,label,typeof value==='number'&&key.endsWith('Probability')?(value*100).toLocaleString('pt-BR',{maximumFractionDigits:1})+'%':value??'—');
        const node=card.metrics.get('vad.'+key);if(node&&value!==undefined)node.title=label+': '+value;
      }}
      // Measurements precede IDs, without moving already ordered nodes on updates.
      let metricIndex=0;
      for(const key of ['sileroProbability','tenProbability','confirmed','recoveries']){
        const node=card.metrics.get('vad.'+key);if(node&&present.has('vad.'+key)){if(card.metricValues.children[metricIndex]!==node)card.metricValues.insertBefore(node,card.metricValues.children[metricIndex]||null);metricIndex++;}
      }
      let chipIndex=0;
      for(const prefix of ['', 'narration.'])for(const key of ['capturedChunks','forwardedChunks','pendingChunks','completedBlocks','totalBlocks','blocks','currentTime','duration']){
        const node=card.metrics.get(prefix+key);if(node&&present.has(prefix+key)){if(card.progress.children[chipIndex]!==node)card.progress.insertBefore(node,card.progress.children[chipIndex]||null);chipIndex++;}
      }
      for(const [key,node]of card.metrics)if(!present.has(key))node.hidden=true;
      card.progress.hidden=![...card.metrics].some(([key,node])=>!node.hidden&&node.parentNode===card.progress);
      card.metricDetail.hidden=false;
    }
    function renderCard(card,job){
      if(!job)return;card.job=job;const audio=audioJob(job),available=audioAvailable(job);
      setText(card.kind,job.type==='STT'?'🎙 Ditado':job.manual?'✎ Manual':job.source==='translation'?'🌐 Tradução':job.source==='lens'?(job.lensMode==='interpret'?'🔍 Análise':'🔍 Leitura'):'🔊 Narração');setText(card.status,job.type==='STT'&&job.narration&&!['ready','completed','cancelled','error'].includes(audio.status)?'Narração · '+(STATUS[audio.status]||'Gerando'):(job.outcome==='NO_SPEECH'?'Sem fala confirmada':job.status==='error'&&job.insertion?.inserted===false?'Texto não inserido':STATUS[job.status]||'Em andamento'));card.node.dataset.active=String(activeJob()?.jobId===job.jobId);card.node.setAttribute('aria-current',String(activeJob()?.jobId===job.jobId));
      if(options.embedded){card.node.dataset.taskType=taskType(job);card.node.dataset.taskRunning=String(taskRunning(job));}
      const short=availableText(job).replace(/\s+/g,' ').trim().slice(0,80)||(job.manual?'Texto manual':job.type==='STT'?'Microfone':job.source==='lens'?'Área selecionada':'Gemini Live');setText(card.description,short);card.description.title=short;
      const source=job.origin||{};setText(card.origin,number(source.tabId)!==null&&source.tabId>0?`Origem: aba ${source.tabId}${number(source.frameId)!==null&&source.frameId!==0?' · frame '+source.frameId:''}`:'Origem: painel da extensão');if(options.jobId)setText(card.origin,card.origin.textContent+' · Agente: '+text(job.agentId)+' · Criado: '+(Number.isFinite(job.createdAt)?new Date(job.createdAt).toLocaleString('pt-BR'):'—')+' · ID: '+job.jobId);
      if(!card.metrics){setText(card.progress,progressLabel(job.narration?.progress||job.progress));card.progress.hidden=!card.progress.textContent;}
      setText(card.label,job.source==='translation'?'Tradução (PT-BR)':job.type==='TTS'?'Texto da narração':'Transcrição confirmada');setText(card.body,text(job.text));card.body.hidden=card.label.hidden=!job.text;
      setText(card.partial,text(job.partialText));card.partial.hidden=card.partialLabel.hidden=!job.partialText;
      if(card.transcript){card.transcript.hidden=!job.text&&!job.partialText;renderHudMetrics(card,job);}
      card.editor.hidden=!(job.manual||options.jobId);card.editor.disabled=!can(job,'edit');if(!card.dirty){card.editBase=text(job.type==='STT'?job.workingText??job.text:job.text);if(card.editor.value!==card.editBase)card.editor.value=card.editBase;}if(job.type==='STT')card.editor.setAttribute('aria-label','Cópia de trabalho (não altera transcrição nem texto inserido)');else card.editor.setAttribute('aria-label','Texto da narração');if(!card.editor.hidden&&job.type==='TTS'){card.body.hidden=true;if(card.transcript)card.transcript.hidden=true;}
      const collapsed=job.collapsed===true&&!options.jobId;card.node.dataset.collapsed=String(collapsed);card.detail.hidden=collapsed;card.origin.hidden=options.embedded||collapsed;card.progress.hidden=collapsed||(card.metrics?card.progress.hidden:!card.progress.textContent);card.actions.hidden=collapsed;card.summary.hidden=true;card.feedback.hidden=collapsed;
      if(card.waveform){
        const speech=job.type==='STT'&&job.status==='recording'&&job.microphoneReleased!==true&&job.captureTelemetry?.confirmed===true;
        const p=audio.progress,narrating=available&&['playing','connecting'].includes(audio.status)&&p?.outputActive===true&&p.signalActive===true&&p.workletPaused!==true&&p.outputMuted!==true&&p.contextState==='running';
        card.waveform.hidden=collapsed||!options.taskOverlay&&state.minimized;
        card.waveform.dataset.active=String(!card.waveform.hidden&&state.visible!==false&&(speech||narrating));
        card.waveform.dataset.mode=speech?'stt':'tts';
        card.waveform.setAttribute('aria-label',speech?'Ditado em captura':narrating?'Narração em reprodução':'Tarefa em silêncio');
      }
      const collapse=card.buttons.collapse;setText(collapse,job.collapsed?'⌄':'⌃');collapse.title=job.collapsed?'Expandir tarefa':'Recolher tarefa';collapse.setAttribute('aria-label',collapse.title);collapse.setAttribute('aria-expanded',String(!job.collapsed));
      const notes=[];
      if(options.embedded&&job.warning&&job.warning!==audio.warning)notes.push(text(job.warning));
      if(audio.warning||audio.error&&job.type==='STT')notes.push(text(audio.warning||audio.error));
      if(job.status==='error'&&job.error)notes.push(text(job.error));
      if(job.incomplete)notes.push('Resultado incompleto.');
      if(job.historyStatus==='failed')notes.push('Não foi possível salvar o histórico; copie o resultado disponível nesta sessão.');
      if(job.capacityWarning||options.embedded&&audio.capacityWarning)notes.push('O estado ativo ultrapassou o orçamento de sessão; conclua tarefas e copie resultados importantes.');
      if(job.type==='STT'&&job.originAvailable===false&&!job.insertion?.inserted&&!['options.html'].includes(job.origin?.page))notes.push('Destino original indisponível; nenhum texto será inserido nesta aba.');
      if(job.type==='STT'&&job.insertion?.reason==='MANUAL_EDIT_PRESERVED')notes.push('Edição manual preservada.');
      else if(job.type==='STT'&&job.insertion&&job.insertion.inserted===false&&!['OPTIONS_PREVIEW','EMPTY_TEXT'].includes(job.insertion.reason))notes.push('Inserção não confirmada. Copie o texto para recuperá-lo.');
      setText(card.note,notes.join(' '));card.note.hidden=collapsed||!notes.length;
      if(card.buttons.alert){const warning=[...notes,card.feedback.textContent,job.outcome==='NO_SPEECH'?'Sem fala confirmada.':''].filter(Boolean).join(' ');card.buttons.alert.hidden=!warning;card.buttons.alert.title=warning;card.buttons.alert.setAttribute('aria-label',warning+(collapsed?' Expandir tarefa para detalhes.':''));card.status.title=card.status.textContent;card.node.dataset.warning=String(!!warning);card.metricDetail.hidden=collapsed;}
      for(const action of ['stop','remove']){const b=card.buttons[action];b.hidden=options.taskOverlay&&action==='remove'||(action==='stop'&&available?false:!can(job,action));b.disabled=!can(job,action)||card.busy.has(action);}collapse.disabled=card.busy.has('collapse');
      for(const [action,delta]of [['previous',-5],['next',5]]){const b=card.buttons[action],reason=seekReason(job,delta);b.hidden=!available;b.disabled=!!reason;b.title=reason||(delta<0?'Retroceder':'Avançar')+' 5 segundos nesta tarefa';b.setAttribute('aria-label',b.title);}
      if(card.buttons.copy){card.buttons.copy.hidden=false;card.buttons.copy.disabled=card.busy.has('copy');card.buttons.narrate.hidden=job.type!=='STT';card.buttons.narrate.disabled=!can(job,'edit')||!(job.workingText??job.text).trim();}
      const toggle=card.buttons.playPause;toggle.hidden=!available;toggle.disabled=card.busy.has('pause')||card.busy.has('resume')||card.busy.has('play')||!(can(job,'pause')||can(job,'resume')||can(job,'play'));setText(toggle,['playing','connecting'].includes(audio.status)?'⏸':'▶');toggle.title=['playing','connecting'].includes(audio.status)?'Pausar esta tarefa':audio.status==='paused'?'Retomar esta tarefa':'Reproduzir esta tarefa do início';toggle.setAttribute('aria-label',toggle.title);card.buttons.maximize.hidden=card.buttons.collapse.hidden=!!options.jobId;
      card.settings.hidden=collapsed||!available;card.volume.disabled=!can(job,'volume');if(doc.activeElement!==card.volume&&!card.volumeTask)card.volume.value=String(audio.progress?.volume??1);
    }
    function update(next){
      if(destroyed||!next||typeof next!=='object')return false;
      if(Number.isInteger(next.presentationTabId))presentationTabId=next.presentationTabId;
      if(presentationTabId&&next.tabHud)next={...next,...next.tabHud[presentationTabId]};
      const nextRevision=number(next.revision);if(nextRevision!==null&&nextRevision<=revision)return false;
      if(nextRevision!==null)revision=nextRevision;
      state={...next,visible:options.taskOverlay||!!next.visible,minimized:!options.taskOverlay&&!!next.minimized,jobs:Array.isArray(next.jobs)?[...next.jobs].sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)||b.jobId.localeCompare(a.jobId)):[]};
      if(typeof next.notice==='string'&&next.noticeId&&next.noticeId!==seenNoticeId){seenNoticeId=next.noticeId;setText(localNotice,next.notice);clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>{if(localNotice.textContent===next.notice)setText(localNotice,'');},5000);}
      renderPanic();
      root.hidden=options.panel?false:!state.visible;root.dataset.minimized=String(!options.panel&&!options.embedded&&!options.jobId&&state.minimized);
      setText(minimize,state.minimized?'Expandir':'Minimizar');minimize.setAttribute('aria-expanded',String(!state.minimized));setText(visibility,state.visible?'Ocultar HUD':'Mostrar HUD');
      const present=new Set();let position=0;
      const compact=options.embedded||options.surface==='popup'||!options.panel&&!options.jobId;
      const candidates=state.jobs.filter(job=>options.jobId?job.jobId===options.jobId:!job.hidden);
      const focus=compact?candidates.find(job=>job.jobId===state.hudTaskId):null;
      const visibleJobs=compact?[...(focus?[focus]:[]),...candidates.filter(job=>job!==focus)].slice(0,4):candidates;
      for(const job of visibleJobs){if(!job||typeof job.jobId!=='string'||present.has(job.jobId)||(options.jobId?job.jobId!==options.jobId:job.hidden))continue;present.add(job.jobId);let card=cards.get(job.jobId);if(!card){card=createCard(job.jobId);cards.set(job.jobId,card);}card.node.hidden=false;renderCard(card,job);if(list.children[position]!==card.node)list.insertBefore(card.node,list.children[position]||null);position++;}
      for(const[id,card]of cards)if(!present.has(id)){if(card.dirty){card.node.hidden=true;setText(card.feedback,'Edição local não salva preservada. Copie o texto antes de fechar.');card.feedback.hidden=false;}else{card.node.remove();cards.delete(id);}}
      empty.hidden=present.size>0;setText(heading,`Tarefas globais (${present.size})`);
      renderPlayer();
      if(typeof options.onState==='function')options.onState(state);
      return true;
    }
    async function refresh(){
      if(destroyed)return;
      try{await request('HUD_GLOBAL_GET');if(!destroyed)setText(message,'');}
      catch{if(!destroyed&&!contextExpired)setText(message,'Não foi possível recuperar as tarefas. Reabra o painel ou atualize a página.');}
    }
    root.hidden=!options.panel;root.dataset.minimized='false';setText(heading,'Tarefas globais (0)');
    const win=doc.defaultView,reconnect=()=>{if(!doc.hidden&&!contextExpired)void refresh();},listener=message=>{if(message.type==='HUD_GLOBAL_STATE')update(message.state||message.payload?.state);return false;};
    globalThis.chrome?.runtime?.onMessage?.addListener(listener);
    win?.addEventListener?.('focus',reconnect);win?.addEventListener?.('pageshow',reconnect);doc.addEventListener?.('visibilitychange',reconnect);
    // State arrives through broadcasts; opening/focus restores the authoritative snapshot.
    const beforeClose=event=>{if([...cards.values()].some(card=>card.dirty)){event.preventDefault();event.returnValue='Há uma edição não salva.';}};win?.addEventListener?.('beforeunload',beforeClose);
    const ready=refresh();
    renderPlayer();return{update,refresh,ready,seekWords,flush:async()=>{for(const card of cards.values())if(!await saveDraft(card))return false;return true;},notice(value){if(!destroyed)setText(localNotice,text(value).slice(0,1000));},destroy(){destroyed=true;clearTimeout(noticeTimer);if(agentListener)globalThis.chrome?.storage?.onChanged?.removeListener(agentListener);globalThis.chrome?.runtime?.onMessage?.removeListener(listener);win?.removeEventListener?.('focus',reconnect);win?.removeEventListener?.('pageshow',reconnect);doc.removeEventListener?.('visibilitychange',reconnect);win?.removeEventListener?.('beforeunload',beforeClose);if(options.noticeContainer){message.remove();localNotice.remove();}if(options.embedded){panic.remove();for(const key of ['previous','toggle','next'])playerControls[key].remove();}cards.clear();root.remove();style.remove();}};
  }
  // One isolated, non-modal presentation layer per document. Jobs remain owned
  // by the registry; closing a presentation never sends Stop/Remove or HUD UI commands.
  const floatingDocuments=new WeakMap();
  async function openTask(jobId,options={}){
    if(typeof jobId!=='string'||!jobId||jobId.length>160)throw Error('Tarefa inválida.');
    const doc=options.doc||globalThis.document,win=doc.defaultView;
    let ready=floatingDocuments.get(doc);
    if(!ready){
      ready=(async()=>{
        const css=options.css||await (await win.fetch(chrome.runtime.getURL('content.css'))).text();
        const host=doc.createElement('div');host.id='ext-tts-stt-task-host';host.style.cssText='all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483647!important';
        const shadow=host.attachShadow({mode:'open'}),style=doc.createElement('style');style.textContent=css;shadow.append(style);doc.documentElement.append(host);
        const layer={host,shadow,entries:new Map(),z:0,themeRevision:0};
        layer.bounds=()=>{const v=win.visualViewport;return{left:v?.offsetLeft||0,top:v?.offsetTop||0,width:v?.width||doc.documentElement.clientWidth,height:v?.height||doc.documentElement.clientHeight};};
        layer.constrain=entry=>{
          const v=layer.bounds(),w=Math.max(1,v.width-24),h=Math.max(1,v.height-24);
          const width=Math.min(w,Math.max(Math.min(360,w),entry.width)),height=Math.min(h,Math.max(Math.min(260,h),entry.height));
          entry.x=Math.max(v.left+12,Math.min(entry.x,v.left+v.width-width-12));entry.y=Math.max(v.top+12,Math.min(entry.y,v.top+v.height-height-12));
          Object.assign(entry.element.style,{left:entry.x+'px',top:entry.y+'px',width:width+'px',height:height+'px'});
        };
        const layout=()=>{for(const entry of layer.entries.values())layer.constrain(entry);};
        win.addEventListener('resize',layout);win.visualViewport?.addEventListener('resize',layout);win.visualViewport?.addEventListener('scroll',layout);
        layer.theme=async()=>{
          const revision=++layer.themeRevision,source=options.appearanceSource;
          if(source){const values=win.getComputedStyle(source);for(let i=0;i<source.style.length;i++){const key=source.style[i];if(key.startsWith('--hud-')&&(key.endsWith('-alpha')||key==='--hud-border-strength'))host.style.setProperty(key,values.getPropertyValue(key));}return;}
          const saved=await chrome.storage.local.get(['hudTransparency','hudContentTransparency']);if(revision!==layer.themeRevision)return;
          const level=value=>typeof value==='number'&&Number.isFinite(value)?Math.max(0,Math.min(100,value)):50;
          const alpha=(value,base,opaque,clear)=>String(value<=50?base+(opaque-base)*(50-value)/50:base+(clear-base)*(value-50)/50);
          const structural=level(saved.hudTransparency),content=level(saved.hudContentTransparency);
          host.style.setProperty('--hud-panel-alpha',alpha(structural,.49,.97,.025));
          for(const[key,base,opaque,clear]of [['card',.76,.96,.68],['active',.8,.97,.72],['control',.78,.96,.74],['surface',.76,.96,.7],['title',.8,.97,.74],['transport',.6,.9,.55],['button',.04,.2,.02],['indicator',.055,.16,.025],['muted',.025,.12,.01],['transcript',.17,.4,.08]])host.style.setProperty('--hud-'+key+'-alpha',alpha(content,base,opaque,clear));
          host.style.setProperty('--hud-border-strength',String(1-content*.008));
        };
        const changed=(changes,area)=>{if(area==='local'&&(changes.hudTransparency||changes.hudContentTransparency))win.requestAnimationFrame(()=>void layer.theme().catch(()=>{}));};
        globalThis.chrome?.storage?.onChanged?.addListener(changed);await layer.theme();
        win.addEventListener('pagehide',()=>{win.removeEventListener('resize',layout);win.visualViewport?.removeEventListener('resize',layout);win.visualViewport?.removeEventListener('scroll',layout);globalThis.chrome?.storage?.onChanged?.removeListener(changed);for(const entry of layer.entries.values()){entry.finish?.();entry.view.destroy();}layer.entries.clear();host.remove();floatingDocuments.delete(doc);},{once:true});
        return layer;
      })();
      floatingDocuments.set(doc,ready);ready.catch(()=>floatingDocuments.delete(doc));
    }
    const layer=await ready,existing=layer.entries.get(jobId);
    if(existing){existing.element.style.zIndex=String(++layer.z);existing.element.focus({preventScroll:true});return existing;}
    const frame=doc.createElement('section');frame.className='fm-task-float';frame.dataset.taskId=jobId;frame.tabIndex=-1;frame.setAttribute('role','dialog');frame.setAttribute('aria-modal','false');frame.setAttribute('aria-label','Tarefa expandida');
    const body=doc.createElement('div');body.className='fm-task-content';
    const close=doc.createElement('button');close.className='ext-btn-icon fm-task-close';close.type='button';close.textContent='×';close.title='Fechar tarefa expandida sem interromper';close.setAttribute('aria-label',close.title);
    const resize=doc.createElement('button');resize.className='fm-task-resize';resize.type='button';resize.textContent='⌟';resize.title='Redimensionar tarefa (arraste ou use as setas)';resize.setAttribute('aria-label',resize.title);
    frame.append(body,close,resize);layer.shadow.append(frame);
    const v=layer.bounds(),offset=Math.min(72,layer.entries.size*24),entry={element:frame,width:680,height:560,x:v.left+Math.max(12,(v.width-680)/2)+offset,y:v.top+Math.max(12,(v.height-560)/2)+offset};
    layer.entries.set(jobId,entry);layer.constrain(entry);
    const raise=()=>{frame.style.zIndex=String(++layer.z);};
    const send=options.send||(message=>chrome.runtime.sendMessage(message));
    entry.view=mount(body,{panel:true,embedded:true,taskOverlay:true,jobId,send,clipboard:options.clipboard,onState:state=>{
      const job=state.jobs.find(j=>j.jobId===jobId);frame.setAttribute('aria-label',job?(job.type==='STT'?'Ditado':'Narração')+' — tarefa expandida':'Resultado não disponível nesta sessão');
      const header=frame.querySelector('.fm-global-card-header');if(header){header.tabIndex=0;header.title='Mover tarefa (arraste ou use as setas)';header.setAttribute('aria-label',header.title);}
      const empty=frame.querySelector('.fm-global-empty');if(empty&&!job)empty.textContent='Resultado não disponível nesta sessão. Consulte o histórico nas Opções.';
    }});
    let closing=false;
    entry.close=async()=>{if(closing)return;closing=true;try{if(!await entry.view.flush())return;entry.finish?.();entry.view.destroy();frame.remove();layer.entries.delete(jobId);}finally{closing=false;}};
    close.onclick=()=>void entry.close();
    frame.addEventListener('pointerdown',event=>{raise();
      const resizing=event.target===resize,header=frame.querySelector('.fm-global-card-header'),headerBox=header?.getBoundingClientRect();
      // The visual header also includes the waveform/SVG and top padding,
      // not just the thin title row below them. Coordinates stay in viewport space.
      const handle=event.target.closest?.('.fm-global-card-header,.fm-global-empty')||headerBox&&event.clientY>=frame.getBoundingClientRect().top&&event.clientY<=headerBox.bottom;
      if(event.button!==0||!resizing&&(!handle||event.target.closest?.('button,input,select,textarea,a,[contenteditable]')))return;
      event.preventDefault();entry.finish?.();const point={x:event.clientX,y:event.clientY,left:entry.x,top:entry.y,width:frame.offsetWidth,height:frame.offsetHeight};frame.setPointerCapture(event.pointerId);
      const move=e=>{if(e.pointerId!==event.pointerId)return;if(resizing){const b=layer.bounds();entry.width=Math.min(b.width-24,Math.max(360,point.width+e.clientX-point.x));entry.height=Math.min(b.height-24,Math.max(260,point.height+e.clientY-point.y));}else{entry.x=point.left+e.clientX-point.x;entry.y=point.top+e.clientY-point.y;}layer.constrain(entry);};
      const finish=e=>{if(e?.pointerId!==undefined&&e.pointerId!==event.pointerId)return;win.removeEventListener('pointermove',move);win.removeEventListener('pointerup',finish);win.removeEventListener('pointercancel',finish);win.removeEventListener('blur',finish);frame.removeEventListener('lostpointercapture',finish);if(frame.hasPointerCapture(event.pointerId))frame.releasePointerCapture(event.pointerId);entry.finish=null;};
      entry.finish=finish;win.addEventListener('pointermove',move);win.addEventListener('pointerup',finish);win.addEventListener('pointercancel',finish);win.addEventListener('blur',finish);frame.addEventListener('lostpointercapture',finish);
    });
    frame.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();void entry.close();return;}
      const resizing=event.target===resize,handle=event.target.matches?.('.fm-global-card-header');if(!resizing&&!handle||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
      event.preventDefault();const step=event.shiftKey?1:10,dx=event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0,dy=event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0;
      if(resizing){entry.width=frame.offsetWidth+dx;entry.height=frame.offsetHeight+dy;}else{entry.x+=dx;entry.y+=dy;}layer.constrain(entry);
    });
    await entry.view.ready;raise();frame.focus({preventScroll:true});return entry;
  }
  return{mount,openTask,activeBorder,availableText,progressLabel,SEEK_LIMITATION,AGENTS};
});
