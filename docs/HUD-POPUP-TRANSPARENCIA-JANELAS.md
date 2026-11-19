# FalaMermo Glass — transparência e comandos locais do HUD

Data: 19/11/2026. Workspace: `/home/Alee/Dev/FalaMermo-glass`.

## Causa investigada

**VERIFICADO:** antes das alterações desta rodada, seis alternâncias em duas janelas nativas do Chrome seguiram os `tabId`, `windowId` e `documentId` corretos. O roteador já obtinha a origem de `sender.tab`/`sender.documentId`, e a apresentação já tinha entradas distintas em `tabHud`. Não foi reproduzida a transferência literal do controle para a janela original. Evidência inicial: `/tmp/falamermo-hud-windows-uWhy8f/diagnostico.json`.

**VERIFICADO:** havia outro defeito concreto: dois cliques antes do ACK calculavam o mesmo próximo valor a partir de `this.globalMinimized`, ainda desatualizado. A regressão de dois cliques falhou antes da correção e passou depois. Isso explica perda de alternância; não comprova a causa do desvio de janela relatado.

**EXECUTADO:** o raio envia a intenção `toggleMinimized:true`, com `scope:'tab'`. O registry calcula a alternância dentro de sua fila serial, na entrada da aba remetente. O background exige origem de content script; identificadores fornecidos no payload não escolhem o destino. A lógica de STT/TTS não foi refatorada.

## Escopo posterior anexado (registro histórico)

O texto abaixo é uma solicitação posterior preservada como referência; não descreve execução desta rodada.

> # CODEX | FalaMermo Glass — Transparência em duas camadas
> Corrigir pontualmente o sistema de transparência do HUD.
> **Problema:** mesmo com o slider no máximo de transparência, o conteúdo da página atrás do HUD continua praticamente invisível.
> ## Implementação
> Separar visualmente o HUD em duas camadas independentes:
> **1. Fundo estrutural**
> - Superfície principal do HUD altamente translúcida.
> - Permitir reconhecer textos, imagens e elementos da página atrás.
> - Reduzir o blur excessivo quando necessário.
> - Evitar gradientes, overlays e sombras que acumulem opacidade.
> **2. Conteúdo funcional**
> - Cards, botões, controles, telemetria e indicadores com opacidade própria, superior à do fundo.
> - Textos e ícones devem continuar nítidos e legíveis.
> - Preservar a aparência Glass, as bordas e os reflexos.
> - A barra vertical também deve respeitar essa separação.
> ## Slider existente
> Manter apenas o controle atual no Popup.
> Ele deve ajustar prioritariamente a transparência do **fundo estrutural**, preservando a legibilidade dos elementos funcionais.
> Não adicionar outro slider.
> Não aplicar `opacity` ao contêiner inteiro, pois isso também torna o conteúdo ilegível.
> Utilizar transparências individuais nos backgrounds e nas camadas decorativas.
> ## Validação
> Comparar o HUD sobre páginas claras, escuras e com texto.
> Na transparência máxima, a página atrás precisa continuar visualmente reconhecível, enquanto os controles permanecem legíveis.
> Preservar todos os comportamentos, layouts e funcionalidades existentes.
> Não modificar Opções, STT/TTS ou lógica de tarefas.
> Não fazer commit, push ou PR.
> Executar testes pertinentes e relatar o resultado.

## Alterações executadas nesta rodada

- **EXECUTADO:** slider de transparência no Popup, de 0 a 100, em passos de 5. O padrão 50 conserva exatamente as opacidades anteriores. Os extremos tornam o vidro mais opaco ou mais transparente; texto, blur, bordas e iluminação mantêm suas propriedades.
- **EXECUTADO:** uma única preferência global, `chrome.storage.local.hudTransparency`. Eventos nativos `storage.onChanged` atualizam os materiais de barra, painel e cartões dos HUDs existentes. A preferência não é duplicada no registry de tarefas. Leituras iniciais têm proteção contra eventos mais novos e falhas de contexto.
- **EXECUTADO:** raio com título, nome acessível, `aria-expanded` e `aria-controls`; o antigo botão de minimizar foi removido. Pânico e ocultação explícita continuam separados e acessíveis na barra. Minimizar não altera tarefas, cartões ou posição.
- **VERIFICADO:** `options.html`, `options.js`, `offscreen.js`, `stt-vad-client.js` e `global-hud.js` são idênticos ao snapshot do início desta rodada, por SHA-256. As alterações locais anteriores foram preservadas. A única adição visual no Popup é o controle solicitado.

## Execuções desta rodada

| Execução | Resultado observado |
|---|---|
| Node: `hud-popup`, `hud-homologation`, `global-jobs`, `global-hud-view`, `hud-automation`, `gui-layout-contract`, `pwa-hud`, `tts-hud`, `tab-isolation`, `publication-version` | **VERIFICADO:** 149 testes aprovados; zero falhas, cancelamentos ou skips. Log: `/tmp/falamermo-hud-popup-node-final.tap`. |
| Chrome MV3 com duas janelas nativas, perfil isolado, `FALAMERMO_HEADED=1 xvfb-run -a node tests/hud-windows-chrome.cjs` | **VERIFICADO:** seis grupos aprovados. Alternância exclusiva na aba remetente, inclusive com outra janela minimizada/fechada; payload com destino forjado ignorado; foco real confirmado pela API Chrome; cards e tarefas globais preservados. Slider acionado por teclado no Popup nativo, atualizado em ambas as janelas sem remontar HUDs, restaurado após reabrir Popup e reiniciar o processo Chrome. Log final: `/tmp/falamermo-hud-windows-final.log`; resultados, trace e captura: `/tmp/falamermo-hud-windows-TovKWY/`. |
| `FALAMERMO_HOMOLOGATION=1 node tests/hud-glass-chrome.cjs` | **VERIFICADO:** 18 grupos, incluindo arraste sem deriva, waveform encerrada, persistência manual com Popup/Opções/foco, telemetria e viewports pequenas. Log: `/tmp/falamermo-hud-popup-layout.log`. |
| `node tests/translation-hud-chrome.cjs --hud-controls` | **VERIFICADO:** captura por microfone virtual, VAD e AudioWorklet reais; raio alternado durante captura sem encerrar trilhas, alterar cartões ou posição; ditado inserido, histórico e waveform encerrada. Tradução/TTS e concorrência também exercitados. Log: `/tmp/falamermo-hud-popup-ditado.log`; artefatos: `/tmp/falamermo-translation-hud-7jspKK`. |
| `FALAMERMO_HUD_AUDIO_ONLY=1 node tests/controls-chrome.cjs` | **VERIFICADO:** PCM/AudioWorklet, transportes individual/global, seek com ACK, volume, velocidade, minimização, pânico e preservação de texto. Log: `/tmp/falamermo-hud-popup-audio.log`. |
| `FALAMERMO_PANIC_ONLY=1 node tests/controls-chrome.cjs` | **VERIFICADO:** pânico no HUD minimizado e Popup; gravação/processamento STT, agente, estados TTS, PCM, histórico e operações posteriores. Log: `/tmp/falamermo-hud-popup-panico.log`. |
| `node tests/pwa-hud-chrome.cjs` | **VERIFICADO:** PWA instalada, aberta e recarregada no perfil isolado; visibilidade local, tarefas alheias e controles manuais. Log: `/tmp/falamermo-hud-popup-pwa.log`. |
| `node tools/verify-publication.cjs`, verificações de sintaxe e `git diff --check` | **VERIFICADO:** 133 arquivos, 95 JavaScript, manifest 1.0.8, 108 referências; zero achados do verificador e nenhum erro de sintaxe/diff. Não foi gerado pacote de distribuição. |

A primeira execução do teste adicional de captura falhou porque a nova asserção consultava `isRecording` antes da conclusão da inicialização do microfone/AudioWorklet. O teste passou a aguardar a captura efetivamente ativa; a execução seguinte completou o cenário. Não houve mudança de STT para acomodar o teste.

## Cobertura da auditoria A1–A9

| Seção | Evidência automática desta rodada | Limite |
|---|---|---|
| A1 — camadas | Contrato CSS/empacotado; renderer compartilhado preservado; roteamento MV3 real. | Não é uma nova auditoria completa da arquitetura. |
| A2 — contêiner | Raio, pânico, ocultação, arraste, teclado, contenção e mini transportes no Chrome. | Aparência final no ambiente pessoal exige homologação humana. |
| A3 — cartões | Expansão independente, seleção/edição, quatro cartões e janela dedicada nas regressões executadas. | Nem toda combinação de tipo/status foi exercitada no Chrome. |
| A4 — métricas | Telemetria em atualização, expansão preservada, ACK, PCM, velocidade e volumes nas regressões Node/Chrome. | Dados de provedor externo foram simulados. |
| A5 — ações individuais | Play/pause/resume/stop, seek, volume, expansão, ocultação e janela dedicada; contratos adicionais no Node. | Não houve homologação humana de cada ação. |
| A6 — ações globais | Tarefa manual sincronizada entre janelas, transportes e pânico reais no runtime de teste. | Provedor Gemini real não foi acionado. |
| A7 — apresentação/concorrência | Duas janelas reais; seis alternâncias de diagnóstico; cliques antes do ACK; foco, fechamento/minimização de janela, timer, abertura manual, restart e PWA. | O desvio original de janela não se reproduziu no baseline local. |
| A8 — avisos/exceções | Contratos e estados de erro/rejeição no Node; avisos de telemetria e confirmação de pânico no Chrome. | Não foram provocadas todas as falhas externas possíveis. |
| A9 — responsividade/isolamento | Viewports pequenas e movimento reduzido; CSS restrito ao HUD; Popup inspecionado por captura. | Homologação humana em diferentes escalas/monitores permanece pendente. |

Os contratos globais da seção D foram exercitados por testes de registry, origem, tarefas, áudio e PWA. Isso não equivale a executar todos os testes existentes do repositório.

## Pendências e limites

- **NÃO VERIFICADO:** reprodução e causa exata da transferência para a janela original no perfil pessoal do usuário.
- **NÃO VERIFICADO:** homologação humana, microfone físico e Gemini real. O Chrome foi real (157.0.8103.78), em perfil descartável; a execução com janelas nativas usou Xvfb. Os testes de mídia usaram dispositivo virtual e respostas HTTP/WebSocket simuladas, com pipeline local de áudio/VAD real.
- **EXECUTADO:** nenhum commit, push ou PR. Este relatório é local e permanece ignorado pela regra preexistente `docs/*`; essa regra não foi alterada.
