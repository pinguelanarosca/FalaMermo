const BUILT_INS=[
  ['narrator','Narrador Fluido','Puck'],['translator','Tradutor Simultâneo','Charon'],['summarizer','Resumidor Executivo','Fenrir'],['editor','Revisor Gramatical & Ditado','Kore'],['explainer','Professor Didático','Aoede'],['developer','Assistente de Código & Dev','Fenrir'],['podcast','Estilo Podcast','Puck'],['accessibility','Leitor de Acessibilidade','Aoede']
];
const $=s=>document.querySelector(s),agent=$('#agent'),notice=$('#notice'),status=$('#status');let customAgents=[];
// Native popups negotiate their initial size from document contents. Never derive
// that intrinsic height from vh; adapt only the inner layout after a real viewport exists.
function fitPopup(){if(window.innerHeight>=300)document.querySelector('main').style.height=Math.min(590,window.innerHeight)+'px';}
window.addEventListener('resize',fitPopup);fitPopup();
function renderAgents(active){
 agent.innerHTML='';
 const built=document.createElement('optgroup');built.label='Agentes de fábrica';
 for(const [id,name,voice] of BUILT_INS)built.append(new Option(name+' — '+voice,id));
 agent.append(built);
 if(customAgents.length){
  const custom=document.createElement('optgroup');custom.label='Agentes personalizados';
  for(const item of customAgents){
   const voice=item.live?.voiceName||item.voice?.preferredVoice||'Kore';
   custom.append(new Option('★ '+(item.metadata?.name||item.metadata?.id)+' — '+voice,item.metadata?.id));
  }
  agent.append(custom);
 }
 agent.value=active||'narrator';
}
function bindTransparency(id,key){
 const input=$('#'+id),output=$('#'+id+'-value');
 const render=raw=>{const value=typeof raw==='number'&&Number.isFinite(raw)?Math.max(0,Math.min(100,raw)):50;if(document.activeElement!==input)input.value=String(value);output.textContent=input.value+'%';input.setAttribute('aria-valuetext',output.textContent);};
 input.oninput=async()=>{render(Number(input.value));try{await chrome.storage.local.set({[key]:Number(input.value)});}catch{status.textContent='Não foi possível salvar a transparência do HUD.';}};
 input.onblur=()=>chrome.storage.local.get(key).then(saved=>render(saved[key])).catch(()=>{});
 return render;
}
const renderTransparency=bindTransparency('hud-transparency','hudTransparency'),renderContentTransparency=bindTransparency('hud-content-transparency','hudContentTransparency');
async function load(){try{const s=await chrome.storage.local.get(['api','agents','hudTransparency','hudContentTransparency']);renderTransparency(s.hudTransparency);renderContentTransparency(s.hudContentTransparency);customAgents=Array.isArray(s.agents?.customAgents)?s.agents.customAgents:[];renderAgents(s.agents?.activeAgentId||'narrator');const configured=!!s.api?.apiKey||s.api?.apiKeys?.some(key=>typeof key==='string'&&key.trim());notice.innerHTML=configured?'':'<div class="warn">⚠️ Chave Gemini ausente. Abra ⚙️ para configurar.</div>'}catch{status.textContent='Não foi possível ler as configurações. Reabra o painel.'}}
agent.onchange=async()=>{try{const s=await chrome.storage.local.get('agents');const ag={...(s.agents||{}),activeAgentId:agent.value,customAgents:Array.isArray(s.agents?.customAgents)?s.agents.customAgents:[],favoriteAgentIds:Array.isArray(s.agents?.favoriteAgentIds)?s.agents.favoriteAgentIds:['narrator','translator','summarizer']};await chrome.storage.local.set({agents:ag});status.textContent='Agente alterado.'}catch{status.textContent='Não foi possível alterar o agente.'}};
const globalTasks=GlobalHud.mount($('#globalTasks'),{panel:true,surface:'popup',send:message=>chrome.runtime.sendMessage(message)});
const globalStateListener=message=>{if(message?.type==='HUD_GLOBAL_STATE')globalTasks.update(message.state||message.payload?.state);};
chrome.runtime.onMessage.addListener(globalStateListener);
$('#settings').onclick=()=>chrome.runtime.openOptionsPage().catch(()=>{status.textContent='Não foi possível abrir as configurações.'});
const settingsListener=(changes,area)=>{if(area!=='local')return;if(changes.hudTransparency)renderTransparency(changes.hudTransparency.newValue);if(changes.hudContentTransparency)renderContentTransparency(changes.hudContentTransparency.newValue);if(changes.agents||changes.api)load();};chrome.storage.onChanged.addListener(settingsListener);
window.addEventListener('pagehide',()=>{globalTasks.destroy();chrome.runtime.onMessage.removeListener(globalStateListener);chrome.storage.onChanged.removeListener(settingsListener);},{once:true});load();
