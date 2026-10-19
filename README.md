# FalaMermo

Extensão Chrome Manifest V3 para narração, ditado e seleção visual com Gemini, agentes personalizados e HUD na página.

FalaMermo v1.0.4 consolida os controles de reprodução global e individual, navegação pelo PCM recebido, HUD/Popup compartilhados e janelas por tarefa. Mantém o scheduler STT para até nove contas, narração literal, agentes e ditado realtime com VAD e parciais. A versão pública e a versão do manifest são `1.0.4`, mantendo Manifest V3. O código está na branch `main`; o pacote instalável e seu checksum acompanham a [release v1.0.4](https://github.com/pinguelanarosca/FalaMermo/releases/tag/v1.0.4).

## Instalação no Chrome

1. Baixe e extraia `FalaMermo-v1.0.4.zip` da [release v1.0.4](https://github.com/pinguelanarosca/FalaMermo/releases/tag/v1.0.4), ou clone [este repositório](https://github.com/pinguelanarosca/FalaMermo) na branch `main`.
2. Mantenha o código em uma pasta permanente. `manifest.json` deve estar diretamente nessa pasta.
3. Abra `chrome://extensions`, ative **Modo do desenvolvedor** e escolha **Carregar sem compactação**.
4. Selecione a pasta extraída, abra as opções da extensão e configure sua chave Gemini.
5. Atualize as páginas que já estavam abertas. Após atualizar/recarregar a extensão, atualize também essas páginas.

Não há etapa de build obrigatória. Para atualizar uma instalação descompactada, feche trabalhos ativos, atualize o código na mesma pasta já carregada e clique **Recarregar** em `chrome://extensions`. Não remova a extensão nem limpe seu armazenamento; mantenha a pasta para preservar a instalação e as preferências. Atualize também as páginas abertas. Pacotes anteriores não contêm as mudanças da v1.0.4.

## Configuração e utilização

Nas opções, salve sua chave Gemini e escolha o agente ativo. É possível configurar até nove chaves, criar/editar agentes e ajustar os parâmetros disponíveis por modelo. Cada tentativa real pode consumir cota; criar um agente local não cria uma voz remota.

- **Narração:** selecione texto na página e use o atalho ou o item direto **Narrar** no menu de contexto. HUD e popup controlam tarefas já criadas; não iniciam leitura de uma nova seleção da página.
- **Ditado:** posicione o cursor em um campo editável, use o atalho de ditado, autorize o microfone e aguarde “Gravando” antes de falar. Use novamente o atalho ou **Parar** no cartão daquele ditado para concluir. O Gemini 3.8 Live usa VAD manual por padrão para delimitar a fala; preferências explícitas de VAD são preservadas. A inserção usa o campo/seleção original; não deve acompanhar uma mudança de foco para outro campo. Se o campo desaparecer, copie o resultado mostrado no HUD. Nas opções, o botão **Copiar diagnóstico STT** fornece contadores e estados sem exigir Console.
- **Lens:** use o atalho Lens e selecione uma região. Quando necessário, a extensão abre sua própria interface para pedir autorização opcional de captura. A autorização exige acesso a todos os sites por uma limitação da API de captura do Chrome. Pode ser recusada ou revogada; não é concedida permanentemente na instalação. A captura depende de uma ação explícita do usuário.
- **Personalização:** agentes compartilham identidade e mantêm instruções próprias para narração, ditado e Lens. Há configurações por modelo e editor avançado com painel, override JSON, JSON completo e preview. Parâmetros incompatíveis não devem ser enviados indiscriminadamente entre STT e TTS.

A narração separa o texto-fonte literal das instruções de estilo do agente. A transcrição do áudio gerado usa `outputTranscription`, sem misturar pensamentos do modelo. Volume, velocidade, pitch, equalização e ambiência são processados localmente; pitch por resampling também altera a duração. A literalidade é um contrato enviado ao modelo, não garantia absoluta de reconhecimento ou geração.

Atalhos internos padrão: `Ctrl+B` para ler seleção, `Ctrl+Shift+Space` para iniciar/parar ditado, `Ctrl+Shift+L` para Lens, `Pause` para pausar/retomar e `Alt+Shift+H` para alternar o HUD. São configuráveis nas opções. O Chrome também oferece os comandos `Alt+Shift+S`, `Alt+Shift+D` e `Alt+Shift+H`, configuráveis em `chrome://extensions/shortcuts`; atalhos podem conflitar com a página ou o sistema.

### HUD/Popup compartilhados

Cada narração e ditado tem um cartão próprio, sincronizado entre páginas, popup, opções e janela individual. Novas tarefas aparecem no topo por data de criação; cartões automáticos começam recolhidos, com chevron, maximizar e X. O X apenas oculta o cartão global, sem parar o job nem apagar o resultado. **Parar** é um controle separado. Ao minimizar o HUD, a barra superior mantém os três controles globais, o badge de atividade e restaurar/fechar; popup e opções continuam acessíveis. A lista do popup tem rolagem própria sem esconder cabeçalho, agente ou player. As barras de rolagem são visualmente ocultas, sem desativar teclado, toque ou roda do mouse.

Os controles globais **⏪ ▶/⏸ ⏩** ficam lado a lado: Pause pausa todas as narrações em reprodução; sem nenhuma reproduzindo, Play retoma somente a pausada mais recentemente. Sem pausadas, Play fica desabilitado e nunca inicia uma tarefa concluída. Cada cartão TTS expandido e sua janela têm **⏪ ▶/⏸ ⏩ ■** individuais; Play explícito após conclusão cria nova reprodução. Volume, velocidade e setas globais afetam a tarefa selecionada; as setas individuais afetam somente seu cartão. Em páginas restritas, consulte e controle as tarefas pelo popup ou pelas opções.

A pausa silencia a saída final do grafo de áudio, confirma o worklet pausado e aguarda o AudioContext suspenso. Retomar preserva o cursor e o buffer, restaurando o volume selecionado. Comandos têm sequência e validação de job/player/request; confirmações antigas ou de um player inexistente não devem fabricar o estado Pausado. O progresso expandido mostra contexto, estado do worklet, cursor PCM e último ACK confirmado.

Maximizar abre uma janela redimensionável para o mesmo job, sem duplicá-lo. Nela estão texto completo, cópia, edição e controles individuais. Fechar a janela não interrompe a tarefa. TTS permite edição somente após parar/concluir, não durante pausa. No STT, a edição altera uma cópia de trabalho para eventual narração; a transcrição original, o histórico e o texto já inserido no site não são reescritos. Rascunhos e cópias de trabalho ficam no estado de sessão, não são um backup persistente.

Clique em um cartão para torná-lo ativo para navegação, volume e velocidade. O botão central global mantém sua regra de pausar todas/retomar a última pausada, independentemente dessa seleção. A cópia de texto fica na janela individual ou no histórico; ocultar um cartão ativo não interrompe sua reprodução.

Use **+** para criar uma tarefa manual com o agente ativo, digite ou cole texto e pressione Play. O rascunho é sincronizado no armazenamento de sessão, sem buscar conteúdo da página. Pare ou aguarde a conclusão para editar novamente; pausa preserva a reprodução atual. Play após conclusão gera uma nova narração pelo mesmo motor TTS. Edições concorrentes são recusadas sem sobrescrever o rascunho local.

As setas deslocam **5 segundos de PCM recebido**, acumulando cliques e respeitando o buffer disponível. O player retém uma janela recente de aproximadamente 60 segundos de PCM consumido enquanto o job está ativo; os limites de posição reais são sincronizados. Avançar não pula para áudio ainda não recebido. Ao parar/concluir, o PCM é liberado; reproduzir novamente é uma ação explícita de nova narração. Não há seek exato por palavra, timestamps inventados, ressíntese oculta ou nova chamada Gemini ao navegar.

Em **Inserção do ditado**, escolha **Ao finalizar** (padrão) ou **Em tempo real**. O modo em tempo real substitui somente o intervalo pertencente ao ditado, distingue texto confirmado de provisório e interrompe a inserção se detectar edição manual conflitante. Agentes que transformam o transcript aguardam o resultado transformado. O destino continua sendo exclusivamente o campo capturado no início, mesmo que o HUD seja aberto em outra aba.

O PCM é enviado continuamente, sem acumular toda a gravação até Parar. Em tempo real, o VAD local delimita turnos em pausas de 500 ms ou ao atingir 12 s, com pre-roll e overlap de 200 ms nos cortes por limite. Parciais e texto confirmado são consolidados por sequência no mesmo cartão. As filas são limitadas: congestionamento encerra o ditado com erro explícito, em vez de descartar áudio silenciosamente. Cancelar interrompe captura, filas e respostas tardias; a transformação do agente ocorre somente após a consolidação final. O merge de overlap é heurístico, sem timestamps por palavra.

Trocar de aba não cancela o ditado. Navegar ou fechar a página de origem destrói sua captura local: áudio ainda não entregue não pode ser recuperado. Resultados já recebidos permanecem identificados como incompletos quando necessário; não são inseridos em outra página. Uma narração offscreen pode continuar após fechar sua origem. Esses cenários ainda exigem homologação física na instalação atual.

### Scheduler STT por conta

Jobs de ditado independentes são distribuídos entre as API keys configuradas, tratadas como recursos de contas independentes. Não há login/senha nem redistribuição dos chunks: cada job permanece na mesma sessão, modelo e conta até encerrar. Não há duplicação de áudio ou corrida do mesmo ditado entre modelos.

Por padrão, há até nove sessões STT, uma por conta, e até nove admissões pendentes. A seleção considera ocupação, consumo/reservas estimados, número de admissões e uso recente. O scheduler preserva a preferência de modelo e tenta as contas elegíveis desse modelo antes de avançar na cadeia. Contas ocupadas aguardam admissão por até 2 s; ocupação local não faz saltar modelos. Zero-Retry impede repetir pares que falharam e replay de operações recentes.

O orçamento usa uma janela de 60 s, duração de PCM/contexto e `usageMetadata` quando recebido. Tetos conhecidos podem ser definidos pela política numérica `api.sttScheduler`; não há nova tela nem alteração automática de configurações. Sem teto conhecido, o diagnóstico indica `UNKNOWN`, mantém limites de sessões e reage a 429/cooldown — não presume TPM infinito nem promete controle exato de faturamento. Consumo de TTS, Lens e outros clientes não está integralmente incluído nesse orçamento STT.

429, AUTH, timeout e falhas de conexão influenciam a admissão de novos jobs. Depois da admissão, falhas encerram somente aquele job, sem replay de PCM ou migração silenciosa de contexto. Captura, VAD, merge, destino original e transformação final pelo agente continuam nos fluxos existentes.

Para consultar a telemetria sanitizada, inclusive após o offscreen encerrar, execute no Console de `options.html`:

```javascript
await chrome.runtime.sendMessage({type:'STT_SCHEDULER_GET'})
```

São exibidos conta (`key#1`…`key#9`), modelo, jobs ativos, estimativas/observações de tokens, reservas, 429/AUTH, cooldown, latências e motivo da escolha, sem API keys ou conteúdo. Zero mensagens de usage não significa consumo zero. O estado limitado usa armazenamento de sessão, com TTL de 24 h; não recupera o contexto Gemini após perder o offscreen. Falha de persistência é sinalizada por `storageHealthy:false`.

## Modelos e fallback

TTS e STT executam exclusivamente Gemini Live por WebSocket. O catálogo geral e a prioridade padrão são:

1. `gemini-3.8-live`
2. `gemini-3.8-live-extended-thinking`
3. `gemini-3.1-flash-live-preview`
4. `gemini-2.5-flash-native-audio-preview-12-2025`

Uma preferência explícita válida é tentada primeiro. O fallback tenta as chaves elegíveis **no mesmo modelo antes de passar ao próximo**. Ranking oportunista e cooldowns não mudam essa regra. A disponibilidade depende do acesso da chave e do serviço; previews podem ser retirados do catálogo ao vencerem. Modelos unary, Flash TTS convencional e Transcribe especializado não são alternativas nas rotas STT/TTS. Lens mantém seu fluxo de visão próprio.

## Privacidade

As chaves e preferências são armazenadas localmente pela extensão no perfil do navegador. Não são fornecidas no pacote nem devem ser compartilhadas. Esse armazenamento não é um cofre de segredos: proteja seu perfil e configure restrições/cotas apropriadas para suas chaves.

Ao usar os recursos, o conteúdo necessário é enviado ao Gemini: texto e instruções para narração; áudio do microfone para ditado; imagem selecionada e instruções para Lens. Uma transformação pós-ditado configurada pelo agente também processa o transcript no Gemini. A captura do microfone depende de autorização do navegador.

Há histórico/diagnósticos locais. Não exporte nem publique seu armazenamento, chaves, áudio, textos pessoais ou instruções privadas. Os diagnósticos persistidos específicos de reprodução TTS e de STT usam resumos limitados e sanitizados; isso não torna todo histórico da extensão livre de conteúdo pessoal. O diagnóstico STT guarda somente contadores e estados em armazenamento de sessão, limitado a 8 jobs e 40 eventos por job, com expiração de 24 horas; não inclui chaves, áudio, texto reconhecido, identificadores de dispositivo ou instruções dos agentes.

Para consultar os últimos diagnósticos TTS no Console de `options.html`, inclusive após o offscreen encerrar:

```javascript
await LiveTtsDiagnostics.get()
```

O resumo TTS aceita também tarefas manuais, registra marcos de pausa/retomada/seek e mantém no máximo 8 jobs, 120 eventos por job e 12 sessões por job, com expiração de 24 horas. Não mantém o offscreen aberto artificialmente nem armazena chaves, PCM, base64 ou conteúdo pessoal nesses diagnósticos.

O estado global do HUD guarda textos necessários à visualização e recuperação em armazenamento de sessão. Ele não é um diagnóstico sanitizado. Resultados concluídos também podem integrar o histórico local, conforme sua preferência e limite; podem conter texto pessoal. Nas Opções, configure até 5.000 resultados/3.650 dias (padrão: 50 resultados/365 dias, preservando limites existentes) e reabra tarefas históricas. A expiração ocorre ao salvar novos resultados, segundo esses limites. Há orçamento de 6 MB para histórico e 4 MB para o registro de sessão; resultados já salvos podem sair do cache de sessão e ser reabertos pelo histórico. Se não for possível salvar, o resultado permanece na sessão com aviso; novas tarefas podem ser recusadas para evitar perda. Não são guardados PCM, base64 ou credenciais no registro de jobs. A limpeza explícita do histórico remove os resultados concluídos correspondentes do HUD.

O estado de sessão permite recuperar o service worker, mas não sobrevive ao recarregamento/atualização da extensão ou reinício do navegador. Somente o histórico habilitado preserva resultados concluídos além dessa sessão. [Documentação Chrome](https://developer.chrome.com/docs/extensions/reference/api/storage#storage_areas).

## Limitações conhecidas

- A versão foi considerada suficientemente funcional pelo responsável após teste manual. Isso não equivale a homologação completa de todo navegador, site, editor, chave e modelo.
- O usuário confirmou o funcionamento do STT com microfone físico no Chrome após a correção de finalização do Gemini 3.8 Live. Isso não homologa todos os dispositivos, editores e ambientes. Microfone físico, inserção e cenários de reload/contexto invalidado não foram repetidos de ponta a ponta pela automação desta publicação. A referência `svg` anteriormente relatada no DevTools ainda não foi correlacionada a um stack original.
- Depois de recarregar a extensão, um content script antigo pode perder autorização para comunicar-se. O STT trata a invalidação, libera sua captura e orienta F5; não reconecta nem recarrega páginas automaticamente. Uma página com código anterior à correção precisa ser atualizada para receber a proteção.
- Campos removidos, editores especiais, páginas internas/restritas do Chrome e permissões recusadas podem impedir inserção/captura. Lens não funciona em todas as páginas.
- Conectividade, cotas, permissões de modelo, latência, mudanças do serviço e encerramento de previews podem afetar o funcionamento. Não há promessa de tempo fixo ou disponibilidade de todas as chaves.
- Gemini 3.8 Live e Extended Thinking usam VAD manual por padrão no ditado, mantendo preferências explícitas. O automático do 3.8 apresentou sessões sem transcrição em testes anteriores; uma preferência explícita automática continua sendo respeitada. Extended Thinking utiliza configuração específica de thinking; VAD automático desse modelo não foi homologado. Microfone físico não foi repetido nesta preparação da release.
- Em testes anteriores, o 3.8 retornou texto mesmo para PCM inteiramente silencioso. Texto reconhecido não comprova que houve fala; revise o resultado. No modo Ao finalizar, sessões sem confirmação de finalização podem aguardar o deadline existente de 15 segundos após Parar (90 segundos no Extended). Isso não limita a duração da gravação. A sincronização entre abas, janelas e service worker ainda requer homologação física no Chrome instalado.

O seek exato por palavra ainda está indisponível. No ciclo de correção anterior à publicação, foram testadas duas narrações reais simultâneas no Chrome; o usuário confirmou silêncio nas pausas individual/global e ao fim da sequência de Stop. O seek cumulativo em pausa foi medido no cursor PCM. A retomada seletiva teve evidência técnica, mas o usuário não conseguiu distinguir as vozes para homologá-la pelo ouvido. Controles no popup nativo, Opções e janela individual, assim como microfone físico e inserção nesta versão, não foram homologados integralmente pela automação. Uma geração retornou áudio muito curto; o replay explícito posterior retornou áudio longo, sem alteração da geração para contornar o resultado.

Não há ganho comparativo de latência comprovado para o scheduler nem teto real de TPM conhecido automaticamente. Os testes reais anteriores do scheduler usaram áudio sintético e não substituem homologação física da instalação atual.

Consulte as [notas da v1.0.4](docs/RELEASE-v1.0.4.md), as [notas da v1.0.3](docs/RELEASE-v1.0.3.md), o [histórico v1.0.2](docs/RELEASE-v1.0.2.md), as [notas v1.0.1](docs/RELEASE-v1.0.1.md) e a [release v1.0.0](https://github.com/pinguelanarosca/FalaMermo/releases/tag/v1.0.0).

## Validação do código

Com Node.js instalado:

```sh
node --test tests/*.test.cjs
node tools/verify-publication.cjs
git diff --check
```

O verificador confere recursos, versão do manifest, sintaxe JavaScript e padrões de segredos nos arquivos públicos selecionados. Isso não substitui homologação física. `node tools/package-release.cjs` gera o pacote da versão pública, verifica as entradas e a extração e calcula seu SHA-256; os artefatos em `dist/` não entram no Git.
