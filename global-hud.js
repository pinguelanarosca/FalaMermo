(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.GlobalHud=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const STATUS={ready:'Pronto',connecting:'Conectando',recording:'Gravando',flushing:'Finalizando envio',waiting:'Aguardando Gemini',transforming:'Transformando',inserting:'Inserindo',playing:'Reproduzindo',paused:'Pausado',completed:'Concluído',error:'Erro',cancelled:'Cancelado',stopped:'Parado'};
  const SEEK_LIMITATION='Navegação exata indisponível: o áudio PCM Live não inclui timestamps por palavra.';
  const AGENTS=[['narrator','Narrador Fluido'],['translator','Tradutor Simultâneo'],['summarizer','Resumidor Executivo'],['editor','Revisor Gramatical & Ditado'],['explainer','Professor Didático'],['developer','Assistente de Código & Dev'],['podcast','Estilo Podcast'],['accessibility','Leitor de Acessibilidade']];
  const CSS=`
  .fm-global-hud{font:12px/1.4 system-ui,sans-serif;color:#e2e8f0;min-width:0;user-select:text;-webkit-user-select:text}
  .fm-global-hud[hidden],.fm-global-hud [hidden]{display:none!important}
  .fm-global-hud *{box-sizing:border-box}.fm-global-head,.fm-global-actions,.fm-global-settings{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
  .fm-global-head{justify-content:space-between;padding:8px 0}.fm-global-heading{font-weight:650}.fm-global-toolbar{display:flex;gap:4px}
  .fm-global-hud button{appearance:none;width:auto;border:1px solid #475569;border-radius:6px;background:#1e293b;color:#f8fafc;padding:5px 8px;font:inherit;cursor:pointer;user-select:none;-webkit-user-select:none}
  .fm-global-hud button:hover{background:#334155}.fm-global-hud button:disabled{opacity:.5;cursor:default}.fm-global-hud button:focus-visible,.fm-global-hud input:focus-visible{outline:2px solid #60a5fa;outline-offset:2px}
  .fm-global-jobs{display:grid;gap:8px;max-height:min(56vh,520px);overflow:auto;overscroll-behavior:contain}
  .fm-global-card{border:1px solid #334155;background:#0f172a;border-radius:8px;padding:9px;min-width:0}
  .fm-global-card-header{display:flex;justify-content:space-between;gap:8px}.fm-global-kind{font-weight:650}.fm-global-status{color:#93c5fd}.fm-global-origin,.fm-global-progress,.fm-global-label,.fm-global-note{font-size:11px;color:#94a3b8;margin-top:3px}
  .fm-global-text{white-space:pre-wrap;overflow-wrap:anywhere;max-height:150px;overflow:auto;margin:5px 0 7px;user-select:text!important;-webkit-user-select:text!important;cursor:text}
  .fm-global-label{margin-top:7px}.fm-global-partial{color:#cbd5e1}.fm-global-actions{margin-top:7px}.fm-global-settings{margin-top:7px}.fm-global-settings label{display:flex;gap:5px;align-items:center;flex:1;min-width:120px}.fm-global-settings input{width:85px;flex:1;min-width:35px}.fm-global-feedback,.fm-global-message{min-height:1.3em;font-size:11px;color:#cbd5e1;margin-top:4px}.fm-global-message:empty,.fm-global-feedback:empty{display:none}
  .fm-global-empty{color:#94a3b8;padding:9px 0}.fm-global-hud[data-minimized="true"] .fm-global-detail{display:none}.fm-global-hud[data-minimized="true"] .fm-global-jobs{max-height:220px}.fm-global-hud[data-minimized="true"] .fm-global-card{padding:7px}
  .fm-global-card[data-active="true"]{border-color:#60a5fa;background:#132039}.fm-global-card:focus-visible{outline:2px solid #60a5fa;outline-offset:1px}
  .fm-global-card-tools{display:flex;gap:4px;align-items:center}.fm-global-card-tools button{padding:2px 7px;min-width:26px}.fm-global-summary{color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:4px}
  .fm-global-editor{display:block;resize:vertical;width:100%;min-height:88px;max-height:180px;padding:7px;background:#111827;color:#f1f5f9;border:1px solid #475569;border-radius:6px;font:inherit;user-select:text;-webkit-user-select:text}
  .fm-global-player{border-top:1px solid #334155;margin-top:9px;padding-top:8px}.fm-global-player-buttons{display:grid;grid-template-columns:1fr 1.3fr 1fr 1fr;gap:6px}.fm-global-player-buttons button{min-height:32px;padding:4px}.fm-global-player-buttons [data-action="toggle"]{background:#2563eb;border-color:#3b82f6;font-size:16px}.fm-global-player .fm-global-settings{display:grid;grid-template-columns:1fr 1fr;gap:8px}.fm-global-player .fm-global-settings label{min-width:0}.fm-global-player .fm-global-settings input{width:50px;accent-color:#60a5fa}
  .fm-global-agent-row{display:flex;gap:6px;margin-bottom:6px}.fm-global-agent-row select{min-width:0;flex:1;background:#1e293b;color:#f8fafc;border:1px solid #475569;border-radius:6px;padding:5px;font:inherit}.fm-global-player-state{font-size:11px;color:#93c5fd;margin-bottom:5px}.fm-global-seek-note{font-size:10px;color:#94a3b8;margin-top:5px}.fm-global-head button{padding:3px 6px;font-size:11px}
  @media(max-width:340px){.fm-global-head{gap:4px}.fm-global-jobs{max-height:42vh}.fm-global-heading{font-size:11px}}
  `;
  function text(value){return typeof value==='string'?value:'';}
  function number(value){return typeof value==='number'&&Number.isFinite(value)?value:null;}
  function can(job,action){const c=job.controls;return Array.isArray(c)?c.includes(action):!!(c&&c[action]);}
  function availableText(job){return text(job.text)||text(job.partialText);}
  function progressLabel(progress){
    if(typeof progress==='number'&&Number.isFinite(progress))return `${Math.round(Math.min(1,Math.max(0,progress))*100)}%`;
    if(!progress||typeof progress!=='object')return '';
    const labels=[];
    if(number(progress.currentTime)!==null&&number(progress.duration)!==null&&progress.duration>0)labels.push(`${Math.floor(progress.currentTime)} / ${Math.ceil(progress.duration)} s`);
    if(number(progress.completedBlocks)!==null&&number(progress.totalBlocks)!==null&&progress.totalBlocks>0)labels.push(`${progress.completedBlocks} / ${progress.totalBlocks} blocos`);
    if(number(progress.forwardedChunks)!==null)labels.push(`${progress.forwardedChunks} blocos enviados`);
    if(number(progress.pendingChunks)!==null&&progress.pendingChunks>0)labels.push(`${progress.pendingChunks} pendentes`);
    return labels.join(' · ');
  }
  function mount(container,options={}){
    if(!container||!container.ownerDocument)throw new TypeError('Container do HUD indisponível');
    const doc=container.ownerDocument,send=options.send;
    if(typeof send!=='function')throw new TypeError('Transporte do HUD indisponível');
    const element=(tag,className,value)=>{const el=doc.createElement(tag);if(className)el.className=className;if(value)el.textContent=value;return el;};
    const setText=(el,value)=>{value=String(value??'');if(el.textContent!==value)el.textContent=value;};
    const style=element('style');style.textContent=CSS;
    const root=element('section','fm-global-hud');root.setAttribute('aria-label','Tarefas globais FalaMermo');
    const head=element('div','fm-global-head'),heading=element('span','fm-global-heading','Tarefas globais'),toolbar=element('div','fm-global-toolbar');
    const minimize=element('button','','Minimizar'),visibility=element('button','','Ocultar HUD');minimize.type=visibility.type='button';
    toolbar.append(minimize,visibility);head.append(heading,toolbar);
    const message=element('div','fm-global-message');message.setAttribute('role','status');message.setAttribute('aria-live','polite');
    const list=element('div','fm-global-jobs'),empty=element('div','fm-global-empty','Nenhuma tarefa disponível.');
    const player=element('div','fm-global-player'),playerState=element('div','fm-global-player-state','Selecione uma narração'),playerButtons=element('div','fm-global-player-buttons'),playerSettings=element('div','fm-global-settings'),seekNote=element('div','fm-global-seek-note',SEEK_LIMITATION);
    player.append(playerState,playerButtons,playerSettings,seekNote);
    root.append(head,message,empty,list,player);container.append(style,root);
    const cards=new Map();let revision=-1,state={visible:false,minimized:false,jobs:[]},destroyed=false;
    async function request(type,payload){
      const response=await send({type,payload:payload||{}});
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
    if(options.embedded){toolbar.hidden=true;}
    let agentListener=null;
    if(options.agentSelector&&globalThis.chrome?.storage?.local){
      const row=element('div','fm-global-agent-row'),select=element('select'),settings=element('button','','⚙');select.setAttribute('aria-label','Agente ativo');settings.type='button';settings.title='Configurações';settings.setAttribute('aria-label','Configurações');row.append(select,settings);root.insertBefore(row,list);
      const load=async()=>{try{const {agents={}}=await chrome.storage.local.get('agents');if(destroyed)return;select.replaceChildren();for(const[id,name]of [...AGENTS,...(agents.customAgents||[]).map(a=>[a.metadata?.id,'★ '+(a.metadata?.name||a.metadata?.id)])]){if(!id)continue;const option=element('option','',name);option.value=id;select.append(option);}select.value=agents.activeAgentId||'narrator';}catch{setText(message,'Não foi possível ler o agente ativo.');}};
      select.onchange=async()=>{try{const {agents={}}=await chrome.storage.local.get('agents');await chrome.storage.local.set({agents:{...agents,activeAgentId:select.value}});}catch{setText(message,'Não foi possível alterar o agente.');}};
      settings.onclick=async()=>{try{await chrome.runtime.openOptionsPage();}catch{setText(message,'Não foi possível abrir as configurações.');}};
      agentListener=(changes,area)=>{if(area==='local'&&changes.agents)void load();};chrome.storage.onChanged?.addListener(agentListener);void load();
    }
    const playerControls={};let playerBusy=false;const pendingSettings=new Map();let settingTask=null;
    function setPlayerSettings(name,value){const job=activeJob();if(!job||job.type!=='TTS'||!Number.isFinite(value)||destroyed)return Promise.resolve();pendingSettings.set(job.jobId,{...pendingSettings.get(job.jobId),[name]:value});if(settingTask)return settingTask;settingTask=(async()=>{try{while(pendingSettings.size&&!destroyed){const[id,values]=pendingSettings.entries().next().value;pendingSettings.delete(id);try{await request('HUD_GLOBAL_COMMAND',{jobId:id,action:'set',...values});}catch(error){setText(message,error.message||'Não foi possível ajustar a reprodução.');}}}finally{settingTask=null;}})();return settingTask;}
    function activeJob(){return state.jobs.find(job=>job.jobId===state.activeTaskId)||state.jobs.find(job=>job.type==='TTS')||state.jobs[0];}
    async function playerCommand(action,values={}){
      const job=activeJob();if(!job||playerBusy||destroyed)return;playerBusy=true;renderPlayer();
      try{const card=cards.get(job.jobId);if(action==='play'&&card?.dirty&&!await saveDraft(card))return;await request('HUD_GLOBAL_COMMAND',{jobId:job.jobId,action,...values});setText(message,'');}
      catch(error){if(!destroyed)setText(message,error.message||'Não foi possível controlar esta tarefa.');}
      finally{playerBusy=false;if(!destroyed)renderPlayer();}
    }
    for(const[action,label,title]of [['previous','←','Retroceder uma palavra'],['toggle','▶','Reproduzir'],['next','→','Avançar uma palavra'],['create','+','Criar nova tarefa']]){
      const button=element('button','',label);button.type='button';button.dataset.action=action;button.title=title;button.setAttribute('aria-label',title);playerButtons.append(button);playerControls[action]=button;
    }
    playerControls.toggle.onclick=()=>{const job=activeJob();return playerCommand(job?.status==='paused'?'resume':['ready','completed','error','cancelled','stopped'].includes(job?.status)?'play':'pause');};
    playerControls.previous.onclick=()=>seekWords(-1);playerControls.next.onclick=()=>seekWords(1);
    function seekWords(delta){if(!Number.isInteger(delta)||!delta)return Promise.resolve();setText(message,SEEK_LIMITATION);return Promise.resolve(false);}
    playerControls.create.onclick=async()=>{if(playerControls.create.disabled)return;playerControls.create.disabled=true;try{await request('HUD_GLOBAL_CREATE');setText(message,'');const card=cards.get(state.activeTaskId);card?.editor.focus?.();}catch(error){setText(message,error.message||'Não foi possível criar a tarefa.');}finally{if(!destroyed)playerControls.create.disabled=false;}};
    for(const[name,title,min,max,step]of [['volume','Volume',0,1,.05],['playbackRate','Velocidade',.5,2,.1]]){
      const label=element('label','',title),input=element('input');input.type='range';input.min=String(min);input.max=String(max);input.step=String(step);input.dataset.control=name;input.setAttribute('aria-label',title+' da tarefa ativa');label.append(input);playerSettings.append(label);playerControls[name]=input;input.oninput=()=>{input.title=input.value;return setPlayerSettings(name,Number(input.value));};input.onchange=input.oninput;
    }
    function renderPlayer(){const job=activeJob(),tts=job?.type==='TTS',playing=job?.status==='playing',pausable=tts&&playing&&can(job,'pause'),resumable=tts&&can(job,'resume'),playable=tts&&(can(job,'play')||job.manual&&!!cards.get(job.jobId)?.editor.value.trim()&&can(job,'edit'));
      setText(playerState,job?(job.manual?'Tarefa manual · ':tts?'Narração · ':'Ditado · ')+(STATUS[job.status]||'Processando'):'Nenhuma tarefa ativa');
      setText(playerControls.toggle,playing?'⏸':'▶');const label=playing?'Pausar':resumable?'Retomar':'Reproduzir';playerControls.toggle.title=label;playerControls.toggle.setAttribute('aria-label',label);playerControls.toggle.disabled=playerBusy||!tts||!(pausable||resumable||playable);
      playerControls.previous.disabled=playerControls.next.disabled=true;playerControls.previous.title='Retroceder uma palavra — '+SEEK_LIMITATION;playerControls.next.title='Avançar uma palavra — '+SEEK_LIMITATION;seekNote.hidden=!tts;
      for(const name of ['volume','playbackRate']){const input=playerControls[name];input.disabled=!tts;if(doc.activeElement!==input)input.value=String(number(job?.[name]??job?.progress?.[name])??1);input.title=input.value;}
    }
    async function saveDraft(card){if(!card.dirty)return Promise.resolve(true);if(card.saving)return card.saving;card.saving=(async()=>{try{while(card.dirty&&!destroyed){const value=card.editor.value,expectedText=card.job.text;await request('HUD_GLOBAL_COMMAND',{jobId:card.job.jobId,action:'edit',text:value,expectedText});if(card.editor.value===value)card.dirty=false;}return !card.dirty;}catch(error){if(!destroyed)setText(card.feedback,error.message||'Edição não salva. Copie seu texto antes de fechar.');return false;}finally{card.saving=null;if(!destroyed){renderCard(card,card.job);renderPlayer();}}})();return card.saving;}
    function createCard(id){
      const node=element('article','fm-global-card');node.dataset.jobId=id;
      const header=element('div','fm-global-card-header'),kind=element('span','fm-global-kind'),status=element('span','fm-global-status'),tools=element('div','fm-global-card-tools');header.append(kind,status,tools);node.setAttribute('tabindex','0');node.setAttribute('aria-label','Selecionar tarefa');
      const origin=element('div','fm-global-origin'),progress=element('div','fm-global-progress');
      const detail=element('div','fm-global-detail'),label=element('div','fm-global-label'),body=element('div','fm-global-text'),partialLabel=element('div','fm-global-label','Transcrição provisória'),partial=element('div','fm-global-text fm-global-partial');
      const editor=element('textarea','fm-global-editor');editor.setAttribute('aria-label','Texto da tarefa manual');editor.placeholder='Digite ou cole o texto para narrar';editor.hidden=true;
      body.setAttribute('tabindex','0');partial.setAttribute('tabindex','0');detail.append(label,body,partialLabel,partial,editor);
      const note=element('div','fm-global-note'),actions=element('div','fm-global-actions'),settings=element('div','fm-global-settings'),feedback=element('div','fm-global-feedback');feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');
      node.append(header,origin,progress,detail,note,actions,settings,feedback);list.append(node);
      const summary=element('div','fm-global-summary');node.append(summary);
      const card={node,kind,status,origin,progress,label,body,partialLabel,partial,note,feedback,buttons:{},settings,detail,summary,editor,dirty:false,saving:null,job:null,busy:new Set()};
      function button(action,label,handler){const b=element('button','',label);b.type='button';b.dataset.action=action;b.onclick=handler;actions.append(b);card.buttons[action]=b;return b;}
      async function command(action,values={}){
        if(destroyed||card.busy.has(action))return;
        card.busy.add(action);renderCard(card,card.job);
        try{await request('HUD_GLOBAL_COMMAND',{jobId:id,action,...values});if(!destroyed)setText(feedback,'');}
        catch(error){if(!destroyed)setText(feedback,'Não foi possível aplicar o comando a esta tarefa. '+error.message+' O texto disponível foi preservado.');}
        finally{card.busy.delete(action);if(!destroyed&&cards.has(id))renderCard(card,card.job);}
      }
      async function copy(partialOnly=false){
        const content=partialOnly?text(card.job.partialText):card.job.manual&&card.dirty?card.editor.value:availableText(card.job),action=partialOnly?'copyPartial':'copy';
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
      button('stop','Parar',()=>command('stop'));button('copy','Copiar texto',()=>copy());button('copyPartial','Copiar provisório',()=>copy(true));
      const collapse=button('collapse','⌃',()=>command('collapse',{collapsed:!card.job.collapsed})),remove=button('remove','×',()=>command('remove'));tools.append(collapse,remove);remove.title='Fechar/remover esta tarefa';remove.setAttribute('aria-label',remove.title);
      node.onclick=event=>{if(event?.target?.closest?.('button,input,textarea,select,a'))return;return command('select');};node.onkeydown=event=>{if(event.target===node&&(event.key==='Enter'||event.key===' ')){event.preventDefault();void command('select');}};
      editor.oninput=()=>{card.dirty=true;renderPlayer();return saveDraft(card);};editor.onchange=()=>saveDraft(card);
      return card;
    }
    function renderCard(card,job){
      if(!job)return;card.job=job;
      setText(card.kind,job.type==='STT'?'🎙 Ditado':job.manual?'✎ Manual':'🔊 Narração');setText(card.status,STATUS[job.status]||'Em andamento');card.node.dataset.active=String(activeJob()?.jobId===job.jobId);card.node.setAttribute('aria-current',String(activeJob()?.jobId===job.jobId));
      const source=job.origin||{};setText(card.origin,number(source.tabId)!==null&&source.tabId>0?`Origem: aba ${source.tabId}${number(source.frameId)!==null&&source.frameId!==0?' · frame '+source.frameId:''}`:'Origem: painel da extensão');
      setText(card.progress,progressLabel(job.progress));card.progress.hidden=!card.progress.textContent;
      setText(card.label,job.type==='TTS'?'Texto da narração':'Transcrição confirmada');setText(card.body,text(job.text));card.body.hidden=card.label.hidden=!job.text;
      setText(card.partial,text(job.partialText));card.partial.hidden=card.partialLabel.hidden=!job.partialText;
      card.editor.hidden=!job.manual;card.editor.disabled=!can(job,'edit');if(!card.dirty&&doc.activeElement!==card.editor)card.editor.value=text(job.text);if(job.manual)card.body.hidden=true;
      card.detail.hidden=job.collapsed===true;card.origin.hidden=job.collapsed===true;card.summary.hidden=!job.collapsed;setText(card.summary,availableText(job).replace(/\s+/g,' ').slice(0,90)||'Texto vazio');
      const collapse=card.buttons.collapse;setText(collapse,job.collapsed?'⌄':'⌃');collapse.title=job.collapsed?'Expandir tarefa':'Recolher tarefa';collapse.setAttribute('aria-label',collapse.title);collapse.setAttribute('aria-expanded',String(!job.collapsed));
      const notes=[];
      if(job.status==='error'&&job.error)notes.push(text(job.error));
      if(job.incomplete)notes.push('Resultado incompleto.');
      if(job.historyStatus==='failed')notes.push('Não foi possível salvar o histórico; copie o resultado disponível nesta sessão.');
      if(job.capacityWarning)notes.push('O estado ativo ultrapassou o orçamento de sessão; conclua tarefas e copie resultados importantes.');
      if(job.originAvailable===false)notes.push('Destino original indisponível; nenhum texto será inserido nesta aba.');
      if(job.insertion&&job.insertion.inserted===false)notes.push('Inserção não confirmada. Copie o texto para recuperá-lo.');
      setText(card.note,notes.join(' '));card.note.hidden=!notes.length;
      for(const action of ['stop','remove']){const b=card.buttons[action];b.hidden=!can(job,action);b.disabled=card.busy.has(action);}collapse.disabled=card.busy.has('collapse');
      card.buttons.copy.hidden=!(job.manual&&card.dirty?card.editor.value:availableText(job));card.buttons.copy.disabled=card.busy.has('copy');
      card.buttons.copyPartial.hidden=!(job.text&&job.partialText);card.buttons.copyPartial.disabled=card.busy.has('copyPartial');
      card.settings.hidden=true;
    }
    function update(next){
      if(destroyed||!next||typeof next!=='object')return false;
      const nextRevision=number(next.revision);if(nextRevision!==null&&nextRevision<=revision)return false;
      if(nextRevision!==null)revision=nextRevision;
      state={...next,visible:!!next.visible,minimized:!!next.minimized,jobs:Array.isArray(next.jobs)?next.jobs:[]};
      root.hidden=options.panel?false:!state.visible;root.dataset.minimized=String(state.minimized);
      setText(minimize,state.minimized?'Expandir':'Minimizar');minimize.setAttribute('aria-expanded',String(!state.minimized));setText(visibility,state.visible?'Ocultar HUD':'Mostrar HUD');
      const present=new Set();
      for(const job of state.jobs){if(!job||typeof job.jobId!=='string'||present.has(job.jobId))continue;present.add(job.jobId);let card=cards.get(job.jobId);if(!card){card=createCard(job.jobId);cards.set(job.jobId,card);}renderCard(card,job);}
      for(const[id,card]of cards)if(!present.has(id)){card.node.remove();cards.delete(id);}
      empty.hidden=present.size>0;setText(heading,`Tarefas globais (${present.size})`);
      renderPlayer();
      if(typeof options.onState==='function')options.onState(state);
      return true;
    }
    async function refresh(){
      try{await request('HUD_GLOBAL_GET');if(!destroyed)setText(message,'');}
      catch{if(!destroyed)setText(message,'Não foi possível recuperar as tarefas. Reabra o painel ou atualize a página.');}
    }
    root.hidden=!options.panel;root.dataset.minimized='false';setText(heading,'Tarefas globais (0)');
    const ready=refresh();
    renderPlayer();return{update,refresh,ready,seekWords,destroy(){destroyed=true;if(agentListener)globalThis.chrome?.storage?.onChanged?.removeListener(agentListener);cards.clear();root.remove();style.remove();}};
  }
  return{mount,availableText,progressLabel,SEEK_LIMITATION,AGENTS};
});
