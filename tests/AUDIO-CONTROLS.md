# Homologação dos controles de áudio

## Preparação no Chrome

1. Aguarde os ditados em andamento terminarem antes de recarregar a extensão.
2. Em `chrome://extensions`, recarregue o FalaMermo instalado a partir desta pasta. Atualize as páginas abertas para carregar os content scripts atuais.
3. Use a configuração Gemini existente. Não é necessário alterar agentes, modelos, vozes, chaves ou scheduler.
4. Abra o HUD e o pop-up. Crie dois cards manuais, A e B, com textos suficientemente longos para testar a pausa. Expanda os cards para acessar transporte e volume individual.

## Checklist curto com microfone e Gemini

1. Em um campo editável, pressione o atalho de ditado quatro vezes para iniciar, parar, iniciar e parar. Mantenha a tecla pressionada no segundo acionamento e aguarde o resultado. Repita nos modos convencional e tempo real.
2. Durante uma gravação, tente iniciar outro ditado em outra aba e em Opções. O segundo deve ser bloqueado. Depois de concluir o primeiro, confirme que a outra origem pode gravar.
3. Inicie A e depois B. Ao ouvir B, confirme que A ficou pausado. Pause B no pop-up e retome no HUD. Volte a A pelo card e confira que ele continua do mesmo ponto.
4. Use Play, Pause e Stop no card de uma transcrição. Confira que o Stop descarta a narração e mantém o texto. Em seguida, confirme que Play solicita nova síntese.
5. Ajuste um volume individual e o global. Feche os painéis durante a reprodução. Deixe a narração atual terminar e confirme que nenhuma outra retoma sozinha.

## Cenários e resultados esperados

| Ação | Resultado esperado |
|---|---|
| Play em A; durante a síntese de B, aguardar seu primeiro áudio | A pode continuar enquanto B gera. Quando B assume, A recebe Pause e conserva posição/cache. Não há sobreposição. |
| Play em A pausado | B pausa; A continua da posição preservada, sem nova síntese. |
| Pause no HUD; Play no pop-up e vice-versa | Ambos mostram o mesmo estado e controlam o mesmo áudio. |
| Selecionar um card pausado, sem outro áudio tocando; Play global | Retoma o card pausado selecionado. Sem seleção aplicável, retoma o pausado mais recente. |
| Play global sem áudio pausado ou ativo | Nenhuma tarefa nova é iniciada. |
| Ajustar volumes individuais de A e B | Cada preferência fica no próprio card. |
| Ajustar volume global; alternar A/B | O volume global multiplica o volume individual e não o reescreve. |
| Stop em A | Descarta somente áudio/cache/posição de A. Card, texto e histórico permanecem. B não retoma automaticamente. |
| Play em A após Stop | Solicita nova síntese desde o início. |
| Deixar B terminar naturalmente; Play posterior | Libera áudio temporário ao concluir. Nenhum pausado retoma sozinho. Novo Play sintetiza novamente. |
| Finalizar um ditado STT e usar Play no próprio card | Narra o texto STT pelo mecanismo TTS existente. Pause/Stop/volume pertencem a esse card. Transcrição, inserção e histórico STT permanecem. |
| Pause durante geração; aguardar resposta e retomar | A resposta tardia fica em cache, sem tocar. Resume utiliza esse áudio. |
| Stop durante geração; aguardar resposta e executar Play novamente | O resultado antigo é invalidado. O novo pedido gera outra narração. |
| Disparar várias gerações; alternar três cards rapidamente | Só a solicitação mais recente pode assumir a reprodução. Respostas antigas ficam pausadas. |
| Fechar pop-up, ocultar HUD ou ocultar um card | O áudio continua; reabrir mostra o estado atual. |
| Gerar áudio até alcançar o limite de cache | Exibe aviso e mantém o áudio recebido em pausa. Não descarta silenciosamente os caches pausados. |

Para conferir ressíntese, observe o documento offscreen pelo inspetor da extensão: Pause/Resume não deve abrir novos turnos de narração; Play após Stop/conclusão deve abrir um novo turno. Não compartilhe chaves nem conteúdo privado dos diagnósticos.

## Testes reproduzíveis

Regressão automatizada

```bash
node --test --experimental-test-isolation=none --test-force-exit tests/*.test.cjs
```

Integração MV3 com Chrome instalado, microfone de teste, AudioWorklets e transporte Gemini simulado. No Linux com Xvfb e libXtst, o comando também testa a repetição do atalho nativo e abre o pop-up pelo botão da extensão.

```bash
FALAMERMO_HEADED=1 FALAMERMO_NATIVE_SHORTCUT=1 xvfb-run -a node tests/controls-chrome.cjs
```

Teste nativo isolado, sem Gemini e sem capturar microfone:

```bash
python3 -m http.server 8766 --bind 127.0.0.1
```

Abra `http://127.0.0.1:8766/tests/audio-controls-browser.html` no Chrome. A página mostra o resultado e publica `window.audioControlTest`. Usa os arquivos reais do roteador, registro, renderer, player e AudioWorklet. Substitui transporte Gemini, mensagens e armazenamento Chrome por fixtures determinísticas e utiliza a saída silenciosa nativa do AudioContext. Não instala a extensão nem altera o perfil pessoal. Requer Chrome com suporte à opção `sinkId: {type: 'none'}` do AudioContext.

## Limites da verificação automatizada

A página nativa confirma processamento PCM, suspensão/retomada de AudioContext, ganho, controles, concorrência e liberação. Ela não comprova a escuta física nem o transporte Gemini real de uma extensão MV3 instalada. Esses cenários dependem da homologação acima.

O orçamento de 128 MB se aplica ao cache gerenciado de reprodução, não ao consumo total do processo Chrome. Ao atingir o limite, a geração é interrompida com aviso e o trecho recebido permanece pausado para recuperação. Liberar outra tarefa com Stop não completa automaticamente a geração interrompida; para obter a narração integral, execute Stop e Play nessa tarefa.

## Homologação da Etapa 2 de STT

1. Carregue o diretório da extensão no Chrome e use as chaves já configuradas. No modo convencional, dite por 20, 60 e 180 segundos. Alterne frases e fala contínua. Confirme a ordem e leia as transições entre blocos.
2. Repita em tempo real. Faça uma pausa de cinco minutos sem parar a gravação. Confirme que os blocos anteriores são inseridos antes do Stop e que a fala seguinte entra na mesma tarefa.
3. Pare e inicie outro ditado em outra aba enquanto o primeiro aguarda resultado. Confirme que o primeiro resultado e o novo microfone pertencem a tarefas diferentes. Teste também Cancelar durante o processamento.
4. Em Opções, use **Copiar diagnóstico STT**. Compare eventos `chunk-send` de uma mesma `sequence`. Os campos `copy`, `keyLabel` e `sessionId` permitem conferir as duas sessões. `chunk-degraded` indica proteção reduzida. `chunk-unresolved` identifica um bloco inconclusivo.
5. Se houver lacuna, use o console das Opções. `await SttRealtime.recovery.list()` mostra `unresolvedSequences`. Exporte o bloco com `await SttRealtime.recovery.download(jobId, sequence)`.

O teste `node --test --experimental-test-isolation=none tests/stt-distributed.test.cjs` usa o scheduler real com nove credenciais fictícias e respostas controladas. A integração `FALAMERMO_HEADED=1 FALAMERMO_NATIVE_SHORTCUT=1 xvfb-run -a node tests/controls-chrome.cjs` usa a extensão e o IndexedDB do Chrome com WebSockets e microfone de teste.

Cada sessão recebe um bloco. A primeira transcrição válida encerra as duas tentativas e a publicação segue a ordem local. Em cortes forçados, até 200 ms do bloco anterior oferecem contexto acústico. A reconciliação usa correspondências literais na fronteira. A referência do Live não garante timestamps por palavra para esta rota, portanto a continuidade na fronteira precisa de avaliação auditiva. A compatibilidade usa uma janela de 900 ms após o fim do turno quando o servidor entrega texto sem confirmação explícita de entrada.

O scheduler conserva os limites configurados de sessões, orçamento e cooldown. Distinção de chaves é verificável localmente. A associação de cada chave a uma conta ou projeto independente depende da configuração do provedor. O PCM é gravado uma vez, com os limites atuais de recuperação. Sob saturação, a redução de réplicas ou a lacuna é sinalizada.
