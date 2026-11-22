# FalaMermo v1.0.10

- O ditado usa Gemini 3.5 Transcribe Live em modo VERBATIM, com detecção local de voz por Silero + TEN. O reconhecimento aceita seleção de idioma e vocabulário personalizado.
- O card exibe hipóteses dos blocos seguintes enquanto um trecho anterior aguarda confirmação. O editor continua recebendo o texto em ordem e preserva edições manuais. Se uma réplica parar de avançar, outra pode assumir a prévia quando trouxer progresso comprovado.
- A captura começa a encaminhar quadros menores durante a inicialização. O WebSocket pode iniciar o setup enquanto o primeiro bloco é gravado para recuperação. A primeira hipótese pode aparecer durante a fala.
- **Parar tudo** inicia o encerramento mesmo com uma consulta ao offscreen pendente. A captura só libera a reserva do microfone após confirmação da origem. O PCM já gravado continua disponível para recuperação.
- Eventos do offscreen exigem confirmação da tarefa e da revisão. Respostas ausentes ou inválidas acionam reenvio ou reconciliação, inclusive após reinício do service worker.

Para atualizar uma instalação descompactada, extraia o ZIP na pasta já carregada, clique em **Recarregar** em `chrome://extensions` e atualize as páginas abertas.
