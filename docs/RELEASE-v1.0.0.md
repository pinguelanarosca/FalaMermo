# FalaMermo 1.0

Primeira versão pública do FalaMermo, uma extensão Chrome com narração e ditado Gemini Live, agentes personalizados, HUD e Lens.

## Recursos

- Narração Gemini Live por WebSocket, player PCM e controles de reprodução no HUD.
- Ditado Gemini Live com transcrição parcial/final, inserção no campo originalmente selecionado e liberação da captura na parada/cancelamento.
- Agentes e instruções próprias para TTS, STT e Lens; personalização e configurações avançadas por modelo.
- Editor de configuração com painel, override JSON, JSON completo e preview.
- Lens para seleção visual, preservando seu processamento existente e solicitando autorização opcional de captura pela interface da extensão quando necessária.
- Seleção dos quatro modelos Live gerais, com prioridade padrão: `gemini-3.8-live` → `gemini-3.8-live-extended-thinking` → `gemini-3.1-flash-live-preview` → `gemini-2.5-flash-native-audio-preview-12-2025`. Preferências explícitas válidas são preservadas.
- Gerenciamento de até nove chaves, fallback esgotando as chaves elegíveis no mesmo modelo antes da troca, ranking oportunista e preservação das configurações locais.
- Correções de lifecycle STT para tratar contexto invalidado, rejeições de Promises e eventos tardios, sem reconexão ou reload automático da página.

TTS e STT usam exclusivamente Gemini Live. Não foi introduzido fallback unary, Flash TTS convencional ou Transcribe especializado. Lens mantém sua rota de visão. A arquitetura e os fluxos existentes de processamento, chunking/paralelismo e player foram preservados, sem refatoração para esta publicação.

## Instalação e chave Gemini

Baixe **FalaMermo-v1.0.0.zip**, extraia-o para uma pasta permanente e confirme `manifest.json` na raiz. Em `chrome://extensions`, ative Modo do desenvolvedor, clique Carregar sem compactação e selecione essa pasta. Abra as opções da extensão, salve sua própria chave Gemini e escolha o agente. Atualize as páginas já abertas.

Para narração, selecione texto e use Ler seleção. Para ditado, selecione o campo editável e clique Ditar; autorize o microfone e conclua por Parar/Ditar. Para Lens, clique no HUD, autorize a captura se solicitado e selecione a região. Instalação e detalhes no [README](https://github.com/pinguelanarosca/FalaMermo/blob/main/README.md).

## Privacidade

O pacote não contém chaves, tokens, dados do Chrome ou configurações pessoais. Cada usuário informa suas próprias chaves, armazenadas localmente no perfil do navegador; isso não é armazenamento criptográfico de segredos.

Texto, áudio de ditado, imagem selecionada e instruções necessárias são enviados ao Gemini quando os recursos são utilizados. Histórico e diagnósticos locais podem conter conteúdo pessoal; não publique exportações do seu perfil/armazenamento. A captura Lens exige ação explícita e pode solicitar permissão opcional para todos os sites, revogável nas permissões da extensão.

## Verificação e limitações conhecidas

- O responsável testou manualmente a versão atual e autorizou seu lançamento inicial por considerá-la suficientemente funcional.
- Na preparação desta publicação, `node --test tests/*.test.cjs` aprovou 19 arquivos, sem falhas. A verificação de sintaxe e de recursos do manifest/pacote foi executada. Esses testes não substituem homologação física no Chrome.
- Cenários completos de microfone físico, inserção em diferentes editores, reload durante STT e referência `svg` no stack do DevTools permanecem sem confirmação independente pela automação. A release não declara esses cenários completamente homologados.
- Após reload da extensão, atualize páginas antigas para receber os content scripts atuais. O contexto invalidado não pode ser recuperado repetindo mensagens; o HUD orienta F5.
- Sites com editores especiais, campos removidos, páginas restritas do Chrome e permissões negadas podem limitar inserção/Lens. Campos indisponíveis mantêm a transcrição no HUD para cópia.
- Acesso aos modelos, conexão, cotas, latência e disponibilidade do Gemini dependem do serviço e das chaves. Os dois modelos preview podem ser descontinuados. O VAD automático do Extended Thinking não foi homologado; seu ditado utiliza VAD manual.
- Não foram repetidas chamadas Gemini, reprodução audível ou testes físicos de microfone apenas para a publicação.

A tag pública é **v1.0.0**. A versão interna do manifest continua **2.0.1**, sem redução artificial. O ZIP é uma extensão sem compactação para instalação manual; não é publicação na Chrome Web Store. O checksum SHA-256 acompanha o pacote.
