# Reuniões: processamento, dados persistidos e validação

O fluxo ativo fica em `meetings/web` (sala) e `meetings/engine` (processamento Python), com acesso pelo gateway autenticado do Norte. O mapa administrativo está em `#/admin/meetings`. Ser administrador não concede acesso automático a uma reunião privada: a mesma permissão da sala é exigida antes e depois de consultar o motor.

## O que existe de fato

| Estado ou memória | Conteúdo e uso | Escopo e persistência |
| --- | --- | --- |
| Janela transitória de fala | Até 15 trechos recentes para interpretar continuidade; cada pedido JEV leva só os 3 trechos anteriores (`recent_context`, com quem falou) para resolver referências. Não pesquisa documentos, projetos ou outras reuniões. | Uma sessão; o registro salva o estado para recuperação após interrupção. |
| Registro original | Transcrição completa, IDs dos trechos, tempos, participantes, entradas e respostas JEV, assuntos e relações. | Registro versionado da reunião; atualização com comparação de versão e isolamento pela assinatura do gateway. |
| Contexto de assunto | Eventos classificados do mesmo assunto, usados para atribuir novos trechos e avaliar relações entre eventos. | Somente a reunião em processamento. Não há índice de projetos nem busca entre reuniões. |
| Memória editorial | Texto original, resumo/título, origem automática ou humana, versão, estado ativo/inativo e avaliações editor/crítico. | `ai_block_memory`, vinculada ao namespace autenticado e à reunião. Correções antigas continuam legíveis apenas na sessão de origem; novas chaves incluem a sessão. |
| Correções de classificação | Exemplos humanos com fala literal, classe original e corrigida, nota e eventual explicação do LLM ancorada no original; complementos das descrições de categoria propostos pelo LLM a partir dessas correções. | `ai_meeting_learning`, versões por usuário/namespace e sessão. Até 20 exemplos ativos; até 6 exemplos pertinentes entram no pedido JEV. Reversão cria outra versão. |
| Ata | Documento produzido e edições posteriores; original preservado nos detalhes. | `minutes_document` dentro do registro da reunião integrada, salvo pelo fluxo normal de persistência. Cache local legado não é lido como conteúdo de outra conta. |
| Fila e uso de provedores | Trabalho editorial pendente, tentativas, orçamento reservado, uso conhecido e falhas sanitizadas. | SQL persistente. A fila ativa aceita apenas revisão de blocos. Histórico aposentado permanece em banco e não é executado. |

As correções contextualizam a classificação seguinte; não treinam pesos nem autorizam geração de código. O LLM pode explicar uma classe escolhida pela pessoa, mas não trocar essa escolha. A explicação só é aceita com trechos literais válidos e sem acrescentar números. A versão aplicada é registrada na resposta JEV.

## Divisão e apresentação da fala

A segmentação preserva os originais. Uma frase pontuada (texto digitado ou transcrição importada) com até 40 palavras é um trecho; uma frase mais longa é dividida em orações de até 24 palavras. A fala do microfone, sem pontuação, é dividida entre 12 e 18 palavras; a continuação reúne no máximo 6 pedaços e 32 palavras, com espera limitada a 6 segundos. Um comando ou novo ponto não é absorvido pelo anterior.

## Do trecho às notas

1. **Memória de eventos (JEV, memória v3).** Uma chamada por trecho responde juntas a `should_store_memory` (reter ou descartar) e `event_type` (observação, hipótese, teste proposto, resultado de teste, decisão, requisito, outro). Comandos à sala só são verificados quando o texto menciona *Norte* ou quando um pedido de nome está pendente; as demais falas não pagam essa chamada.
2. **Memória de assuntos (JEV, assuntos v6).** Cada evento retido recebe uma única pergunta de múltipla escolha: os 10 assuntos discutidos mais recentemente, cada um resumido pela primeira e pela última fala, ou `new_topic`. Um assunto é um item específico (componente, documento, proposta, requisito, risco, prazo), não o tema geral da reunião, e voltar a um assunto anterior é uma resposta comum. Abaixo de 60%, o evento fica *provisório* no assunto mais provável; um assunto novo exige que `new_topic` seja a resposta mais provável, com pelo menos 50%. Reuniões salvas com memória v2 continuam com as duas perguntas antigas.
3. **Memória de relações (JEV).** Relações tipadas entre eventos já associados (testa, resultado de, contradiz, substitui…), sem mudança neste fluxo.
4. **Notas (LLM editorial).** Enquanto a reunião acontece, um trabalho de fundo escreve as notas por assunto, até 8 falas e o título por chamada. O editor recebe as notas já publicadas do mesmo assunto (até 8) e, quando existem, até 6 reescritas humanas desta reunião como exemplo de forma, nunca de fatos. A classificação do JEV acompanha cada fala, mas a fala prevalece: uma proposta, suposição ou conclusão de quem fala continua marcada como tal. Falas com menos de 60 caracteres já são uma nota e aparecem como foram ditas. Cada nota passa sozinha pelas guardas locais (números, unidades, negações, possibilidade/condição, tamanho) e pelo crítico; só as recusadas voltam uma vez ao editor, com o problema apontado. Uma nota recusada de novo mostra a fala original. Terminado um assunto, o próximo é agendado sem esperar a sala consultar. Não há botão: a área de revisão mostra *Organizando tópicos…* enquanto há trabalho.
5. **Títulos estáveis.** O título de um assunto é reescrito só quando o assunto chega a 1, 3, 6, 12, 24 ou 48 eventos; o título anterior continua visível enquanto o novo é escrito. A ata segue a mesma regra, e um título dado pela equipe sempre prevalece.
6. **Ata (LLM).** Organizada ao fim, a pedido, a partir dos eventos, assuntos e notas validadas.

A edição humana de um bloco (duplo clique ou lápis) prevalece sobre a nota automática e segue para a ata como `human_summary`, ao lado do texto original; as guardas da ata aceitam valores presentes no original ou na correção. Abrir uma reunião salva não grava nem reorganiza nada; uma edição ou a continuação da reunião retomam a organização de fundo.

O anfitrião também pode continuar uma reunião concluída por texto, arquivo de transcrição ou microfone. A sessão retoma o registro salvo, grava o estado em andamento antes de aceitar contribuições e conta o novo período a partir de `continued_at`; uma ata gerada antes deixa de corresponder à fonte e precisa ser gerada de novo.

## Correções e adaptação da classificação

Corrigir a classificação de um bloco cria um exemplo humano versionado desta reunião. Depois de cada correção, o LLM lê as correções da reunião e pode propor, para até 4 categorias envolvidas nelas, um complemento em inglês de até 240 caracteres à descrição usada pelo JEV. O complemento descreve a forma da fala (intenção, verbo, tempo verbal), sem fatos, números, nomes ou endereços, e somado à descrição tem no máximo 800 caracteres. O LLM também resume o que mudou e, se as reescritas humanas indicarem, o estilo preferido das notas. Uma proposta fora dessas regras é descartada; a classificação continua só com os exemplos. A reversão cria nova versão sem os complementos. Nada disso altera pesos, código, a classe escolhida pela pessoa ou outras reuniões.

Um resumo automático publicável tem de 1 a 3 tópicos, cada um com até 180 caracteres e até 480 no total. Guardas locais preservam números, unidades, negações e condições; uma chamada crítica compara candidato e original. Isso reduz falhas, mas não constitui prova de equivalência semântica. Quando a validação falha, o original permanece disponível e a sugestão não é publicada como válida.

## Observabilidade

O mapa apresenta somente dados registrados: fala → segmentação → filtro → classificação → assunto/relações → blocos. Ao selecionar uma etapa, mostra entrada, perguntas e critérios, respostas, provedor, modelo, latência e versão de correções quando presentes. As chamadas de segmentação passaram a preservar a resposta completa; histórico anterior pode não conter essa trilha, e ela não é reconstruída por suposição.

Cada página mostra até 50 trechos. A inspeção editorial retorna até 100 itens e o total existente; o painel informa essa diferença em reuniões maiores. A janela transitória apresentada é uma amostra recente, não um índice externo de conhecimento. Cabeçalhos de transporte, credenciais e campos antigos de contexto de projeto não são expostos.

A avaliação editorial registra, por tentativa, quantas notas foram aprovadas e o motivo de cada recusa (número, negação, unidade, possibilidade/condição, tamanho ou crítico). A execução preservada e a ata salva aparecem separadamente do cache editorial de blocos. Importar resultados não preenche esse cache: quando ele está vazio, o painel informa a ausência. A ata mostra sínteses aceitas e originais preservados, com IDs e motivos de revisão; nenhuma dessas contagens equivale à precisão do classificador.

## Provedores e saída de dados

- Reconhecimento de fala: API de voz do navegador, quando disponível; a implementação e o eventual envio de áudio dependem do navegador. Áudio de participantes usa WebRTC, com consentimento de microfone.
- JEV: `https://api.typesafe.ai/v1/systemone`, configurado por `TYPESAFE_API_KEY`/`JEV_MODEL`. Recebe estado limitado da reunião, perguntas fixas e exemplos de correção dessa mesma reunião quando aplicáveis.
- Revisão editorial: Gemini ou OpenAI conforme `AI_AGENT_PROVIDER`, opt-in de revisão externa, credenciais e orçamento. Recebe fala classificada limitada, contexto do mesmo assunto e os dados necessários ao item. OpenAI usa `store: false`.
- Atas: Gemini conforme configuração de atas; recebe a fonte solicitada para gerar o documento. O limite diário é persistente e independente da fila editorial.

Nenhum desses fluxos recupera contexto de projeto ou de reuniões anteriores. Os endpoints antigos de aliases, navegação de simulador e consulta de memória externa foram retirados.

## O que os testes demonstram e o que falta

Os testes com respostas simuladas verificam preservação de originais, limites dos tópicos, atualização por versão, reversão, falhas de transporte, orçamento, isolamento por reunião/conta e rejeição de entradas inválidas. O smoke de navegador usa contas temporárias e testa WebRTC real entre duas sessões, convites, persistência, contribuição idempotente e visualização móvel. Não faz chamadas pagas de IA.

Esses testes não medem acurácia real de JEV, fidelidade semântica de todos os resumos, qualidade de reconhecimento de fala nem melhora causada pelo feedback. Para medir isso faltam falas reais consentidas e rotuladas por pessoas, conjunto de avaliação separado dos exemplos de correção, comparação com/sem contexto de feedback, métricas por classe e latência/custo em uso real. Aprovação do crítico LLM e HTTP 200 não substituem essas medidas.

### Limitações concretas e próximos ajustes possíveis

1. **Histórico incompleto em registros antigos.** O teste `only completed recorded segmentation, topic and relation calls appear in the map` em `norte/server/meeting-observability.test.mjs` confirma que o mapa usa somente respostas preservadas; chamadas ausentes não são inventadas. Registros anteriores não guardavam a resposta da segmentação. Um próximo ajuste simples seria mostrar, por etapa, “não registrado nesta versão” e a versão do formato, distinguindo ausência histórica de falha de processamento. Essa é uma lacuna de rastreabilidade observada, não evidência de erro do classificador.
2. **Inspeção editorial limitada.** `BlockAgents.inspect` retorna os 100 itens editoriais mais recentes; `MeetingLearning.response` retorna as últimas 20 versões de correção. O mapa indica itens mostrados/total, mas não pagina memórias editoriais nem versões antigas. Para reuniões extensas, a melhoria seria paginação desses dois históricos com o mesmo isolamento por reunião que já existe nos trechos. A necessidade de consultas maiores em uso real ainda não foi medida.
3. **Retenção distinta entre original e memória editorial.** `BlockAgents.prune` expurga revisões editoriais e exemplos de correção conforme a retenção configurada; isso não apaga automaticamente o registro original da reunião. Portanto, uma reunião preservada pode continuar consultável depois que parte da memória editorial expirou. Uma melhoria possível é explicitar a data de retenção e o motivo “expirado” no diagnóstico, com exportação do histórico antes da expiração. O comportamento de retenção está definido no código; o smoke com mocks não acompanha meses de uso e não prova recuperação após todas as combinações de expiração.

Esses ajustes são sugestões de continuidade, não funcionalidades já implementadas. Nenhum exige reintroduzir memória externa de projeto ou recuperação de outras reuniões.

## Arquivos legados

Reuniões antigas dos fluxos de revisão e simulação são convertidas em arquivos somente leitura pelo script `norte/scripts/archive-legacy-meetings.mjs`. O padrão é dry-run; `--apply` cria backup do store antes da escrita atômica e mantém o SQLite original intacto. A exportação preserva transcrições, atas, eventos e o registro original em JSON; texto/PDF permitem consulta sem executar o pipeline aposentado. A migração deve ser feita com os serviços parados e os dados respaldados.

## Avaliação real dos três cenários fornecidos (24/10/2026)

Executamos apenas as falas do material autorizado; comentários e gabarito ficaram fora das requisições. Os arquivos de origem, transcrições, respostas e PDFs são privados, em `novo_teste/resultados/reunioes/`. Esta execução não mede conformidade regulatória nem comprova os alertas do gabarito.

| Cenário | Falas / chunks | Chamadas JEV | Registros retidos / sem assunto confirmado | Tempo somado do provedor JEV | Tempo da ata Gemini |
| --- | --- | --- | --- | --- | --- |
| 01 | 13 / 22 | 88 | 19 / 15 | 20,2 s | 16,9 s |
| 02 | 12 / 22 | 91 | 20 / 18 | 20,8 s | 10,8 s |
| 03 | 15 / 22 | 103 | 22 / 19 | 24,8 s | 15,3 s |

As 282 chamadas correspondem à segmentação e às etapas separadas de comando, retenção, tipo e assunto; não são 282 falas. O modelo efetivamente retornado foi `jev-1.14.0` para requisições `jev-latest`. Uma chamada adicional de diagnóstico foi descartada quando o teto inicial interrompeu o terceiro cenário; ela não está nas contagens finais. Os tempos acima não são a duração das reuniões.

A baixa confiança de associação a assuntos é uma limitação observada: no cenário 03, 19 de 22 registros ficaram pendentes. Relações dependentes dessa associação foram evitadas. O sistema preserva as falas e permite associação humana explícita, com justificativa e histórico; a revisão não sobrescreve a saída original de JEV. Não houve busca de contexto externo nem recuperação de outra reunião.

O Gemini `gemini-3.8-flash` organizou 41 registros do recorte apresentado: 35 sínteses passaram pela validação e 6 conservaram o texto original curto, com aviso para revisão (3, 2 e 1 por cenário). Essas contagens são de aceitação editorial, separadas da classificação JEV e da qualidade frente ao gabarito. Houve rejeição real de uma quantidade trazida de outro registro e de paráfrases que mudavam cláusulas negativas. O teste de regressão privado cobre o primeiro caso. IDs, associação a assunto, unidades, negações, cobertura e tabelas continuam sujeitos à validação local.

O schema remoto tinha limites de arrays aninhados que causavam HTTP 400. `gemini_minutes.response_schema` remove esses limites somente da gramática enviada; `SCHEMA` e `finalize` mantêm os limites na resposta. Isso segue a [limitação de complexidade documentada pelo Google](https://ai.google.dev/gemini-api/docs/structured-output#limitations). `finalize_editorial` pode preservar um original curto quando apenas sua síntese falha; erros estruturais ainda rejeitam o documento. Originais longos não são truncados para aparentar uma síntese válida.

Os três resultados finais somaram cerca de US$ 0,0416 pelas tarifas configuradas localmente e tokens medidos, incluindo tokens de raciocínio do Gemini. É uma estimativa, não uma fatura. O custo dos diagnósticos não está incluído: foram 6 recusas HTTP 400 e 3 respostas recusadas pela validação antes das 3 atas aceitas; o uso desses diagnósticos não foi preservado integralmente. Metadados reais e método do cálculo ficam no relatório privado `metricas-reais.json`.

Melhorias sugeridas a partir do teste (a situação em 26/10 está na seção seguinte):

- Comparar janelas curtas que preservem a frase e seu referente antes da associação de assunto. Medir a redução dos registros pendentes com avaliação separada, sem reduzir limiares só para aumentar a quantidade de vínculos.
- Medir a combinação de perguntas compatíveis na mesma chamada JEV e a reutilização de resultados idênticos dentro da própria reunião. As 88–103 chamadas por cenário justificam essa investigação; não justificam aceitar relações menos confiáveis.
- Medir se a revisão lateral de associações e a distinção entre síntese aceita e original preservado reduzem erros nas próximas classificações. Essas duas visualizações já existem; sua eficácia ainda não foi medida. Só correções efetivamente confirmadas devem alimentar a memória versionada da reunião; não transformar gabarito ou saída de outro modelo em feedback humano.

## Avaliação real após a revisão do pipeline (26/10/2026)

Mesmo material e mesma regra: só as falas foram enviadas; comentários e gabarito ficaram fora das requisições. As respostas JEV vêm da segunda execução do dia (memória v3, assuntos v6). Notas, títulos e atas usam o código final. Os resultados privados ficam em `novo_teste/resultados/reunioes/artefatos/` (`avaliacao-real.json` e `LYLE-0X-run/trace/minutes.json`); as execuções intermediárias estão nas pastas `v3-*`.

| Cenário | Chunks / registros | Chamadas JEV (24/10) | Assuntos | Relações | Notas / títulos | Chamadas de notas | Tempo da ata |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 01 | 19 / 18 | 64 (88) | 2 | 12 | 7 / 2 | 6 | 22,2 s |
| 02 | 20 / 19 | 60 (91) | 2 | 5 | 6 / 2 | 6 | 13,7 s |
| 03 | 21 / 20 | 58 (103) | 6 | 4 | 10 / 6 | 17 | 16,1 s |

- As 182 chamadas JEV (eram 282) vêm de uma pergunta de memória por chunk (retenção e tipo juntos), uma pergunta de assunto com várias opções por registro e as relações. O comando só é perguntado quando a fala cita o Norte ou há um título pendente. O tempo somado do provedor JEV foi de 17,7 s, 17,3 s e 15,4 s.
- Nenhum registro ficou sem assunto ou com associação provisória; antes eram 15, 18 e 19 pendentes. A pergunta mudou de formato, então a queda não é uma comparação direta. Sem rótulos humanos, ela também não mostra se os assuntos estão certos.
- Notas: 29 chamadas, todas respondidas; uma resposta do crítico veio com JSON inválido e foi repetida uma vez no mesmo job. Dos 35 itens (notas e títulos), 33 foram publicados. Na primeira tentativa falharam 9: 6 por negação perdida, 2 por nota mais longa que a fala e 1 recusado pelo crítico. A segunda tentativa corrigiu 7; os 2 restantes ficaram com a fala original, marcados para revisão.
- Atas: `gemini-3.8-flash` gerou e validou as três. Foram 24 sínteses aceitas e 12 originais preservados (7/3, 9/2 e 8/7). O custo estimado é de US$ 0,0325 pelas tarifas locais e tokens medidos, raciocínio incluído; é uma estimativa, não uma fatura.

Limitações observadas:

- No cenário 01, “Então congelamos todos os requisitos de interface hoje…” virou “Congelados todos os requisitos de interface hoje…”: uma proposta registrada como fato. A fala seguinte adiou o congelamento, mas a nota é escrita sem as respostas posteriores, e o JEV classificou o trecho como decisão. A relação E017→E016 saiu com baixa confiança (0,26 para `supersedes`, 0,23 para `contradicts`). Um ajuste possível é revisar a nota anterior quando uma relação de contradição ou substituição for aceita.
- O crítico varia entre execuções; aprovação dele não é medida de fidelidade.
- Nada disso mede acurácia de JEV, qualidade dos assuntos ou ganho com correções humanas. Para isso ainda faltam falas rotuladas por pessoas e um conjunto de avaliação separado.

Situação das melhorias sugeridas em 24/10:

- Janelas curtas antes do assunto: implementado com chunks por frase e `recent_context` de até três trechos anteriores, com quem falou. Os pendentes foram a zero, sem medição de acerto (ver acima).
- Perguntas combinadas: implementado (retenção e tipo numa só chamada, pré-filtro de comando, assunto em uma pergunta de várias opções). Resultados idênticos não são reutilizados entre chamadas.
- Efeito da revisão lateral nas classificações seguintes: ainda não medido.
