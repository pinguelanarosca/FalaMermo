# FalaMermo v1.0.1

Atualização de estabilização do ditado Gemini Live. O usuário confirmou que o STT voltou a funcionar com o microfone físico no Chrome após a correção de finalização no `gemini-3.8-live`. Essa confirmação é específica do ambiente testado, não uma homologação universal.

## Correções

- Gemini 3.8 Live utiliza VAD manual como padrão do ditado: `activityStart` antes do primeiro áudio e `activityEnd` após os últimos blocos. Preferências explícitas de VAD continuam sendo respeitadas; o padrão de TTS não é alterado.
- Finalização não depende de o VAD automático detectar silêncio imediatamente antes de Parar. O protocolo manual não mistura `activityEnd` com `audioStreamEnd`.
- Captura mono, mistura dos canais no AudioWorklet, conversão PCM Int16 little-endian a 16 kHz e envio da cauda antes do encerramento.
- Captura trata os blocos recebidos durante a inicialização e confirma o AudioContext em execução; HUD e opções orientam a aguardar “Gravando”.
- `turnComplete` sem transcrição não encerra prematuramente o job. O ditado aguarda a transcrição de entrada independente; transcrição provisória não é promovida a resultado final.
- Liberação do microfone e do AudioContext na parada/cancelamento, inserção no campo original e proteções contra contexto invalidado preservadas, com regressões automatizadas.

## Melhorias

- Botão **Copiar diagnóstico STT** nas opções, incluindo os ditados iniciados pelo HUD, sem necessidade de Console ou de manter o offscreen aberto.
- Diagnóstico sanitizado de captura, PCM, transporte, eventos do servidor, transcrição e inserção; distingue ausência de captura, ausência de transcrição e resultado apenas provisório.
- Resumos sobrevivem ao encerramento do offscreen em armazenamento de sessão: até 8 jobs, 40 eventos por job e expiração de 24 horas. Não incluem chaves, áudio/base64/PCM, texto reconhecido, identificadores de dispositivo ou instruções dos agentes.
- Tratamento de falhas de consulta/cópia e mensagens mais precisas para erros STT.

## Compatibilidade e privacidade

TTS e STT permanecem exclusivamente Gemini Live por WebSocket. A prioridade padrão dos quatro modelos gerais foi preservada: `gemini-3.8-live`, `gemini-3.8-live-extended-thinking`, `gemini-3.1-flash-live-preview` e `gemini-2.5-flash-native-audio-preview-12-2025`. Não foram introduzidos modelos unary ou Transcribe especializados.

Permanecem TTS, Lens, HUD, agentes personalizados, system instructions, JSON avançado, gerenciamento de até nove chaves independentes, ranking oportunista, paralelismo e reprodução PCM. O fallback tenta as chaves elegíveis do mesmo modelo antes de mudar de modelo. Configurações pessoais não são apagadas nem distribuídas.

Cada usuário fornece sua própria chave Gemini nas opções. Texto, áudio e imagens necessários aos recursos são enviados ao Gemini durante o uso. O pacote não contém credenciais, perfil Chrome, histórico pessoal ou logs de diagnóstico. Diagnósticos sanitizados não tornam exportações gerais do armazenamento seguras para publicação.

## Instalar ou atualizar no Chrome

1. Baixe **FalaMermo-v1.0.1.zip** e, se desejar, confira o SHA-256 no arquivo que acompanha o pacote.
2. Para uma instalação nova, extraia em uma pasta permanente, confirme `manifest.json` na raiz e use **Carregar sem compactação** em `chrome://extensions`, com **Modo do desenvolvedor** ativado. Configure sua chave nas opções.
3. Para atualizar, encerre trabalhos ativos, extraia sobre a mesma pasta já carregada e clique **Recarregar**. Não remova a extensão nem limpe seu armazenamento; mantenha a pasta para preservar a instalação e as preferências.
4. Atualize as páginas abertas para carregar os novos content scripts. No ditado, aguarde “Gravando”, fale e clique Parar.

## Verificação e limites

- Suíte completa executada: 19 arquivos aprovados, zero falhas, cancelamentos ou testes ignorados. Verificação de publicação aprovada: sintaxe de 36 arquivos JavaScript/CJS, Manifest V3 2.0.2, 53 referências de recursos e nenhuma correspondência nas regras de detecção de segredos dos 49 arquivos candidatos. O ZIP é extraído e conferido antes do envio.
- O funcionamento físico do STT foi confirmado pelo usuário. Não foram repetidas chamadas Gemini nem captura física apenas para publicar; testes automatizados não substituem homologação de todos os dispositivos, sites e editores.
- Preferências explícitas de VAD automático são preservadas. O automático do 3.8 apresentou sessões sem transcrição nos testes anteriores; o padrão manual corrige a finalização do cenário investigado.
- Páginas antigas precisam ser atualizadas depois de recarregar a extensão. Páginas restritas, campos removidos, editores especiais, permissões negadas, cotas, conexão e mudanças dos modelos podem limitar os recursos. A referência `svg` anteriormente relatada não teve seu stack original identificado.
- Não se declara homologação universal de TTS audível, Lens, troca de dispositivos, contextos invalidados ou todos os modelos/chaves nesta publicação.

Versão pública **v1.0.1**; versão interna Chrome **2.0.2**, sem downgrade. A tag e os assets da **v1.0.0** não são alterados. Esta distribuição é para instalação descompactada, não uma publicação na Chrome Web Store.
