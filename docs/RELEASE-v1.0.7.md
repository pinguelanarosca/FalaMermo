# FalaMermo v1.0.7

## Alterações

- Dupla confirmação local Silero + TEN VAD: o início de fala exige confiança ≥ 0,50 de cada detector, com correlação temporal entre janelas de 32 e 16 ms, sem exigir duas janelas consecutivas.
- TEN VAD oficial em WASM empacotado na extensão MV3, sem CDN ou biblioteca nativa. Pré-roll, pausas e hangover preservados; RMS não autoriza fala sozinho.
- Recuperação automática após deadline, falha de análise ou pressão da fila, com PCM temporariamente em buffer e proteção contra reentrega de amostras. Falha definitiva preserva o áudio pendente nas recuperações locais.
- Arquivamento automático de tarefas concluídas e recuperações encerradas em IndexedDB separado, com compressão de áudio sem perda quando vantajosa. Itens ativos, pendentes e fixados ficam protegidos; Opções expõe consulta, exportação, reprodução e restauração.
- HUD e diagnóstico STT mostram probabilidades Silero/TEN, confirmações, rejeições, deadlines e recuperações, além da correlação com segmentos, sessões e inserções no editor.
- Ferramenta de prova acústica local em `tools/stt-audio-forensics.cjs`, com WAVs e linha do tempo; entrada única e oculta das nove chaves, mantidas em memória. Capturas e relatórios pessoais ficam fora do pacote instalável e do Git.
- Consolidação das alterações locais de Lens literal/interpretação, instruções por modalidade, continuidade de resultados e testes de interface e protocolo.

## Instalação e atualização

Extraia `FalaMermo-v1.0.7.zip` em uma pasta permanente e carregue-a em `chrome://extensions`, com o modo do desenvolvedor ativado. O manifesto fica na raiz. O arquivo `.zip.sha256` acompanha o pacote.

Para atualizar, conclua trabalhos ativos, substitua os arquivos na pasta da instalação, recarregue a extensão e atualize as abas abertas. Preserve o armazenamento da extensão e sua pasta de instalação.

## Validação

EXECUTADO e VERIFICADO nesta publicação:

- `node --test tests/*.test.cjs`: **661 testes aprovados, zero falhas e zero ignorados**. As fixtures do registro global foram alinhadas ao arquivo persistente, preservando as verificações de conteúdo e capacidade ativa.
- Chrome **157.0.8103.38**, modelos locais reais: segmento 47 rejeitado com zero confirmações conjuntas; amostra de voz existente com 10 confirmações; gravação humana oficial TEN com 174. Um deadline induzido reinicializou o detector e entregou dois pacotes com bytes idênticos, sem duplicação. PCM não classificado foi preservado em IndexedDB como recuperação incompleta.
- `node tests/selection-chrome.cjs --two-modes`: aprovado para OCR literal, interpretação, personas e continuidade da tarefa, com provedor controlado.
- `node tests/stt-editors-chrome.cjs`: **24/24** casos aprovados; com `--continuous`: **28/28**, incluindo input, textarea, contenteditable e ProseMirror. Usadas as dependências locais existentes.
- `FALAMERMO_PANIC_ONLY=1 node tests/controls-chrome.cjs`: aprovado para Parar tudo, HUD/popup, captura e processamento STT, três estados TTS, PCM, histórico e novas operações.
- `node tests/controls-chrome.cjs`: aprovação parcial para Start/Stop, modos final/realtime, configurações STT, duas abas/janelas, resultados pendentes e ditado contínuo; **falha no timeout “medição do bloco confirmado”**. Os casos posteriores dessa execução não foram alcançados. Esse resultado não comprova correção do gargalo dos pacotes STT.
- Pré-voo de `tools/stt-audio-forensics.cjs` aprovado no Chrome isolado. Nessa modalidade não se executam STT/Gemini nem se capturam amostras de áudio; `NO_GEMINI_EVIDENCE` é o resultado esperado.
- Verificador oficial: sintaxe, versão MV3, referências locais, dependências WASM e busca de credenciais. O empacotador oficial confere entradas, extração e igualdade byte a byte do ZIP com as fontes e gera o SHA-256.

O teste de controles usa uma amostra de voz já versionada no dispositivo virtual do Chrome, pois o tom padrão desse dispositivo é rejeitado pela dupla confirmação. A expectativa antiga de ocultar o aviso da captura foi atualizada para conferir a exibição das probabilidades Silero/TEN. Nenhum limiar ou regra de detecção foi alterado para passar os testes.

## Problemas conhecidos e limites

- O teste geral de controles do Chrome ainda termina com timeout ao localizar a medição diagnóstica do bloco confirmado; sua execução não foi integralmente aprovada.
- **O gargalo dos pacotes STT permanece em investigação.** Esta versão não anuncia sua correção nem ganho de latência comprovado.
- Dupla confirmação reduz autorizações isoladas, mas não comprova ausência de todas as transcrições fantasmas. Os resultados Gemini ainda exigem revisão.
- Fala muito baixa, todas as vocalizações, dispositivos físicos e editores especiais não foram homologados integralmente nesta preparação. Testes com áudio gravado e modelos reais não substituem homologação completa com microfone e Gemini ao vivo.
- O arquivo local depende da quota e do espaço físico do perfil Chrome. Se a gravação persistente falhar, a cópia ativa não é removida; itens ativos e fixados podem impedir a liberação de capacidade. O arquivo não substitui backup externo.
- Cotas, disponibilidade e latência Gemini dependem do serviço e das contas. Seek exato por palavra continua indisponível.
- Recarregar a extensão exige atualizar as abas abertas para substituir content scripts antigos.
- O TEN VAD é distribuído com a licença oficial integral e suas condições adicionais em `vad-assets/ten/LICENSE` e os avisos de terceiros em `vad-assets/ten/NOTICES`; a origem e o commit estão em `SOURCE.txt`.
