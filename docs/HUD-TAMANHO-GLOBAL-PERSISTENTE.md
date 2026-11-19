# HUD — tamanho global persistente

19/11/2026 · `/home/Alee/Dev/FalaMermo-glass`

## EXECUTADO

- Dimensões em uma única preferência global, `chrome.storage.local.hudSize`, com largura e altura. Os HUDs existentes recebem alterações por `storage.onChanged`, inclusive durante o arraste da alça; escritas de prévia são agrupadas por frame.
- Separadas a dimensão preferida e a dimensão renderizada. Viewports pequenas limitam apenas o CSS; não substituem o valor salvo. Ao ampliar novamente a viewport, o HUD recupera o tamanho preferido.
- Posição, visibilidade, minimização e intervenção manual continuam locais à aba. Receber uma dimensão global não envia comandos de mostrar, ocultar ou minimizar.
- Migração dos tamanhos legados antes da recuperação do registry. Preferência global válida existente tem prioridade; caso contrário, usa o tamanho válido da aba ativa ou, na ausência, o da aba com maior ID entre os candidatos. Remove somente `size` dos registros antigos, preservando os demais campos. Se a gravação falha, o legado permanece para nova tentativa.
- O registry deixa de armazenar/restaurar dimensões em `tabHud`. A confirmação de resize continua usando o canal existente, mas grava a dimensão em armazenamento local global.
- Leituras de tamanho e transparências têm proteção independente contra eventos mais novos durante a inicialização.
- **Nenhum commit, push ou PR.** Alterações locais anteriores preservadas.

Arquivos de produção alterados:

- [content.js](/home/Alee/Dev/FalaMermo-glass/content.js): preferência global, atualização dos HUDs e limitação apenas visual.
- [background.js](/home/Alee/Dev/FalaMermo-glass/background.js): migração e persistência global pelo comando existente.
- [global-jobs.js](/home/Alee/Dev/FalaMermo-glass/global-jobs.js): remoção do tamanho da apresentação por aba.

Regressões alteradas:

- [global-jobs.test.cjs](/home/Alee/Dev/FalaMermo-glass/tests/global-jobs.test.cjs): migração, prioridade global, preservação de estados e falha de gravação sem perda do legado.
- [hud-adjustments.test.cjs](/home/Alee/Dev/FalaMermo-glass/tests/hud-adjustments.test.cjs): registry sem dimensão local.
- [hud-homologation.test.cjs](/home/Alee/Dev/FalaMermo-glass/tests/hud-homologation.test.cjs): viewport pequena preserva a dimensão preferida.
- [hud-adjustments-chrome.cjs](/home/Alee/Dev/FalaMermo-glass/tests/hud-adjustments-chrome.cjs): sincronização durante arraste, posições locais, viewport, fechar/reabrir e reload.
- [hud-windows-chrome.cjs](/home/Alee/Dev/FalaMermo-glass/tests/hud-windows-chrome.cjs): restauração após reinício real do Chrome.

## VERIFICADO

| Execução atual | Resultado |
|---|---|
| Node: HUD, registry, automação, contratos, isolamento, PWA, TTS e publicação | **159 testes aprovados**, zero falhas/skips/cancelamentos na execução final. `/tmp/falamermo-global-size-node-final.tap`. |
| Chrome MV3, duas abas em uma janela e uma aba em outra janela | **12 grupos aprovados**: resize com ponteiro/teclado, sincronização durante o arraste, dimensões iguais onde há espaço, âncoras locais, minimizar/restaurar, fechar/reabrir, reload, viewport pequena sem alterar o armazenamento, recuperação em viewport maior e reinício do processo Chrome. Inclui controles locais e transparências. `/tmp/falamermo-global-size-chrome-final.log`; artefatos `/tmp/falamermo-hud-windows-rNt7KH/`. |
| Homologação automatizada do HUD no Chrome | **19 grupos aprovados**, incluindo arraste, animações, movimento reduzido, viewports pequenas, controles, pânico, persistência manual e telemetria. `/tmp/falamermo-global-size-layout.log`; artefatos `/tmp/falamermo-hud-glass-HETHkE/`. |
| Verificador e diff | 136 arquivos, 98 JavaScript, 108 referências, manifest 1.0.8; sem erro de sintaxe/diff ou achado do verificador. `/tmp/falamermo-global-size-publicacao.log`; `git diff --check` aprovado. |

O cenário inicial de reinício comparava dimensões por serialização JSON; foi corrigido para comparar os dois valores, independentemente da ordem das propriedades retornadas pelo armazenamento. A execução final passou integralmente.

**Verificado por hash:** CSS, renderer compartilhado, Popup, Opções, offscreen e Worklet permanecem idênticos ao início desta rodada. Não houve alteração de STT/TTS, transparências ou animações. Chrome usado: 157.0.8103.78 em perfil isolado; janelas nativas sob Xvfb.

## NÃO VERIFICADO

Homologação humana no perfil pessoal e nova execução de ciclos completos de mídia nesta rodada. Os testes de Chrome que exercitam captura usam metadados simulados; não equivalem a microfone físico ou Gemini real. Não foi reexecutada toda a suíte do repositório nem uma nova homologação humana integral da auditoria A1–A9.

Relatório local ignorado pela regra preexistente `docs/*`, sem alteração dessa regra.
