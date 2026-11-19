# HUD Glass — refinamento pontual

19/11/2026 · `/home/Alee/Dev/FalaMermo-glass`

**EXECUTADO:** waveform sem fundo, borda, sombra ou filtro decorativo. Cores e animações operacionais mantidas. Cartões passaram de alpha 0,86/0,90 para 0,76/0,80; superfícies de controles/indicadores foram suavizadas em aproximadamente dez pontos percentuais. Nenhum blur foi aumentado. Fundo estrutural e lógica do slider não foram alterados.

**EXECUTADO:** transportes do HUD com glifos monocromáticos, altura de 30 px, alinhamento, material e feedback uniformes. Na barra minimizada, os mesmos três elementos são reutilizados em 32 × 30 px. A diferenciação de disponibilidade e a confirmação dos comandos continuam reais. O texto genérico abaixo do player foi retirado da apresentação do HUD; a limitação PCM permanece em descrição acessível e os motivos de indisponibilidade continuam nos títulos dos botões. Avisos operacionais não foram removidos. Alterações do renderer são condicionadas ao HUD (`embedded`); demais superfícies mantêm seus glifos e apresentação anteriores.

**VERIFICADO, sem alteração dessa lógica:** o disclosure “Captação” já era criado fechado, sem expansão automática no código local. Foram acrescentadas regressões para padrão recolhido, início do ditado, atualizações, clique explícito, recolhimento manual, ocultação/reexibição da telemetria e encerramento. A escolha manual e os detalhes Silero/TEN/confirmação/recuperações foram preservados. A expansão automática de cartões de novas tarefas não foi confundida com esse disclosure nem alterada no registry.

## Resultados desta execução

| Teste | Resultado |
|---|---|
| Node: HUD, renderer, registry, automação, contratos CSS, PWA, TTS, isolamento de abas e publicação | **VERIFICADO:** 149 aprovados, zero falhas/skips/cancelamentos na execução final. Log: `/tmp/falamermo-refino-node.tap`. A expectativa dos ícones no HUD foi atualizada; outras superfícies continuam com as expectativas anteriores. |
| `FALAMERMO_HOMOLOGATION=1 node tests/hud-glass-chrome.cjs` | **VERIFICADO:** 19 grupos aprovados, incluindo waveform sem decoração, captura recolhida, escolhas manuais, arraste sem deriva, foco, persistência, pânico, viewports pequenas e telemetria. Log: `/tmp/falamermo-refino-layout.log`; capturas: `/tmp/falamermo-hud-glass-5gytCd/`. |
| `node tests/translation-hud-chrome.cjs --hud-controls` | **VERIFICADO:** gravação com dispositivo virtual, VAD e AudioWorklet reais, inserção do ditado, encerramento da waveform, abertura explícita da telemetria mantida até depois do encerramento e minimização sem interromper captura. HTTP/WebSocket do provedor simulados. Log: `/tmp/falamermo-refino-ditado.log`; artefatos: `/tmp/falamermo-translation-hud-XZFdjV/`. |
| `FALAMERMO_HUD_AUDIO_ONLY=1 node tests/controls-chrome.cjs` | **VERIFICADO:** reprodução PCM/AudioWorklet, pause/resume, seek individual/global ±5 com ACK, volume, velocidade e pânico. Asserções de altura, largura, cores, fundos e bordas dos três transportes expandidos/minimizados aprovadas. Log: `/tmp/falamermo-refino-audio.log`; artefatos: `/tmp/falamermo-hud-audio-YwnpjB/`. |
| `FALAMERMO_TRANSPARENCY=1 node tests/hud-glass-chrome.cjs` | **VERIFICADO:** extremos do slider em páginas claras, escuras e com texto; blur e materiais funcionais independentes do slider, tarefas e geometria preservadas. Capturas expandidas/minimizadas inspecionadas. Log: `/tmp/falamermo-refino-visual.log`; artefatos: `/tmp/falamermo-hud-glass-J78aWo/`. |
| `FALAMERMO_HEADED=1 xvfb-run -a node tests/hud-windows-chrome.cjs` | **VERIFICADO:** seis grupos em duas janelas nativas; comandos por origem, foco/fechamento, persistência e reinício do Chrome. Log: `/tmp/falamermo-refino-janelas.log`; artefatos: `/tmp/falamermo-hud-windows-CyuAoR/`. |
| `node tools/verify-publication.cjs` e `git diff --check` | **VERIFICADO:** 134 arquivos, 96 JavaScript, 108 referências; manifest 1.0.8; nenhuma falha de sintaxe/diff ou achado do verificador. |

**VERIFICADO por SHA-256:** background, registry de tarefas, Popup, Opções, offscreen e cliente VAD permanecem idênticos ao início desta rodada. O CSS empacotado corresponde a `content.css`. Sem refatoração de STT/TTS. Os testes cobrem os contratos A1–A9 pertinentes à alteração, sem equivaler a uma nova homologação completa de toda a auditoria.

## Evidências visuais

- [HUD expandido](/tmp/falamermo-hud-glass-J78aWo/transparencia-texto-100.png)
- [HUD minimizado](/tmp/falamermo-hud-glass-J78aWo/transparencia-barra-100.png)
- [Reprodução com PCM](/tmp/falamermo-hud-audio-YwnpjB/hud-audio.png)

**NÃO VERIFICADO:** correspondência com a captura mencionada, que não estava anexada à mensagem; homologação humana no perfil pessoal, microfone físico e Gemini real. Chrome real 157.0.8103.78 em perfis isolados; duas janelas nativas executadas sob Xvfb. Não foi executada toda a suíte do repositório.

**EXECUTADO:** nenhum commit, push ou PR. Alterações locais anteriores preservadas. Relatório local ignorado pela regra preexistente `docs/*`, sem alteração dessa regra.
