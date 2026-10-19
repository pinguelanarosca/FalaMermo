# FalaMermo v1.0.4 — controles de reprodução e HUD

Consolidação das correções locais sobre a v1.0.3. Versão pública e `manifest.json.version`: **1.0.4**, com `manifest_version: 3`. Preserva configurações e não exige build para instalação.

## Reprodução

- Controles globais **⏪ ▶/⏸ ⏩** no HUD, popup e Opções. Pause atua em todas as narrações; Play retoma somente a pausada mais recentemente. Sem pausadas, fica desabilitado e não reinicia tarefas concluídas.
- Cada cartão TTS expandido e sua janela têm **⏪ ▶/⏸ ⏩ ■**, restritos àquela tarefa. Replay de concluída exige clique explícito e inicia nova narração.
- Pausa silencia o ganho final do grafo, confirma o worklet e aguarda o AudioContext suspenso. Retomada conserva posição e buffer. Alterar volume durante pausa não libera som.
- ACKs identificam comando, sequência, job, player e request. Player inexistente, request antigo, timeout ou suspensão sem efeito não devem resultar em falsa confirmação. Stop antigo não cancela uma reprodução nova.
- Setas navegam **5 segundos de PCM recebido por clique**, cumulativamente, durante reprodução ou pausa. Respeitam o buffer disponível e a retenção recente de até aproximadamente 60 segundos. Não enviam áudio/texto novamente ao Gemini. Seek exato por palavra permanece indisponível.

## Interface, tarefas e histórico

- HUD minimizado conserva os três controles globais no cabeçalho, sem duplicar handlers. Cartões recolhidos mantêm somente a linha compacta; controles individuais ficam na área expandida.
- Popup com altura intrínseca definida, lista rolável e cabeçalho/player acessíveis. Scrollbars visualmente ocultas, mantendo rolagem e teclado.
- Estado de tarefas compartilhado entre abas e painéis, com recuperação de viewers e ordem de criação estável. X oculta o cartão sem parar a tarefa ou apagar seu resultado.
- Janela individual reutiliza o mesmo job; fechar a janela não é um comando de cancelamento. Edição TTS exige parar/concluir; edição STT é cópia de trabalho, sem reescrever a transcrição original ou o destino já inserido.
- Retenção de histórico configurável e reabertura de resultados, com limites de armazenamento e proteção dos rascunhos. Não é backup de áudio ou do contexto Gemini.

## STT e diagnósticos

- Inicialização do ditado aguarda a leitura da preferência de inserção, evitando assumir modo antigo enquanto o armazenamento responde. Falha de leitura é explícita. Confirmação de inserção concluída não é sobrescrita por evento tardio de perda da origem.
- Preservados PCM contínuo, VAD, overlap, parciais, merge, cancelamento, campo original e liberação do microfone, assim como o scheduler STT das nove contas independentes, fallback por chaves antes de modelos e Zero-Retry. Não há hedging ou duplicação de áudio.
- Diagnóstico TTS sanitizado aceita jobs manuais e registra AudioContext, pausa do worklet, saída silenciada, cursor PCM e ACKs, incluindo erros de controle. Mantém limites e TTL fora do ciclo de vida do offscreen.

No Console de `options.html`, mesmo depois da narração:

```javascript
await LiveTtsDiagnostics.get()
```

## Preservação e privacidade

Mantidos Gemini Live exclusivo em STT/TTS, prioridade de modelos, geração TTS, literalidade, vozes, agentes, System Instructions, DSP local, JSON avançado, chunking, paralelismo, ranking oportunista e Lens. Nenhum reset de configurações pessoais.

As chaves são configuradas localmente nas Opções, não fornecidas no Git ou no pacote. Ao usar a extensão, o conteúdo necessário ao recurso é enviado ao Gemini: texto/instruções, áudio de microfone ou recorte visual. Histórico e estado de tarefas podem conter conteúdo pessoal; não os publique. Diagnósticos sanitizados não incluem chaves, PCM, base64 ou instruções privadas.

## Instalação e atualização

1. Baixe `FalaMermo-v1.0.4.zip` e, se desejar, confira seu SHA-256 no arquivo de checksum anexado. Extraia o ZIP: `manifest.json` fica na raiz.
2. Em `chrome://extensions`, ative Modo do desenvolvedor e escolha **Carregar sem compactação**, selecionando a pasta extraída.
3. Abra as Opções, configure suas API keys Gemini e escolha o agente. Para ditar, foque o campo original, autorize o microfone e aguarde “Gravando”. Para narrar, selecione texto e use o atalho ou o menu **Narrar**; use **+** para texto manual.
4. Ao atualizar uma instalação existente, feche tarefas, atualize a mesma pasta, recarregue a extensão e atualize as páginas abertas. Não remova a extensão nem apague seu armazenamento.

## Evidências e limitações conhecidas

No ciclo de correção anterior a este versionamento, duas narrações reais foram reproduzidas simultaneamente no Chrome. O usuário confirmou silêncio após pausa individual, pausa global das duas narrações e ao final dos comandos de Stop. O seek em pausa foi medido: 120.000 amostras por clique a 24 kHz, equivalentes a 5 segundos. Os controles permaneceram acessíveis no HUD minimizado.

Esses resultados não equivalem a homologação integral. Permanecem **NÃO VERIFICADOS pelo ouvido** a retomada seletiva e o isolamento entre vozes: a evidência técnica de estados e cursores foi obtida, mas o usuário não conseguiu distinguir as vozes. Houve também interação manual durante a sequência; reproduções adicionais não comprovam replay automático.

Controles no popup nativo, Opções e janela individual não foram exercitados integralmente pela automação instalada. Microfone físico e inserção STT não foram novamente homologados de ponta a ponta neste ciclo. Uma geração retornou menos de um segundo de PCM; o replay explícito posterior retornou áudio longo. Não foi alterado o motor de geração para contornar essa variação.

Não há seek exato por palavra, garantia de disponibilidade dos modelos ou ganho comparativo de latência comprovado para o scheduler. Tetos de TPM desconhecidos não são tratados como infinitos; TTS/Lens e outros consumidores não estão integralmente incluídos no budget STT. Páginas restritas, dispositivos, permissões, rede e mudanças do serviço podem limitar os recursos.

A preparação desta publicação executa a suíte completa, o verificador de publicação/sintaxe, revisão de arquivos públicos e padrões de segredos, `git diff --check` e verificação do ZIP extraído. Não exige nem declara uma nova homologação física completa. Relatórios locais, capturas, logs, credenciais, perfis e pacotes antigos ficam fora do commit e da distribuição.
