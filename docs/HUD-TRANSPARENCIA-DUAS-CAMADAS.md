# HUD Glass — transparência em duas camadas

19/11/2026 · `/home/Alee/Dev/FalaMermo-glass`

## Causa confirmada no Chrome

**VERIFICADO:** o CSS computado anterior mantinha `backdrop-filter: blur(28px) saturate(1.5)` no painel e na barra, inclusive com transparência em 100%. Nesse extremo, os gradientes estruturais ainda tinham alphas de 0,20–0,28 no painel e 0,18–0,24 na barra. Os cartões ficavam progressivamente mais transparentes, enquanto o desfoque amplo continuava impedindo reconhecer a página.

Foram inspecionados `background`, gradientes, `opacity`, `backdrop-filter`, sombras e os pseudoelementos `::before`/`::after` no Chrome. Evidência anterior: `/tmp/falamermo-hud-glass-895sCY/camadas-computadas.json` e capturas no mesmo diretório.

## Alteração executada

**EXECUTADO:** painel e barra receberam uma camada decorativa `.ext-hud-glass`, sem interação ou participação no layout. Ela fica atrás do conteúdo funcional. O filtro não é mais aplicado ao ancestral de todos os controles, permitindo que as superfícies funcionais tenham proteção local independente.

| Propriedade | Resultado |
|---|---|
| Slider atual do Popup | Continua único; armazenamento, persistência e mensagens existentes foram preservados. |
| Opacidade estrutural | Slider 0: alpha 0,97. Slider 100: painel 0,025 e barra 0,035. Padrão continua em 50, com alphas 0,49/0,44. |
| Desfoque estrutural | **Fixo em 1 px**, independente do slider. |
| Fundo estrutural | Cor translúcida simples; gradientes estruturais removidos e sombras externas reduzidas. Bordas e reflexos mantidos. |
| Conteúdo funcional | Cartões com alpha próprio 0,86/0,90; controles, telemetria, player e indicadores com superfícies próprias, sem alteração pelo slider. Desfoque local fixo de 4/6 px, conforme a superfície. |
| Opacidade do contêiner | Continua 1 quando visível. Não foi usada para controlar transparência. |
| Layout e operações | Posição, tamanhos, arraste, cartões, tarefas e comandos existentes preservados. |

**VERIFICADO por SHA-256:** `popup.html`, `popup.js`, `options.html`, `options.js`, `background.js`, `global-jobs.js`, `global-hud.js`, `offscreen.js` e `stt-vad-client.js` permanecem idênticos ao início desta rodada. Não houve alteração de Opções, STT/TTS ou lógica de tarefas. As alterações locais anteriores foram preservadas.

## Validação executada nesta rodada

| Execução | Resultado |
|---|---|
| `FALAMERMO_TRANSPARENCY=1 node tests/hud-glass-chrome.cjs` | **VERIFICADO:** fundos claro, escuro e com texto, nos extremos 0/100; CSS computado confirma blur fixo, fundo altamente translúcido, ausência de gradiente estrutural e materiais funcionais invariáveis. Layout e tarefas inalterados; raio e barra minimizada preservados. |
| Comparação das capturas | **VERIFICADO por inspeção das imagens:** a página é reconhecível nas áreas estruturais em 100%; cartões, controles, indicadores e telemetria continuam legíveis. Comparação local abaixo. |
| Node: `hud-popup`, `hud-homologation`, `global-jobs`, `global-hud-view`, `hud-automation`, `gui-layout-contract`, `pwa-hud`, `tts-hud`, `tab-isolation`, `publication-version` | **VERIFICADO:** 149 testes aprovados, zero falhas/skips/cancelamentos na execução final. Inclui igualdade entre `content.css` e CSS empacotado em `content.js`. Log: `/tmp/falamermo-camadas-node.tap`. |
| `FALAMERMO_HOMOLOGATION=1 node tests/hud-glass-chrome.cjs` | **VERIFICADO:** 18 grupos aprovados: arraste, contenção, teclado, movimento reduzido, viewports pequenas, mini transportes, pânico, cartões, janela dedicada, persistência manual, waveform e telemetria. Log: `/tmp/falamermo-camadas-homologacao.log`; artefatos: `/tmp/falamermo-hud-glass-4IdZV0`. |
| `FALAMERMO_HEADED=1 xvfb-run -a node tests/hud-windows-chrome.cjs` | **VERIFICADO:** seis grupos aprovados em duas janelas Chrome nativas; slider global com blur/cartões invariáveis, apresentação independente, foco/fechamento e persistência após reiniciar Chrome. Log: `/tmp/falamermo-camadas-janelas.log`; artefatos: `/tmp/falamermo-hud-windows-6awFIP`. |
| `node tools/verify-publication.cjs` e `git diff --check` | **VERIFICADO:** 134 arquivos, 96 JavaScript, 108 referências; manifest 1.0.8; nenhum erro de sintaxe/diff ou achado do verificador. |

O teste de arraste substituiu a espera fixa de 900 ms pela observação do término da acomodação; continua verificando a posição da barra. A verificação de cor após reiniciar o Chrome passou a aceitar a ausência inicial de cartões. Essas duas correções são do harness; nenhuma lógica de movimento ou de tarefas foi alterada.

O novo cenário visual usa extensão MV3 real, comandos reais de tarefas manuais e o slider existente. Os valores de telemetria são fixtures somente na cópia temporária de teste. O runtime de produção não recebeu dados demonstrativos.

[Comparação dos extremos em três fundos](/home/Alee/Dev/FalaMermo-glass/docs/HUD-TRANSPARENCIA-COMPARACAO.png)

Capturas completas e CSS computado final: `/tmp/falamermo-hud-glass-rYoyWw/`. Log: `/tmp/falamermo-camadas-depois.log`. Chrome: 157.0.8103.78.

## Limites

**NÃO VERIFICADO:** homologação humana no perfil pessoal, outras escalas/monitores e novas execuções com microfone físico ou Gemini real. Os cenários foram automatizados em perfis isolados; a comparação visual foi feita pelas capturas, e o teste com janelas nativas usou Xvfb. Não foi executada novamente toda a suíte de mídia ou todo o repositório.

**EXECUTADO:** nenhum commit, push ou PR. Relatório e comparação são locais, ignorados pela regra `docs/*` já existente; a regra não foi alterada.
