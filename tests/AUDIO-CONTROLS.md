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
