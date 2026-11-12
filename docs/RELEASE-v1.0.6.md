# FalaMermo v1.0.6

## Alterações

- VAD híbrido Silero executado localmente em worker, com modelo ONNX e runtime WASM incluídos no pacote, sem download durante o uso.
- Continuidade do ditado com proteção do destino original, limites de segmentos e tratamento de resultados atrasados, envio e recriação do editor.
- Correções no ciclo de captura, transporte STT, finalização e diagnósticos, preservando os controles compartilhados do HUD e a reprodução TTS.
- Seleção (Lens) integrada ao registro global: análise, resultado, narração e conclusão na mesma tarefa, com Stop e descarte de respostas tardias.
- OCR literal independente da persona: preserva palavras, idioma, pontuação e quebras relevantes; não resume nem responde ao texto. Sem texto legível, o cartão informa a ausência e não inicia narração.
- Redundância competitiva usando o pool de até nove chaves Gemini: duas tentativas por seleção, até quatro requisições Lens globais e uma por conta. A primeira resposta válida vence; falhas permitem substituição progressiva, respeitando cooldown e fallback, sem repetir o mesmo par modelo/chave.
- A narração do Lens recebe somente o texto extraído e não reutiliza sessões com instruções de análise da persona. Voz e parâmetros de áudio são preservados.

## Instalação e atualização

Extraia `FalaMermo-v1.0.6.zip` em uma pasta permanente e carregue-a em `chrome://extensions`, com o modo do desenvolvedor ativado. O manifesto fica na raiz. O checksum SHA-256 acompanha o pacote.

Para atualizar, conclua trabalhos ativos, substitua os arquivos na pasta da instalação, recarregue a extensão e atualize as abas abertas. Não remova a extensão nem limpe seu armazenamento; assim, as configurações pessoais permanecem preservadas.

## Validação e limitações

EXECUTADO e VERIFICADO nesta publicação: `node --test tests/*.test.cjs` concluiu com 650 testes aprovados e zero falhas.

As verificações da publicação abrangem regressão automatizada, sintaxe, manifesto MV3, referências locais, presença das dependências do VAD, busca de credenciais e comparação do ZIP extraído com os arquivos originais.

Nesta sessão, o Lens foi validado com Gemini real em perfil isolado do Chrome e persona de desenvolvimento: texto idêntico à fonte, incluindo perguntas, números, pontuação e quebras, narração concluída e aviso sem áudio para uma região vazia. Disputa entre contas, falhas HTTP, respostas tardias, Stop, limites e continuidade após fechar a origem também foram exercitados no Chrome com provedor controlado. Essas verificações manuais aprovadas não foram repetidas para a publicação.

OCR e geração de áudio continuam sujeitos a erros do modelo e à legibilidade da imagem. Disponibilidade e cotas Gemini dependem das contas; o cooldown respeita as respostas recebidas, sem garantir saldo remoto. O WASM local exige compatibilidade do navegador. O histórico não é backup de áudio nem substitui a preservação do armazenamento da extensão.
