# Discovery: primeira rodada de correções da IA

Implementação de 20/09/2026. As verificações desta rodada usam respostas simuladas; nenhuma chamada paga foi executada.

## Contexto

A interpretação recebe a hipótese completa, nome/tipo/propósito do projeto, um índice compacto dos alvos da arquitetura e detalhes selecionados. A seleção determinística usa palavras, um pequeno vocabulário português/inglês, até 12 alvos iniciais, suas relações imediatas, ancestrais e requisitos relacionados. Os limites são 40 objetos detalhados, 64 relações e 32 evidências. Direção, origem, confiança e citações são mantidas. Documentos completos, pessoas, coordenadas, cenários antigos e histórico administrativo não são enviados.

São incluídos até oito cartões diretamente conectados, com direção da conexão, e os seis últimos pares de pergunta/resposta do cartão atual. Cartões vizinhos são identificados como hipóteses do usuário: ajudam a resolver referências, mas não são evidência técnica nem autorizam alterações adicionais. Citações de mudanças precisam vir da hipótese atual ou de esclarecimentos explícitos.

O contexto selecionado tem orçamento agregado de 100 mil caracteres, além da hipótese e das instruções. As omissões ficam explícitas; trechos de evidência não são cortados no meio. O índice de nomes ajuda a reconhecer ambiguidades mesmo quando um objeto não recebeu detalhes.

## Configuração Gemini

`GEMINI_MODEL` continua sendo o modelo global. `GEMINI_THINKING_LEVEL` agora é lido e enviado no REST como `generationConfig.thinkingConfig.thinkingLevel`, com enum em maiúsculas. Sem nível configurado, permanece o padrão do provedor.

Cada funcionalidade aceita overrides:

| Funcionalidade | Prefixo | Limite padrão de saída |
| --- | --- | --- |
| Interpretação da Discovery | `GEMINI_DISCOVERY_` | 8192 tokens |
| Extração da arquitetura | `GEMINI_EXTRACTION_` | 16000 tokens |
| Organização dos cartões | `GEMINI_ORGANIZATION_` | 6000 tokens |

Os sufixos são `MODEL`, `THINKING_LEVEL` e `MAX_OUTPUT_TOKENS`. Nível vazio herda o global; `default` mantém o padrão do provedor mesmo quando existe nível global. Exemplo: global `high`, Discovery `medium`, organização `low`. Os níveis são controles de esforço; não garantem precisão.

O `gemini-3.8-flash` aceita `low`, `medium` e `high`. Não aceita `minimal` na matriz verificada. O código mantém uma matriz explícita dos modelos de texto Gemini 3 conhecidos. Em `generateContent`, modelos anteriores ao Gemini 3 não aceitam `thinkingLevel`: combinar Gemini 2.5 com esse nível gera erro de configuração, sem tradução arbitrária para orçamento e sem troca de modelo. Modelos desconhecidos com nível explícito também exigem revisão da matriz. Modelo com sintaxe inválida nunca usa fallback; nome sintaticamente válido sem nível explícito é enviado como configurado e pode ser rejeitado pelo provedor.

Referências verificadas: [níveis por modelo](https://ai.google.dev/gemini-api/docs/thinking), [contrato REST de ThinkingConfig e respostas](https://ai.google.dev/api/generate-content), [catálogo de modelos](https://ai.google.dev/gemini-api/docs/models). A tabela de Interactions não deve ser usada para supor compatibilidade de Gemini 2.5 com `thinkingLevel` no endpoint REST `generateContent`.

## Respostas e falhas

- `resolved` e `confirmation`: proposta validada para o fluxo de impacto existente.
- `clarification`: pergunta específica sobre intenção realmente ausente; não é fallback de validação.
- `unsupported`: pedido compreendido fora das operações atuais, valor relativo sem base documentada ou proposta sem mudança efetiva.
- `error`: contrato inválido, alvo inexistente, citação ausente, unidade incompatível ou outra rejeição técnica. Valores independentes que passaram pela validação permanecem em `understood`, sem gerar uma alteração parcial aplicável.

Perguntas e confirmações com identificadores internos são rejeitadas. Uma confirmação inválida nunca vira aceitação implícita. Erros de configuração, transporte, bloqueio e interrupção possuem códigos próprios. O cartão mantém o texto para nova tentativa; respostas atrasadas são descartadas se hipótese, contexto conectado ou arquitetura mudarem.

O transporte compartilhado exige exatamente um candidato com `finishReason=STOP`, ignora partes de pensamento e valida JSON e metadados numéricos. `MAX_TOKENS`, bloqueios, ausência do motivo de término e orçamento de saída esgotado são rejeitados mesmo com JSON válido. O orçamento considera tokens de resposta e de pensamento. Metadados ausentes são registrados como indisponíveis, não como comprovação de consumo zero. Não há repetição automática para interrupções; Discovery usa uma única tentativa por solicitação.

Logs normais registram funcionalidade, modelo, duração, HTTP, motivo de término, contagem de tokens e códigos de rejeição. Não incluem hipótese, respostas, citações, dados pessoais ou mensagens brutas de erro do provedor. Hooks explícitos de diagnóstico existentes podem receber payloads para testes/experimentos; não devem ser tratados como logs de produção.

## Texto e compatibilidade

A hipótese pode ter até 6000 caracteres. `text` mantém um título de até 220; `description`, opcional, guarda o conteúdo integral. Cartões antigos usam `text` como conteúdo. Esclarecimentos são adicionados ao texto completo e preservados como pares de pergunta/resposta. O editor distingue editar o texto original de responder à pergunta pendente. Duplicação, armazenamento local e sincronização preservam descrição e esclarecimentos.

A descrição completa também chega à organização existente de cartões. Reescritas dessa funcionalidade afetam o título; não substituem uma descrição completa. O contrato de persistência de propostas aceita a descrição maior. O algoritmo de avaliação de impacto não foi alterado.

## Limites e decisões restantes

A seleção de detalhes ainda é lexical e pode deixar de recuperar contexto expresso por sinônimos fora do vocabulário. O índice compacto reduz essa limitação, mas não oferece compreensão semântica garantida. Fontes não extraídas na arquitetura continuam indisponíveis à Discovery.

Esta etapa continua propondo parâmetros, requisitos e substituição de um componente. Não cria componentes, relações, fórmulas nem múltiplas mudanças independentes. Essas intenções agora recebem uma limitação explícita. A validação confere estrutura, referências, citações e unidades; não prova toda a interpretação semântica do Gemini. A qualidade real, o custo e a latência precisam de uma avaliação posterior autorizada com o provedor.

Ainda é necessário decidir como representar hipóteses qualitativas, propostas com vários alvos, distinção entre esclarecimento e confirmação em casos limítrofes, política de contexto omitido e quais níveis/orçamentos oferecem a melhor relação entre qualidade e custo para cada funcionalidade. Não há chatbot, serviço adicional ou migração destrutiva nesta rodada.

## Verificação

`npm run quality` cobre tipos, lint, testes unitários/API e build. Os novos casos reproduzem omissão de relações/cartões/esclarecimentos, limite de 220 caracteres, perda de dados válidos por rejeição, fallback de modelo, configuração de raciocínio e aceitação de JSON interrompido. `npm run test:visual` usa API local, banco temporário e Gemini simulado para conferir edição, esclarecimento, duplicação e persistência, além dos fluxos de concepção e impacto existentes.
