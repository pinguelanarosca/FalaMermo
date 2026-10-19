(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.GlobalHud=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const STATUS={ready:'Pronto',connecting:'Conectando',recording:'Gravando',flushing:'Finalizando envio',waiting:'Aguardando Gemini',transforming:'Transformando',inserting:'Inserindo',playing:'Reproduzindo',paused:'Pausado',completed:'Concluído',error:'Erro',cancelled:'Cancelado',stopped:'Parado'};
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
  .fm-global-jobs{display:grid;align-content:start;grid-auto-rows:max-content;gap:8px;max-height:min(56vh,520px);overflow:auto;overscroll-behavior:contain;min-height:0}.fm-global-hud::-webkit-scrollbar,.fm-global-hud ::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}
  .fm-global-card{border:1px solid #334155;background:#0f172a;border-radius:8px;padding:9px;min-width:0;align-self:start}
  .fm-global-card[data-collapsed="true"]{padding:6px 8px;min-height:0;height:auto}.fm-global-card[data-collapsed="true"]>:not(.fm-global-card-header){display:none!important}
  .fm-global-card-header{display:flex;align-items:center;justify-content:space-between;gap:6px;white-space:nowrap}.fm-global-kind{font-weight:650;flex:none}.fm-global-description{flex:1;min-width:0;max-width:12ch;overflow:hidden;text-overflow:ellipsis;color:#94a3b8;font-size:10px}.fm-global-status{color:#93c5fd;min-width:0;max-width:14ch;overflow:hidden;text-overflow:ellipsis}.fm-global-origin,.fm-global-progress,.fm-global-label,.fm-global-note{font-size:11px;color:#94a3b8;margin-top:3px;overflow-wrap:anywhere}
  .fm-global-text{white-space:pre-wrap;overflow-wrap:anywhere;max-height:150px;overflow:auto;margin:5px 0 7px;user-select:text!important;-webkit-user-select:text!important;cursor:text}
  .fm-global-label{margin-top:7px}.fm-global-partial{color:#cbd5e1}.fm-global-actions{margin-top:7px}.fm-global-settings{margin-top:7px}.fm-global-settings label{display:flex;gap:5px;align-items:center;flex:1;min-width:120px}.fm-global-settings input{width:85px;flex:1;min-width:35px}.fm-global-feedback,.fm-global-message{min-height:1.3em;font-size:11px;color:#cbd5e1;margin-top:4px}.fm-global-message:empty,.fm-global-feedback:empty{display:none}
  .fm-global-empty{color:#94a3b8;padding:9px 0}.fm-global-hud[data-minimized="true"]>:not(.fm-global-head){display:none}
  .fm-global-card[data-active="true"]{border-color:#60a5fa;background:#132039}.fm-global-card:focus-visible{outline:2px solid #60a5fa;outline-offset:1px}
  .fm-global-card-tools{display:flex;gap:4px;align-items:center;flex:none}.fm-global-card-tools button{padding:2px 7px;min-width:26px}.fm-global-summary{color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:4px}
  .fm-global-editor{display:block;resize:vertical;width:100%;min-height:88px;max-height:180px;padding:7px;background:#111827;color:#f1f5f9;border:1px solid #475569;border-radius:6px;font:inherit;user-select:text;-webkit-user-select:text}
  .fm-global-player{border-top:1px solid #334155;margin-top:9px;padding-top:8px}.fm-global-player-buttons{display:grid;grid-template-columns:1fr 1.3fr 1fr 1fr;gap:6px}.fm-global-player-buttons button{min-height:32px;padding:4px}.fm-global-player-buttons [data-action="toggle"]{background:#2563eb;border-color:#3b82f6;font-size:16px}.fm-global-player .fm-global-settings{display:grid;grid-template-columns:1fr 1fr;gap:8px}.fm-global-player .fm-global-settings label{min-width:0}.fm-global-player .fm-global-settings input{width:50px;accent-color:#60a5fa}
  .fm-global-agent-row{display:flex;gap:6px;margin-bottom:6px}.fm-global-agent-row select{min-width:0;flex:1;background:#1e293b;color:#f8fafc;border:1px solid #475569;border-radius:6px;padding:5px;font:inherit}.fm-global-player-state{font-size:11px;color:#93c5fd;margin-bottom:5px}.fm-global-seek-note{font-size:10px;color:#94a3b8;margin-top:5px}.fm-global-head button{padding:3px 6px;font-size:11px}
  @media(max-width:340px){.fm-global-head{gap:4px}.fm-global-jobs{max-height:42vh}.fm-global-heading{font-size:11px}}
  `;
  function text(value){return typeof value==='string'?value:'';}
  function number(value){return typeof value==='number'&&Number.isFinite(value)?value:null;}
  function can(job,action){const c=job.controls;return Array.isArray(c)?c.includes(action):!!(c&&c[action]);}
  function availableText(job){return text(job.text)||text(job.partialText);}
  function seekReason(job,delta){if(job?.type!=='TTS')return 'Selecione uma narração TTS para navegar.';if(!can(job,'seek')||!(job.progress?.availableEnd>0))return 'PCM desta reprodução indisponível; inicie ou aguarde o áudio.';const p=job.progress;if(delta<0&&p.currentTime<=p.availableStart)return 'Início do PCM retido alcançado (até 60 s de retrocesso).';if(delta>0&&p.currentTime>=p.availableEnd)return 'Fim do PCM recebido; aguarde mais áudio ou retroceda.';return '';}
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
    const style=element('style');style.textContent=CSS;
    const root=element('section','fm-global-hud');root.setAttribute('aria-label','Tarefas globais FalaMermo');root.dataset.surface=options.jobId?'task':options.embedded?'hud':options.surface||'panel';root.dataset.layout='compact-2';if(options.jobId)root.dataset.dedicated='true';
    const head=element('div','fm-global-head'),heading=element('span','fm-global-heading','Tarefas globais'),toolbar=element('div','fm-global-toolbar');
    const minimize=element('button','','Minimizar'),visibility=element('button','','Ocultar HUD');minimize.type=visibility.type='button';
    toolbar.append(minimize,visibility);head.append(heading,toolbar);
    const message=element('div','fm-global-message');message.setAttribute('role','status');message.setAttribute('aria-live','polite');
    const localNotice=element('div','fm-global-message');localNotice.setAttribute('role','alert');
    const list=element('div','fm-global-jobs');list.setAttribute('tabindex','0');list.setAttribute('aria-label','Lista de tarefas');const empty=element('div','fm-global-empty','Nenhuma tarefa disponível.');
    const player=element('div','fm-global-player'),playerState=element('div','fm-global-player-state','Selecione uma narração'),playerButtons=element('div','fm-global-player-buttons'),playerSettings=element('div','fm-global-settings'),seekNote=element('div','fm-global-seek-note',SEEK_LIMITATION);
    player.append(playerState,playerButtons,playerSettings,seekNote);
    root.append(head,message,localNotice,empty,list,player);container.append(style,root);
    const cards=new Map();let revision=-1,state={visible:false,minimized:false,jobs:[]},destroyed=false,contextExpired=false;
    async function request(type,payload){
      if(contextExpired)throw new Error('Extensão atualizada. Atualize esta página (F5) para usar os controles.');
      let response;try{response=await send({type,payload:payload||{}});}catch(error){if(/extension context invalidated/i.test(error?.message||String(error))){contextExpired=true;setText(message,'Extensão atualizada. Atualize esta página (F5) para usar os controles.');}throw error;}
      if(!response||response.success===false)throw new Error(response?.error||'Comando não confirmado');
      if(response.state)update(response.state);
      return response;
    }
    async function ui(payload,button){
      if(destroyed)return;button.disabled=true;
      try{await request('HUD_GLOBAL_UI_SET',payload);setText(message,'');}
      catch{if(!destroyed)setText(message,'Não foi possível atualizar o HUD. Reabra o painel ou atualize a página.');}
      finally{if(!destroyed)button.disabled=false;}
    }
    minimize.onclick=()=>ui({minimized:!state.minimized},minimize);
    visibility.onclick=()=>ui({visible:!state.visible},visibility);
    if(options.embedded||options.jobId){toolbar.hidden=true;}
    minimize.hidden=options.panel===true;
    let agentListener=null;
    if(options.agentSelector&&globalThis.chrome?.storage?.local){
      const row=element('div','fm-global-agent-row'),select=element('select'),settings=element('button','','⚙');select.setAttribute('aria-label','Agente ativo');settings.type='button';settings.title='Configurações';settings.setAttribute('aria-label','Configurações');row.append(select,settings);root.insertBefore(row,list);
      const load=async()=>{try{const {agents={}}=await chrome.storage.local.get('agents');if(destroyed)return;select.replaceChildren();for(const[id,name]of [...AGENTS,...(agents.customAgents||[]).map(a=>[a.metadata?.id,'★ '+(a.metadata?.name||a.metadata?.id)])]){if(!id)continue;const option=element('option','',name);option.value=id;select.append(option);}select.value=agents.activeAgentId||'narrator';}catch{setText(message,'Não foi possível ler o agente ativo.');}};
      select.onchange=async()=>{try{const {agents={}}=await chrome.storage.local.get('agents');await chrome.storage.local.set({agents:{...agents,activeAgentId:select.value}});}catch{setText(message,'Não foi possível alterar o agente.');}};
      settings.onclick=async()=>{try{await chrome.runtime.openOptionsPage();}catch{setText(message,'Não foi possível abrir as configurações.');}};
      agentListener=(changes,area)=>{if(area==='local'&&changes.agents)void load();};chrome.storage.onChanged?.addListener(agentListener);void load();
    }
    const playerControls={};let playerBusy=0;const pendingSettings=new Map();let settingTask=null;
    function setPlayerSettings(name,value){const job=activeJob();if(!job||job.type!=='TTS'||!Number.isFinite(value)||destroyed)return Promise.resolve();pendingSettings.set(job.jobId,{...pendingSettings.get(job.jobId),...(job.requestId?{requestId:job.requestId}:{}),[name]:value});if(settingTask)return settingTask;settingTask=(async()=>{try{while(pendingSettings.size&&!destroyed){const[id,values]=pendingSettings.entries().next().value;pendingSettings.delete(id);try{await request('HUD_GLOBAL_COMMAND',{jobId:id,action:'set',...values});}catch(error){setText(message,error.message||'Não foi possível ajustar a reprodução.');}}}finally{settingTask=null;}})();return settingTask;}
    function activeJob(){return state.jobs.find(job=>job.jobId===(options.jobId||state.activeTaskId))||state.jobs.find(job=>job.type==='TTS')||state.jobs[0];}
    async function playerCommand(action,values={}){
      const job=activeJob();if(!job||playerBusy&&action!=='seek'||destroyed)return;playerBusy++;renderPlayer();
      try{const card=cards.get(job.jobId);if(action==='play'&&card?.dirty&&!await saveDraft(card))return;await request('HUD_GLOBAL_COMMAND',{jobId:job.jobId,action,...(job.requestId?{requestId:job.requestId}:{}),...values});setText(message,'');}
      catch(error){if(!destroyed)setText(message,error.message||'Não foi possível controlar esta tarefa.');}
      finally{playerBusy--;if(!destroyed)renderPlayer();}
    }
    for(const[action,label,title]of [['previous','⏪','Retroceder 5 segundos'],['toggle','▶','Retomar último pausado'],['next','⏩','Avançar 5 segundos'],['create','+','Criar nova tarefa']]){
      const button=element('button','',label);button.type='button';button.dataset.action=action;button.title=title;button.setAttribute('aria-label',title);playerButtons.append(button);playerControls[action]=button;
    }
    playerControls.toggle.onclick=async()=>{if(playerBusy||destroyed)return;const action=state.jobs.some(job=>job.type==='TTS'&&job.status==='playing')?'pause':'resume';playerBusy++;renderPlayer();try{await request('HUD_GLOBAL_TOGGLE',{action});setText(message,'');}catch(error){setText(message,error.message);}finally{playerBusy--;if(!destroyed)renderPlayer();}};
    playerControls.previous.onclick=()=>seekWords(-1);playerControls.next.onclick=()=>seekWords(1);
    function seekWords(delta){if(!Number.isInteger(delta)||!delta||seekReason(activeJob(),delta))return Promise.resolve(false);return playerCommand('seek',{deltaSeconds:delta<0?-5:5});}
    playerControls.create.onclick=async()=>{if(playerControls.create.disabled)return;playerControls.create.disabled=true;try{await request('HUD_GLOBAL_CREATE');setText(message,'');const card=cards.get(state.activeTaskId);card?.editor.focus?.();}catch(error){setText(message,error.message||'Não foi possível criar a tarefa.');}finally{if(!destroyed)playerControls.create.disabled=false;}};
    for(const[name,title,min,max,step]of [['volume','Volume',0,1,.05],['playbackRate','Velocidade',.5,2,.1]]){
      const label=element('label','',title),input=element('input');input.type='range';input.min=String(min);input.max=String(max);input.step=String(step);input.dataset.control=name;input.setAttribute('aria-label',title+' da tarefa ativa');label.append(input);playerSettings.append(label);playerControls[name]=input;input.oninput=()=>{input.title=input.value;return setPlayerSettings(name,Number(input.value));};input.onchange=input.oninput;
    }
    function renderPlayer(){const job=activeJob(),tts=job?.type==='TTS',playing=state.jobs.some(job=>job.type==='TTS'&&job.status==='playing'),resumable=state.jobs.some(job=>job.type==='TTS'&&job.status==='paused');
      if(options.compactControls){options.compactControls.hidden=!state.minimized;for(const action of ['previous','toggle','next']){const button=playerControls[action];if(state.minimized){if(button.parentNode!==options.compactControls)options.compactControls.append(button);}else if(button.parentNode!==playerButtons)playerButtons.insertBefore(button,playerControls.create);}}
      setText(playerState,job?(job.manual?'Tarefa manual · ':tts?'Narração · ':'Ditado · ')+(STATUS[job.status]||'Processando'):'Nenhuma tarefa ativa');
      setText(playerControls.toggle,playing?'⏸':'▶');const label=playing?'Pausar todas as narrações':'Retomar a narração pausada mais recentemente';playerControls.toggle.title=label;playerControls.toggle.setAttribute('aria-label',label);playerControls.toggle.disabled=playerBusy||!(playing||resumable);
      for(const [name,delta]of [['previous',-5],['next',5]]){const reason=seekReason(job,delta),label=(delta<0?'Retroceder':'Avançar')+' 5 segundos';playerControls[name].disabled=!!reason;playerControls[name].title=reason||label;playerControls[name].setAttribute('aria-label',reason||label);}setText(seekNote,[seekReason(job,0),SEEK_LIMITATION].filter(Boolean).join(' '));seekNote.hidden=false;player.hidden=!!options.jobId;
      for(const name of ['volume','playbackRate']){const input=playerControls[name];input.disabled=!tts;if(doc.activeElement!==input)input.value=String(number(job?.[name]??job?.progress?.[name])??1);input.title=input.value;}
    }
    async function saveDraft(card){if(!card.dirty)return Promise.resolve(true);if(card.saving)return card.saving;card.saving=(async()=>{try{while(card.dirty&&!destroyed){const value=card.editor.value,expectedText=card.editBase;await request('HUD_GLOBAL_COMMAND',{jobId:card.job.jobId,action:'edit',text:value,expectedText});card.editBase=value;if(card.editor.value===value)card.dirty=false;}return !card.dirty;}catch(error){if(!destroyed)setText(card.feedback,error.message||'Edição não salva. Copie seu texto antes de fechar.');return false;}finally{card.saving=null;if(!destroyed){renderCard(card,card.job);renderPlayer();}}})();return card.saving;}
    function createCard(id){
      const node=element('article','fm-global-card');node.dataset.jobId=id;
      const header=element('div','fm-global-card-header'),kind=element('span','fm-global-kind'),description=element('span','fm-global-description'),status=element('span','fm-global-status'),tools=element('div','fm-global-card-tools');header.append(kind,description,status,tools);node.setAttribute('tabindex','0');node.setAttribute('aria-label','Selecionar tarefa');
      const origin=element('div','fm-global-origin'),progress=element('div','fm-global-progress');
      const detail=element('div','fm-global-detail'),label=element('div','fm-global-label'),body=element('div','fm-global-text'),partialLabel=element('div','fm-global-label','Transcrição provisória'),partial=element('div','fm-global-text fm-global-partial');
      const editor=element('textarea','fm-global-editor');editor.setAttribute('aria-label','Texto da tarefa manual');editor.placeholder='Digite ou cole o texto para narrar';editor.hidden=true;
      body.setAttribute('tabindex','0');partial.setAttribute('tabindex','0');detail.append(label,body,partialLabel,partial,editor);
      const note=element('div','fm-global-note'),actions=element('div','fm-global-actions'),settings=element('div','fm-global-settings'),feedback=element('div','fm-global-feedback');feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');
      node.append(header,origin,progress,detail,note,actions,settings,feedback);list.append(node);
      const summary=element('div','fm-global-summary');node.append(summary);
      const card={node,kind,description,status,origin,progress,label,body,partialLabel,partial,note,feedback,buttons:{},actions,settings,detail,summary,editor,dirty:false,editBase:'',saving:null,job:null,busy:new Set()};
      function button(action,label,handler){const b=element('button','',label);b.type='button';b.dataset.action=action;b.onclick=handler;actions.append(b);card.buttons[action]=b;return b;}
      async function command(action,values={}){
        if(destroyed||card.busy.has(action)&&action!=='seek')return;
        if(['remove','maximize'].includes(action)&&card.dirty&&!await saveDraft(card))return;
        card.busy.add(action);renderCard(card,card.job);
        try{await request('HUD_GLOBAL_COMMAND',{jobId:id,action,...(['stop','pause','resume','seek','set'].includes(action)&&card.job.requestId?{requestId:card.job.requestId}:{}),...(['play','narrate'].includes(action)?{expectedText:card.editBase}:{}),...values});if(!destroyed)setText(feedback,'');}
        catch(error){if(!destroyed)setText(feedback,'Não foi possível aplicar o comando a esta tarefa. '+error.message+' O texto disponível foi preservado.');}
        finally{card.busy.delete(action);if(!destroyed&&cards.has(id))renderCard(card,card.job);}
      }
      async function copy(partialOnly=false){
        const content=partialOnly?text(card.job.partialText):card.dirty?card.editor.value:card.job.type==='STT'?card.job.workingText??[card.job.text,card.job.partialText].filter(Boolean).join(' '):!card.editor.hidden?card.editor.value:availableText(card.job),action=partialOnly?'copyPartial':'copy';
        if(!content||card.busy.has(action)||destroyed)return;
        card.busy.add(action);renderCard(card,card.job);
        try{
          const clipboard=options.clipboard||(doc.defaultView&&doc.defaultView.navigator&&doc.defaultView.navigator.clipboard)||(typeof navigator!=='undefined'&&navigator.clipboard);
          if(!clipboard||typeof clipboard.writeText!=='function')throw new Error('Clipboard indisponível');
          await clipboard.writeText(content);
          if(!destroyed)setText(feedback,partialOnly?'Texto provisório copiado.':'Texto copiado.');
        }catch{if(!destroyed)setText(feedback,'Não foi possível copiar. Selecione o texto e use Ctrl+C.');}
        finally{card.busy.delete(action);if(!destroyed&&cards.has(id))renderCard(card,card.job);}
      }
      button('previous','⏪',()=>seekReason(card.job,-5)?undefined:command('seek',{deltaSeconds:-5}));
      button('playPause','▶',async()=>{if(card.dirty&&!await saveDraft(card))return;return command(card.job.status==='playing'?'pause':card.job.status==='paused'?'resume':'play');});
      button('next','⏩',()=>seekReason(card.job,5)?undefined:command('seek',{deltaSeconds:5}));const stop=button('stop','■',()=>command('stop'));stop.title='Parar esta tarefa';stop.setAttribute('aria-label',stop.title);if(options.jobId){button('copy','Copiar texto',()=>copy());button('narrate','Narrar cópia de trabalho',async()=>{if(card.dirty&&!await saveDraft(card))return;return command('narrate');});}
      const collapse=button('collapse','⌃',()=>command('collapse',{collapsed:!card.job.collapsed})),maximize=button('maximize','↗',()=>command('maximize')),remove=button('remove','×',()=>command('remove'));tools.append(collapse,maximize,remove);maximize.title='Abrir janela da tarefa';maximize.setAttribute('aria-label',maximize.title);remove.title='Ocultar cartão sem parar a tarefa';remove.setAttribute('aria-label',remove.title);
      node.onclick=event=>{if(event?.target?.closest?.('button,input,textarea,select,a'))return;return command('select');};node.onkeydown=event=>{if(event.target===node&&(event.key==='Enter'||event.key===' ')){event.preventDefault();void command('select');}};
      editor.oninput=()=>{card.dirty=true;renderPlayer();return saveDraft(card);};editor.onchange=()=>saveDraft(card);
      return card;
    }
    function renderCard(card,job){
      if(!job)return;card.job=job;
      setText(card.kind,job.type==='STT'?'🎙 Ditado':job.manual?'✎ Manual':'🔊 Narração');setText(card.status,STATUS[job.status]||'Em andamento');card.node.dataset.active=String(activeJob()?.jobId===job.jobId);card.node.setAttribute('aria-current',String(activeJob()?.jobId===job.jobId));
      const short=availableText(job).replace(/\s+/g,' ').trim().slice(0,80)||(job.manual?'Texto manual':job.type==='STT'?'Microfone':'Gemini Live');setText(card.description,short);card.description.title=short;
      const source=job.origin||{};setText(card.origin,number(source.tabId)!==null&&source.tabId>0?`Origem: aba ${source.tabId}${number(source.frameId)!==null&&source.frameId!==0?' · frame '+source.frameId:''}`:'Origem: painel da extensão');if(options.jobId)setText(card.origin,card.origin.textContent+' · Agente: '+text(job.agentId)+' · Criado: '+(Number.isFinite(job.createdAt)?new Date(job.createdAt).toLocaleString('pt-BR'):'—')+' · ID: '+job.jobId);
      setText(card.progress,progressLabel(job.progress));card.progress.hidden=!card.progress.textContent;
      setText(card.label,job.type==='TTS'?'Texto da narração':'Transcrição confirmada');setText(card.body,text(job.text));card.body.hidden=card.label.hidden=!job.text;
      setText(card.partial,text(job.partialText));card.partial.hidden=card.partialLabel.hidden=!job.partialText;
      card.editor.hidden=!(job.manual||options.jobId);card.editor.disabled=!can(job,'edit');if(!card.dirty){card.editBase=text(job.type==='STT'?job.workingText??job.text:job.text);if(card.editor.value!==card.editBase)card.editor.value=card.editBase;}if(job.type==='STT')card.editor.setAttribute('aria-label','Cópia de trabalho (não altera transcrição nem texto inserido)');else card.editor.setAttribute('aria-label','Texto da narração');if(!card.editor.hidden&&job.type==='TTS')card.body.hidden=true;
      const collapsed=job.collapsed===true&&!options.jobId;card.node.dataset.collapsed=String(collapsed);card.detail.hidden=collapsed;card.origin.hidden=collapsed;card.progress.hidden=collapsed||!card.progress.textContent;card.actions.hidden=collapsed;card.summary.hidden=true;card.feedback.hidden=collapsed;
      const collapse=card.buttons.collapse;setText(collapse,job.collapsed?'⌄':'⌃');collapse.title=job.collapsed?'Expandir tarefa':'Recolher tarefa';collapse.setAttribute('aria-label',collapse.title);collapse.setAttribute('aria-expanded',String(!job.collapsed));
      const notes=[];
      if(job.status==='error'&&job.error)notes.push(text(job.error));
      if(job.incomplete)notes.push('Resultado incompleto.');
      if(job.historyStatus==='failed')notes.push('Não foi possível salvar o histórico; copie o resultado disponível nesta sessão.');
      if(job.capacityWarning)notes.push('O estado ativo ultrapassou o orçamento de sessão; conclua tarefas e copie resultados importantes.');
      if(job.type==='STT'&&job.originAvailable===false&&!job.insertion?.inserted&&!['options.html'].includes(job.origin?.page))notes.push('Destino original indisponível; nenhum texto será inserido nesta aba.');
      if(job.type==='STT'&&job.insertion&&job.insertion.inserted===false&&job.insertion.reason!=='OPTIONS_PREVIEW')notes.push('Inserção não confirmada. Copie o texto para recuperá-lo.');
      setText(card.note,notes.join(' '));card.note.hidden=collapsed||!notes.length;
      for(const action of ['stop','remove']){const b=card.buttons[action];b.hidden=action==='stop'&&job.type==='TTS'?false:!can(job,action);b.disabled=!can(job,action)||card.busy.has(action);}collapse.disabled=card.busy.has('collapse');
      for(const [action,delta]of [['previous',-5],['next',5]]){const b=card.buttons[action],reason=seekReason(job,delta);b.hidden=job.type!=='TTS';b.disabled=!!reason;b.title=reason||(delta<0?'Retroceder':'Avançar')+' 5 segundos nesta tarefa';b.setAttribute('aria-label',b.title);}
      if(card.buttons.copy){card.buttons.copy.hidden=false;card.buttons.copy.disabled=card.busy.has('copy');card.buttons.narrate.hidden=job.type!=='STT';card.buttons.narrate.disabled=!can(job,'edit')||!(job.workingText??job.text).trim();}
      const toggle=card.buttons.playPause;toggle.hidden=job.type!=='TTS';toggle.disabled=card.busy.has('pause')||card.busy.has('resume')||card.busy.has('play')||!(can(job,'pause')||can(job,'resume')||can(job,'play'));setText(toggle,job.status==='playing'?'⏸':'▶');toggle.title=job.status==='playing'?'Pausar esta tarefa':job.status==='paused'?'Retomar esta tarefa':'Reproduzir esta tarefa do início';toggle.setAttribute('aria-label',toggle.title);card.buttons.maximize.hidden=card.buttons.collapse.hidden=!!options.jobId;
      card.settings.hidden=true;
    }
    function update(next){
      if(destroyed||!next||typeof next!=='object')return false;
      const nextRevision=number(next.revision);if(nextRevision!==null&&nextRevision<=revision)return false;
      if(nextRevision!==null)revision=nextRevision;
      state={...next,visible:!!next.visible,minimized:!!next.minimized,jobs:Array.isArray(next.jobs)?[...next.jobs].sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)||b.jobId.localeCompare(a.jobId)):[]};
      root.hidden=options.panel?false:!state.visible;root.dataset.minimized=String(!options.panel&&!options.embedded&&!options.jobId&&state.minimized);
      setText(minimize,state.minimized?'Expandir':'Minimizar');minimize.setAttribute('aria-expanded',String(!state.minimized));setText(visibility,state.visible?'Ocultar HUD':'Mostrar HUD');
      const present=new Set();let position=0;
      for(const job of state.jobs){if(!job||typeof job.jobId!=='string'||present.has(job.jobId)||(options.jobId?job.jobId!==options.jobId:job.hidden))continue;present.add(job.jobId);let card=cards.get(job.jobId);if(!card){card=createCard(job.jobId);cards.set(job.jobId,card);}renderCard(card,job);if(list.children[position]!==card.node)list.insertBefore(card.node,list.children[position]||null);position++;}
      for(const[id,card]of cards)if(!present.has(id)){if(card.dirty){setText(card.feedback,'Edição local não salva preservada. Copie o texto antes de fechar.');card.feedback.hidden=false;}else{card.node.remove();cards.delete(id);}}
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
    renderPlayer();return{update,refresh,ready,seekWords,notice(value){if(!destroyed)setText(localNotice,text(value).slice(0,1000));},destroy(){destroyed=true;if(agentListener)globalThis.chrome?.storage?.onChanged?.removeListener(agentListener);globalThis.chrome?.runtime?.onMessage?.removeListener(listener);win?.removeEventListener?.('focus',reconnect);win?.removeEventListener?.('pageshow',reconnect);doc.removeEventListener?.('visibilitychange',reconnect);win?.removeEventListener?.('beforeunload',beforeClose);cards.clear();root.remove();style.remove();}};
  }
  return{mount,availableText,progressLabel,SEEK_LIMITATION,AGENTS};
});
