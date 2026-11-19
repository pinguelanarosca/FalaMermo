# Consolidação local do FalaMermo Glass HUD

Data: 19/11/2026. Branch: `design/glass-visualstttts`.
Base auditada: `4ad0b644259379518fc47fe9139e213e1a369f16`.

Este relatório registra a execução da auditoria de consolidação. Os demais relatórios `HUD-*.md` são registros históricos das respectivas rodadas: seus números de testes, localizações anteriores de controles e pendências não substituem os resultados atuais abaixo. A imagem comparativa é evidência histórica de material/transparência, não uma captura da versão final.

## Inventário e comparação com a base

- Inventário inicial: 18 arquivos rastreados modificados, 17 scripts/testes novos e 11 arquivos ignorados em `docs/` (dez relatórios e uma imagem). Não havia commits intermediários após a base.
- Inspecionados os arquivos rastreados, novos e ignorados. Inclusão explícita dos relatórios pertinentes, sem liberar indiscriminadamente `docs/*` no `.gitignore`.
- Arquivos de execução consolidados: `background.js`, `content.css`, `content.js`, `global-hud.js`, `global-jobs.js`, `offscreen.js`, `pcm-player-worklet.js`, `popup.html` e `popup.js`.
- Manifest preservado em **1.0.8**, com permissões e recursos inalterados. `options.html`, `options.js`, `task.html`, `task.js`, `live-config.js` e os componentes VAD permanecem idênticos à base. Não foi iniciado redesign de Opções ou nova etapa de migração.
- Nenhum arquivo modificado/novo/ignorado intencional permanece excluído. Credenciais, perfis, logs, caches e capturas temporárias desta auditoria ficaram fora do repositório, sob `/tmp/`. Nenhum pacote ZIP ou release foi criado.

## Alterações acumuladas incluídas

| Área | Resultado consolidado e limites |
|---|---|
| HUD Glass | Barra vertical independente, painel elástico, cartões compactos expansíveis, transporte uniforme, indicadores acessíveis em linha, origem e telemetria em detalhes. Removidos seletor de agente e cabeçalho redundante; Opções acima de ocultar na barra. Seleção ativa de agente preservada. |
| Bordas | Contorno mascarado de 2 px, azul/verde/laranja, reflexos brancos discretos, giro de 4 s e pulso de 3 s somente durante execução. Inativos mantêm cor estática; barra compacta reflete execução mais recente ou fica neutra. Movimento reduzido respeitado. |
| Transparências | Preferências globais independentes `hudTransparency` e `hudContentTransparency`; alpha individual dos fundos, sem `opacity` no contêiner. Filtros internos removidos, blur estrutural fixo reduzido, borda/brilho proporcionais ao material funcional. Popup recebeu apenas integrações necessárias ao HUD. |
| Geometria | Arraste estável com acomodação limitada ao painel, contenção pelas superfícies visíveis/viewport, redimensionamento e rolagem. `hudSize` global em `storage.local`, atualização ao vivo, reload e reinício; migração de `tabHud.size` sem apagar outros campos. Janela pequena limita apresentação sem sobrescrever tamanho salvo. |
| Apresentação local | `sender.tab`, documento e janela do Popup vinculam comandos à origem. Visibilidade, posição e minimização por aba; tarefas e dimensões globais. Alternâncias atômicas evitam perda de cliques antes do ACK. |
| Automação e avisos | Novas tarefas abrem compactas, preservando expansão manual. Clique em qualquer superfície cancela fechamento automático daquela apresentação; foco isolado não conta. Conflito real do microfone mostra título obtido por `tabId`, fallback genérico, dispensa e prazo mínimo de 8 s sem reiniciar por atualizações. |
| Waveform e telemetria | Waveform por tarefa expandida; captura ligada à gravação e confirmação real do VAD; narração ligada à reprodução e sinal PCM real. Silero, TEN, dupla confirmação e recuperações preservados em detalhes recolhidos por padrão. |
| Tarefas flutuantes | ↗ abre dentro da aba, com renderer e registry compartilhados, Shadow DOM, arraste por cabeçalho e resize independentes. Edição com conflito, cópia/fallback, narração de cópia STT, histórico/recuperação e controles preservados. Fechar apresentação não interrompe tarefa nem altera HUD. `task.html` continua disponível. |
| Registry/background | Normalização de telemetria e sinal, UI local, preferências globais e recuperação. Permanecem identidade/revisão/ordem de eventos, autoridade de captura/inserção, limites e arquivo de tarefas. |
| Offscreen/Worklet | Estado de sinal de saída propagado para o renderer. Worklet observa amostras sem alterar PCM, ganhos, geração ou playback; regressão valida silêncio → áudio → silêncio e amostras preservadas. |

## Correções encontradas nesta auditoria

1. A lista explícita de publicação omitia três helpers necessários: `hud-border-states-chrome.cjs`, `hud-conflict-chrome.cjs` e `hud-interactions-chrome.cjs`. Inclusão corrigida e regressão adicionada para dependências locais dos testes publicados.
2. Mocks de `chrome.storage.local` em `api-keys-storage` e `flow-performance` aceitavam apenas callbacks, enquanto a migração de tamanho usa também Promises, ambas disponíveis no Chrome real. Mocks corrigidos sem alterar produção.
3. Fixtures do Popup em `flow-performance` e `gemini-payload-contract` não continham os dois sliders/outputs e `setAttribute`. Fixtures e expectativa de leitura das preferências atualizadas. Essas correções eliminaram seis falhas introduzidas pela desatualização dos testes.
4. O roteiro completo `controls-chrome.cjs` ainda continha expectativas de minimização global, abertura expandida, seletores antigos de telemetria e mensagem antiga do microfone. Atualizado para os contratos atuais. A execução completa continua bloqueada antes desses trechos por uma falha do editor também reproduzida na base; os comportamentos de HUD correspondentes foram exercitados pelos cenários focados.
5. Um prompt posterior estava concatenado ao título de alterações no relatório de transparência/Popup. Conteúdo preservado como citação histórica, separado dos resultados executados.

## Testes executados nesta auditoria

Todos os números abaixo são da execução atual, não foram reaproveitados dos relatórios históricos.

| Comando/cenário | Resultado atual |
|---|---|
| `node --test --test-concurrency=1 tests/*.test.cjs` inicial | 763 testes: 746 aprovados, 17 falhas. |
| Mesmo comando após correções dos fixtures e inclusão da regressão de publicação | **764 testes: 753 aprovados, 11 falhas**, zero cancelados/skips. |
| Mesmo comando numa worktree limpa da base `4ad0b64` | **720 testes: 709 aprovados, as mesmas 11 falhas**, pelos mesmos nomes e na mesma ordem. Worktree temporária removida após execução. |
| `api-keys-storage`, `flow-performance`, `gemini-payload-contract`, `publication-version` | 53 testes: 52 aprovados; única falha restante é o caso de modelo legado também presente na base. |
| Conjunto focado: `hud-adjustments`, `hud-popup`, `hud-homologation`, `global-jobs`, `global-hud-view`, `hud-automation`, `gui-layout-contract`, `pwa-hud`, `tts-hud`, `tab-isolation`, `publication-version`, `live-pcm-player`, `pcm-player-worklet-controls` | **201 aprovados**, zero falhas/cancelados/skips. |
| `FALAMERMO_HOMOLOGATION=1 node tests/hud-glass-chrome.cjs` | Aprovado: persistência manual, drag, waveform, telemetria, controles, tarefas flutuantes, Opções na barra e responsividade. |
| `FALAMERMO_REFINEMENTS=1 node tests/hud-glass-chrome.cjs` | Aprovado: espaçamento, recolhimento, resize, padding, alpha sem filtros, três bordas, transições ativas/inativas e movimento reduzido. |
| `FALAMERMO_RAIL_BORDER=1 node tests/hud-glass-chrome.cjs` | Aprovado: resumo da tarefa executando mais recente, verde/azul/laranja/neutro, sem mudar geometria/material/controles. |
| `FALAMERMO_TRANSPARENCY=1 node tests/hud-glass-chrome.cjs` | Aprovado: extremos sobre página clara, escura e texto; blur fixo e independência das camadas. Capturas dos extremos estrutural/funcional inspecionadas nesta auditoria. |
| `FALAMERMO_TASK_DRAG=1 node tests/hud-glass-chrome.cjs` | Aprovado: arraste nativo em quatro direções, cabeçalho, seleção/edição, slider, resize, limites e fechamento sem parar tarefa. |
| `FALAMERMO_HEADED=1 xvfb-run -a node tests/hud-windows-chrome.cjs` | Aprovado em duas janelas nativas e abas distintas: origem local, Popup vinculado, sliders, tamanho global, reload e reinício real do processo Chrome. |
| `FALAMERMO_INTERACTIONS=1 FALAMERMO_HEADED=1 xvfb-run -a node tests/hud-windows-chrome.cjs` | Aprovado: timer real com/sem cliques, foco sem intervenção, três layouts, zoom 80/100/125%, barras de rolagem e arraste estável. |
| `FALAMERMO_HUD_AUDIO_ONLY=1 node tests/controls-chrome.cjs` | Aprovado: PCM/Worklet reais, waveform, seek ±5 com ACK, ganho, velocidade, mini controles, exclusividade, Resume, tarefa flutuante e pânico. |
| `node tests/translation-hud-chrome.cjs --hud-controls --isolation --hud-notices --task-floats` | Aprovado: tradução/narração, abertura compacta/manual, histórico, timer, captura/VAD, waveform encerrada, duas janelas, áudio externo, aviso ≥8 s e tarefa flutuante STT com edição/narração sem alterar original. |
| `node tests/pwa-hud-chrome.cjs` | Aprovado: PWA instalada/aberta/recarregada, tarefas alheias sem revelar HUD, apresentação local e controles manuais. |
| `FALAMERMO_PANIC_ONLY=1 node tests/controls-chrome.cjs` | Aprovado: HUD minimizado e Popup; captura/processamento STT, agente, três estados TTS, PCM, histórico e novas operações. |
| `node tests/controls-chrome.cjs`, atual e base | Ambos falham em `registro da aplicação no editor (revisão 4, eventos undefined)`, após ciclos STT e leitura de configuração. Não declarar o roteiro integral aprovado. |
| `node tools/verify-publication.cjs` | **144 arquivos, 106 JavaScript, 108 referências**, manifest **1.0.8**, zero achados dos padrões de segredo. Sintaxe verificada pelo próprio comando. Não foi gerado pacote. |
| Verificação adicional do conjunto candidato, incluindo relatórios ignorados | 156 arquivos, 106 JavaScript, 108 referências, zero achados dos padrões de segredo; sintaxe aprovada. |
| CSS distribuído e revisão Git | `content.css` idêntico ao módulo raw embutido em `content.js`; `git diff --check` e revisão do diff preparado: aprovados; 51 arquivos exatos, sem alterações adicionais ou arquivos ignorados restantes. |

As 11 falhas reproduzidas na base estão em `gemini-payload-contract.test.cjs`, `live-config.test.cjs`, `live-homologation.test.cjs`, `live-session-protocol.test.cjs`, `stt-live-regression.test.cjs`, `stt-options-routing.test.cjs` e `tts-options.test.cjs`. As expectativas incluem modelos que o catálogo local já exclui por `shutdownDate: 2026-11-17`. A auditoria ocorreu em 19/11/2026. Catálogo e seleção de modelos não foram alterados para mascarar as falhas.

## Cobertura funcional A1–A9 e contratos globais

| Seção | Evidência atual | Limite |
|---|---|---|
| A1 — camadas/contratos | Renderer, registry, CSS/raw, isolamento Shadow DOM e roteamento MV3 nos testes Node/Chrome. | Não constitui uma nova auditoria completa de arquitetura. |
| A2 — HUD/barra | Raio, ocultar, pânico, Opções, mini transportes, arraste/teclado, contenção, transparências e tamanho global. | Seletor removido conforme autorização; agente segue ativo via Popup/Opções. |
| A3 — cartões | Tipos/estados, texto original/cópia, expansão independente, detalhes e tarefas flutuantes simultâneas. | Aparência no perfil pessoal requer homologação humana. |
| A4 — métricas | Pacotes/blocos, zeros, ACK, PCM, ganhos/velocidade, Silero/TEN/dupla confirmação/recuperações em atualização. | Provedores de teste simulados. |
| A5 — ações individuais | Transporte, seek, edição/conflito, copiar/fallback, narrar cópia, fechamento sem Stop, ↗ local e resize/drag. | Roteiro amplo do editor tem bloqueio preexistente explicitado acima. |
| A6 — globais | Controles, tarefa manual, sincronização e pânico, preservando textos/resultados e áudio externo. | Sem provedor Gemini real. |
| A7 — automação/concorrência | Apresentação por aba/janela, cliques atômicos, manual/auto, timer real, foco, reload/restart e PWA. | Janelas nativas sob Xvfb, perfis descartáveis. |
| A8 — avisos/recuperação | Conflito real de microfone entre abas/janelas, título real da aba de teste, prazo ≥8 s/dismiss; erros de edição, stale events, armazenamento/origem/arquivo e pânico nos contratos Node. | Não foram provocadas todas as falhas possíveis de serviços externos/dispositivos físicos. |
| A9 — responsividade/isolamento | Viewports pequenas, conteúdo expandido/recolhido, várias tarefas, scroll, zoom, drag/resize e movimento reduzido. | Escalas/monitores/perfil pessoal não homologados por humano. |
| D — globais | Identidade/documento/eventSeq/revisão, exclusividade e autoridade de captura/inserção, sessão/arquivo, histórico/recuperação e controle PCM exercitados nas suítes atuais. | As 11 falhas de modelos e o bloqueio do roteiro amplo impedem declarar aprovação integral de todos os testes existentes. |

## Evidências e limites

Chrome real **157.0.8103.78**, MV3, perfis temporários. Microfone virtual, VAD/AudioWorklet/PCM reais; respostas HTTP/WebSocket de provedor são fixtures. Testes de bordas usam estados de tarefas controlados no registry do ambiente de teste. A interface de produção não recebeu dados de demonstração.

Logs atuais: `/tmp/falamermo-consolidation-*.log`; inventário, listas de falhas comparadas e revisão do diff: `/tmp/falamermo-hud-consolidation-p1kpkhm5/`. Esses artefatos locais não são dependências nem arquivos publicados.

**NÃO VERIFICADO:** microfone físico, Gemini externo, homologação humana no perfil pessoal, todos os cenários de falhas externas e conclusão do roteiro amplo de controles bloqueado pelo editor preexistente. Os testes simulados não substituem homologação humana.

## Relação completa dos arquivos destinados ao commit

- `background.js`
- `content.css`
- `content.js`
- `docs/HUD-AJUSTES-CAPTURAS-2026-11-19.md`
- `docs/HUD-CONSOLIDACAO-2026-11-19.md`
- `docs/HUD-CORRECOES-ESCOPO-E-ONDAS.md`
- `docs/HUD-HOMOLOGACAO-CORRECOES.md`
- `docs/HUD-MIGRACAO-ETAPA1.md`
- `docs/HUD-POPUP-TRANSPARENCIA-JANELAS.md`
- `docs/HUD-REFINAMENTO-PONTUAL.md`
- `docs/HUD-REFINAMENTOS-ESPACO-ALPHA-BORDAS.md`
- `docs/HUD-TAMANHO-GLOBAL-PERSISTENTE.md`
- `docs/HUD-TRANSPARENCIA-COMPARACAO.png`
- `docs/HUD-TRANSPARENCIA-DUAS-CAMADAS.md`
- `docs/HUD-WAVEFORM-POR-TAREFA.md`
- `global-hud.js`
- `global-jobs.js`
- `offscreen.js`
- `pcm-player-worklet.js`
- `popup.html`
- `popup.js`
- `tests/api-keys-storage.test.cjs`
- `tests/controls-chrome.cjs`
- `tests/flow-performance.test.cjs`
- `tests/gemini-payload-contract.test.cjs`
- `tests/global-hud-view.test.cjs`
- `tests/global-jobs.test.cjs`
- `tests/gui-layout-contract.test.cjs`
- `tests/hud-adjustments-chrome.cjs`
- `tests/hud-adjustments.test.cjs`
- `tests/hud-audio-chrome-cases.cjs`
- `tests/hud-automation.test.cjs`
- `tests/hud-border-states-chrome.cjs`
- `tests/hud-conflict-chrome.cjs`
- `tests/hud-glass-chrome.cjs`
- `tests/hud-homologation-chrome.cjs`
- `tests/hud-homologation.test.cjs`
- `tests/hud-interactions-chrome.cjs`
- `tests/hud-popup.test.cjs`
- `tests/hud-rail-border-chrome.cjs`
- `tests/hud-refinements-chrome.cjs`
- `tests/hud-transparency-chrome.cjs`
- `tests/hud-windows-chrome.cjs`
- `tests/live-pcm-player.test.cjs`
- `tests/publication-version.test.cjs`
- `tests/stt-live-regression.test.cjs`
- `tests/task-float-chrome.cjs`
- `tests/task-float-drag-chrome.cjs`
- `tests/task-float-stt-chrome.cjs`
- `tests/translation-hud-chrome.cjs`
- `tools/verify-publication.cjs`

Nenhuma alteração de versão, release, push ou PR integra esta consolidação. O SHA e o estado final do commit são entregues separadamente após a criação do commit local, evitando referência circular neste arquivo.

A tentativa inicial de commit foi bloqueada porque não havia `user.name`/`user.email` configurados. A identidade para o comando de commit foi obtida do commit-base; será fornecida somente com `git -c`, sem gravar configuração local ou global.
