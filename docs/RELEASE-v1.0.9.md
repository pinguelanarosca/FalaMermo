# FalaMermo v1.0.9

O HUD Glass reúne os refinamentos de apresentação, controles e tarefas flutuantes desenvolvidos na branch design/glass-visualstttts.

## Novidades

- Barra vertical compacta e painel Glass com arraste elástico estável, redimensionamento e rolagem.
- Cartões independentes e expansíveis, indicadores compactos acessíveis e telemetria Silero/TEN nos detalhes da tarefa.
- Bordas luminosas por tipo de tarefa: narração azul, ditado verde e Lens laranja. Animação somente durante execução, com movimento reduzido respeitado; a barra compacta resume a execução mais recente.
- Transparências independentes do fundo estrutural e dos elementos internos, com blur fixo, atualização imediata e preferências persistentes.
- Tamanho global persistente e sincronizado entre abas/janelas; posição, visibilidade e minimização permanecem locais.
- Waveform dentro da tarefa expandida, ligada à captura/reprodução e ao sinal real; silenciosa/inativa permanece estática.
- Novas tarefas abrem compactas, preservando expansão manual. Cliques no HUD cancelam fechamento automático; foco isolado não altera a escolha.
- Aviso de microfone ocupado por pelo menos oito segundos, com título real da aba quando acessível e opção de dispensar.
- ↗ abre a tarefa numa janela flutuante dentro da aba, com edição, cópia, narração, controles, arraste e redimensionamento. Fechar a janela não interrompe a tarefa.
- Pânico global preservado; Opções acessíveis na barra, inclusive recolhida. Agente ativo segue disponível no Popup/Opções.

A preparação desta release atualiza versão, referências, notas e regressões de publicação. Não inicia novas reformulações de Popup/Opções nem altera motores STT/TTS. Os skins já existentes na branch são preservados.

## Verificações

- Suíte completa antes do merge: `node --test --test-concurrency=1 tests/*.test.cjs`: **764 testes, 753 aprovados e 11 falhas**, zero cancelados/skips. Os nomes das 11 falhas coincidem exatamente com a auditoria de consolidação; envolvem expectativas de modelos legados cuja elegibilidade no catálogo local terminou em 17/11/2026.
- Conjunto focado de HUD, registry, automação, áudio, PWA, isolamento e publicação antes do merge: **201 aprovados, zero falhas**.
- Chrome **157.0.8103.78**: `FALAMERMO_RAIL_BORDER=1 node tests/hud-glass-chrome.cjs` aprovado, incluindo cores, execução mais recente, estado neutro e movimento reduzido.
- Duas janelas nativas via Xvfb: `FALAMERMO_HEADED=1 xvfb-run -a node tests/hud-windows-chrome.cjs` aprovado, incluindo apresentação local, Popup vinculado, sliders, tamanho global, reload e reinício real do Chrome.
- Após atualizar para 1.0.9: três testes de publicação aprovados; `node tools/verify-publication.cjs` aprovado com **145 arquivos, 106 JavaScript, 108 referências**, manifest **1.0.9** e zero achados dos padrões de segredo. `git diff --check` aprovado.
- O empacotador verifica recursos, sintaxe, padrões de segredos, lista de entradas, integridade do ZIP, igualdade dos arquivos extraídos e calcula SHA-256. Os artefatos são anexados à release e não entram no Git.

A PR [#1](https://github.com/pinguelanarosca/FalaMermo/pull/1) foi integrada com commit de merge, preservando os cinco commits da branch. O merge é `8a77700d807f599234abe918c586a7c8a89083e5`. A atualização de versão é um commit separado na main. A auditoria detalhada anterior está em [HUD-CONSOLIDACAO-2026-11-19.md](https://github.com/pinguelanarosca/FalaMermo/blob/40d7c7334ea83187cfc5931609ba7d4962141ae0/docs/HUD-CONSOLIDACAO-2026-11-19.md).

## Limitações

Os testes Chrome usam perfis descartáveis e, quando necessário, Xvfb, mídia virtual e respostas de provedor simuladas. Não substituem homologação humana, microfone físico ou Gemini externo. As falhas preexistentes explicitadas acima não foram ocultadas nem contornadas alterando o catálogo de modelos.

## Instalação

Baixe e extraia `FalaMermo-v1.0.9.zip` e carregue a pasta em `chrome://extensions`, no modo de desenvolvedor. Para atualizar uma instalação existente, preserve a pasta e o armazenamento, recarregue a extensão e atualize as páginas abertas. Confira a integridade com `FalaMermo-v1.0.9.zip.sha256`.
