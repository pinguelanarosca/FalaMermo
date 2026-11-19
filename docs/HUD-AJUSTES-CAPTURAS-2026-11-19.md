# HUD Glass — ajustes das três capturas

19/11/2026 · `/home/Alee/Dev/FalaMermo-glass`

**VERIFICADO:** as três imagens anexadas foram recebidas e visualizadas, incluindo os indicadores da imagem 3.

## Executado

- Dois sliders no Popup: **Fundo do HUD** (`hudTransparency`) e **Elementos do HUD** (`hudContentTransparency`). Preferências globais em `chrome.storage.local`, atualização dos HUDs já montados por eventos nativos de armazenamento e restauração após reiniciar o Chrome. O novo padrão 50 preserva o material funcional anterior. Somente alphas dos materiais variam; textos/ícones não recebem opacidade de contêiner e os filtros permanecem independentes.
- Removido do DOM do HUD o cabeçalho completo “Tarefas globais”, com contador, toolbar e seu espaço. Lista, cartões e demais superfícies da extensão preservados.
- Removido o bloco de captação do cabeçalho. Silero, TEN, dupla confirmação e recuperações aparecem primeiro em **Detalhes da tarefa** do `jobId` correspondente. A publicação usa `HUD_CAPTURE_STATE`, valida a origem e normaliza os quatro campos no registry existente. Os últimos valores ficam na tarefa após o encerramento. Nenhum cálculo ou decisão do VAD foi alterado.
- Detalhes continuam fechados por padrão. Atualizações não forçam expansão; a abertura manual permanece local a cada HUD e é preservada no ditado e no encerramento.
- Indicadores com ícones e valores: `↥` enviados, `≡` pendentes, `✓` finalizados e `▦` total. Uma linha, espaçamento uniforme, tooltip e `aria-label` completos. Em espaço insuficiente, a faixa permite rolagem horizontal e foco por teclado, sem quebrar a linha ou descartar métricas.
- Alça discreta no canto superior esquerdo, com mouse/toque e teclado. Redimensiona o painel mantendo a âncora da barra, com mínimos de 320 × 260 px quando a viewport comporta e limites ajustados à viewport. Arraste e rolagem interna mantidos. O tamanho pertence a `tabHud[tabId].size` no armazenamento de sessão já existente, sem preferência global paralela; permanece em atualizações e minimizar/restaurar. A reidratação do registry foi testada. O tamanho não é uma preferência entre reinícios completos do Chrome; as duas transparências são persistentes.

## Verificação desta rodada

| Execução | Resultado real |
|---|---|
| Node: ajustes, HUD, renderer, registry, automação, contratos CSS, PWA, TTS, isolamento de abas e publicação | **151 aprovados**, zero falhas/skips/cancelamentos na execução final. Inclui origem da telemetria, normalização, reidratação e tamanho por aba. `/tmp/falamermo-ajustes-node-final.tap`. |
| Chrome MV3 com duas janelas nativas sob Xvfb | **8 grupos aprovados**: origem de comandos, sliders independentes ao vivo em ambas as janelas, persistência dos dois valores após reinício do Chrome, cabeçalho ausente, telemetria na tarefa correta, expansão local independente, chips acessíveis na mesma linha, resize com ponteiro/teclado, limites, arraste, minimizar/restaurar e isolamento do tamanho. `/tmp/falamermo-ajustes-janelas-final.log`; artefatos `/tmp/falamermo-hud-windows-gLtHH6/`. |
| Chrome: homologação/regressões do HUD | **19 grupos aprovados**, incluindo arraste sem deriva, waveform, pânico, foco, persistência manual, viewports pequenas e detalhes de telemetria. `/tmp/falamermo-ajustes-layout-final.log`; artefatos `/tmp/falamermo-hud-glass-VRD7VQ/`. |
| Ditado `translation-hud-chrome.cjs --hud-controls` | Microfone virtual, VAD e AudioWorklet reais: gravação, telemetria no novo detalhe, abertura explícita mantida até depois do encerramento, minimização sem encerrar trilhas, inserção e histórico. Provedor HTTP/WebSocket simulado. `/tmp/falamermo-ajustes-ditado.log`; artefatos `/tmp/falamermo-translation-hud-BjmBCV/`. |
| Áudio `FALAMERMO_HUD_AUDIO_ONLY=1` | PCM/AudioWorklet real: play/pause/resume, seek individual/global com ACK, volume, velocidade, mini transportes, pânico e resultados preservados. `/tmp/falamermo-ajustes-audio.log`; artefatos `/tmp/falamermo-hud-audio-8xNhDo/`. |
| Chrome PWA | Instalação, abertura, reload, tarefas alheias, apresentação local e controles manuais aprovados. `/tmp/falamermo-ajustes-pwa.log`; artefatos `/tmp/falamermo-pwa-N2Ojf4/`. |
| Comparação visual | Páginas claras, escuras e com texto nos extremos estruturais; captura adicional com transparência interna máxima. Capturas inspecionadas, incluindo HUD redimensionado, telemetria e Popup nativo. `/tmp/falamermo-ajustes-visual-final.log`; artefatos `/tmp/falamermo-hud-glass-Lpy5p9/`. |
| Verificador e diff | 136 arquivos, 98 JavaScript, 108 referências, manifest 1.0.8, sem erro de sintaxe/diff ou achado do verificador. `/tmp/falamermo-ajustes-publicacao-final.log`; `git diff --check` aprovado. |

Os testes de metadados usam fixtures somente nas cópias temporárias de teste; o produto usa os estados reais. Não houve geração de pacote nem execução integral de todos os testes do repositório. Os contratos A1–A9 pertinentes foram exercitados pelas regressões acima; isso não substitui nova homologação humana completa da auditoria.

## Arquivos alterados nesta rodada

Produção:

- [content.js](/home/Alee/Dev/FalaMermo-glass/content.js): preferências, telemetria e redimensionamento do HUD; CSS empacotado sincronizado.
- [content.css](/home/Alee/Dev/FalaMermo-glass/content.css): materiais funcionais parametrizados, indicadores e alça.
- [global-hud.js](/home/Alee/Dev/FalaMermo-glass/global-hud.js): cabeçalho, detalhes por tarefa, ícones e acessibilidade.
- [global-jobs.js](/home/Alee/Dev/FalaMermo-glass/global-jobs.js): campos normalizados de telemetria e tamanho por aba.
- [background.js](/home/Alee/Dev/FalaMermo-glass/background.js): encaminhamento do tamanho pela origem do comando existente.
- [popup.html](/home/Alee/Dev/FalaMermo-glass/popup.html) e [popup.js](/home/Alee/Dev/FalaMermo-glass/popup.js): segundo controle persistente, sem redesign.

Regressões e verificador:

- Novos: [hud-adjustments.test.cjs](/home/Alee/Dev/FalaMermo-glass/tests/hud-adjustments.test.cjs), [hud-adjustments-chrome.cjs](/home/Alee/Dev/FalaMermo-glass/tests/hud-adjustments-chrome.cjs).
- Atualizados: [global-hud-view.test.cjs](/home/Alee/Dev/FalaMermo-glass/tests/global-hud-view.test.cjs), [hud-homologation.test.cjs](/home/Alee/Dev/FalaMermo-glass/tests/hud-homologation.test.cjs), [hud-homologation-chrome.cjs](/home/Alee/Dev/FalaMermo-glass/tests/hud-homologation-chrome.cjs), [hud-windows-chrome.cjs](/home/Alee/Dev/FalaMermo-glass/tests/hud-windows-chrome.cjs), [translation-hud-chrome.cjs](/home/Alee/Dev/FalaMermo-glass/tests/translation-hud-chrome.cjs), [hud-transparency-chrome.cjs](/home/Alee/Dev/FalaMermo-glass/tests/hud-transparency-chrome.cjs), [verify-publication.cjs](/home/Alee/Dev/FalaMermo-glass/tools/verify-publication.cjs).

**VERIFICADO:** Opções, offscreen, cliente VAD e a classe `SttController` continuam idênticos ao snapshot inicial. Alterações locais anteriores preservadas. Nenhuma nova etapa da migração foi iniciada.

## Evidências e pendências

- [HUD redimensionado com telemetria e indicadores](/tmp/falamermo-hud-windows-gLtHH6/hud-ajustes.png)
- [Dois sliders no Popup nativo](/tmp/falamermo-hud-windows-gLtHH6/popup-transparencia.png)
- [Transparência interna máxima sobre texto](/tmp/falamermo-hud-glass-Lpy5p9/internos-maximo-texto.png)

**NÃO VERIFICADO:** homologação humana no perfil pessoal, microfone físico, Gemini real e restauração do tamanho por reload nativo de página. O tamanho foi validado por comandos, minimizar/restaurar e reidratação do registry; não é persistido após encerrar o navegador. Chrome usado: 157.0.8103.78, perfis isolados.

**EXECUTADO:** nenhum commit, push ou PR. Este relatório é local e ignorado pela regra preexistente `docs/*`, sem alteração da regra.
