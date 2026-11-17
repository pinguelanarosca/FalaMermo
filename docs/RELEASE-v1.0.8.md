# FalaMermo v1.0.8

Consolidação das alterações locais desde a v1.0.7, antes do redesign da interface. A preparação desta publicação atualiza versão, documentação e verificações de publicação, sem novas funcionalidades ou refatorações.

## Principais mudanças

- Central de Diagnóstico em aba própria, com coleta limitada em lotes, filtros, exportação sanitizada e correlação das operações de captura, VAD, persistência, transporte, Gemini e reprodução.
- Tradução da seleção para PT-BR seguida de narração pelo comando configurável **Alt+Shift+Y**, preservando o texto original. O menu de contexto mantém somente **Narrar**, diretamente, sem submenu.
- HUD automático com a tarefa recém-iniciada expandida, até quatro cartões visíveis e fechamento após cinco segundos sem atividade. Nova atividade cancela o fechamento; a consulta manual e o histórico são preservados.
- Isolamento da visibilidade do HUD por aba e documento. Abrir ou recarregar uma PWA sem tarefa própria não restaura a visibilidade de outra janela; tarefas globais continuam sincronizadas.
- Correções na confirmação de inserção do ditado, preservação de edições manuais e recuperação de transcrições quando o destino desaparece ou recusa a inserção. Estados finais passam a refletir o resultado da entrega.
- Tratamento de encerramento, cancelamento e invalidação de contexto, com instrumentação sanitizada da origem das exceções e controle de registros repetidos. Sessões sem fala confirmada são diferenciadas de falhas técnicas, mantendo a dupla confirmação Silero + TEN.
- Ajustes na persistência incremental, recuperação e controle de tarefas pendentes, acompanhados de regressões de execução, isolamento entre abas, tradução e PWAs.

## Validação desta publicação

- Suíte Node completa (`node --test tests/*.test.cjs`): **720 testes, 709 aprovados e 11 falhas**, sem cancelamentos ou testes ignorados, em 141,3 s. As 11 falhas exigem os modelos legados `gemini-3.1-flash-live-preview` e/ou `gemini-2.5-flash-native-audio-preview-12-2025`, cuja elegibilidade o catálogo existente encerra em **17/11/2026**. O catálogo permanece inalterado; os testes dependentes da data não foram ajustados nesta consolidação.
- Chrome **157.0.8103.78**, PWA instalada em perfil isolado: **cinco cenários aprovados** — abertura sem tarefa, tarefa em outra aba, reabertura após fechamento manual alheio, recarga sem atividade e tarefa própria com controles manuais.
- Chrome headless (`node tests/translation-hud-chrome.cjs --isolation`): processo concluído com código **0**. Confirmados menu direto Narrar, tradução pelo callback do comando, texto original preservado, quatro cartões e histórico, destaque/expansão manual, fechamento em cinco segundos e cancelamento do timer, STT com VAD real e áudio externo preservado nos ciclos de conclusão, cancelamento e interrupção.
- Teclado nativo em Xvfb: processo terminou com código **1**, por timeout esperando o estado “traduzindo”. O acionamento físico de **Alt+Shift+Y** está **NÃO VERIFICADO** nesta publicação; a execução pelo callback do comando passou. A causa do timeout não foi determinada.
- Verificação de publicação e empacotamento executados com validação de versão, sintaxe, recursos, integridade do ZIP extraído e checksum SHA-256. Nenhum segredo encontrado pela varredura dos arquivos destinados ao Git.

## Limitações preservadas

- Testes Chrome usam perfis isolados; os fluxos automatizados de tradução e áudio usam respostas Gemini simuladas e microfone virtual. Não substituem homologação com serviço remoto, microfone físico e todos os editores.
- As 68 exceções históricas sem origem/stack suficientes e a ocorrência histórica de áudio rejeitado sem evidência acústica completa continuam inconclusivas. A nova instrumentação e as regressões não comprovam a causa de cada registro antigo.
- Não há comprovação de eliminação de todos os gargalos STT nem de alterações externas/intermitentes de volume do sistema. Mantêm-se as limitações de contexto destruído, permissões, cotas e disponibilidade dos modelos descritas no README.

## Instalação

Extraia `FalaMermo-v1.0.8.zip` e carregue a pasta em `chrome://extensions`, no modo de desenvolvedor. Para atualizar uma instalação existente, preserve a pasta e o armazenamento, recarregue a extensão e atualize as páginas abertas. O arquivo `.sha256` acompanha o ZIP para conferir sua integridade.
