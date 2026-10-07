# B002 — ensaios identificados

Cópia separada do B002 que distingue o ensaio inicial de deformação e sua repetição à tarde. Somente cinco falas foram alteradas; os tipos de evento e o roteamento esperado permanecem iguais.

Copie o conteúdo de [b002-ensaios-identificados.json](b002-ensaios-identificados.json) para **Carregar input**. O arquivo contém somente `batch_id`, `cases` e `expected_threads`, no formato original. O [gabarito de relações](b002-ensaios-identificados.relations.json) fica separado para consulta e edição; ele não é parte do input copiável.

## Falas e resultados esperados

Os IDs desta tabela identificam os chunks do input. A coluna Thread mostra a atribuição esperada após a fala; `—` significa ausência de atribuição. Todos os detalhes de continuidade e de candidatas arquivadas continuam preservados em `expected_threads` no JSON.

| ID | Texto | Guardar memória | Tipo esperado | Thread esperada | Ação esperada |
| --- | --- | --- | --- | --- | --- |
| C01 | The bracket is deforming too much. | true | observation | T001 | create_new_thread |
| C02 | Yeah. | false | — | — | — |
| C03 | The current bracket is 3 mm aluminum. | true | observation | T001 | keep_active_thread |
| C04 | Maybe the thickness is causing the problem. | true | hypothesis | T001 | keep_active_thread |
| C05 | Okay, that makes sense. | false | — | — | — |
| C06 | Let's run the initial bracket deformation test with a 4 mm version. | true | test_proposal | T001 | keep_active_thread |
| C07 | Can you repeat that? | false | — | — | — |
| C08 | In the initial bracket deformation test, the 4 mm version still exceeded the deformation limit. | true | test_result | T001 | keep_active_thread |
| C09 | Please repeat that initial bracket deformation test with the 4 mm version this afternoon. | true | test_proposal | T001 | keep_active_thread |
| C10 | We have decided to use the 4 mm version in the next prototype. | true | decision | T001 | keep_active_thread |
| C11 | I will reconnect in one minute. | false | — | — | — |
| C12 | The client requires a safety factor of two. | true | requirement | — | assignment_pending |
| C13 | Maybe the support stiffness is the real issue. | true | hypothesis | T001 | keep_active_thread |
| C14 | Let's test the support condition next. | true | test_proposal | T001 | keep_active_thread |
| C15 | In the initial bracket deformation test, the 4 mm version still exceeded the deformation limit. | true | test_result | T001 | keep_active_thread |
| C16 | Now let's discuss the sensor enclosure. | false | — | — | — |
| C17 | The sensor enclosure wall is cracking near the mounting holes. | true | observation | T002 | create_new_thread |
| C18 | Can everyone see my screen? | false | — | — | — |
| C19 | Maybe the mounting-hole spacing is concentrating the stress. | true | hypothesis | T002 | keep_active_thread |
| C20 | Yeah, I can see it now. | false | — | — | — |
| C21 | Let's test a version with wider hole spacing. | true | test_proposal | T002 | keep_active_thread |
| C22 | In the test with wider hole spacing, the sensor enclosure no longer cracked. | true | test_result | T002 | keep_active_thread |
| C23 | Give me a second, I need to grab my charger. | false | — | — | — |
| C24 | Going back to the bracket, the afternoon rerun of the initial deformation test with the 4 mm version is complete. It still exceeded the deformation limit. | true | test_result | T001 | reactivate_thread |
| C25 | Sorry, my audio cut out for a second. | false | — | — | — |
| C26 | For the sensor enclosure, let's test a 4 mm wall. | true | test_proposal | T002 | reactivate_thread |
| C27 | The client also requires a maximum mass of 2 kg. | true | requirement | — | assignment_pending |
| C28 | By the way, lunch is in the conference room. | false | — | — | — |
| C29 | That 2 kg limit applies to the sensor enclosure. | true | requirement | T002 | keep_active_thread |
| C30 | Separately, the bracket coating is failing the salt-spray test. | true | test_result | T003 | create_new_thread |
| C31 | Give me a second, I'm opening the coating report. | false | — | — | — |
| C32 | Maybe the coating thickness is too low. | true | hypothesis | T003 | keep_active_thread |
| C33 | Let's measure the coating thickness. | true | test_proposal | T003 | keep_active_thread |
| C34 | I can't see the slides because the meeting-room projector is disconnected. | false | — | — | — |
| C35 | We measured the coating at 18 microns, below the required 25. | true | test_result | T003 | keep_active_thread |
| C36 | Back to the bracket deformation, let's test the support stiffness under the same load. | true | test_proposal | T001 | reactivate_thread |
| C37 | Can we take a five-minute break after this? | false | — | — | — |
| C38 | For the sensor enclosure, the 4 mm wall cracked again. | true | observation | T002 | reactivate_thread |
| C39 | The sensor enclosure must remain under 2 kg. | true | requirement | T002 | keep_active_thread |
| C40 | The bracket must maintain a safety factor of two under the test load. | true | requirement | T001 | reactivate_thread |
| C41 | Okay. | false | — | — | — |
| C42 | Did anyone see the game last night? | false | — | — | — |
| C43 | Let's run the support-stiffness test under the same load tomorrow morning. | true | test_proposal | T001 | keep_active_thread |

## Observações para revisar o gabarito

- C08 e C22 explicitam que o resultado veio de um teste. Isso sustenta test_result considerando somente a fala atual.
- C13 espera keep_active_thread: deixar C12 pendente não remove a thread ativa T001.
- C38 continua observation: a trinca é relatada sem afirmar execução de teste. C12 e C27 continuam sem thread porque não identificam o objeto do requisito.
- C06, C08, C09, C15 e C24 identificam o ensaio inicial ou a repetição da tarde. A comparação completa das falas está abaixo.
- C15 repete o relato inicial, sem afirmar nova execução. C24 identifica o resultado da repetição pedida em C09; a relação com o ensaio inicial é repeats. Nenhum parâmetro de configuração ausente é inventado.

## As cinco falas alteradas

| ID | B002 revisado | B002 com ensaios identificados |
| --- | --- | --- |
| C06 | Let's test a 4 mm version. | Let's run the initial bracket deformation test with a 4 mm version. |
| C08 | In the deformation test, the 4 mm version still exceeded the deformation limit. | In the initial bracket deformation test, the 4 mm version still exceeded the deformation limit. |
| C09 | Please run that test again this afternoon. | Please repeat that initial bracket deformation test with the 4 mm version this afternoon. |
| C15 | We tested the 4 mm version and it still exceeded the deformation limit. | In the initial bracket deformation test, the 4 mm version still exceeded the deformation limit. |
| C24 | Going back to the bracket, the 4 mm rerun still exceeded the deformation limit. | Going back to the bracket, the afternoon rerun of the initial deformation test with the 4 mm version is complete. It still exceeded the deformation limit. |

## Relações esperadas

A seta vai da fala mais recente (origem) para uma fala anterior (alvo) da mesma thread. Os IDs são de chunks, não números gerados de eventos. Cada linha é uma expectativa do gabarito, não uma resposta da IA.

`none` significa que o par foi revisado e não merece aresta direta. `not_applicable` mantém a relação, sem comparar configurações. Um par sem gabarito não recebe pontuação e não equivale a `none`.

### Pares com aresta esperada

| Origem | Texto da origem | Alvo | Texto do alvo | relation_type | configuration_match |
| --- | --- | --- | --- | --- | --- |
| C04 | Maybe the thickness is causing the problem. | C01 | The bracket is deforming too much. | related_to | not_applicable |
| C06 | Let's run the initial bracket deformation test with a 4 mm version. | C04 | Maybe the thickness is causing the problem. | tests | not_applicable |
| C08 | In the initial bracket deformation test, the 4 mm version still exceeded the deformation limit. | C06 | Let's run the initial bracket deformation test with a 4 mm version. | result_of | exact |
| C09 | Please repeat that initial bracket deformation test with the 4 mm version this afternoon. | C06 | Let's run the initial bracket deformation test with a 4 mm version. | repeats | exact |
| C09 | Please repeat that initial bracket deformation test with the 4 mm version this afternoon. | C08 | In the initial bracket deformation test, the 4 mm version still exceeded the deformation limit. | repeats | exact |
| C13 | Maybe the support stiffness is the real issue. | C01 | The bracket is deforming too much. | related_to | not_applicable |
| C14 | Let's test the support condition next. | C13 | Maybe the support stiffness is the real issue. | tests | not_applicable |
| C15 | In the initial bracket deformation test, the 4 mm version still exceeded the deformation limit. | C06 | Let's run the initial bracket deformation test with a 4 mm version. | result_of | exact |
| C19 | Maybe the mounting-hole spacing is concentrating the stress. | C17 | The sensor enclosure wall is cracking near the mounting holes. | related_to | not_applicable |
| C21 | Let's test a version with wider hole spacing. | C19 | Maybe the mounting-hole spacing is concentrating the stress. | tests | not_applicable |
| C22 | In the test with wider hole spacing, the sensor enclosure no longer cracked. | C21 | Let's test a version with wider hole spacing. | result_of | exact |
| C24 | Going back to the bracket, the afternoon rerun of the initial deformation test with the 4 mm version is complete. It still exceeded the deformation limit. | C06 | Let's run the initial bracket deformation test with a 4 mm version. | repeats | exact |
| C24 | Going back to the bracket, the afternoon rerun of the initial deformation test with the 4 mm version is complete. It still exceeded the deformation limit. | C08 | In the initial bracket deformation test, the 4 mm version still exceeded the deformation limit. | repeats | exact |
| C24 | Going back to the bracket, the afternoon rerun of the initial deformation test with the 4 mm version is complete. It still exceeded the deformation limit. | C09 | Please repeat that initial bracket deformation test with the 4 mm version this afternoon. | result_of | exact |
| C24 | Going back to the bracket, the afternoon rerun of the initial deformation test with the 4 mm version is complete. It still exceeded the deformation limit. | C15 | In the initial bracket deformation test, the 4 mm version still exceeded the deformation limit. | repeats | exact |
| C32 | Maybe the coating thickness is too low. | C30 | Separately, the bracket coating is failing the salt-spray test. | related_to | not_applicable |
| C33 | Let's measure the coating thickness. | C32 | Maybe the coating thickness is too low. | tests | not_applicable |
| C35 | We measured the coating at 18 microns, below the required 25. | C32 | Maybe the coating thickness is too low. | supports | not_applicable |
| C35 | We measured the coating at 18 microns, below the required 25. | C33 | Let's measure the coating thickness. | result_of | exact |
| C36 | Back to the bracket deformation, let's test the support stiffness under the same load. | C13 | Maybe the support stiffness is the real issue. | tests | not_applicable |

### Pares sem aresta esperada

| Origem | Texto da origem | Alvo | Texto do alvo | relation_type | configuration_match |
| --- | --- | --- | --- | --- | --- |
| C03 | The current bracket is 3 mm aluminum. | C01 | The bracket is deforming too much. | none | — |
| C06 | Let's run the initial bracket deformation test with a 4 mm version. | C01 | The bracket is deforming too much. | none | — |
| C06 | Let's run the initial bracket deformation test with a 4 mm version. | C03 | The current bracket is 3 mm aluminum. | none | — |
| C08 | In the initial bracket deformation test, the 4 mm version still exceeded the deformation limit. | C01 | The bracket is deforming too much. | none | — |
| C08 | In the initial bracket deformation test, the 4 mm version still exceeded the deformation limit. | C03 | The current bracket is 3 mm aluminum. | none | — |
| C08 | In the initial bracket deformation test, the 4 mm version still exceeded the deformation limit. | C04 | Maybe the thickness is causing the problem. | none | — |
| C09 | Please repeat that initial bracket deformation test with the 4 mm version this afternoon. | C01 | The bracket is deforming too much. | none | — |
| C09 | Please repeat that initial bracket deformation test with the 4 mm version this afternoon. | C03 | The current bracket is 3 mm aluminum. | none | — |
| C09 | Please repeat that initial bracket deformation test with the 4 mm version this afternoon. | C04 | Maybe the thickness is causing the problem. | none | — |
| C10 | We have decided to use the 4 mm version in the next prototype. | C01 | The bracket is deforming too much. | none | — |
| C10 | We have decided to use the 4 mm version in the next prototype. | C03 | The current bracket is 3 mm aluminum. | none | — |
| C10 | We have decided to use the 4 mm version in the next prototype. | C04 | Maybe the thickness is causing the problem. | none | — |
| C10 | We have decided to use the 4 mm version in the next prototype. | C06 | Let's run the initial bracket deformation test with a 4 mm version. | none | — |
| C10 | We have decided to use the 4 mm version in the next prototype. | C08 | In the initial bracket deformation test, the 4 mm version still exceeded the deformation limit. | none | — |
| C10 | We have decided to use the 4 mm version in the next prototype. | C09 | Please repeat that initial bracket deformation test with the 4 mm version this afternoon. | none | — |
| C13 | Maybe the support stiffness is the real issue. | C03 | The current bracket is 3 mm aluminum. | none | — |
| C13 | Maybe the support stiffness is the real issue. | C04 | Maybe the thickness is causing the problem. | none | — |
| C13 | Maybe the support stiffness is the real issue. | C06 | Let's run the initial bracket deformation test with a 4 mm version. | none | — |
| C13 | Maybe the support stiffness is the real issue. | C09 | Please repeat that initial bracket deformation test with the 4 mm version this afternoon. | none | — |
| C13 | Maybe the support stiffness is the real issue. | C10 | We have decided to use the 4 mm version in the next prototype. | none | — |
| C14 | Let's test the support condition next. | C01 | The bracket is deforming too much. | none | — |
| C14 | Let's test the support condition next. | C03 | The current bracket is 3 mm aluminum. | none | — |
| C14 | Let's test the support condition next. | C04 | Maybe the thickness is causing the problem. | none | — |
| C14 | Let's test the support condition next. | C06 | Let's run the initial bracket deformation test with a 4 mm version. | none | — |
| C14 | Let's test the support condition next. | C08 | In the initial bracket deformation test, the 4 mm version still exceeded the deformation limit. | none | — |
| C14 | Let's test the support condition next. | C09 | Please repeat that initial bracket deformation test with the 4 mm version this afternoon. | none | — |
| C14 | Let's test the support condition next. | C10 | We have decided to use the 4 mm version in the next prototype. | none | — |
| C15 | In the initial bracket deformation test, the 4 mm version still exceeded the deformation limit. | C01 | The bracket is deforming too much. | none | — |
| C15 | In the initial bracket deformation test, the 4 mm version still exceeded the deformation limit. | C03 | The current bracket is 3 mm aluminum. | none | — |
| C15 | In the initial bracket deformation test, the 4 mm version still exceeded the deformation limit. | C04 | Maybe the thickness is causing the problem. | none | — |
| C15 | In the initial bracket deformation test, the 4 mm version still exceeded the deformation limit. | C08 | In the initial bracket deformation test, the 4 mm version still exceeded the deformation limit. | none | — |
| C15 | In the initial bracket deformation test, the 4 mm version still exceeded the deformation limit. | C09 | Please repeat that initial bracket deformation test with the 4 mm version this afternoon. | none | — |
| C15 | In the initial bracket deformation test, the 4 mm version still exceeded the deformation limit. | C10 | We have decided to use the 4 mm version in the next prototype. | none | — |
| C15 | In the initial bracket deformation test, the 4 mm version still exceeded the deformation limit. | C13 | Maybe the support stiffness is the real issue. | none | — |
| C15 | In the initial bracket deformation test, the 4 mm version still exceeded the deformation limit. | C14 | Let's test the support condition next. | none | — |
| C21 | Let's test a version with wider hole spacing. | C17 | The sensor enclosure wall is cracking near the mounting holes. | none | — |
| C22 | In the test with wider hole spacing, the sensor enclosure no longer cracked. | C17 | The sensor enclosure wall is cracking near the mounting holes. | none | — |
| C22 | In the test with wider hole spacing, the sensor enclosure no longer cracked. | C19 | Maybe the mounting-hole spacing is concentrating the stress. | none | — |
| C24 | Going back to the bracket, the afternoon rerun of the initial deformation test with the 4 mm version is complete. It still exceeded the deformation limit. | C01 | The bracket is deforming too much. | none | — |
| C24 | Going back to the bracket, the afternoon rerun of the initial deformation test with the 4 mm version is complete. It still exceeded the deformation limit. | C03 | The current bracket is 3 mm aluminum. | none | — |
| C24 | Going back to the bracket, the afternoon rerun of the initial deformation test with the 4 mm version is complete. It still exceeded the deformation limit. | C04 | Maybe the thickness is causing the problem. | none | — |
| C24 | Going back to the bracket, the afternoon rerun of the initial deformation test with the 4 mm version is complete. It still exceeded the deformation limit. | C10 | We have decided to use the 4 mm version in the next prototype. | none | — |
| C24 | Going back to the bracket, the afternoon rerun of the initial deformation test with the 4 mm version is complete. It still exceeded the deformation limit. | C13 | Maybe the support stiffness is the real issue. | none | — |
| C24 | Going back to the bracket, the afternoon rerun of the initial deformation test with the 4 mm version is complete. It still exceeded the deformation limit. | C14 | Let's test the support condition next. | none | — |
| C26 | For the sensor enclosure, let's test a 4 mm wall. | C17 | The sensor enclosure wall is cracking near the mounting holes. | none | — |
| C26 | For the sensor enclosure, let's test a 4 mm wall. | C19 | Maybe the mounting-hole spacing is concentrating the stress. | none | — |
| C26 | For the sensor enclosure, let's test a 4 mm wall. | C21 | Let's test a version with wider hole spacing. | none | — |
| C26 | For the sensor enclosure, let's test a 4 mm wall. | C22 | In the test with wider hole spacing, the sensor enclosure no longer cracked. | none | — |
| C29 | That 2 kg limit applies to the sensor enclosure. | C17 | The sensor enclosure wall is cracking near the mounting holes. | none | — |
| C29 | That 2 kg limit applies to the sensor enclosure. | C19 | Maybe the mounting-hole spacing is concentrating the stress. | none | — |
| C29 | That 2 kg limit applies to the sensor enclosure. | C21 | Let's test a version with wider hole spacing. | none | — |
| C29 | That 2 kg limit applies to the sensor enclosure. | C22 | In the test with wider hole spacing, the sensor enclosure no longer cracked. | none | — |
| C29 | That 2 kg limit applies to the sensor enclosure. | C26 | For the sensor enclosure, let's test a 4 mm wall. | none | — |
| C33 | Let's measure the coating thickness. | C30 | Separately, the bracket coating is failing the salt-spray test. | none | — |
| C35 | We measured the coating at 18 microns, below the required 25. | C30 | Separately, the bracket coating is failing the salt-spray test. | none | — |
| C36 | Back to the bracket deformation, let's test the support stiffness under the same load. | C01 | The bracket is deforming too much. | none | — |
| C36 | Back to the bracket deformation, let's test the support stiffness under the same load. | C03 | The current bracket is 3 mm aluminum. | none | — |
| C36 | Back to the bracket deformation, let's test the support stiffness under the same load. | C04 | Maybe the thickness is causing the problem. | none | — |
| C36 | Back to the bracket deformation, let's test the support stiffness under the same load. | C06 | Let's run the initial bracket deformation test with a 4 mm version. | none | — |
| C36 | Back to the bracket deformation, let's test the support stiffness under the same load. | C08 | In the initial bracket deformation test, the 4 mm version still exceeded the deformation limit. | none | — |
| C36 | Back to the bracket deformation, let's test the support stiffness under the same load. | C09 | Please repeat that initial bracket deformation test with the 4 mm version this afternoon. | none | — |
| C36 | Back to the bracket deformation, let's test the support stiffness under the same load. | C10 | We have decided to use the 4 mm version in the next prototype. | none | — |
| C36 | Back to the bracket deformation, let's test the support stiffness under the same load. | C15 | In the initial bracket deformation test, the 4 mm version still exceeded the deformation limit. | none | — |
| C36 | Back to the bracket deformation, let's test the support stiffness under the same load. | C24 | Going back to the bracket, the afternoon rerun of the initial deformation test with the 4 mm version is complete. It still exceeded the deformation limit. | none | — |
| C38 | For the sensor enclosure, the 4 mm wall cracked again. | C19 | Maybe the mounting-hole spacing is concentrating the stress. | none | — |
| C38 | For the sensor enclosure, the 4 mm wall cracked again. | C21 | Let's test a version with wider hole spacing. | none | — |
| C38 | For the sensor enclosure, the 4 mm wall cracked again. | C22 | In the test with wider hole spacing, the sensor enclosure no longer cracked. | none | — |
| C38 | For the sensor enclosure, the 4 mm wall cracked again. | C29 | That 2 kg limit applies to the sensor enclosure. | none | — |
| C39 | The sensor enclosure must remain under 2 kg. | C17 | The sensor enclosure wall is cracking near the mounting holes. | none | — |
| C39 | The sensor enclosure must remain under 2 kg. | C19 | Maybe the mounting-hole spacing is concentrating the stress. | none | — |
| C39 | The sensor enclosure must remain under 2 kg. | C21 | Let's test a version with wider hole spacing. | none | — |
| C39 | The sensor enclosure must remain under 2 kg. | C22 | In the test with wider hole spacing, the sensor enclosure no longer cracked. | none | — |
| C39 | The sensor enclosure must remain under 2 kg. | C26 | For the sensor enclosure, let's test a 4 mm wall. | none | — |
| C39 | The sensor enclosure must remain under 2 kg. | C38 | For the sensor enclosure, the 4 mm wall cracked again. | none | — |
| C40 | The bracket must maintain a safety factor of two under the test load. | C01 | The bracket is deforming too much. | none | — |
| C40 | The bracket must maintain a safety factor of two under the test load. | C03 | The current bracket is 3 mm aluminum. | none | — |
| C40 | The bracket must maintain a safety factor of two under the test load. | C04 | Maybe the thickness is causing the problem. | none | — |
| C40 | The bracket must maintain a safety factor of two under the test load. | C06 | Let's run the initial bracket deformation test with a 4 mm version. | none | — |
| C40 | The bracket must maintain a safety factor of two under the test load. | C08 | In the initial bracket deformation test, the 4 mm version still exceeded the deformation limit. | none | — |
| C40 | The bracket must maintain a safety factor of two under the test load. | C09 | Please repeat that initial bracket deformation test with the 4 mm version this afternoon. | none | — |
| C40 | The bracket must maintain a safety factor of two under the test load. | C10 | We have decided to use the 4 mm version in the next prototype. | none | — |
| C40 | The bracket must maintain a safety factor of two under the test load. | C13 | Maybe the support stiffness is the real issue. | none | — |
| C40 | The bracket must maintain a safety factor of two under the test load. | C14 | Let's test the support condition next. | none | — |
| C40 | The bracket must maintain a safety factor of two under the test load. | C15 | In the initial bracket deformation test, the 4 mm version still exceeded the deformation limit. | none | — |
| C40 | The bracket must maintain a safety factor of two under the test load. | C24 | Going back to the bracket, the afternoon rerun of the initial deformation test with the 4 mm version is complete. It still exceeded the deformation limit. | none | — |
| C40 | The bracket must maintain a safety factor of two under the test load. | C36 | Back to the bracket deformation, let's test the support stiffness under the same load. | none | — |
| C43 | Let's run the support-stiffness test under the same load tomorrow morning. | C01 | The bracket is deforming too much. | none | — |
| C43 | Let's run the support-stiffness test under the same load tomorrow morning. | C03 | The current bracket is 3 mm aluminum. | none | — |
| C43 | Let's run the support-stiffness test under the same load tomorrow morning. | C04 | Maybe the thickness is causing the problem. | none | — |
| C43 | Let's run the support-stiffness test under the same load tomorrow morning. | C06 | Let's run the initial bracket deformation test with a 4 mm version. | none | — |
| C43 | Let's run the support-stiffness test under the same load tomorrow morning. | C08 | In the initial bracket deformation test, the 4 mm version still exceeded the deformation limit. | none | — |
| C43 | Let's run the support-stiffness test under the same load tomorrow morning. | C09 | Please repeat that initial bracket deformation test with the 4 mm version this afternoon. | none | — |
| C43 | Let's run the support-stiffness test under the same load tomorrow morning. | C10 | We have decided to use the 4 mm version in the next prototype. | none | — |
| C43 | Let's run the support-stiffness test under the same load tomorrow morning. | C15 | In the initial bracket deformation test, the 4 mm version still exceeded the deformation limit. | none | — |
| C43 | Let's run the support-stiffness test under the same load tomorrow morning. | C24 | Going back to the bracket, the afternoon rerun of the initial deformation test with the 4 mm version is complete. It still exceeded the deformation limit. | none | — |
| C43 | Let's run the support-stiffness test under the same load tomorrow morning. | C40 | The bracket must maintain a safety factor of two under the test load. | none | — |

### Pares sem gabarito

| Origem | Texto da origem | Alvo | Texto do alvo | Por que permanece sem gabarito |
| --- | --- | --- | --- | --- |
| C04 | Maybe the thickness is causing the problem. | C03 | The current bracket is 3 mm aluminum. | A hipótese usa a espessura descrita no fato anterior. Não é inequívoco se isso merece related_to direto ou apenas fornece contexto para entender a hipótese. |
| C13 | Maybe the support stiffness is the real issue. | C08 | In the initial bracket deformation test, the 4 mm version still exceeded the deformation limit. | A hipótese da rigidez pode explicar o problema geral ou o resultado específico de 4 mm; a fala não identifica esse resultado como seu alvo. |
| C36 | Back to the bracket deformation, let's test the support stiffness under the same load. | C14 | Let's test the support condition next. | A nova proposta detalha rigidez e carga, mas não explicita se retoma, esclarece, substitui ou repete a proposta anterior. |
| C38 | For the sensor enclosure, the 4 mm wall cracked again. | C17 | The sensor enclosure wall is cracking near the mounting holes. | A recorrência da trinca é explícita, mas a localização e a versão anteriores não estão identificadas. A taxonomia não determina uma única relação para essa recorrência. |
| C38 | For the sensor enclosure, the 4 mm wall cracked again. | C26 | For the sensor enclosure, let's test a 4 mm wall. | A observação da trinca é compatível com o teste proposto, mas não afirma que um teste foi executado. Não se presume result_of. |
| C39 | The sensor enclosure must remain under 2 kg. | C29 | That 2 kg limit applies to the sensor enclosure. | A expressão under 2 kg pode reiterar o limite ou esclarecer uma desigualdade estrita; não estabelece automaticamente uma substituição nem cumprimento do requisito. |
| C43 | Let's run the support-stiffness test under the same load tomorrow morning. | C13 | Maybe the support stiffness is the real issue. | O nome do teste pode expressar diretamente a investigação da hipótese ou apenas retomar o teste já proposto. O objetivo direto não está inequívoco. |
| C43 | Let's run the support-stiffness test under the same load tomorrow morning. | C14 | Let's test the support condition next. | As propostas não identificam uma execução anterior concluída nem um ensaio compartilhado de forma única. Agendar não implica repetir. |
| C43 | Let's run the support-stiffness test under the same load tomorrow morning. | C36 | Back to the bracket deformation, let's test the support stiffness under the same load. | Tomorrow morning pode agendar o mesmo teste aberto, reagendá-lo ou pedir outra execução. A fala não distingue essas possibilidades. |

## Fontes preservadas

Input e expectativas derivados de [tests/fixtures/typed-relations-b002-clarified.json](../tests/fixtures/typed-relations-b002-clarified.json). Relações derivadas de [tests/fixtures/typed-relations-b002-clarified.json](../tests/fixtures/typed-relations-b002-clarified.json). As fixtures de teste permanecem intactas.
