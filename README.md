# FalaMermo

Extensão Chrome Manifest V3 para narração, ditado e seleção visual com Gemini, agentes personalizados e HUD na página.

FalaMermo 1.0 é a primeira versão pública. A tag é `v1.0.0`; a versão interna do manifest permanece `2.0.1`, preservando a sequência de desenvolvimento.

## Instalação no Chrome

1. Baixe `FalaMermo-v1.0.0.zip` na [release](https://github.com/pinguelanarosca/FalaMermo/releases/tag/v1.0.0).
2. Extraia o ZIP para uma pasta permanente. `manifest.json` deve estar diretamente nessa pasta.
3. Abra `chrome://extensions`, ative **Modo do desenvolvedor** e escolha **Carregar sem compactação**.
4. Selecione a pasta extraída, abra as opções da extensão e configure sua chave Gemini.
5. Atualize as páginas que já estavam abertas. Após atualizar/recarregar a extensão, atualize também essas páginas.

Alternativamente, clone este repositório e carregue sua raiz como extensão sem compactação. Não há etapa de build obrigatória.

## Configuração e utilização

Nas opções, salve sua chave Gemini e escolha o agente ativo. É possível configurar até nove chaves, criar/editar agentes e ajustar os parâmetros disponíveis por modelo. Cada tentativa real pode consumir cota; criar um agente local não cria uma voz remota.

- **Narração:** selecione texto na página e use “Ler seleção” no popup, menu de contexto ou HUD. O HUD controla reprodução, pausa, parada, volume e velocidade.
- **Ditado:** posicione o cursor em um campo editável, clique “Ditar” e autorize o microfone. Clique novamente em Ditar ou em Parar para concluir. A inserção usa o campo/seleção original; não deve acompanhar uma mudança de foco para outro campo. Se o campo desaparecer, copie o resultado mostrado no HUD.
- **Lens:** clique Lens no HUD e selecione uma região. Quando necessário, a extensão abre sua própria interface para pedir autorização opcional de captura. A autorização exige acesso a todos os sites por uma limitação da API de captura do Chrome. Pode ser recusada ou revogada; não é concedida permanentemente na instalação. A captura depende de uma ação explícita do usuário.
- **Personalização:** agentes compartilham identidade e mantêm instruções próprias para narração, ditado e Lens. Há configurações por modelo e editor avançado com painel, override JSON, JSON completo e preview. Parâmetros incompatíveis não devem ser enviados indiscriminadamente entre STT e TTS.

Atalhos internos padrão: `Ctrl+B` para ler seleção, `Ctrl+Shift+Space` para iniciar/parar ditado, `Ctrl+Shift+L` para Lens, `Pause` para pausar/retomar e `Alt+Shift+H` para alternar o HUD. São configuráveis nas opções. O Chrome também oferece os comandos `Alt+Shift+S`, `Alt+Shift+D` e `Alt+Shift+H`, configuráveis em `chrome://extensions/shortcuts`; atalhos podem conflitar com a página ou o sistema.

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

Há histórico/diagnósticos locais. Não exporte nem publique seu armazenamento, chaves, áudio, textos pessoais ou instruções privadas. Os diagnósticos persistidos específicos de reprodução TTS usam um resumo limitado e sanitizado; isso não torna todo histórico da extensão livre de conteúdo pessoal.

## Limitações conhecidas

- A versão foi considerada suficientemente funcional pelo responsável após teste manual. Isso não equivale a homologação completa de todo navegador, site, editor, chave e modelo.
- Microfone físico, inserção e cenários de reload/contexto invalidado não foram novamente homologados de ponta a ponta pela automação da publicação. A referência `svg` relatada no DevTools ainda não foi correlacionada a um stack original.
- Depois de recarregar a extensão, um content script antigo pode perder autorização para comunicar-se. O STT trata a invalidação, libera sua captura e orienta F5; não reconecta nem recarrega páginas automaticamente. Uma página com código anterior à correção precisa ser atualizada para receber a proteção.
- Campos removidos, editores especiais, páginas internas/restritas do Chrome e permissões recusadas podem impedir inserção/captura. Lens não funciona em todas as páginas.
- Conectividade, cotas, permissões de modelo, latência, mudanças do serviço e encerramento de previews podem afetar o funcionamento. Não há promessa de tempo fixo ou disponibilidade de todas as chaves.
- Extended Thinking utiliza configuração específica de thinking e VAD manual no ditado. VAD automático desse modelo não foi homologado. Reprodução audível e microfone físico não foram repetidos durante a publicação.

Consulte as [notas de lançamento](docs/RELEASE-v1.0.0.md).

## Testes e pacote

Com Node.js e as ferramentas `zip`/`unzip` instaladas:

```sh
node --test tests/*.test.cjs
node tools/verify-publication.cjs
node tools/package-release.cjs
```

O empacotador usa uma lista explícita de recursos, verifica o ZIP extraído e gera o checksum em `dist/`. Testes, Git, diagnósticos históricos, arquivos temporários e configurações pessoais não entram no ZIP.
