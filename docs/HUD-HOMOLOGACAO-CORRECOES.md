# FalaMermo Glass — correções da homologação humana

Execução de 18/11/2026, somente no HUD da branch `design/glass-visualstttts`. Relatório local, conforme a regra existente `docs/*`; `.gitignore` preservada. Nenhum commit, push, PR ou alteração no perfil pessoal do Chrome.

## EXECUTADO

| Correção | Causa identificada | Alteração |
|---|---|---|
| Persistência manual | Iniciar outra tarefa retirava a aba da proteção manual; mudanças globais de apresentação descartavam `documentId`, permitindo que `attachHud` tratasse o retorno de foco como novo documento | A decisão manual permanece no registry existente. Abertura e minimização manuais prevalecem sobre timers e ações automáticas. Atualizações globais preservam a identidade do documento. Ocultar explicitamente continua funcionando |
| Deriva ao soltar | Cada atualização convertia novamente o retângulo medido em `right/bottom`, realimentando diferenças entre a viewport e seu gutter | A posição passa a ser alterada somente pelo deslocamento solicitado ou por uma correção real de overflow. Nenhuma posição é recalculada por simples atualização de estado. A mola atua apenas no painel |
| Waveform após finalizar | O estado `recording` podia chegar atrasado em relação a `microphoneReleased`; `playing` isolado também não comprova saída de áudio | A onda de captura exige microfone não liberado. A onda de narração exige `outputActive:true`, sem pausa/mute do Worklet e com contexto em execução quando informado. Estados terminais e inativos não animam |
| Transparência | O material estava mais opaco que o desejado na homologação | Painel: alphas 0,43/0,55; barra: 0,38/0,50; cartões: 0,10/0,06/0,08. Blur de 28 px, bordas, paleta e controles preservados. Sombra sutil no texto auxilia leitura sobre fundos claros |
| Telemetria VAD | Silero, TEN, confirmação e recuperações eram enviados a um aviso como texto corrido | Resumo compacto de captação, dupla confirmação e recuperações; probabilidades e estados completos em expansão nativa. Atualizações preservam a expansão. Valores brutos das probabilidades continuam no tooltip; valores ausentes aparecem como indisponíveis, sem inventar zero. Alertas críticos continuam fora do painel minimizável |

A mudança no callback VAD limita-se ao argumento de apresentação de `setCaptureNotice`: os mesmos valores são entregues em estrutura para o HUD. Decisão, thresholds, captura, envio, métricas e diagnóstico do VAD não foram alterados. Não houve refatoração de STT/TTS.

## VERIFICADO — testes desta execução

Antes da correção, quatro regressões novas falharam no código real: persistência após nova atividade/timer, identidade do documento, idempotência da posição e encerramento da waveform. Depois da correção, passaram. Uma quinta regressão cobre valores, expansão e avisos da telemetria.

| Execução | Resultado atual | Natureza da evidência |
|---|---|---|
| Node: `hud-homologation`, `hud-automation`, `pwa-hud`, `global-jobs`, `global-hud-view`, `gui-layout-contract`, `tts-hud` e `publication-version` | **141 testes passaram, zero falhas** | Código real dos módulos em Node; relógio, transporte e DOM são fixtures quando requeridos pelo caso |
| `FALAMERMO_HOMOLOGATION=1 node tests/hud-glass-chrome.cjs` | **18 grupos passaram** | Chrome 157.0.8103.78, extensão MV3, foco, mensagens, layout e pointer reais; metadados de captura e amostras de telemetria controlados pelo teste |
| `node tests/translation-hud-chrome.cjs` | **Passou** | Captura do microfone virtual, VAD e processamento de áudio no Chrome reais; HTTP/WebSocket Gemini simulados. Confirma gravação, encerramento da onda, texto inserido, persistência manual por mais de 5 s após finalizar e ocultação explícita |
| `FALAMERMO_HUD_AUDIO_ONLY=1 node tests/controls-chrome.cjs` | **Passou** | PCM/AudioWorklet nativos, provider simulado: seek individual/global com ACK, Pause/Resume, volumes, velocidade, Stop isolado, janela dedicada, ocultação, pânico e onda imóvel após encerramento |
| `FALAMERMO_PANIC_ONLY=1 node tests/controls-chrome.cjs` | **Passou** | Chrome MV3, microfone virtual e provider simulado; pânico pelo HUD minimizado/Popup, STT, áudio e continuidade de novas operações |
| `node tests/pwa-hud-chrome.cjs` | **Passou** | PWA instalada/aberta/recarregada no perfil descartável; origem e apresentação por aba preservadas |
| `node tools/verify-publication.cjs` | **Passou** | Versão 1.0.8, 131 arquivos, 93 JavaScript, 108 referências; inclui os novos roteiros no conjunto de publicação |
| Sintaxe JavaScript e `git diff --check` | **Passaram** | Arquivos distribuídos e roteiros alterados; CSS empacotado validado por igualdade com `content.css` |

Os roteiros de integração foram executados com `/opt/google/chrome/chrome` em perfis descartáveis. Não foi executada homologação humana nesta rodada, nem produzida nova publicação/ZIP. A suíte ampla de todos os motores não foi reexecutada; os resultados acima são os das regressões relevantes executadas nesta correção.

### Cenários novos no Chrome

- Abertura manual por aba com o padrão global **oculto**, para evitar um falso positivo de visibilidade global.
- Captação ativa, alternância de foco para Opções/Popup, minimização global, retorno à página, fechamento das superfícies, finalização e espera de 5,3 s: HUD permanece aberto até ocultação explícita.
- `documentId` preservado após mudança global de apresentação e consultas de reconexão.
- Status `recording` atrasado com microfone já liberado: animação deixa de existir e o transform da onda permanece imóvel entre amostras.
- Drag com `scrollbar-gutter: stable both-edges`, soltura e 40 atualizações de telemetria/estado: posição da barra permanece dentro da tolerância de 0,25 px, antes e depois da acomodação. Essa é a tolerância da asserção, não uma métrica inventada de precisão física.
- Telemetria expandida permanece aberta e atualiza probabilidades, confirmação e recuperações. Zero recebido permanece zero; desconhecido não vira zero.
- Layout em 320×480 e 360×260, com rolagem dos detalhes e sem overflow horizontal. Aviso crítico continua acessível com o painel minimizado.
- Capturas inspecionadas sobre fundo escuro e branco; nova aprovação estética humana permanece pendente.

## Preservação da auditoria A1–A9

| Área | Preservação nesta correção | Evidência |
|---|---|---|
| A1 estrutura/contratos | Shadow DOM, registry único e roteamento existentes; CSS fonte/distribuído sincronizados | Contratos Node e integração MV3 |
| A2 HUD/barra | Barra e controles aprovados mantidos; persistência, posição e onda corrigidas | Node, pointer/foco reais no Chrome, PWA |
| A3 cartões/texto | Renderizador compartilhado não foi modificado nesta rodada; texto, expansão, edição, avisos e janela dedicada permanecem | Comparação com o início da correção, testes do renderizador e Chrome |
| A4 métricas | Campos de tarefas continuam intactos. Silero, TEN, dupla confirmação e recuperações apenas mudam de apresentação | Regressão de telemetria, atualização no Chrome e VAD do microfone virtual |
| A5 individuais | Comandos, `jobId`, `requestId`, controles permitidos e proteção de edição preservados | Node e roteiro de áudio com ACK/PCM |
| A6 globais | Mini transportes, volume, velocidade, criação, agente e pânico preservados | UI/áudio/pânico no Chrome |
| A7 automação/concorrência | Fechamento automático continua para abertura automática. A abertura manual passa a persistir também entre novas tarefas e reinício do registry; ocultação explícita continua respeitada | Regressões de relógio, Chrome com padrão global oculto, ditado e PWA |
| A8 exceções | Avisos críticos não são substituídos por amostras VAD. Texto de fallback/recuperação, feedback e aviso de pânico mantidos | Regressão de telemetria e pânico minimizado |
| A9 responsividade/movimento | Viewport, scroll, seleção e movimento reduzido preservados; telemetria tem altura limitada e expansão própria | Contratos Node, telas baixas e capturas Chrome |

Dois testes antigos tiveram a expectativa atualizada: uma nova atividade não deve mais desfazer minimização/abertura manuais. As asserções de histórico, recuperação, concorrência e fechamento automático sem intervenção manual permanecem nos testes.

## Arquivos desta rodada

- `content.js`: apresentação estruturada da telemetria, critérios operacionais da waveform, coordenadas sem realimentação e cópia CSS sincronizada.
- `content.css`: transparência, contraste local e layout da telemetria expansível.
- `global-jobs.js`: proteção da decisão manual e preservação de `documentId`.
- `tests/hud-homologation.test.cjs` e `tests/hud-homologation-chrome.cjs`: regressões novas.
- `tests/hud-glass-chrome.cjs`: modo opcional da homologação, com instrumentação somente na cópia de teste.
- `tests/hud-automation.test.cjs`, `tests/global-jobs.test.cjs`: expectativas de apresentação manual atualizadas.
- `tests/translation-hud-chrome.cjs`, `tests/controls-chrome.cjs`, `tests/hud-audio-chrome-cases.cjs`: observação da nova telemetria, encerramento da waveform e persistência com microfone virtual.
- `tools/verify-publication.cjs`: inclui o novo helper Chrome na lista de publicação.
- Este relatório local.

Comparação por hash com o início desta rodada confirmou preservação de `popup.html/js`, `options.html/js`, `background.js`, `offscreen.js`, `stt-vad-client.js` e `global-hud.js`. As alterações locais anteriores foram preservadas. O estado anterior dos arquivos relevantes e o diff prévio estão em `/tmp/falamermo-homologacao-antes-aq32dvgj/` para recuperação proporcional.

## Evidências locais

- Antes das correções: `/tmp/falamermo-homologacao-regressao-antes.tap`.
- Node final: `/tmp/falamermo-homologacao-node-final.tap`.
- Chrome UI: `/tmp/falamermo-homologacao-chrome.log`; capturas e resultados em `/tmp/falamermo-hud-glass-Xgyyfx/`.
- Captura/VAD e texto: `/tmp/falamermo-homologacao-ditado.log`; artefatos em `/tmp/falamermo-translation-hud-7Ap4fM/`.
- Áudio: `/tmp/falamermo-homologacao-audio.log`; captura em `/tmp/falamermo-hud-audio-1frwLG/`.
- Pânico: `/tmp/falamermo-homologacao-panico.log`.
- PWA: `/tmp/falamermo-homologacao-pwa.log` e `/tmp/falamermo-pwa-JcHYzB/`.

## NÃO VERIFICADO

Nova homologação humana no perfil habitual, microfone físico, Gemini real, percepção da elasticidade no monitor do usuário, contraste em todas as páginas/temas e interação touch/pen física. Os testes headless e as capturas confirmam os cenários descritos, mas não substituem essa homologação. Nenhum resultado de testes da etapa anterior foi reutilizado como resultado desta rodada.
