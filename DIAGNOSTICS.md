# Central nativa de Diagnóstico — implementação e validação

## Uso

Recarregue a extensão local em `chrome://extensions` e abra **Opções → Central de Diagnóstico**. A página `diagnostics.html` abre numa aba independente. O nível inicial é Normal. A configuração de coleta é compartilhada entre os contextos; pausar e limpar alteram somente a visualização. Salvar logs exporta todo o buffer disponível, independentemente dos filtros ou da pausa.

Para reproduzir acúmulo de pacotes, comece em Normal e filtre pela tarefa STT. Observe, nesta ordem, `vad-analysis`, `capture-send`, `persist-send`, `persist-packet`, `block-admission`, `lane-open` e `gemini-send`. `background-message`, `capture-message` e `vad-request` separam tempos de mensageria. Use Forense quando precisar seguir `packetSequence`, `sequence`, `chunkId`, `sessionId` e `copy` individualmente.

## Coleta única e limites

Os emissores existentes `LiveSttDiagnostics` e `LiveTtsDiagnostics` alimentam o mesmo coletor. Seus resumos antigos são projeções sob demanda desse buffer; não há leitura/gravação de resumo STT/TTS por pacote. A chamada existente do logger técnico também alimenta a Central, preservando o histórico legado.

Cada contexto agrega e envia no máximo 128 eventos por lote, aproximadamente a cada 500 ms. Um envio pendente não abre envios paralelos. Falhas conservam um lote limitado para nova tentativa; o receptor elimina duplicatas por origem/sequência. Captura, VAD, persistência, transporte e reprodução não aguardam telemetria. A instrumentação dos workers utiliza os tempos já presentes nas respostas reais, sem acrescentar mensagens de diagnóstico por inferência.

O buffer circular padrão comporta até 4.000 eventos e 4 MiB contabilizados; a interface permite de 256 a 20.000 eventos, respeitando também o limite de bytes. O teto de bytes aceito pela configuração é 8 MiB. A contabilidade usa a representação serializada mais uma reserva por evento, não uma medição exata do heap do V8. Há limites independentes para agregados (128), filas (128) e itens rastreados (8.192 no total, no máximo 2.048 por fila). Descartes e falhas são contabilizados.

Um checkpoint de até 256 eventos / 512 KiB é salvo em `chrome.storage.session` a cada 5 s, fora das transações de áudio. A coleta não escreve no IndexedDB. O checkpoint pode sobreviver à suspensão do service worker; não é arquivo permanente e não sobrevive necessariamente à recarga/desativação da extensão ou ao encerramento do Chrome. A retomada é sinalizada quando um checkpoint é encontrado.

A sanitização ocorre **antes de reter** eventos, agregados, spans ou metadados de fila. Só entram campos técnicos numéricos/booleanos, enums fixos e IDs com formato reconhecido. Áudio, textos, transcrições, prompts, URLs, chaves, tokens, stacks e mensagens externas são excluídos. Mensagens de erro exportadas são fixas, associadas a códigos. Cancelamentos não são classificados como erros.

## Observabilidade implementada

| Caminho | Eventos e métricas |
| --- | --- |
| Captura STT | Inicialização, microfone, worklet, estado/liberação, bytes/frames/PCM, RMS/pico, criação de pacotes, cortes e sobreposição existentes. |
| Silero + TEN | Confianças, frames, confirmações/rejeições, fila, tempos do worker/ONNX/Silero, transporte da análise, deadlines, fallback e recuperação. `tenAndAgreementMs` corresponde ao intervalo já medido de TEN + concordância temporal, não a uma medição exclusiva da inferência TEN. |
| Persistência STT | `persist-send`: espera/processamento da fila serial; `persist-packet`: tempo total de `RecoveryStore.append`, incluindo commit ou arquivamento excepcional. Bytes, bloco e sequência do pacote sem PCM. |
| Transporte/Gemini | Espera por vaga de bloco, admissão de contas, abertura das réplicas, envio/retirada de PCM do buffer, estado e buffer do socket, setup, respostas/finais, retomadas, erros e finalização. |
| Editor | Despacho, revisão, aplicação/ACK e motivos de falha já emitidos; contagens de caracteres/quebras de linha e snapshots técnicos, sem conteúdo. |
| TTS | Ciclo do socket/setup/turno, primeiro PCM, recebimento por bloco, fila do player, entrega ao worklet, consumo, reprodução, pausa, retomada, término e erros. |
| Chrome | Tempo no receptor background por tipo/operação; ida/volta content→background e background→offscreen/VAD; fila de eventos offscreen→background e falhas de entrega. |
| Sistema | Fila serial de tarefas globais, transições de estado, cancelamentos/recuperações existentes, `error`, `unhandledrejection`, fim de página e remoção de abas associadas a emissores observados. Lens aparece nas operações/mensagens e falhas do logger técnico compartilhado. |

A atualização da tabela reaproveita as linhas existentes e acrescenta/remove apenas as necessárias, mantendo até 500 no DOM.

Filas instrumentadas: `capture-send`, `vad-analysis`, `persist-send`, `block-admission`, `stt-admission`, `gemini-send`, `tts-player`, `offscreen-events` e `global-tasks`. São registrados tamanho, espera/in-flight, pico, vazão de conclusões, espera média dos itens iniciados no intervalo, duração média dos concluídos, idade do mais antigo, idade do mais antigo aguardando, falhas e cancelamentos. Contadores de cancelamento/falha são separados de conclusões bem-sucedidas. A fila `global-tasks` é global; não recebe uma tarefa inventada.

O JSON preserva `at`, `receivedAt`, `monotonicMs`, `sourceId`, `sourceSeq`, sequência no coletor e correlações reais. A ordem global é de recebimento; durações usam relógio monotônico local. Em Normal, eventos frequentes são agregados e campos de pacote/confiança representam a última amostra do intervalo, com contagem e duração média/máxima. Forense registra detalhes individuais, sujeitos ao buffer circular. Não se atribui uma palavra Gemini a um pacote: respostas de sessões contínuas podem abranger vários pacotes; a correlação utiliza apenas IDs efetivamente disponíveis no protocolo/pipeline.

## Validação executada

- Suíte Node completa: **687/687**, zero falhas. A primeira execução encontrou uma asserção que exigia `tts-config.js` como primeiro import; essa ordem foi preservada, o teste direcionado passou e a suíte completa foi repetida com sucesso.
- Testes específicos da Central: **20/20**, incluindo sanitização antes da retenção, ordenação, limites, filtros/pausa/exportação, falhas do coletor/transporte, reinjeção idempotente, recuperação da coleta após alternar o nível e integridade do PCM. Também verificam rotação/retomada de filas ociosas, correlação Lens→TTS, separação entre tempo decorrido e duração medida, os tempos reais do host VAD, a métrica de oito blocos ativos + nono esperando e a validação de identidade inválida com telemetria ativa.
- Chrome **157.0.8103.38**, extensão real carregada: link, página própria, fluxo entre contextos, filtros, pausa, limpeza somente visual, download JSON, coleta com página fechada, checkpoint, descarte de duplicatas, validação de origem e `unhandledrejection` sanitizada. Inspeção visual da página realizada por captura de tela.
- Captura com **microfone virtual do Chrome**, AudioWorklet/resampler de produção e Silero/TEN WASM reais: **39 pacotes capturados / 39 consumidos**, 124.800 bytes, zero falhas. Não é teste de microfone físico nem de Gemini.
- Recorte nativo de controles no Chrome (`FALAMERMO_PANIC_ONLY=1`): Parar tudo em HUD/popup, captura/processamento STT, agente, estados TTS/PCM, histórico e novas operações; processo terminou com código 0.
- Verificação de recursos/sintaxe/segredos do projeto e `git diff --check` executados; saída final em `/tmp/falamermo-diagnostics-verification.json`.

Comandos de validação disponíveis:

```sh
node --test tests/diagnostics.test.cjs
node --test tests/*.test.cjs
node tests/diagnostics-chrome.cjs --ui-only
node tests/diagnostics-chrome.cjs --long
node tests/diagnostics-chrome.cjs --view-performance
FALAMERMO_PANIC_ONLY=1 node tests/controls-chrome.cjs
node tools/verify-publication.cjs
git diff --check
```

## Desempenho medido

Ensaio isolado no V8 do Chrome: 18.000 operações de fila + span de persistência, cinco rodadas por modo; tabela com mediana. Inclui sanitização antes da retenção e descarte circular. Não inclui áudio/modelos/rede e não estima sozinho o custo do pipeline inteiro.

| Modo | Mediana total (ms) | Custo adicional por pacote vs. Desativado (µs) |
| --- | ---: | ---: |
| Desativado | 2.30 | 0.00 |
| Normal | 41.60 | 2.18 |
| Forense | 114.70 | 6.24 |

Com a Central fechada, replay acelerado no código real `CapturePipeline → AudioQueue → DistributedDictation → RecoveryStore/IndexedDB`: 18.000 pacotes / 30 min representados / 57.600.000 bytes por modo. Entrada nominal a cada 3 ms (sujeita ao agendador do Chrome), uma réplica e respostas remotas controladas, sem Gemini. Uma rodada por modo, sem inferir significância estatística das diferenças de persistência.

| Modo | Persistência média (ms) | p95 (ms) | Pacotes/s | Pico pendente | Drenagem final (ms) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Desativado | 0.972 | 1.300 | 241.01 | 18 | 0.200 |
| Normal | 1.046 | 1.300 | 238.97 | 29 | 0.100 |
| Forense | 1.059 | 1.400 | 237.26 | 18 | 0.100 |

Todos os modos: fila final **0**, zero `BACKPRESSURE`, `ACK_TIMEOUT` e `CHUNK_TIMEOUT`, hashes iguais entre entrada/áudio novo enviado/persistido; 150 sessões controladas abertas e encerradas. Os 953.600 bytes adicionais no transporte são contexto de sobreposição conhecido. Drenagem de 0,000 ms significa abaixo da resolução observada, não tempo físico literalmente nulo. O replay mede o caminho local posterior ao VAD; não representa 30 minutos de captura física com Gemini. Diferenças pequenas de vazão/IDB incluem variabilidade de agendamento e armazenamento; o custo isolado acima separa a instrumentação.

No produtor offscreen do replay Forense, foram descartados **86.204 eventos diagnósticos**, com **3.744 retidos / 3.361.052 bytes contabilizados** ao final: a entrada acelerada excede o orçamento de transporte em lotes. Isso não descartou PCM. `telemetry` no JSON mede esse buffer produtor, não o heap inteiro nem o buffer central. O teste demonstra o limite e a sinalização da perda; não demonstra rastreamento Forense integral sob essa sobrecarga.

Medição adicional da página real, com **500 linhas no DOM**, contadores CDP do renderer:

| Atualização | Script (ms) | Layout (ms) | Tarefas (ms) |
| --- | ---: | ---: | ---: |
| Carga de 600 eventos em lotes | 2,155 | 37,170 | 128,998 |
| Acréscimo de 50 eventos | 0,139 | 5,002 | 20,887 |

As linhas anteriores foram reutilizadas, confirmado por identidade dos nós DOM. Esses totais são das janelas de observação e incluem polling/callbacks; não são duração exclusiva de uma chamada de renderização nem medição de captura acústica simultânea.

## Arquivos desta implementação

Criados: `diagnostics-runtime.js`, `diagnostics-background.js`, `diagnostics.html`, `diagnostics.css`, `diagnostics.js`, `tests/diagnostics.test.cjs`, `tests/diagnostics-chrome.cjs` e `DIAGNOSTICS.md`.

Modificados: `background.js`, `content.js`, `dictation-runtime.js`, `global-jobs.js`, `live-stt-diagnostics.js`, `live-tts-diagnostics.js`, `manifest.json`, `offscreen.html`, `offscreen.js`, `options.html`, `options.js`, `popup.html`, `task.html`, `lens-permission.html`, `stt-realtime.js`, `stt-scheduler.js`, `stt-vad-client.js`, `tests/load-background.cjs`, `tools/verify-publication.cjs` e `README.md`.

Preservados os ajustes locais anteriores de desempenho em `stt-realtime.js`/`live-stt-diagnostics.js`, os testes de recuperação/performance e o arquivamento existente. Não foram alterados algoritmos, limiares, limites, timeouts ou regras de segmentação STT/TTS/VAD, seleção de chaves ou HUD. Sem commit, push ou publicação.

## Evidências e limites reais

Saídas locais:

- `/tmp/falamermo-diagnostics-final-suite.log`: 687 testes da suíte completa.
- `/tmp/falamermo-diagnostics-unit-final-20.log`: 20 testes específicos.
- `/tmp/falamermo-diagnostics-x2Yh6c/performance.json`: séries de CPU, hashes, métricas e amostras das filas dos três modos, captura virtual e versão do Chrome.
- `/tmp/falamermo-diagnostics-final-performance.log`: saída bruta desse comparativo.
- `/tmp/falamermo-diagnostics-view-performance.log`: validação final da página, exportação e caminho da captura visual.
- `/tmp/falamermo-diagnostics-ITsEPj/view-performance.json`: contadores de custo da página.
- `/tmp/falamermo-diagnostics-ITsEPj/central.png`: captura visual da Central.
- `/tmp/falamermo-diagnostics-controls.log`: recorte nativo Parar tudo.
- `/tmp/falamermo-diagnostics-verification.json`: verificação do projeto.

**NÃO VERIFICADO:** suspensão/retomada real do service worker (foi verificada a escrita/leitura do checkpoint); sessão longa com microfone físico e Gemini Live autenticado; não foram solicitadas nem usadas chaves pessoais. O provedor foi controlado apenas nos testes locais de transporte; nenhuma medição foi anunciada como latência Gemini.

Limites: buffers podem descartar eventos, especialmente em replay acelerado Forense; há contadores e eventos de perda. A interface mostra até 500 linhas filtradas; o JSON exporta o buffer completo disponível. O Chrome pode atrasar timers/IPC de abas ocultas. Fechamento abrupto pode perder o último lote e eventos posteriores ao último checkpoint. A remoção de abas é detectada quando o emissor já foi observado; não se recuperam eventos de contextos destruídos e não se promete identificar encerramentos invisíveis. Nem toda subetapa interna de Lens/worker/worklet tem um span próprio: worker usa os tempos existentes, player usa ACK/drain existentes, Lens usa mensagens e operações compartilhadas. A Central não determina o conteúdo acústico nem reproduz as transcrições fantasmas, pois não armazena áudio ou texto.
