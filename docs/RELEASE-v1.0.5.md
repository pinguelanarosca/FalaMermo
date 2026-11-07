# FalaMermo v1.0.5

## Alterações

- O atalho de ditado alterna entre iniciar e parar, com proteção contra repetição de teclas e comandos duplicados.
- A exclusividade STT acompanha a captura do microfone. Após sua liberação, outros ditados podem iniciar enquanto resultados anteriores são processados.
- O HUD informa quando outra aba mantém uma captura ativa e a engrenagem abre as configurações.
- HUD e popup controlam a reprodução global. Cada cartão TTS ou STT controla seu próprio áudio e volume.
- Uma nova narração pausa a anterior. Pause preserva posição e cache, e Stop explícito descarta o áudio da tarefa.
- Os indicadores acompanham o estado do player e a disponibilidade real de PCM.
- A captura e a recuperação STT recebem correções para eventos atrasados, encerramento e isolamento entre tarefas.

## Instalação

Extraia `FalaMermo-v1.0.5.zip` em uma pasta permanente e carregue essa pasta em `chrome://extensions`, com o modo do desenvolvedor ativado. O `manifest.json` fica na raiz. O arquivo de checksum SHA-256 acompanha o ZIP.

## Validação e limites

A suíte automatizada e a integração no Chrome utilizam fixtures para o transporte Gemini. Os cenários com Gemini real e microfone físico desta versão dependem de homologação no ambiente do usuário.
