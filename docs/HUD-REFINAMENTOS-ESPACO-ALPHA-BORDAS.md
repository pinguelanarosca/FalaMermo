# HUD — espaçamento, alpha e bordas

19/11/2026 · `/home/Alee/Dev/FalaMermo-glass`

## EXECUTADO

- A lista deixou de expandir para ocupar a altura vazia. Os controles acompanham o último cartão com margem de 10 px, inclusive após expandir/recolher e redimensionar. O tamanho global escolhido permanece preservado; a eventual área livre fica depois dos controles. Lista continua podendo encolher e rolar.
- Removido o filtro da camada estrutural que ainda desfocava a página sob os cartões; seus alphas e o controle de transparência estrutural permanecem idênticos. Elementos funcionais não têm filtros ou opacidade de contêiner. Fundos funcionais continuam parametrizados por alpha, com menos sobreposições e sombra textual mais nítida.
- Bordas exclusivas do HUD: narração azul `#2563EB`/`#38BDF8`, ditado verde `#10A37F`/`#34D399` e Lens laranja `#EA580C`/`#FB923C`, com os brilhos solicitados. Gradiente cônico principal/branco/destaque, giro de 4 s, contorno mascarado de 1,5 px e brilho interno/externo pulsando em 3 s. Os pseudoelementos não interceptam cliques e não têm preenchimento colorido no centro.
- Manual, tradução e demais tipos ficam neutros. Fundos dos cartões não recebem cores por tipo.
- O slider interno determina também a força da borda/brilho: 1 em transparência 0, 0,6 em 50 e 0,2 em 100. Cores e durações permanecem iguais. Movimento reduzido interrompe giro e pulso; HUD oculto/minimizado pausa os efeitos.
- Nenhum commit, push ou PR. Alterações locais anteriores preservadas.

Produção alterada: [content.css](/home/Alee/Dev/FalaMermo-glass/content.css), [content.js](/home/Alee/Dev/FalaMermo-glass/content.js), [global-hud.js](/home/Alee/Dev/FalaMermo-glass/global-hud.js).

Regressões/verificador alterados:

- Novo [hud-refinements-chrome.cjs](/home/Alee/Dev/FalaMermo-glass/tests/hud-refinements-chrome.cjs): espaçamento, tipos, máscara, giro real no Shadow DOM, pulso, cliques, extremos do slider e movimento reduzido.
- [hud-glass-chrome.cjs](/home/Alee/Dev/FalaMermo-glass/tests/hud-glass-chrome.cjs): integração do novo cenário e exposição do registry somente na cópia temporária de teste.
- [global-hud-view.test.cjs](/home/Alee/Dev/FalaMermo-glass/tests/global-hud-view.test.cjs): classificação dos tipos restrita ao HUD.
- [hud-popup.test.cjs](/home/Alee/Dev/FalaMermo-glass/tests/hud-popup.test.cjs): borda/brilho proporcionais ao slider interno, sem alteração do alpha estrutural.
- [gui-layout-contract.test.cjs](/home/Alee/Dev/FalaMermo-glass/tests/gui-layout-contract.test.cjs): lista ajustada ao conteúdo.
- [hud-windows-chrome.cjs](/home/Alee/Dev/FalaMermo-glass/tests/hud-windows-chrome.cjs), [hud-transparency-chrome.cjs](/home/Alee/Dev/FalaMermo-glass/tests/hud-transparency-chrome.cjs): expectativa de filtros removidos.
- [verify-publication.cjs](/home/Alee/Dev/FalaMermo-glass/tools/verify-publication.cjs): inclusão do novo cenário.

## VERIFICADO

| Execução desta rodada | Resultado |
|---|---|
| Node: HUD, registry, automação, contratos, isolamento, PWA, TTS e publicação | **161 aprovados**, zero falhas/skips/cancelamentos na execução final. `/tmp/falamermo-refinamentos-node-final.tap`. |
| `FALAMERMO_REFINEMENTS=1 node tests/hud-glass-chrome.cjs` | Espaçamento medido após expansão/recolhimento e resize; cores, máscara, espessura, durações e giro real; clique de expandir/recolher através da decoração; slider interno suavizando borda e brilho; ausência de filtros; movimento reduzido; alpha estrutural constante. `/tmp/falamermo-refinamentos-chrome-final.log`. |
| Homologação automatizada Chrome | **20 grupos aprovados**, incluindo controles, Opções na barra, viewports pequenas, arraste, waveform, pânico e persistência. `/tmp/falamermo-refinamentos-layout.log`. |
| Chrome nativo: três abas em duas janelas de teste | **12 grupos aprovados**: apresentação local, dimensões globais persistentes, reload/reinício, resize e dois sliders independentes. `/tmp/falamermo-refinamentos-janelas.log`. |
| PCM/AudioWorklet real no Chrome | Silêncio, reprodução, pause/resume, seek com ACK, volumes, velocidade, recolhimento/minimização e pânico aprovados. Provedor simulado. `/tmp/falamermo-refinamentos-audio.log`. |
| Verificador e diff | 137 arquivos, 99 JavaScript, 108 referências, manifest 1.0.8; sem erro de sintaxe/diff ou achado do verificador. `/tmp/falamermo-refinamentos-publicacao.log`; `git diff --check` aprovado. |

Comparação visual inspecionada sobre texto diretamente atrás dos cartões, mantendo o mesmo fundo estrutural nos dois extremos:

- [Elementos em transparência 0](/tmp/falamermo-hud-glass-reJ235/refinamentos-alpha-0.png)
- [Elementos em transparência 100](/tmp/falamermo-hud-glass-reJ235/refinamentos-alpha-100.png)
- [CSS computado dos extremos](/tmp/falamermo-hud-glass-reJ235/refinamentos-computado.json)

Verificado por hash/diff: background, registry, Popup, Opções, offscreen, Worklet e a função de transparência estrutural permanecem idênticos ao início desta rodada. Não houve alteração de motores STT/TTS.

## NÃO VERIFICADO

Homologação humana no perfil pessoal, captura física de microfone, Lens/Gemini reais e execução integral da auditoria A1–A9. O cenário de tipos utiliza fixtures apenas na cópia de teste, executando o renderer e o registry reais no Chrome MV3. Chrome 157.0.8103.78, perfis isolados; teste com janelas nativas sob Xvfb.

Relatório local ignorado pela regra preexistente `docs/*`, sem alteração dessa regra.
