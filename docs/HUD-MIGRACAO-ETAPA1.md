# FalaMermo — migração visual 1/4: HUD

Relatório e matriz locais: a regra existente `docs/*` mantém este arquivo fora do Git. A `.gitignore` foi preservada.

Execução: 18/11/2026. Workspace: `/home/Alee/Dev/FalaMermo-glass`. Branch: `design/glass-visualstttts`. Base recuperável: commit `4ad0b644259379518fc47fe9139e213e1a369f16`, mantido no HEAD; alterações somente na árvore de trabalho, sem commit, push ou PR. A versão do manifest permanece 1.0.8.

## EXECUTADO

- Barra vertical independente, iluminação interna por estado, pânico e comandos de minimizar/ocultar. O painel usa a composição de vidro, cartões e waveform do `visualstttts`, adaptada ao Shadow DOM existente, sem React ou dependências novas.
- Painel suspenso: a barra responde imediatamente ao pointer; o painel acompanha com atraso, oscilação curta e acomodação por mola. Mouse, pen e touch usam Pointer Events; teclado permite mover com setas e ajustar em passos de 1 px com Shift. Há contenção na viewport útil, inclusive quando a página tem scrollbar. O movimento reduzido desliga animações e oscilação.
- Waveform SVG com curvas e fluxo do protótipo, comandada pelos estados reais de gravação, reprodução, pausa, conexão, inatividade e erro. Não há medidor de amplitude, probabilidade VAD, valores ou tarefas de demonstração. Não foi acrescentada captura nem análise de áudio.
- Cartões independentes com origem, estado, prévia, controles, volume individual, janela dedicada, ocultação e avisos acessíveis. Texto confirmado e provisório compartilham uma área de rolagem, mantendo os respectivos nós e estados separados. Tarefas manuais continuam editáveis.
- Chips mantêm captura e reprodução separadas, inclusive quando uma transcrição tem narração associada. Zero é exibido quando recebido. Identificadores, janela PCM, ganho, velocidade, Worklet, ACK, bytes e demais dados ficam em **Detalhes da tarefa**, sem remover campos do snapshot.
- Avisos gerais, de captura e de pânico ficam fora do painel minimizável; erros dos cartões recolhidos têm um botão de aviso que expande a tarefa pelo comando real. Ocultar o HUD aplica `inert`, visibilidade e bloqueio de pointer aos seus elementos; a página permanece interativa.
- Ajuste funcional pontual em `global-jobs.js`: iniciar novamente a reprodução de uma tarefa existente ou narrar a cópia STT não restaura o HUD nem altera o recolhimento dos cartões. Resume também mantém essa apresentação. Nova tarefa de origem continua usando a abertura automática existente. Replay não rearma fechamento automático após consulta manual global.

## Limites do escopo e diferenças da base

A auditoria v1.0.8 foi lida integralmente. A comparação remota entre a referência estável `609906417d720551929d0653aa33b7acb9647f09` e o HEAD inicial identificou quatro commits anteriores, apenas em `global-hud.js`, `popup.html` e `options.html`. A branch já continha uma skin CSS parcial e mudanças visuais nas outras superfícies; isso foi preservado.

A opacidade do vidro segue a base `glass-shell` do protótipo; o contraste também foi inspecionado sobre página branca. Os tempos dos chips usam uma casa decimal em pt-BR, mantendo o valor bruto no tooltip.

O CSS base compartilhado e a skin anterior de Popup/Opções são idênticos aos do HEAD inicial. O HUD deixa de receber essa skin genérica e usa regras em `content.css`, restritas à sua superfície e ao Shadow DOM. A cópia CSS distribuída em `content.js` foi sincronizada e comparada pelo teste de contrato.

`popup.html/js`, `options.html/js`, `task.html/js`, `background.js`, `offscreen.js` e `manifest.json` foram comparados byte a byte com o HEAD inicial e não foram alterados. Registry, transportes, permissões, STT, TTS, Lens, tradução e arquivos persistentes permanecem na arquitetura existente. O histórico local é raso e não contém a tag v1.0.8; a comparação estável foi obtida pelo GitHub, sem modificar o histórico local.

## VERIFICADO — execução automática

| Execução | Resultado observado | Limite |
|---|---|---|
| `node --test tests/*.test.cjs` | 725 testes: 714 passaram, 11 falharam | Os mesmos 11 casos falham no HEAD inicial; comparação dos nomes registrada abaixo |
| Regressão focada após o último ajuste: global-hud, global-jobs, hud-automation, gui-layout-contract, pwa-hud e tts-hud | 134 testes passaram, zero falhas | Inclui aviso local, flag de microfone somente em STT, tempos compactos e CSS sincronizado |
| Mesma suíte em cópia isolada de `git archive HEAD` | 720 testes: 709 passaram, 11 falharam | Nenhum arquivo da árvore de trabalho foi restaurado ou descartado |
| `node tests/hud-glass-chrome.cjs` | Passou: 13 grupos de verificações no Chrome 157.0.8103.78 | MV3 e comandos reais, tarefas manuais; sem provedor nem microfone |
| `FALAMERMO_HUD_AUDIO_ONLY=1 node tests/controls-chrome.cjs` | Passou: waveform, seek ±5 com ACK, ganho individual × global, velocidade, mini transportes, exclusividade, Resume, janela dedicada, ocultação e pânico | PCM e AudioWorklet reais; transporte Gemini substituído pelo fixture existente |
| `node tests/translation-hud-chrome.cjs` | Passou: tradução, reprodução, simultaneidade, quatro cartões, histórico, automação, gravação STT, finalização e inserção | Chrome MV3, microfone virtual e VAD reais; HTTP/WebSocket Gemini simulados; atalho/menu por callback no headless |
| `FALAMERMO_PANIC_ONLY=1 node tests/controls-chrome.cjs` | Passou: pânico pelo HUD minimizado e Popup, STT gravando/processando, agente, três estados TTS, PCM, histórico e novas operações | Perfil descartável; provedor simulado e microfone virtual |
| `node tests/pwa-hud-chrome.cjs` | Passou: PWA instalada, aberta, reaberta e recarregada; isolamento por origem e intervenção manual | Perfil descartável; não é homologação de todas as PWAs do usuário |
| `node --test tests/publication-version.test.cjs` | 2 passaram | Verificação repetida após incluir os novos roteiros na lista de publicação |
| `node tools/verify-publication.cjs` | Passou: versão 1.0.8, 129 arquivos, 91 JavaScript, 108 referências, 0 achados de segredo no conjunto inspecionado | Não é uma auditoria de segurança |
| Verificações de sintaxe dos arquivos de execução e `git diff --check` | Passaram | Não há etapa de compilação adicional neste repositório de artefatos distribuídos; não foi produzido ZIP de release |

Os roteiros Chrome foram executados com `FALAMERMO_CHROME=/opt/google/chrome/chrome`, em perfis temporários, sem usar configurações ou credenciais pessoais.

### Falhas preexistentes reproduzidas

Os 11 nomes de casos que falharam são iguais entre a suíte final e a cópia do HEAD inicial. Afetam `gemini-payload-contract.test.cjs`, `live-config.test.cjs`, `live-homologation.test.cjs`, `live-session-protocol.test.cjs`, `stt-live-regression.test.cjs`, `stt-options-routing.test.cjs` e `tts-options.test.cjs`. Os casos esperam modelos que o próprio `live-config.js` exclui depois de `shutdownDate: 2026-11-17`; a execução ocorreu após essa data. Esse catálogo e esses testes não foram modificados na etapa visual.

O roteiro completo `tests/controls-chrome.cjs` também foi executado e falhou ao procurar `editor-apply` da revisão 4: `registro da aplicação no editor (revisão 4, eventos undefined)`. O mesmo erro foi reproduzido no HEAD inicial, antes da parte de controles TTS. O novo modo `FALAMERMO_HUD_AUDIO_ONLY` exercita os comandos de áudio do HUD independentemente desse bloqueio; o roteiro completo permanece disponível e sua falha não foi mascarada.

## Matriz de aceitação — seção E aplicada ao HUD

Legenda de evidência: **N** = testes Node, incluindo renderizador, registry, automação, PCM, STT/TTS/Lens e contratos; **UI** = Chrome MV3 do roteiro `hud-glass-chrome`; **ÁUDIO** = modo focado com PCM/AudioWorklet nativos; **FLUXO** = roteiro Chrome de tradução/ditado; **PÂNICO** = roteiro isolado de parada global; **PWA** = roteiro Chrome de PWA. Fixtures usados nos testes não são dados da interface de produção. “VERIFICADO” indica a evidência explicitada, sem implicar uso de Gemini, microfone físico ou inspeção humana.

### A1–A2 — estrutura, barra e contêiner

| Item / ID | Superfície | Continua? | Implementação atual → nova localização / condição | Comando / estado real | Validação | Pendência |
|---|---|---|---|---|---|---|
| A1 contêiner e isolamento | HUD | VERIFICADO | `HudController.init`, Shadow DOM → assembly com barra e painel | Snapshot recebido por `GlobalHud.mount` | N, UI | Homologação humana em páginas reais |
| A1 CSS fonte e distribuído | HUD | VERIFICADO | `content.css` e módulo `hud.css?raw` em `content.js` | Mesmo conteúdo CSS | N, igualdade exata | — |
| A1 renderizador compartilhado | Todas | VERIFICADO | `global-hud.js` → nova composição somente com `embedded:true` | `data-surface='hud'` | N, UI; CSS anterior comparado | Redesign das outras superfícies em etapas posteriores |
| A1 registry e roteamento | Global/HUD | VERIFICADO | `global-jobs.js` e `background.js`, sem substituição | Snapshots, revisão e comandos existentes | N, ÁUDIO, FLUXO, PÂNICO | Gemini real |
| A2 posição inicial inferior | HUD | VERIFICADO | `.ext-hud-card`, direita/inferior com 24 px iniciais | Posição local do controller | UI, captura desktop | Avaliação estética humana |
| A2 arraste e limites | HUD | VERIFICADO | `setupListeners`, `moveHud`, `constrainPosition` → barra vertical | Pointer capture, viewport útil | UI: arraste real, bordas e resize | Touch/pen físicos NÃO VERIFICADOS |
| A2 painel suspenso | HUD | VERIFICADO | `animatePanel`, `resetMotion` → painel separado por conector sutil | Posição local transitória; não entra no registry | UI: atraso, acomodação e movimento reduzido | Sensação do movimento em monitor real |
| A2 seleção, foco e cliques | HUD/página | VERIFICADO | Arraste só na barra, controles excluídos; texto selecionável | Pointer/teclado; nenhum overlay de tela inteira | N, UI; clique real na página com HUD oculto | Seleção durante ditado físico prolongado |
| A2 identidade | HUD | VERIFICADO | Marca, título vertical e vidro azul/violeta/grafite | Sem dados operacionais de demonstração | UI, screenshots inspecionados | Aprovação estética humana |
| A2 `ext-badge` | HUD | VERIFICADO | Na barra vertical | Gravação, narração, conexão, pausa, erro e inatividade do snapshot; inclui narração STT | N, ÁUDIO, FLUXO | — |
| A2 minimizar/restaurar | HUD/aba | VERIFICADO | `ext-btn-min` na barra; painel oculto e inerte | `HUD_GLOBAL_UI_SET {minimized}` | N, UI, ÁUDIO | — |
| A2 ocultar HUD | HUD/aba | VERIFICADO | `ext-btn-close` na barra | `HUD_GLOBAL_UI_SET {visible:false}`, aplicado após confirmação | N, UI, ÁUDIO | — |
| A2 mini transportes | HUD minimizado | VERIFICADO | `ext-global-compact` na barra | Mesmos três botões globais, movidos sem duplicar handlers | N, UI, ÁUDIO | — |
| A2 emergência | HUD, inclusive minimizado | VERIFICADO | `ext-global-emergency`, botão de pânico prioritário | `HUD_GLOBAL_PANIC` | N, UI, ÁUDIO, PÂNICO; hit-test em 320×260 | — |
| A2 aviso de encerramento | HUD, inclusive minimizado | VERIFICADO | `ext-panic-notice` no contêiner externo de avisos | ACK, `remoteStopped`, `cancelling` | N, PÂNICO | — |
| A2 aviso de captura/VAD | HUD, inclusive minimizado | VERIFICADO no código e pipeline | `setCaptureNotice`, `ext-capture-notice` fora do painel | Avisos reais de reserva/captura/VAD | N, FLUXO; estrutura e contenção em UI | Legibilidade humana dos avisos durante captura física |
| A2 avisos do renderer | HUD, inclusive minimizado | VERIFICADO | Mensagens locais/gerais no `noticeContainer` | Falha de comando, recuperação, contexto invalidado | N; PÂNICO para aviso externo | Atualização da extensão durante uso real |
| A2 montagem `ext-global-jobs` | HUD | VERIFICADO | Continua montado no painel | `embedded`, `compactControls`, `panicContainer`, `agentSelector`; novo destino visual de avisos | N, UI, ÁUDIO | — |
| A2 seleção de agente | HUD/Popup | VERIFICADO | Seletor real acima dos cartões | `chrome.storage.local.agents`, `activeAgentId` | UI: troca de agente e sincronização com Popup; N | Personas personalizadas em conta real |
| A2 configurações | HUD → Opções | VERIFICADO | Engrenagem junto ao seletor | `HUD_OPEN_OPTIONS` | UI: abertura real e estado das tarefas nas Opções | Redesign das Opções fora desta etapa |

### A3–A4 — cartões, texto e métricas

| Item / ID | Superfície | Continua? | Implementação atual → nova localização / condição | Comando / estado real | Validação | Pendência |
|---|---|---|---|---|---|---|
| A3 cartões independentes | HUD | VERIFICADO | `createCard/renderCard`, cache por `jobId` → cards de vidro | Identidade, `collapsed`, `hidden`, revisão | N, UI, ÁUDIO, FLUXO | — |
| A3 cabeçalho | HUD | VERIFICADO | Tipo, prévia, status e ferramentas no header compacto | `type/source/manual/lensMode/status` | N, UI, FLUXO | Conferência humana de todos os tipos |
| A3 Ditado/Narração/Manual | HUD | VERIFICADO | Tipos reais mantidos no header | STT/TTS e `manual` | N, UI, ÁUDIO, FLUXO | — |
| A3 Tradução/Leitura/Análise | HUD | VERIFICADO automaticamente | Identificação mantida no header | `source:'translation'/'lens'`, `lensMode` | N para Lens; FLUXO para tradução | Lens completo no Chrome com origem real NÃO VERIFICADO nesta execução |
| A3 estados técnicos | HUD | VERIFICADO automaticamente | Status no header, texto completo em tooltip | `STATUS`, `NO_SPEECH`, inserção negada, narração STT | N, ÁUDIO, FLUXO | Estados raros em sessão humana |
| A3 origem | HUD/tarefa | VERIFICADO | Chip de origem; identificadores em Detalhes e janela dedicada | `origin.tabId/frameId/documentId/page`, `agentId`, IDs | N, UI, FLUXO, PWA | — |
| A3 texto confirmado | HUD | VERIFICADO | Nó `.fm-global-text` na área unificada com scroll | `job.text` | N, FLUXO | Ditado longo com Gemini real |
| A3 texto provisório | HUD | VERIFICADO | Nó `.fm-global-partial` na mesma área, visual e rótulo distintos | `job.partialText` | N; FLUXO confirma a composição com a captura | Conteúdo parcial em microfone físico/Gemini real |
| A3 texto longo | HUD | VERIFICADO | Área de transcrição com limite de 132 px; editor tem seu limite próprio | Conteúdo recebido, sem truncar dados | N, UI: editor longo, rolagem e viewport baixa | Inspeção humana de transcrição longa |
| A3 edição manual | HUD | VERIFICADO | Editor dentro do card manual | `edit`, `expectedText` | N, UI com comando/ACK real | — |
| A3 cópia STT de trabalho | Janela dedicada | VERIFICADO automaticamente | Editor existente, acessível via ↗ | `workingText`, `expectedText`; original separado | N | Edição concorrente em duas janelas Chrome NÃO VERIFICADA |
| A3 alertas e feedback | HUD | VERIFICADO | Nota/feedback no card expandido; botão de aviso no header recolhido | Warning, erro, conflito e rejeição recebidos | N; erro de transporte em roteiros existentes | Conferência humana de mensagens extensas |
| A3 transportes individuais | HUD | VERIFICADO | Linha própria de cada card expandido | Ações por `jobId/requestId`, habilitadas por `controls` | N, ÁUDIO | — |
| A3 volume individual | HUD | VERIFICADO | Slider do card expandido | `set {volume}` e progresso do próprio áudio | N, ÁUDIO: ganho nativo e isolamento de B | — |
| A3 recolhimento independente | HUD | VERIFICADO | Header permanece, demais áreas recolhem | `collapse {collapsed}` | N, UI, FLUXO | — |
| A3 seleção ativa | HUD | VERIFICADO automaticamente | Borda ativa e foco por clique/teclado | `select`, `activeTaskId/hudTaskId` | N; ÁUDIO para seleção de playback global | — |
| A4 `forwardedChunks` | HUD | VERIFICADO | Chip “Enviados”, sem chamar de confirmado | Contagem recebida de encaminhamento | N: valores e atualização do mesmo nó | — |
| A4 `pendingChunks` | HUD | VERIFICADO | Chip “Pendentes”, incluindo zero recebido | Fila real do snapshot | N: zero explícito | — |
| A4 `completedBlocks` | HUD | VERIFICADO | Chip “Finalizados” quando disponível | Valor próprio, separado de encaminhados | N | — |
| A4 `totalBlocks` | HUD | VERIFICADO | Chip “Total de blocos” somente quando recebido | Nenhum total inferido | N | — |
| A4 `capturedChunks` | HUD | VERIFICADO | Detalhes da tarefa | Chunks de captura recebidos | N | — |
| A4 `capturedBytes` | HUD | VERIFICADO | Detalhes, bytes sem conversão especulativa | Bytes de captura recebidos | N | — |
| A4 `forwardedBytes` | HUD | VERIFICADO | Detalhes da tarefa | Bytes encaminhados recebidos | N | — |
| A4 `currentTime` | HUD | VERIFICADO | Chip “Posição (s)” | Cursor PCM recebido | N, ÁUDIO | — |
| A4 `duration` | HUD | VERIFICADO | Chip “Áudio recebido (s)” | Duração disponível, não promessa de áudio futuro | N, ÁUDIO | — |
| A4 `availableStart` | HUD | VERIFICADO | Detalhes “PCM inicial (s)”; limita seta | Início da janela PCM | N, ÁUDIO | — |
| A4 `availableEnd` | HUD | VERIFICADO | Detalhes “PCM final (s)”; limita seta | Fim do PCM já recebido | N, ÁUDIO | — |
| A4 `volume` | HUD | VERIFICADO | Slider e Detalhes, separados do volume global | Progresso individual e `playback.volume` global | N, ÁUDIO | — |
| A4 `playbackRate` | HUD | VERIFICADO | Slider global da narração relevante e Detalhes | `set {playbackRate}` | N, ÁUDIO: 1,4 efetivo no player | — |
| A4 `contextState` | HUD | VERIFICADO | Detalhes “AudioContext” | Estado recebido, sem supor execução | N, ÁUDIO: suspended/running | — |
| A4 `workletPaused` | HUD | VERIFICADO | Detalhes “Worklet pausado” | Booleano recebido | N, ÁUDIO | — |
| A4 `outputMuted` | HUD | VERIFICADO | Detalhes “Saída muda” | Booleano recebido | N, ÁUDIO | — |
| A4 `outputActive` | HUD | VERIFICADO | Detalhes “Saída ativa”; usado na conexão com áudio ativo | Booleano recebido | N, ÁUDIO | — |
| A4 `controlSeq` | HUD | VERIFICADO | Detalhes “ACK” | Sequência confirmada pelo player | N, ÁUDIO: seek com novo ACK | — |
| A4 `positionFrame` | HUD | VERIFICADO | Detalhes “Posição PCM (frames)” | Posição recebida, sem estimar por palavras | N, ÁUDIO | — |
| A4 captura + narração STT | HUD | VERIFICADO automaticamente | Ambos os grupos; métricas de áudio têm prefixo “Narração” | `job.progress` e `job.narration.progress` | N: mantém ambos no mesmo card | Narração de cópia STT com Gemini real |

### A5–A6 — ações individuais e globais

| Item / ID | Superfície | Continua? | Implementação atual → nova localização / condição | Comando / estado real | Validação | Pendência |
|---|---|---|---|---|---|---|
| A5 anterior | HUD/card | VERIFICADO | Transporte individual expandido | `seek {deltaSeconds:-5}` com `jobId/requestId` | N, ÁUDIO; mantém pausa e limites PCM | — |
| A5 play | HUD/card | VERIFICADO | Botão do card expandido | `play`, texto esperado, ACK | N, ÁUDIO | Gemini real |
| A5 pause | HUD/card | VERIFICADO | Mesmo botão, conforme estado | `pause` | N, ÁUDIO: contexto suspenso | — |
| A5 resume | HUD/card | VERIFICADO | Mesmo botão em pausa | `resume`, posição e cache existentes | N, ÁUDIO: sem novo turno | — |
| A5 próximo | HUD/card | VERIFICADO | Transporte individual expandido | `seek {deltaSeconds:5}` | N, ÁUDIO: ACK e janela disponível | — |
| A5 parar individual | HUD/card | VERIFICADO automaticamente | Botão ■ separado do pânico | `stop {jobId}` | N, ÁUDIO: Stop individual pela UI, outro áudio mantido e nova síntese após Stop | — |
| A5 volume | HUD/card | VERIFICADO | Slider individual | `set {volume}` | N, ÁUDIO | — |
| A5 expandir/recolher | HUD/card | VERIFICADO | ⌃/⌄ no header; alerta também permite expandir | `collapse` | N, UI, FLUXO | — |
| A5 janela dedicada | HUD → tarefa | VERIFICADO | ↗ no header | `maximize`, `task.html?jobId=...` | UI, ÁUDIO: mesma narração e controle sincronizado | — |
| A5 ocultar cartão | HUD/card | VERIFICADO | × no header | `remove`, mantém job e áudio | N, UI, ÁUDIO | — |
| A5 selecionar | HUD/card | VERIFICADO automaticamente | Clique no card ou Enter/Espaço no foco | `select` | N | — |
| A5 copiar | Janela dedicada | VERIFICADO automaticamente | ↗ → botão de cópia existente | `copy`, texto recuperável, fallback manual | N: parcial/final, clipboard negado | Clipboard nativo com permissões reais NÃO VERIFICADO |
| A5 narrar cópia | Janela dedicada | VERIFICADO automaticamente | ↗ → “Narrar cópia de trabalho” | `narrate`, `workingText`, `expectedText` | N: cópia isolada, conflito e preservação da apresentação | Chrome com Gemini real |
| A5 editar e conflitos | HUD/manual e tarefa | VERIFICADO automaticamente | Editor existente; feedback local preservado | `edit {expectedText}` | N: rascunho preservado em rejeição/conflito; UI para edição normal | Conflito simultâneo em Chrome NÃO VERIFICADO |
| A6 seek global | HUD/player e mini | VERIFICADO automaticamente e em PCM | Player inferior; mini transportes quando minimizado | Narração selecionada/ativa, ±5 s de PCM | N, ÁUDIO: cliques nas duas setas globais com PCM/ACK, sem ressíntese | — |
| A6 play/pause global | HUD/player e mini | VERIFICADO | Player inferior ou barra minimizada | `HUD_GLOBAL_TOGGLE`, ativo/último pausado | N, ÁUDIO; não inicia concluídos indiscriminadamente | — |
| A6 criar manual | HUD/player | VERIFICADO | Botão + | `HUD_GLOBAL_CREATE` | N, UI, ÁUDIO | — |
| A6 volume global | HUD/player | VERIFICADO | Slider global 0–1, passo 0,05 | `HUD_GLOBAL_SET` | N, UI, ÁUDIO: ganho multiplicativo sem alterar outro card | — |
| A6 velocidade global | HUD/player | VERIFICADO | Slider 0,5–2,0, passo 0,1 | `HUD_GLOBAL_COMMAND set` para narração relevante | N, ÁUDIO | — |
| A6 pânico global | HUD/barra | VERIFICADO | Sempre na barra, inclusive minimizado | `HUD_GLOBAL_PANIC`, não é stop individual | N, ÁUDIO, PÂNICO | — |
| A6 agente e configurações | HUD | VERIFICADO | Seletor e engrenagem acima dos cards | Storage real e `HUD_OPEN_OPTIONS` | UI; sincronização com Popup/Opções | Personas personalizadas com voz real |

### A7–A9 — ciclo de vida, exceções e responsividade

| Item / ID | Superfície | Continua? | Implementação atual → nova localização / condição | Comando / estado real | Validação | Pendência |
|---|---|---|---|---|---|---|
| A7 visibilidade por aba | HUD/abas | VERIFICADO | `tabHud`, controller recebe projeção por origem | `GET/STATE/UI_SET`, revisão | N, FLUXO, PWA | — |
| A7 tarefas persistem entre superfícies | Global/HUD | VERIFICADO | Registry continua fora da UI | Mesmos IDs e snapshots | N, UI, ÁUDIO, FLUXO | — |
| A7 abertura de nova atividade | HUD/origem | VERIFICADO | Barra/painel inferiores; nova tarefa pode expandir | `start` → `beginHudActivity` | N, FLUXO, PWA | — |
| A7 intervenção manual | HUD | VERIFICADO | Mostrar/ocultar/minimizar/recolher mantêm significados distintos | `ui`, `collapse`, automação existente | N, FLUXO, ÁUDIO | — |
| A7 replay sem expansão forçada | HUD | VERIFICADO | Painel e cartões mantêm apresentação | `preparePlayback(...reveal:false)` | N, ÁUDIO: áudio B inicia com HUD minimizado | — |
| A7 fechar após ~5 s | HUD automático | VERIFICADO | Nenhum fechamento ligado a blur de Popup | `hudAutomation`, timer/token, intervenção manual | N, FLUXO | Relato em ambiente pessoal deve ser reavaliado se persistir |
| A7 nova atividade cancela timer | HUD | VERIFICADO | Sem mudança de serviço | Mesma automação do registry | N, FLUXO | — |
| A7 origem não abre outra aba/PWA | HUD/abas/PWA | VERIFICADO | Sincronização global separada da visibilidade local | Projeção `forHud` | N, PWA | — |
| A7 quatro cards sem excluir dados | HUD | VERIFICADO | Lista compacta com foco prioritário | `hudTaskId`, quatro jobs não ocultos | N, FLUXO: quatro cards, seis resultados | — |
| A7 navegação por PCM retido | HUD | VERIFICADO | Setas individuais/globais e explicação no player | Janela real, até 60 s quando disponível | N, ÁUDIO | Retenção longa com provedor real |
| A7 fechar Popup/página não destrói global | Global/HUD | VERIFICADO | Renderer mantém apenas a view | Registry e execução fora do DOM | N, UI, PWA; ÁUDIO para ocultar HUD/card | Fechar uma página com tarefa ativa em sessão pessoal |
| A8 `NO_SPEECH` | HUD/card | VERIFICADO automaticamente | Status real e aviso acessível no header | `job.outcome` | N | Microfone físico em silêncio NÃO VERIFICADO |
| A8 resultado incompleto | HUD/card | VERIFICADO automaticamente | Nota e alerta recolhido; flag nos Detalhes | `incomplete` | N | — |
| A8 origem indisponível | HUD/card | VERIFICADO automaticamente | Nota e Detalhes; não sugere inserção em outra aba | `originAvailable:false`, `insertion` | N; isolamento em PWA/FLUXO | Navegação/origem perdida com ditado físico |
| A8 inserção não confirmada | HUD/card | VERIFICADO automaticamente | Status, nota e alerta | `insertion.inserted/reason` | N | — |
| A8 edição manual preservada | HUD/card | VERIFICADO automaticamente | Nota específica, razão nos Detalhes | `MANUAL_EDIT_PRESERVED` | N | Edição concorrente humana |
| A8 falha de histórico | HUD/card | VERIFICADO automaticamente | Nota/alerta com orientação de cópia | `historyStatus:'failed'` | N | Falha real de armazenamento NÃO VERIFICADA |
| A8 limite de sessão | HUD/card | VERIFICADO automaticamente | Nota/alerta, sem apagar dados | `capacityWarning`, também da narração associada | N | Saturação real do navegador NÃO VERIFICADA |
| A8 warnings/erros | HUD/card | VERIFICADO automaticamente | Nota, tooltip/alerta e estado | `job.warning/error`, `job.narration` | N; ÁUDIO para estados de playback | Erros reais de provedor |
| A8 clipboard negado | Tarefa/HUD | VERIFICADO automaticamente | ↗ → feedback e instrução Ctrl+C | Falha real recebida da operação de cópia | N com clipboard rejeitado | Permissão nativa NÃO VERIFICADA |
| A8 comando recusado | HUD/card/global | VERIFICADO automaticamente | Feedback e aviso externo; não anuncia sucesso antes do ACK | Resposta `success:false`, exceções de transporte | N | Rejeição remota Gemini real |
| A8 duplicidade/ACK pendente | HUD/card/global | VERIFICADO | Busy por ação, `expectedText`, sequência de controle | Comandos e ACKs existentes | N, ÁUDIO, PÂNICO | — |
| A8 contexto invalidado | HUD | VERIFICADO automaticamente | Aviso externo orienta atualizar a página | Falha `extension context invalidated` | N | Atualização/reload real da extensão NÃO VERIFICADO |
| A8 encerramento em andamento | HUD minimizado | VERIFICADO | Pânico com `aria-busy` e aviso fora do painel | `cancelling`, confirmação remota | N, PÂNICO | — |
| A9 telas pequenas | HUD | VERIFICADO | Limites de viewport e rolagem do corpo/lista/texto | CSS responsivo e contenção por medidas reais | UI: 320×480, 360×260; pânico em 320×260; sliders inferiores atingíveis após scroll | Zoom do SO, alto contraste e outras escalas NÃO VERIFICADOS |
| A9 retrato/paisagem | HUD | VERIFICADO como layout responsivo | Não introduz modos operacionais novos | Viewport real | UI | Touch físico |
| A9 movimento reduzido | HUD | VERIFICADO | CSS sem animação e controller sem mola | `prefers-reduced-motion`, inclusive mudança em execução | UI | Preferência em outros sistemas operacionais |
| A9 referências legadas | HUD | VERIFICADO por inspeção | Referências a preview/play/mic/Lens/stop/volume/speed antigas mantidas | Nenhuma remoção sem contrato | Comparação do código | Não são controles novos montados no HUD |
| A9 `fm-global-summary` | Compartilhada | VERIFICADO por inspeção | Continua criado e oculto como na base | Renderer existente | N de layout e inspeção | — |
| A9 isolamento de superfície | HUD/Popup/Opções/tarefa | VERIFICADO | Novo CSS em Shadow DOM e seletores `data-surface='hud'`; outras superfícies recebem a skin anterior | Opções de montagem existentes | N, UI; comparação byte a byte | Redesign das outras superfícies em etapas próprias |

## Arquivos alterados

| Arquivo | Alteração |
|---|---|
| `content.css` | Assembly, barra vertical, painel, waveform, responsividade e skin exclusiva do HUD |
| `content.js` | Markup do HUD, pointer/teclado, movimento elástico, contenção, estados e CSS distribuído sincronizado |
| `global-hud.js` | Composição exclusiva embedded, chips/Detalhes, texto unificado, avisos externos e acesso a alertas recolhidos |
| `global-jobs.js` | Replay/narração de tarefa existente preserva apresentação e consulta manual |
| `tests/global-hud-view.test.cjs` | Cobertura de texto unificado, métricas, avisos recolhidos e isolamento de superfície |
| `tests/gui-layout-contract.test.cjs` | Contrato de minimização atualizado para o painel separado; mantém comparação CSS exata |
| `tests/hud-automation.test.cjs` | Replay, cópia STT e fechamento automático após intervenção manual |
| `tests/translation-hud-chrome.cjs` | Asserções da waveform em reprodução/gravação, composição do texto e espera da confirmação real de visibilidade |
| `tests/controls-chrome.cjs` | Modo opcional de áudio/HUD isolado; execução completa existente mantida |
| `tests/hud-audio-chrome-cases.cjs` | Cenários MV3 focados com PCM/AudioWorklet reais e provedor fixture |
| `tests/hud-glass-chrome.cjs` | Roteiro MV3 de layout, ponteiro, teclado, superfícies, responsividade e screenshots |
| `tools/verify-publication.cjs` | Inclui os dois novos roteiros na lista de arquivos de publicação |
| `docs/HUD-MIGRACAO-ETAPA1.md` | Relatório e matriz de aceitação desta execução |

## Evidências locais desta execução

Arquivos temporários, sem credenciais pessoais:

- `/tmp/falamermo-hud-node-final.tap`: suíte ampla, 725 testes.
- `/tmp/falamermo-hud-targeted-final.tap`: 134 regressões focadas após o último ajuste.
- `/tmp/falamermo-hud-baseline.tap`: suíte na cópia imutável do HEAD inicial, 720 testes.
- `/tmp/falamermo-hud-controls.log` e `/tmp/falamermo-hud-controls-baseline.log`: mesmo bloqueio no roteiro completo Chrome.
- `/tmp/falamermo-hud-glass-chrome-final.log` e `/tmp/falamermo-hud-glass-angGUY/`: 13 grupos de UI, JSON e capturas desktop, telas estreitas e minimizado.
- `/tmp/falamermo-hud-audio.log` e `/tmp/falamermo-hud-audio-7wSflK/hud-audio.png`: controles de áudio focados e captura da waveform durante reprodução.
- `/tmp/falamermo-hud-translation.log` e `/tmp/falamermo-translation-hud-bC9Udv/`: tradução/ditado e resultados.
- `/tmp/falamermo-hud-panic.log`: parada global isolada.
- `/tmp/falamermo-hud-pwa.log` e `/tmp/falamermo-pwa-QeNqQw/`: integração com PWA.
- `/tmp/falamermo-hud-publication.tap`: dois testes de publicação.

## NÃO VERIFICADO — pendências humanas e etapas seguintes

1. Homologação com extensão instalada no perfil habitual, Chrome com interface visível, monitor/zoom reais e preferência estética do usuário. As capturas do Chrome headless foram inspecionadas; isso não substitui a avaliação humana do vidro e da elasticidade sobre páginas reais.
2. Microfone físico, Gemini real, áudio ouvido fisicamente, ditado prolongado com rede real, silêncio, permissões reais de clipboard, touch/pen, atualização da extensão em uso e conflitos simultâneos em janelas reais.
3. Lens completo, recuperação/arquivo e restauração com dados reais no Chrome. Os testes Node desses serviços passaram, mas esses fluxos não foram homologados manualmente nesta execução.
4. Os dois bloqueios preexistentes — expectativas do catálogo após a data de descontinuação e consulta de `editor-apply` no roteiro completo Chrome — exigem trabalho funcional próprio. Não foram alterados por razões estéticas.

| Dependência | Etapa posterior | Estado nesta entrega |
|---|---|---|
| Popup | 2/4 | HTML/JS e skin existentes preservados; sincronização do agente e dos três jobs verificada no Chrome; apresentação do protótipo ainda não migrada |
| Opções e formulários | 3/4 | HTML/JS e skin existentes preservados; abertura pela engrenagem e jobs compartilhados verificados; sem reorganização de configurações/modelos/ferramentas |
| Integração transversal | 4/4 | Contratos GET/STATE/COMMAND/UI_SET/CREATE/SET/PANIC preservados; PWA, áudio, origem e automação exercitados nos roteiros descritos; Gemini/hardware/perfil pessoal pendentes |

SUGESTÃO: usar a matriz acima para a homologação humana e registrar resultados antes de considerar a migração visual global concluída. Nenhum commit, push, PR, publicação ou recarga da extensão pessoal foi realizado.
