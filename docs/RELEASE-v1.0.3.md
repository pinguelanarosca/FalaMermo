# FalaMermo v1.0.3 — scheduler STT

Consolidação da implementação STT pendente sobre a v1.0.2 (`9928e94184b305ab05029566cc9de0160f6d15a1`). Entrega de código na branch `main`, sem tag, GitHub Release ou ZIP.

## Versionamento

A versão pública e `manifest.json.version` passam a `1.0.3`. `manifest_version` permanece `3`. O alinhamento de `2.0.2` para `1.0.3` foi autorizado pelo mantenedor, que informa não haver publicação na Chrome Web Store. Não há reset de configurações ou mudança funcional de TTS/STT nesta etapa de consolidação.

## Scheduler STT incluído

- Distribui jobs de ditado independentes entre até nove contas usando somente suas API keys já configuradas, sem login/senha. Cada job mantém afinidade com uma sessão Live, um modelo e uma conta. Todos os seus chunks continuam sequenciais nessa sessão.
- Por padrão: até nove sessões STT, uma por conta, e nove admissões pendentes. Escolha por ocupação, consumo/reserva estimados, número de admissões e uso recente; desempate pela ordem salva. Não há corrida, duplicação de áudio ou sessão por chunk.
- Preserva preferência e cadeia de modelos, contas elegíveis antes da troca de modelo e Zero-Retry. Ocupação local aguarda até 2 s no mesmo modelo, sem saltar a cadeia por conveniência. Acquires tardios são retirados após cancelamento/timeout.
- Contabiliza estimativas em janela móvel de 60 s, contexto reapresentado e metadata numérica de uso. A estimativa inicial de aproximadamente 25 tokens/s de áudio e a reserva de setup são parâmetros operacionais, não promessa de consumo ou faturamento. Limite TPM desconhecido permanece `UNKNOWN`; número de contas não significa capacidade infinita.
- Política opcional `api.sttScheduler`: tetos por modelo (`limits`) ou identidade opaca de conta/modelo (`accountLimits`), margem, estimativas e limites de sessão/espera validados. Nada é automaticamente regravado nas configurações pessoais; não há tela nova.
- 429 aplica cooldown usando atraso estruturado quando disponível, ou 60 s por padrão. AUTH específico afeta o par; 401/evidência de chave inválida afeta a conta. Falhas transitórias usam cooldown local. Payload inválido e cancelamento não consomem outras tentativas.
- Falhas após admissão/PCM encerram o job sem replay de áudio nem troca silenciosa de contexto. Preserva VAD, silêncio, overlap, merge, parciais, destino original e transformação final do agente.

## Diagnósticos e privacidade

Consulta pelo Console das opções, mesmo após encerrar o offscreen:

```javascript
await chrome.runtime.sendMessage({type:'STT_SCHEDULER_GET'})
```

Telemetria por conta/modelo: jobs ativos, tokens estimados/observados, reservas, metadata recebida, 429/AUTH, cooldown, latências, motivo de escolha e estado. Ausência de metadata não representa consumo zero. Não guarda API keys, áudio, texto pessoal, instruções ou handles de retomada nesses diagnósticos.

Persistência sanitizada via background em `chrome.storage.session`, com limites de histórico e TTL de 24 h; leituras/escritas têm deadline. Um ledger opaco de operações recentes impede replay. Reiniciar o worker não recria sessões; perder o offscreen não permite fingir contexto Gemini recuperado. Falhas de storage são indicadas, sem aguardar indefinidamente nem manter o offscreen aberto artificialmente. O estado de sessão não substitui histórico durável após reinício/recarga da extensão.

## Preservação

Narração literal, vozes, agentes e System Instructions, DSP local, TTS atual, STT realtime, HUD/Popup, Lens, modelos, configurações e Zero-Retry preservados. Não há retorno a unary nem Transcribe especializado nas rotas STT/TTS. Seek exato por palavra continua indisponível.

Instalação e atualização: carregar a raiz da branch `main` como extensão sem compactação. Para atualizar, feche tarefas, atualize a mesma pasta, recarregue a extensão e atualize as páginas, preservando o armazenamento. Configure as chaves nas opções, sem compartilhar seu perfil ou exportações locais.

## Validação e limites das evidências

A publicação exige suíte completa, `node tools/verify-publication.cjs`, sintaxe dos JS/CJS e `git diff --check`, além da revisão dos arquivos públicos e padrões de segredos. A regressão de publicação verifica a coerência README/notas/manifest/verificador. O teste de concorrência identifica sessões por jobId, sem presumir a ordem assíncrona de criação dos sockets.

Na etapa anterior de implementação, foram executadas duas rodadas Gemini Live reais com áudio sintético público: nove e três jobs independentes, totalizando 12 conexões e 24 segmentos em `gemini-3.8-live`, com parciais/finais e sem erro/timeout. Esses resultados são contexto histórico, não chamadas repetidas nesta consolidação. 429/AUTH/timeouts foram exercitados por injeção determinística; não foram esgotadas quotas reais deliberadamente.

Permanecem não comprovados: ganho comparativo de latência, tetos reais de TPM por conta, faturamento exato, retomada entre sockets e homologação física integral da extensão instalada. Outros consumidores — TTS, Lens e tráfego externo — não estão integralmente cobertos pelo budget STT. Testes automatizados e API com áudio sintético não substituem microfone físico, inserção e reprodução audível no Chrome.

Relatórios técnicos locais ignorados, harnesses de diagnóstico, pacotes antigos, logs, credenciais e configurações pessoais não integram este commit; permanecem preservados localmente.
