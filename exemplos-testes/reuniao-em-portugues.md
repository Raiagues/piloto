# Reunião em português

Dez falas curtas sobre lentidão de login e anexos ausentes em um backup. Inclui confirmações e logística, referências indiretas e três pares que não têm gabarito inequívoco.

Copie o conteúdo de [reuniao-em-portugues.json](reuniao-em-portugues.json) para **Carregar input**. O arquivo contém somente `batch_id`, `cases` e `expected_threads`, no formato original. O [gabarito de relações](reuniao-em-portugues.relations.json) fica separado para consulta e edição; ele não é parte do input copiável.

## Falas e resultados esperados

Os IDs desta tabela identificam os chunks do input. A coluna Thread mostra a atribuição esperada após a fala; `—` significa ausência de atribuição. Todos os detalhes de continuidade e de candidatas arquivadas continuam preservados em `expected_threads` no JSON.

| ID | Texto | Guardar memória | Tipo esperado | Thread esperada | Ação esperada |
| --- | --- | --- | --- | --- | --- |
| N01 | A tela de login está demorando a abrir. | true | observation | T001 | create_new_thread |
| N02 | Talvez a consulta de permissões esteja atrasando o login. | true | hypothesis | T001 | keep_active_thread |
| N03 | Vamos medir o tempo da consulta de permissões com cem usuários simultâneos. | true | test_proposal | T001 | keep_active_thread |
| N04 | Tá, entendi. | false | — | — | — |
| N05 | Na medição, a consulta de permissões levou dois segundos, mas não anotamos quantos usuários estavam conectados. | true | test_result | T001 | keep_active_thread |
| N06 | Os anexos ficaram de fora do backup de ontem. | true | observation | T002 | create_new_thread |
| N07 | Talvez o filtro de extensões esteja excluindo os anexos. | true | hypothesis | T002 | keep_active_thread |
| N08 | Vamos testar o backup com o filtro de extensões desligado. | true | test_proposal | T002 | keep_active_thread |
| N09 | Só um segundo. | false | — | — | — |
| N10 | No teste com o filtro desligado, todos os anexos foram copiados. | true | test_result | T002 | keep_active_thread |

## Observações para revisar o gabarito

- N04 e N09 são falas sem memória útil e não geram eventos nem candidatos a relação; continuam fazendo parte da sequência da conversa.
- N05 identifica a medição proposta em N03, mas não registra a concorrência efetiva. O pareamento é partial e não basta para encerrar o plano automaticamente.
- N10 identifica o teste do backup com o filtro desligado. A única condição explicitada na proposta aparece no resultado: exact; não se exigem parâmetros que nenhuma fala definiu.
- Um resultado posterior bem-sucedido não contradiz automaticamente a ocorrência histórica de uma falha anterior. Evidência compatível com uma hipótese também não equivale a causalidade demonstrada.

## Relações esperadas

A seta vai da fala mais recente (origem) para uma fala anterior (alvo) da mesma thread. Os IDs são de chunks, não números gerados de eventos. Cada linha é uma expectativa do gabarito, não uma resposta da IA.

`none` significa que o par foi revisado e não merece aresta direta. `not_applicable` mantém a relação, sem comparar configurações. Um par sem gabarito não recebe pontuação e não equivale a `none`.

### Pares com aresta esperada

| Origem | Texto da origem | Alvo | Texto do alvo | relation_type | configuration_match |
| --- | --- | --- | --- | --- | --- |
| N02 | Talvez a consulta de permissões esteja atrasando o login. | N01 | A tela de login está demorando a abrir. | related_to | not_applicable |
| N03 | Vamos medir o tempo da consulta de permissões com cem usuários simultâneos. | N02 | Talvez a consulta de permissões esteja atrasando o login. | tests | not_applicable |
| N05 | Na medição, a consulta de permissões levou dois segundos, mas não anotamos quantos usuários estavam conectados. | N03 | Vamos medir o tempo da consulta de permissões com cem usuários simultâneos. | result_of | partial |
| N07 | Talvez o filtro de extensões esteja excluindo os anexos. | N06 | Os anexos ficaram de fora do backup de ontem. | related_to | not_applicable |
| N08 | Vamos testar o backup com o filtro de extensões desligado. | N07 | Talvez o filtro de extensões esteja excluindo os anexos. | tests | not_applicable |
| N10 | No teste com o filtro desligado, todos os anexos foram copiados. | N08 | Vamos testar o backup com o filtro de extensões desligado. | result_of | exact |

### Pares sem aresta esperada

| Origem | Texto da origem | Alvo | Texto do alvo | relation_type | configuration_match |
| --- | --- | --- | --- | --- | --- |
| N05 | Na medição, a consulta de permissões levou dois segundos, mas não anotamos quantos usuários estavam conectados. | N01 | A tela de login está demorando a abrir. | none | — |
| N05 | Na medição, a consulta de permissões levou dois segundos, mas não anotamos quantos usuários estavam conectados. | N02 | Talvez a consulta de permissões esteja atrasando o login. | none | — |
| N10 | No teste com o filtro desligado, todos os anexos foram copiados. | N06 | Os anexos ficaram de fora do backup de ontem. | none | — |

### Pares sem gabarito

| Origem | Texto da origem | Alvo | Texto do alvo | Por que permanece sem gabarito |
| --- | --- | --- | --- | --- |
| N03 | Vamos medir o tempo da consulta de permissões com cem usuários simultâneos. | N01 | A tela de login está demorando a abrir. | Medir a consulta investiga diretamente a hipótese N02. Uma ligação adicional com o sintoma do login é defensável como investigação do problema, mas não é explicitada na proposta. O gabarito não impõe redução transitiva nem converte relevância geral em ligação obrigatória. |
| N08 | Vamos testar o backup com o filtro de extensões desligado. | N06 | Os anexos ficaram de fora do backup de ontem. | O teste com o filtro desligado investiga a hipótese N07. Uma ligação adicional com a falha do backup anterior pode representar investigação direta do problema; a fala não especifica essa relação separadamente. Mantido sem pontuação em vez de impor none por transitividade. |
| N10 | No teste com o filtro desligado, todos os anexos foram copiados. | N07 | Talvez o filtro de extensões esteja excluindo os anexos. | Copiar todos os anexos com o filtro desligado é compatível com a hipótese. O relato não afirma a conclusão causal e não registra controle das outras condições. É discutível se essa evidência deve contar como supports implícito; não se fixa supports nem none nesta avaliação independente. |

## Fontes preservadas

Input e expectativas derivados de [tests/fixtures/typed-relations-natural.json](../tests/fixtures/typed-relations-natural.json). Relações derivadas de [tests/fixtures/typed-relations-natural.json](../tests/fixtures/typed-relations-natural.json). As fixtures de teste permanecem intactas.
