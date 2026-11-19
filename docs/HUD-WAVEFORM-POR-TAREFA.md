# HUD Glass — waveform por tarefa

19/11/2026 · `/home/Alee/Dev/FalaMermo-glass`

## EXECUTADO

- Removidas as waveforms globais do topo e da área inferior do player.
- Cada cartão do HUD recebe sua própria waveform como primeiro elemento, acima do cabeçalho. A animação usa somente o estado daquela tarefa: captura STT confirmada pelo VAD ou reprodução TTS com saída e sinal PCM efetivos. Silêncio, pausa e encerramento deixam a onda estática. Recolher o cartão ou minimizar o HUD oculta a onda e interrompe sua animação sem parar a operação.
- Restaurados `capturedChunks` como **Pacotes capturados** e `blocks` como **Blocos** na faixa horizontal de indicadores, junto de enviados, pendentes, finalizados e total. Valores zero são preservados; campos ausentes não ganham valores inventados. Tooltips, nomes acessíveis e rolagem horizontal mantidos.
- Ajustado o espaçamento superior do corpo após remover a onda global. Iluminação da barra, transparências e redimensionamento preservados.
- Nenhum commit, push ou PR.

Produção alterada: [content.js](/home/Alee/Dev/FalaMermo-glass/content.js), [content.css](/home/Alee/Dev/FalaMermo-glass/content.css), [global-hud.js](/home/Alee/Dev/FalaMermo-glass/global-hud.js).

Regressões alteradas:

- [global-hud-view.test.cjs](/home/Alee/Dev/FalaMermo-glass/tests/global-hud-view.test.cjs): ondas independentes, recolhimento, minimização, silêncio e pacotes/blocos.
- [hud-homologation.test.cjs](/home/Alee/Dev/FalaMermo-glass/tests/hud-homologation.test.cjs): ausência de waveform global no contêiner.
- [hud-audio-chrome-cases.cjs](/home/Alee/Dev/FalaMermo-glass/tests/hud-audio-chrome-cases.cjs): onda no cartão durante PCM real, silêncio, recolher/expandir sem interromper áudio e minimizar ocultando todas as ondas.
- [hud-glass-chrome.cjs](/home/Alee/Dev/FalaMermo-glass/tests/hud-glass-chrome.cjs), [hud-homologation-chrome.cjs](/home/Alee/Dev/FalaMermo-glass/tests/hud-homologation-chrome.cjs): seletores e verificações migrados para a onda do cartão.
- [hud-adjustments-chrome.cjs](/home/Alee/Dev/FalaMermo-glass/tests/hud-adjustments-chrome.cjs): seis indicadores na mesma linha, incluindo pacotes e blocos.
- [hud-transparency-chrome.cjs](/home/Alee/Dev/FalaMermo-glass/tests/hud-transparency-chrome.cjs): material da waveform por cartão.
- [translation-hud-chrome.cjs](/home/Alee/Dev/FalaMermo-glass/tests/translation-hud-chrome.cjs): captura/encerramento no cartão, ausência de ondas globais e pacotes capturados reais maiores que zero.

## VERIFICADO

| Execução desta rodada | Resultado |
|---|---|
| Node: HUD, renderer, registry, automação, layout, PWA, TTS, isolamento e publicação | **155 aprovados**, zero falhas/skips/cancelamentos. `/tmp/falamermo-card-wave-node-final.tap`. |
| Chrome HUD + homologação | **19 grupos aprovados**, incluindo viewports pequenas, arraste, movimento reduzido, mini transportes, pânico, persistência e telemetria. `/tmp/falamermo-card-wave-layout-final.log`; artefatos `/tmp/falamermo-hud-glass-wBRDxg/`. |
| Chrome nativo com duas abas na primeira janela e uma aba em outra janela | **10 grupos aprovados**: apresentação local, minimização, redimensionamento, sliders, persistência, telemetria e indicadores na mesma linha. `/tmp/falamermo-card-wave-janelas.log`; artefatos `/tmp/falamermo-hud-windows-rSNF4m/`. |
| Ditado com `--hud-controls` | Microfone virtual, VAD/AudioWorklet reais, onda no cartão em captura, encerramento, pacotes capturados reais, inserção e histórico aprovados. Provedor HTTP/WebSocket simulado. `/tmp/falamermo-card-wave-ditado.log`; artefatos `/tmp/falamermo-translation-hud-H9Y3sn/`. |
| Áudio com `FALAMERMO_HUD_AUDIO_ONLY=1` | PCM/AudioWorklet real: silêncio, reprodução, pausa/retomada, seek com ACK, volumes, velocidade, recolher/expandir sem parar áudio, ondas ocultas na minimização e pânico aprovados. `/tmp/falamermo-card-wave-audio-final.log`; artefatos `/tmp/falamermo-hud-audio-Q7gxGh/`. |
| Verificador e diff | 136 arquivos, 98 JavaScript, 108 referências, manifest 1.0.8; sem erro de sintaxe/diff ou achado do verificador. CSS empacotado igual a `content.css`. `/tmp/falamermo-card-wave-publicacao.log`; `git diff --check` aprovado. |

Capturas inspecionadas: [narração no cartão](/tmp/falamermo-hud-audio-Q7gxGh/hud-audio.png) e [captura com pacotes/blocos em linha](/tmp/falamermo-hud-windows-rSNF4m/hud-ajustes.png).

**Verificação por hash/diff:** Popup, Opções, background, registry, offscreen, Worklet e a classe `SttController` permanecem idênticos ao início desta rodada. Não houve alteração de motores STT/TTS nem de preferências globais. Alterações locais anteriores preservadas.

## NÃO VERIFICADO

Homologação humana no perfil pessoal, microfone físico e Gemini real. Chrome utilizado: 157.0.8103.78, perfis isolados; janelas nativas sob Xvfb. Não foi executada toda a suíte do repositório nem uma nova homologação integral A1–A9.

Relatório local ignorado pela regra `docs/*` preexistente, sem alteração dessa regra.
