# FalaMermo v1.0.2

Consolidação pública do código na branch `main`. A versão interna do manifest permanece `2.0.2`. Esta entrega não cria tag, GitHub Release ou ZIP e não altera configurações pessoais.

## Payloads Gemini e agentes

- Resolução de `agentId` explícito, aliases e agente ativo; prévias e configurações por agente alinhadas.
- TTS literal: texto-fonte serializado separadamente das system instructions de estilo, inclusive no JSON avançado. O contrato de literalidade não é garantia absoluta de obediência de um modelo generativo.
- `outputTranscription` tem prioridade na transcrição do áudio gerado; pensamentos do modelo não integram o resultado narrado.
- DSP local para volume, velocidade, pitch, equalização e ambiência, sem inventar campos Gemini. Pitch por resampling também afeta a duração.
- Lens preserva captura e processamento de imagem, com a instrução resolvida separada da imagem e diagnósticos sanitizados.

## GUI compartilhada

- HUD, popup e painel das opções refletem o registro global de tarefas, com cartões e controles individuais.
- Seleção de tarefa ativa, Play/Pause, volume e velocidade; recolher, copiar, parar e remover cartões sem substituir outra tarefa.
- Tarefa manual pelo botão **+**, com texto e agente ativo; rascunho compartilhado em armazenamento de sessão.
- Item direto **Narrar** no menu de contexto e atalhos para ações na página. HUD e popup controlam tarefas, sem iniciar uma nova leitura da seleção da página.
- O campo original permanece o único destino autorizado para cada ditado, independentemente da aba que exibe o HUD.

## STT realtime

- PCM mono/16 kHz contínuo por WebSocket; não espera toda a gravação terminar para enviar áudio.
- Modo realtime usa VAD local e atividade manual: corte em pausas de 500 ms, limite de 12 s por turno, pre-roll e overlap de 200 ms no corte por limite.
- Parciais e resultados confirmados no mesmo job, ordenação por sequência e merge conservador de overlap. A confirmação usa a transcrição de entrada, não o áudio gerado pelo assistente.
- Fila limitada com erro explícito de congestionamento; cancelamento limpa captura, filas e timers e invalida respostas tardias.
- Transformação pelo agente somente após consolidar o resultado final. O modo ao finalizar mantém seu protocolo separado.

## Arquitetura e privacidade preservadas

TTS/STT continuam exclusivamente Gemini Live, com prioridade padrão: `gemini-3.8-live`, `gemini-3.8-live-extended-thinking`, `gemini-3.1-flash-live-preview` e `gemini-2.5-flash-native-audio-preview-12-2025`. Preferências explícitas válidas, fallback por chaves antes da troca de modelo, Zero-Retry e ranking oportunista são preservados. Não há retorno a unary ou Transcribe especializado nas rotas STT/TTS.

Chaves são configuradas nas opções e armazenadas no perfil local, não no repositório. Texto, áudio ou imagem necessários ao recurso são enviados ao Gemini após a ação do usuário. HUD/histórico podem conter textos pessoais; diagnósticos sanitizados não equivalem a uma exportação segura de todo o armazenamento. Relatórios técnicos e evidências locais existentes são preservados fora deste commit.

## Instalação e limitações

Carregue a raiz do código da branch `main` pelo **Modo do desenvolvedor → Carregar sem compactação** em `chrome://extensions`. Para atualizar, preserve a pasta e o armazenamento, feche tarefas ativas, atualize o código, recarregue a extensão e atualize páginas abertas. Configure a chave Gemini nas opções. Não existe ZIP v1.0.2 nesta entrega.

- Seek exato por palavra ainda indisponível; controles correspondentes não simulam alinhamento por porcentagem.
- Microfone físico e áudio real não foram homologados novamente pela automação mais recente.
- A extensão instalada no Chrome não foi testada integralmente pela automação; testes automatizados com fixtures e testes reais de API não substituem essa homologação.
- VAD por energia e merge sem timestamps por palavra são heurísticos; ruído, fala baixa, ambiguidades de reconhecimento e atrasos do serviço podem afetar resultados.
- Páginas restritas, editores especiais, permissões, conectividade e disponibilidade dos modelos continuam limitando operações.

Validação executada para esta publicação: `node --test tests/*.test.cjs` aprovou os 24 arquivos, sem falhas ou skips. `node tools/verify-publication.cjs` verificou 59 arquivos públicos, sintaxe de 45 JS/CJS e 63 referências de recursos, com manifest `2.0.2` e zero achados nas regras de segredos. `git diff --check` não apontou erros. Não foram repetidas chamadas Gemini nem se declara nova homologação física.
