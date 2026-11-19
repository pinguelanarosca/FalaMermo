# HUD — apresentação local e ondas operacionais

19/11/2026 · `/home/Alee/Dev/FalaMermo-glass`

## EXECUTADO

- Causa do escopo global: comandos de painéis sem aba eram encaminhados ao estado global; criar/reabrir tarefas também chamava `setHud` sem aba. Reprodução com o snapshot anterior: criar na aba 2 deixava abas 1 e 2 visíveis. Com a correção: aba 1 oculta, aba 2 visível.
- Comandos vinculados à aba remetente. Popup vinculado ao documento/aba da janela de abertura, com contexto Chrome e cache por documento; uma mudança posterior de foco não troca o destino. Mostrar/ocultar usa alternância autoritativa por aba. Broadcasts continuam globais para tarefas e são projetados para a apresentação local de cada painel. Criar/reabrir não abre HUDs alheios.
- Ícones vetoriais de envio, fila, confirmação, blocos, relógio e duração substituem caracteres ambíguos. Valores e rótulos acessíveis preservados em uma linha horizontal, com rolagem quando necessário.
- “Origem: aba…” transferida para Detalhes da tarefa apenas no HUD.
- Slider interno altera alpha dos materiais; filtros locais dos elementos funcionais foram removidos. Blur estrutural permanece fixo em 1 px, independente dos dois sliders. Limites de alpha mantêm fundos de apoio para os textos.
- Onda superior animada somente com STT gravando, microfone não liberado e confirmação real do VAD. Silêncio, TTS e encerramento deixam a onda superior estática.
- Texto acima do player substituído por onda. Animação inferior exige TTS em reprodução, saída ativa/desmutada, contexto em execução e sinal PCM não silencioso. Em silêncio, pausa ou inatividade: onda estática vermelha. Acrescentada observação de sinal PCM, sem alterar amostras, fila, velocidade ou comandos do player.
- Popup HTML/JS, Opções HTML/JS e classe `SttController` idênticos ao snapshot inicial. Alterações locais anteriores preservadas. **Nenhum commit, push ou PR.**

Arquivos de produção alterados:

- [background.js](/home/Alee/Dev/FalaMermo-glass/background.js)
- [global-jobs.js](/home/Alee/Dev/FalaMermo-glass/global-jobs.js)
- [global-hud.js](/home/Alee/Dev/FalaMermo-glass/global-hud.js)
- [content.js](/home/Alee/Dev/FalaMermo-glass/content.js)
- [content.css](/home/Alee/Dev/FalaMermo-glass/content.css)
- [offscreen.js](/home/Alee/Dev/FalaMermo-glass/offscreen.js)
- [pcm-player-worklet.js](/home/Alee/Dev/FalaMermo-glass/pcm-player-worklet.js)

Regressões atualizadas/adicionadas em arquivos existentes:

- `tests/global-jobs.test.cjs`: Popup vinculado à origem mesmo após mudança de foco.
- `tests/hud-adjustments.test.cjs`: criação/reabertura com apresentação local.
- `tests/global-hud-view.test.cjs`: projeção, ícones, origem nos detalhes e onda inferior por sinal efetivo.
- `tests/hud-homologation.test.cjs`: onda superior separada, estática no silêncio e sem resposta a TTS.
- `tests/hud-windows-chrome.cjs`: duas abas numa janela, outra janela, comandos locais e Popup nativo.
- `tests/hud-adjustments-chrome.cjs`: indicadores atualizados.
- `tests/hud-homologation-chrome.cjs`: preparação local e sinal de VAD explícito no fixture.
- `tests/translation-hud-chrome.cjs`: TTS não anima a onda superior.
- `tests/hud-audio-chrome-cases.cjs`: PCM silencioso mantém onda inferior parada/vermelha; PCM com sinal anima somente a inferior.
- `tests/live-pcm-player.test.cjs`: silêncio/sinal/silêncio com amostras de saída inalteradas.

Este relatório é local, ignorado pela regra preexistente `docs/*`.

## VERIFICADO

| Execução | Resultado desta rodada |
|---|---|
| Node: HUD/registry/automação/contratos/isolamento/PWA/TTS/publicação | **154 aprovados**, zero falhas/skips/cancelamentos na execução final. `/tmp/falamermo-local-ondas-node.tap`. |
| `node --test tests/live-pcm-player.test.cjs` | **23 aprovados**, incluindo detecção de silêncio sem alteração das amostras e controles existentes. `/tmp/falamermo-local-ondas-pcm.tap`. |
| Chrome MV3 nativo sob Xvfb | **10 grupos aprovados** com duas abas na primeira janela e uma aba em outra janela: mostrar/ocultar/minimizar locais, Popup nativo, criação sem abertura alheia, foco, redimensionamento, sliders e persistência. `/tmp/falamermo-local-ondas-janelas.log`; artefatos `/tmp/falamermo-hud-windows-R8V26A/`. |
| Homologação automatizada Chrome | **19 grupos aprovados**: arraste, limites, teclas, mini transportes, pânico, persistência, waveform e detalhes. `/tmp/falamermo-local-ondas-layout.log`; artefatos `/tmp/falamermo-hud-glass-1u3WMW/`. |
| Ditado Chrome, `--hud-controls` | Captura com microfone virtual, VAD/AudioWorklet reais, inserção, encerramento, minimização e histórico aprovados. Provedor simulado. `/tmp/falamermo-local-ondas-ditado.log`; artefatos `/tmp/falamermo-translation-hud-2d7Nmk/`. |
| Áudio Chrome, `FALAMERMO_HUD_AUDIO_ONLY=1` | PCM silencioso, PCM com sinal, ondas separadas, pause/resume, seek com ACK, volumes, velocidade, minimização e pânico aprovados. `/tmp/falamermo-local-ondas-audio.log`; artefatos `/tmp/falamermo-hud-audio-8W2pNv/`. |
| PWA Chrome | Instalação, abertura/reload, isolamento de apresentação e tarefas globais aprovados. `/tmp/falamermo-local-ondas-pwa.log`. |
| Visual Chrome, `FALAMERMO_TRANSPARENCY=1` | Fundos claro/escuro/texto, extremos estruturais e interno máximo. Capturas inspecionadas; alpha altera superfícies sem filtros funcionais. `/tmp/falamermo-local-ondas-visual-final.log`; artefatos `/tmp/falamermo-hud-glass-zCNuX5/`. |
| Contrato CSS e verificador | CSS empacotado igual a `content.css`; 136 arquivos, 98 JavaScript, 108 referências, manifest 1.0.8; nenhum erro de sintaxe/diff ou achado do verificador. `/tmp/falamermo-local-ondas-css.tap`, `/tmp/falamermo-local-ondas-publicacao.log`; `git diff --check` aprovado. |

Chrome: 157.0.8103.78, perfis isolados. Os testes de metadados usam fixtures nas cópias de teste; o teste de áudio executa o PCM/Worklet real e o teste de ditado usa dispositivo virtual com VAD real. Não foi executada toda a suíte do repositório nem uma nova auditoria humana integral A1–A9.

## NÃO VERIFICADO

- Comparação com as duas novas capturas citadas: não acompanharam estas mensagens. As três capturas anteriores pertencem ao pedido anterior.
- Homologação humana no perfil pessoal, microfone físico e Gemini real.

Evidências visuais: [HUD e indicadores](/tmp/falamermo-hud-windows-R8V26A/hud-ajustes.png), [TTS efetivo](/tmp/falamermo-hud-audio-8W2pNv/hud-audio.png), [silêncio vermelho e alpha interno máximo](/tmp/falamermo-hud-glass-zCNuX5/internos-maximo-texto.png).
