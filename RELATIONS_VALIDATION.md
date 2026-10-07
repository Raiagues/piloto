# Validação das relações e da ata — registro auditável

Este documento registra resultados observados e mudanças de arquitetura. **Acertar o gabarito não equivale a eliminar a incerteza nem demonstrar correção universal em reuniões reais.** As rodadas abaixo mantêm as distribuições, avisos e falhas originais. A consolidação final abaixo inclui o conjunto natural, o B002 com ensaios identificados, divergências restantes e correções de gabarito auditadas.

## Como ler os resultados

- `upstream-only`: chamadas reais de retenção, tipo de evento e atribuição de thread; relações ainda não medidas.
- `isolated`: somente relações usam JEV real; eventos, tipos e threads são fornecidos pelas anotações. Não é validação integral da reunião.
- `from-run`: relações usam JEV real sobre os outputs reais de uma rodada anterior, restaurada e verificada. Não repete o classificador de chunks/threads.
- `end-to-end`: a execução faz chamadas reais para as três etapas.
- Pares corretos exigem todas as dimensões explicitamente anotadas no par, inclusive match quando presente. Pares sem gabarito não são negativos implícitos nem acertos.
- Revisão conta pares cuja probabilidade da classe prevista é inferior a 0,8 em alguma etapa. A coluna não usa o campo separado `confidence`.
- `classifications_correct` e `all_checks_passed` têm significados diferentes: a segunda condição também exige ausência de avisos de probabilidade e aprovação das etapas anteriores. As rodadas finais mantêm `all_checks_passed=false` quando há avisos ou divergências; o código de saída 1 do verificador nesses casos não é ocultado.
- Checkpoints `0/0` significam que aquela rodada não tinha checkpoints de lifecycle registrados; não representam demonstração de fechamento correto.

A inferência usa somente eventos anteriores e campos semânticos permitidos. Gabaritos, notas de revisão e checkpoints ficam no avaliador. Cada artefato conserva requests/responses originais e o snapshot exato das perguntas; não há repetição automática de chamada possivelmente faturada. As métricas da tabela são as gravadas naquela rodada, **não uma reavaliação retroativa contra o gabarito atual**. Mudanças entre rodadas podem incluir perguntas e revisões documentadas de input/anotação; portanto a cronologia, isoladamente, não é uma ablação causal.

## Cronologia das execuções

Horários UTC de 2026-10-06, obtidos do início da primeira chamada do artefato. Os links levam aos dados completos; o arquivo de mesmo nome terminado em `.summary.json` contém o resumo original.

| UTC | Artefato | Modo | Chunks / threads corretos | Pares corretos | Não processados | Pares em revisão | Lifecycle | Observação |
|---|---|---|---|---|---|---|---|---|
| 03:59:47 | [curated-upstream](.runtime/typed-relations/curated-upstream.json) | upstream-only | 19/20 · 18/20 | — | — | — | — | Divergências preservadas. |
| 04:00:55 | [curated-relations-v1](.runtime/typed-relations/curated-relations-v1.json) | isolated | anotados, não avaliados | 84/94 | 0 | 46 | 8/12 | Schema 1. Divergências preservadas. |
| 04:03:34 | [curated-upstream-v2](.runtime/typed-relations/curated-upstream-v2.json) | upstream-only | 20/20 · 20/20 | — | — | — | — | Classes de acordo com gabarito; avisos ainda presentes. |
| 04:05:29 | [curated-relations-v2](.runtime/typed-relations/curated-relations-v2.json) | from-run | 20/20 · 20/20 | 89/94 | 0 | 24 | 11/12 | Schema 2. Divergências preservadas. |
| 04:09:44 | [curated-relations-v3](.runtime/typed-relations/curated-relations-v3.json) | from-run | 20/20 · 20/20 | 91/94 | 0 | 29 | 11/12 | Schema 2. Divergências preservadas. |
| 04:12:32 | [curated-v4-end-to-end](.runtime/typed-relations/curated-v4-end-to-end.json) | end-to-end | 20/20 · 20/20 | 67/94 | 22 | 39 | 7/12 | Schema 2. Interrompida: HTTP 502 / provedor sobrecarregado; sem retry automático. |
| 04:14:04 | [curated-v5](.runtime/typed-relations/curated-v5.json) | from-run | 20/20 · 20/20 | 90/94 | 0 | 36 | 10/12 | Schema 2. Divergências preservadas. |
| 04:14:15 | [holdout-upstream](.runtime/typed-relations/holdout-upstream.json) | upstream-only | 11/12 · 12/12 | — | — | — | — | Divergências preservadas. |
| 04:16:08 | [b002-upstream](.runtime/typed-relations/b002-upstream.json) | upstream-only | 43/43 · 17/28 | — | — | — | — | Divergências preservadas. |
| 04:18:31 | [curated-v6](.runtime/typed-relations/curated-v6.json) | from-run | 20/20 · 20/20 | 93/94 | 0 | 24 | 11/12 | Schema 2. Divergências preservadas. |
| 04:20:08 | [curated-v7](.runtime/typed-relations/curated-v7.json) | from-run | 20/20 · 20/20 | 94/94 | 0 | 23 | 12/12 | Schema 2. Classes de acordo com gabarito; avisos ainda presentes. |
| 04:20:46 | [b002-upstream-final](.runtime/typed-relations/b002-upstream-final.json) | upstream-only | 43/43 · 28/28 | — | — | — | — | Classes de acordo com gabarito; avisos ainda presentes. |
| 04:21:27 | [holdout-v7](.runtime/typed-relations/holdout-v7.json) | from-run | 11/12 · 12/12 | 29/30 | 0 | 9 | 4/4 | Schema 2. Divergências preservadas. |
| 04:22:38 | [b002-final](.runtime/typed-relations/b002-final.json) | from-run | 43/43 · 28/28 | 104/112 | 0 | 31 | 0/0 | Schema 2. Divergências preservadas. |
| 04:25:11 | [b002-v8](.runtime/typed-relations/b002-v8.json) | from-run | 43/43 · 28/28 | 108/112 | 0 | 38 | 0/0 | Schema 2. Divergências preservadas. |
| 04:27:56 | [natural-upstream](.runtime/typed-relations/natural-upstream.json) | upstream-only | 10/10 · 8/8 | — | — | — | — | Classes de acordo com gabarito; avisos ainda presentes. |
| 04:27:57 | [curated-v8](.runtime/typed-relations/curated-v8.json) | from-run | 20/20 · 20/20 | 86/94 | 0 | 24 | 11/12 | Schema 2. Divergências preservadas. |
| 04:30:17 | [b002-clarified-upstream](.runtime/typed-relations/b002-clarified-upstream.json) | upstream-only | 43/43 · 28/28 | — | — | — | — | Classes de acordo com gabarito; avisos ainda presentes. |
| 04:32:02 | [curated-v9](.runtime/typed-relations/curated-v9.json) | from-run | 20/20 · 20/20 | 94/94 | 0 | 20 | 12/12 | Schema 2. Classes de acordo com gabarito; avisos ainda presentes. |
| 04:33:38 | [holdout-final](.runtime/typed-relations/holdout-final.json) | end-to-end | 11/12 · 12/12 | 29/30 | 0 | 7 | 4/4 | Schema 2. Divergências preservadas. |

## Revisões rastreáveis de inputs e gabaritos

As anotações detalhadas estão em `review_notes` de cada fixture. Os artefatos de execução guardam a fixture usada na época; não se deve substituir a fixture original dentro deles para melhorar a métrica. O B002 anterior à revisão permanece em [memory-b002-original.json](tests/fixtures/memory-b002-original.json).

- [Curated](tests/fixtures/typed-relations-curated.json): `label_revisions` registra L05 como requisito por esclarecer uma condição especificada; permite `repeats` sobre um resultado que identifica a execução anterior; reconhece substituição explicitamente implementada em F10→F08; explicita em L06 a comparação com o plano L1, preservando a temperatura diferente como `mismatch`. As notas explicam a mudança sem usá-la como resposta da API.
- [Holdout](tests/fixtures/typed-relations-holdout.json): registra H11 como requisito e a revisão geral de `repeats` sobre uma execução identificada. O fato de um conjunto ter sido separado inicialmente não o torna indefinidamente independente depois de inspecionado durante desenvolvimento.
- [B002 com relações](tests/fixtures/typed-relations-b002.json): conserva 112 pares anotados e 13 pares elegíveis sem gabarito por ambiguidade. Falas sem uma execução identificável não receberam artificialmente um alvo único. C38 continua observação quando o texto não declara execução de teste.
- [B002 clarificado](tests/fixtures/typed-relations-b002-clarified.json): é uma variante separada; as diferenças devem ser lidas em `review_notes.clarified_variant`, sem substituir o B002 original nas comparações.
- [Conversa natural](tests/fixtures/typed-relations-natural.json): contém falas curtas e referências contextuais; `pair_rationales`, `unannotated_pairs` e `annotation_policy` explicitam decisões e lacunas de anotação.

## Sondagens controladas e alternativas rejeitadas

Estes experimentos são chamadas reais com alterações isoladas de contexto ou formulação. Não modificam automaticamente arestas nem gabaritos. Os números abaixo são probabilidades das opções, preservadas integralmente nos links.

| Experimento | Chamadas | Evidência observada | Conclusão limitada |
|---|---:|---|---|
| [Isolamento de configuração](.runtime/typed-relations/probes/context-isolation.json) | 6 | F11→F10 passou de exact 0,46 no baseline para mismatch 0,79 sem histórico; L07→L06 atingiu exact 0,99. F12→F05 ainda escolheu partial 0,65. | Contexto de um único par melhorou esses matches; não resolveu sozinho a aplicabilidade de uma justificativa. Embasou schema 2. |
| [Tipos explícitos e justificativa atômica](.runtime/typed-relations/probes/context-v2.json) | 5 | Prefixar tipos não resolveu os quatro vínculos controversos; a pergunta de justificativa F12→F05 retornou not_applicable 1,00. | Evidência localizada para tornar mais explícito o propósito da comparação; não demonstra generalização. |
| [Contexto vazio versus três anteriores](.runtime/typed-relations/probes/relations-context-v5.json) | 8 | L06→L04 permaneceu related_to com 0,87/0,80; L08→L03 permaneceu none com 0,77/0,54. | Rejeitada como solução geral para o tipo da relação; histórico reduzido não eliminou a interferência semântica. |
| [Gate NOUL de aplicabilidade](.runtime/typed-relations/probes/applicability-noul.json) | 6 | Respondeu true nos seis pares: 0,84; 0,85; 0,81; 0,88; 0,89; 0,88. Os três primeiros tratavam de hipótese/justificativa sem equivalência de setup. | Rejeitado: separar essa pergunta nesta formulação não corrigiu a aplicabilidade. Não incorporado à produção. |

A comparação v8 também foi preservada: o B002 melhorou de 104/112 para 108/112, mas o curated caiu de 94/94 na v7 para 86/94 na v8. Portanto não se escolheu uma versão somente pelo ganho no lote usado naquele ajuste. A execução v4 teve falha HTTP 502; seus pares não processados permanecem no denominador. Não é correto apresentá-la como teste integral concluído.

## Verificação de implementação e artefato PDF

Após as correções de integridade, passaram 41 testes direcionados: `typed-relations.test.cjs`, `typed-relations-persistence.test.cjs`, `verify-typed-relations.test.cjs` e `meeting-minutes.test.cjs`. Usam respostas locais controladas para verificar regras do software; não contam como acurácia do JEV. Foram cobertos: arestas reconstruídas a partir de outputs, descarte de projeção inventada, rejeição de request adulterado e resposta faltante, cancelamento sem retry, gabarito ausente, parâmetros incompatíveis, resultados retirados e cadeias de substituição que não reativam versões antigas.

A inconsistência de estado global encontrada na revisão independente foi corrigida: falhas em `onChange`, inclusive na notificação final, agora registram `worker.error`, encerram o worker como `error` e preservam esse diagnóstico na restauração. O primeiro erro não é substituído por uma falha secundária de limpeza. Parar ou falhar no callback anterior ao transporte não envia nem contabiliza chamada. Snapshots com worker `done` e jobs incompletos/erro são rejeitados. Os novos testes cobrem esses limites antes e depois da resposta; 16 artefatos históricos auditados foram restaurados sem mudar outputs ou arestas. O teste de navegador das relações também passou após a correção.

A consulta de gabaritos verifica propriedades próprias: IDs como `constructor` e `toString` não recebem um gabarito herdado de JavaScript. Anotações explícitas com esses IDs continuam válidas. O resumo indexa os pares por origem e destino com mapas, incluindo pares cujo request não pôde ser preparado, mantendo-os como não processados quando não há resposta.

A [ata demonstrativa real](.runtime/typed-relations/curated-meeting-minutes.pdf) foi produzida do `curated-v7.json` restaurado, usando os mesmos módulos de lifecycle/ata/PDF da interface. A [verificação](.runtime/typed-relations/curated-meeting-minutes.verification.json) guarda o SHA-256 da fonte: 6 páginas, 20 falas completas E001–E020, 25 relações e 26 avisos preservados por extração `pdftotext`. Os testes com mismatch, partial e ambiguous correspondentes permaneceram abertos. Nenhuma chamada ao modelo foi feita para gerar a ata. O [texto extraído](.runtime/typed-relations/curated-meeting-minutes.txt) permite conferir o conteúdo. Contagem de avisos da ata não é igual à contagem de pares de baixa probabilidade: também inclui incompatibilidades de configuração.

No Chrome, a validação da interface confirmou seleção com offsets UTF-16, comentários persistidos em namespace próprio, resolução/reabertura, exportação, download real de PDF multipágina e preservação da acentuação. Comentários não alteram previsões nem se tornam automaticamente verdade de treinamento. A fonte é verificada antes da exportação: caracteres sem cobertura bloqueiam o PDF em vez de desaparecer.

## Fontes primárias e decisões de arquitetura

- A [introdução oficial do JEV](https://docs.typesafe.ai/introduction) descreve perguntas independentes contra o mesmo state e recomenda decomposição de julgamentos. A aplicação primeiro recebe o tipo previsto e depois o fornece à pergunta de configuração; uma resposta não é presumida como disponível a outra pergunta na mesma chamada.
- A [referência HTTP oficial](https://docs.typesafe.ai/api) define `state`, `questions`, `model` e respostas por pergunta. Cada request de produção usa o provedor oficial; as chaves de API permanecem no servidor e não entram nos artefatos de feedback.
- As [distribuições Choice](https://docs.typesafe.ai/primitives/choice) e a [documentação de confiança](https://docs.typesafe.ai/confidence) distinguem probabilidade da opção e a estatística `confidence`. O limiar local é aplicado à primeira; não foi reduzido para esconder avisos.
- O [jsPDF 4.2.1](https://github.com/parallax/jsPDF/tree/v4.2.1) fornece geração local do PDF, com fonte TTF incorporada. A [licença DejaVu](https://dejavu-fonts.github.io/License.html) permite redistribuição sob suas condições. Versões, licenças e hashes locais constam em [vendor/minutes/README.md](vendor/minutes/README.md).

## Consolidação final

O padrão de relações corresponde ao [snapshot v9](.runtime/typed-relations/questions-v9.json), arquitetura 2: contexto da thread para o tipo e comparação isolada do par para configuração. A proposta v10 de relações foi rejeitada; o teste controlado não resolveu a repetição e introduziu uma falsa clarificação L05→L04 antes classificada corretamente. As perguntas de chunks receberam uma mudança separada para distinguir tarefas concretas preparatórias de requisitos. Ela foi verificada em seis controles e depois em três reuniões completas.

| Conjunto / evidência | Positivos corretos | Negativos corretos | Pares corretos | Pares em revisão | Checkpoints de acompanhamento |
|---|---:|---:|---:|---:|---:|
| [Ensaios e revisões — v9](.runtime/typed-relations/curated-v9.summary.json) | 25/25 | 69/69 | 94/94 | 20 | 12/12 |
| [Conjunto independente após correção de tarefas](.runtime/typed-relations/holdout-v9-task-v10.summary.json) | 11/11 | 18/19 | 29/30 | 7 | 4/4 |
| [B002 original, anotação auditada](.runtime/typed-relations/b002-v9-annotation-review.json) | 15/18 | 94/94 | 109/112 | 36 | não anotados |
| [B002 com cinco falas esclarecidas](.runtime/typed-relations/b002-clarified-final.summary.json) | 18/20 | 96/96 | 114/116 | 32 | não anotados |
| [Conversa natural em português](.runtime/typed-relations/natural-final.summary.json) | 6/6 | 3/3 | 9/9 | 4 | revisão manual descrita abaixo |

Todos os pares elegíveis dessas rodadas foram processados, sem erro de transporte, e suas restaurações foram verificadas. B002 original tem 13 pares sem anotação; sua variante esclarecida tem nove; a conversa natural tem três. Eles não são contados como acertos nem como `none`. As quatro métricas de relações com `from-run` usam outputs upstream reais restaurados, não eventos fornecidos pelo gabarito.

A [revalidação de chunks/threads do holdout](.runtime/typed-relations/holdout-upstream-task-v10.summary.json) obteve 12/12 e 12/12; [B002](.runtime/typed-relations/b002-upstream-task-v10.summary.json), 43/43 e 28/28; [curated](.runtime/typed-relations/curated-upstream-task-v10.summary.json), 20/20 e 20/20. Persistiram respectivamente 1, 2 e 1 avisos. Não se substituíram as perguntas históricas de execuções anteriores pelas novas: cada artefato mantém sua configuração efetiva. A conversa natural usou a configuração de chunks anterior à distinção final de tarefas, com retenção 10/10, tipos 8/8 e threads 8/8, além de três avisos de retenção.

### O que ainda erra e como isso afeta a ata

- No conjunto independente, H11→H10 foi previsto como `clarifies` (probabilidade 0,61), apesar de H11 definir o parâmetro do **plano H09**, sem preencher a temperatura efetiva ausente no **relatório H10**. O gabarito continua `none`. A relação fica em revisão e não conclui o teste H09.
- No B002 original, C09→C06 foi `repeats/ambiguous`, quando a referência identifica o teste e apenas omite a espessura: o esperado é `repeats/partial`. C24→C06 foi `result_of/exact`, mas relata uma repetição do ensaio inicial, portanto espera-se `repeats/exact`. C24→C09 foi `repeats/ambiguous` em vez de `result_of/partial`. Os três pares estão em revisão; não encerram testes automaticamente.
- Mesmo identificando as execuções na variante, C24→C06 continuou `result_of/exact` (0,76 para o tipo) em vez de `repeats/exact`; C24→C15 ficou `none` (0,53) em vez de `repeats/exact`. A informação adicional melhorou parte da classificação, mas não resolveu completamente a distinção entre proposta inicial, pedido de repetição e relatos duplicados.
- Na conversa natural, todos os rótulos anotados coincidiram. N05→N03 é `result_of/partial`: não foi registrada a quantidade de usuários da medição, logo o teste continua aberto. N10→N08 é `result_of/exact`, confirmado nas duas etapas, e conclui o teste do backup. Isso não prova definitivamente a hipótese do filtro. Esses dois estados foram conferidos manualmente; o runner não contou os textos descritivos `lifecycle_expectations` como checkpoints formais.

Os pares divergentes conhecidos nas rodadas finais ficaram abaixo do limiar de confirmação. **Isso é uma observação deste conjunto, não garantia de que erros futuros terão baixa probabilidade.** Resultados corretos também podem exigir revisão. O limiar permaneceu 0,8; não foi reduzido para obter sucesso artificial.

### Correção final do gabarito B002

A avaliação original [b002-v9](.runtime/typed-relations/b002-v9.summary.json) permanece com 108/112, 16 positivos e 96 negativos. Uma auditoria independente posterior identificou dois `none` excessivos: C24→C06 e C24→C08. Impedir propagação de `result_of` ao plano inicial não impede `repeats` sobre a execução anterior explicitamente retomada por “rerun”. Ambos os extremos identificam 4 mm; C09 identifica o pedido da nova execução. Os rótulos foram corrigidos para `repeats/exact`, com justificativas e valores anteriores em `review_notes.typed_relations.label_revisions` da fixture.

A [reavaliação local](.runtime/typed-relations/b002-v9-annotation-review.json) usa exatamente as mesmas respostas e registra hashes da fonte e da anotação; fez zero chamadas novas. Passa a 109/112, com 18 positivos e 94 negativos. C24→C06 continua errado, e C24→C15 continua sem anotação. A variante esclarecida foi preparada antes dessa última auditoria; suas notas de diferenças descrevem a versão de origem da época, preservada no artefato de execução.

### Experimentos finais que não viraram o padrão

A [sondagem v10](.runtime/typed-relations/probes/final-v10.json) contém três chamadas de relações e seis controles de tipo de evento. A distinção de tarefa classificou corretamente preparação e atualização de desenho como `other`, restrições como `requirement` e investigação como `test_proposal`. Já a reescrita das relações não resolveu os erros e foi rejeitada.

O [teste de foco no par](.runtime/typed-relations/probes/pair-focus.json) contém 12 chamadas: quatro pares, cada um com histórico/singleton, histórico/par nomeado e somente o par. Remover o histórico corrigiu H11→H10 (`none` 0,77) e C24→C15 (`repeats` 0,65), mas C24→C06 permaneceu `result_of` 0,83. Mudar a forma de nomear o candidato também não foi solução geral. Não se implementou um seletor baseado nos gabaritos nem uma regra especial para esses IDs.

### Artefato final e verificação de software

A [ata final de demonstração](.runtime/typed-relations/curated-v9-minutes.pdf) usa a rodada v9. A [verificação automatizada](.runtime/typed-relations/curated-v9-minutes.verification.json) confirma seis páginas, 20 falas completas, 25 relações e 24 avisos preservados, sem chamadas ao modelo. O [texto extraído](.runtime/typed-relations/curated-v9-minutes.txt) permite revisar cada frase. Configurações incompletas/incompatíveis permaneceram pendentes.

A suíte completa de módulos JavaScript passou com **208 testes**. Os **24 testes Python** de servidor/provedor/endpoints também passaram. Depois da última mudança nas perguntas, os 33 testes pertinentes de contratos, relações e persistência passaram novamente. A regressão de navegador passou em **nove scripts e dez cenários**: relações tipadas, Memória V2, ata/PDF, memória anterior, layout, threads (normal e arquivos), compatibilidade de relações V1, execução contínua e navegação. Usou servidores efêmeros com respostas controladas, sem chamadas JEV. Os testes antigos foram atualizados para o contrato existente: FIFO de 15, filas recolhíveis, exportação pelo histórico e relações V1 somente para consulta. O caso de 40 falas longas continua verificando erro explícito por limite de contexto, sem enviar state grande demais. O novo botão de padrão revisado foi testado nas três abas: modifica apenas rascunho até salvar e preserva execuções/histórico. Respostas simuladas nesses testes verificam software, não acurácia do JEV.

## Revisão de apresentação da ata

Atendendo à revisão da interface, a ata atual é composta por um título para cada discussão e tópicos com as falas retidas em ordem cronológica. Os PDFs de seis páginas descritos acima são artefatos históricos do formato anterior. O corpo atual não contém IDs de eventos/chunks, classificações, probabilidades, relações ou acompanhamento de testes. Falas ainda sem thread permanecem em **Pontos sem assunto definido**. Não houve alteração das classificações nem novas chamadas ao JEV para essa revisão.

A [ata B002 em tópicos](.runtime/typed-relations/b002-topicos.pdf) foi gerada da rodada real `b002-v9.json`: **duas páginas e 28 falas preservadas**. O [texto extraído](.runtime/typed-relations/b002-topicos.txt) e a [verificação](.runtime/typed-relations/b002-topicos.verification.json) confirmam conteúdo e ordem dentro de cada thread. As 24 relações e os 36 avisos dessa fonte ficam registrados no JSON de verificação, fora do PDF. A geração utilizou zero chamadas ao modelo.

Passaram os nove testes de unidade da ata e a verificação no Chrome, incluindo tópicos cronológicos, ausência de relatório técnico no PDF, seleção de texto, comentários persistidos, reabertura, fonte portuguesa, múltiplas páginas e layout móvel. A identidade da fonte e os IDs de âncoras foram preservados, mantendo válidos os comentários já salvos; a exportação acrescenta a estrutura visível da ata à proveniência existente.

As limitações operacionais, de linguagem e de feedback estão em [MEMORY_RELATIONS_LIMITATIONS.md](MEMORY_RELATIONS_LIMITATIONS.md). A implementação permite inspeção, revisão e comentários; os resultados medidos não sustentam prometer classificação automática perfeita para qualquer reunião.

## Entrada original e visualização contínua

A revisão de interface removeu todos os botões de exemplos do modal. [B002.json](B002.json) e os cinco conjuntos em [exemplos-testes](exemplos-testes/README.md) mantêm somente a estrutura original de input; gabaritos de relações e tabelas de revisão ficam em documentos separados.

O worker da página agora usa schema 3 para aceitar eventos durante a execução, após cada atribuição de thread. O contrato de inferência e as perguntas não mudaram nesta revisão. O teste `typed-relations-stream.test.cjs` bloqueia um chunk futuro, comprova que a relação anterior fica disponível, restaura esse snapshot parcial e compara todos os requests/arestas com uma execução em lote: são semanticamente idênticos. Também verifica ordem, atribuição finalizada, deduplicação, interrupção ociosa e fechamento prematuro.

O teste de navegador `browser-typed-relations.cjs` bloqueia o quarto chunk e verifica uma aresta no estado e no DOM antes de liberar sua resposta. O input desse teste tem exatamente os campos originais, sem gabarito de relações. A nova rede usa somente eventos e arestas previstos; não cria conexões por proximidade visual ou por compartilharem uma thread. As novas verificações de software não representam uma nova medição de precisão do JEV.

A verificação desta revisão passou com 213 testes JavaScript e 24 testes Python. Passaram também os testes de navegador de relações contínuas, Memória V2, mapa de relações, ata/PDF, navegação e compatibilidade da memória anterior. A conferência integrada do mapa usou um resultado real já salvo (20 eventos e 25 relações), em armazenamento isolado, sem chamadas novas ao modelo. O novo [PDF B002 em tópicos](.runtime/typed-relations/b002-topicos.pdf) preserva 28 falas em duas páginas, com verificação e texto extraído ao lado.

## Correção da quota do histórico — 6 de outubro de 2026

O erro `setItem ... norte.memory-library.v2 ... exceeded the quota` acontecia ao salvar a execução anterior antes de aplicar outro input. Os snapshots completos ocupavam simultaneamente o histórico, a recuperação compartilhada e o rascunho da aba em Web Storage. A V2 passou a usar IndexedDB para esses registros, com migração validada após commit, edição transacional do histórico e proteção contra sobrescrita entre abas. Nenhuma pergunta, classificação ou resposta de IA foi alterada por essa correção.

Passaram 217 testes JavaScript e 24 Python, além de `browser-memory-v2.cjs`, `browser-typed-relations.cjs` e `browser-memory.cjs`. As verificações de recarga comparam também biblioteca, relações e auditoria completa do worker.

`browser-memory-storage.cjs` reproduz uma quota real esgotada no Chrome, confirma a falha do salvamento antigo e verifica a migração e o fluxo Salvar → Aplicar input. Conserva um histórico válido acima de 6 MiB após recarga, mantém registros de outras telas intactos e verifica gravações concorrentes de duas abas com IDs únicos. Os dados e respostas usados nessa regressão são fixtures locais, em perfil temporário; não houve chamadas ao JEV nem limpeza do armazenamento do usuário.
