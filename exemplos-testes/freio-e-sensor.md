# Freio e sensor

Investigação de capacidade de retenção de um freio e de deslocamento de um sensor. Exercita dependência de uma tarefa, verificação de requisito, efeito direto e esclarecimento de um plano.

Copie o conteúdo de [freio-e-sensor.json](freio-e-sensor.json) para **Carregar input**. O arquivo contém somente `batch_id`, `cases` e `expected_threads`, no formato original. O [gabarito de relações](freio-e-sensor.relations.json) fica separado para consulta e edição; ele não é parte do input copiável.

## Falas e resultados esperados

Os IDs desta tabela identificam os chunks do input. A coluna Thread mostra a atribuição esperada após a fala; `—` significa ausência de atribuição. Todos os detalhes de continuidade e de candidatas arquivadas continuam preservados em `expected_threads` no JSON.

| ID | Texto | Guardar memória | Tipo esperado | Thread esperada | Ação esperada |
| --- | --- | --- | --- | --- | --- |
| H01 | The A9 actuator brake must hold a stationary 120 N load while the actuator is deenergized. | true | requirement | T001 | create_new_thread |
| H02 | Please remove the locking pin from actuator A9 before beginning any brake test. | true | other | T001 | keep_active_thread |
| H03 | Let us run holding test B1 on the A9 actuator brake with a stationary 120 N load while deenergized, to verify that holding requirement. Starting B1 depends on completing the locking-pin removal just requested. | true | test_proposal | T001 | keep_active_thread |
| H04 | B1 is complete: the deenergized A9 actuator brake was subjected to a stationary 120 N load and slipped. It therefore failed the specified 120 N holding requirement. | true | test_result | T001 | keep_active_thread |
| H05 | Repeat B1 tomorrow as new run B2, again with actuator A9 deenergized and subjected to a stationary 120 N load. | true | test_proposal | T001 | keep_active_thread |
| H06 | The drawing number for the A9 actuator brake is BA-4. | true | observation | T001 | keep_active_thread |
| H07 | Separately, the tip of temperature probe P7 has an upward position offset of 0.2 mm. | true | observation | T002 | create_new_thread |
| H08 | Expansion of the support bracket changes that P7 probe-tip position by 0.2 mm upward. | true | observation | T002 | keep_active_thread |
| H09 | Let us run thermal trial P1 on probe P7 in a 60 C chamber for 30 minutes, measuring bracket expansion and probe-tip position to test the claimed effect of expansion on tip position. | true | test_proposal | T002 | keep_active_thread |
| H10 | The P1 thermal-test report identifies probe P7 and a 30-minute duration, and records 0.2 mm of bracket expansion. The chamber-temperature page is missing and no tip-position measurement was recorded. | true | test_result | T002 | keep_active_thread |
| H11 | The 60 C specified in the P1 thermal-test plan is the chamber setpoint, not the probe temperature. | true | requirement | T002 | keep_active_thread |
| H12 | Based on the bracket-expansion measurement reported in P1, we decided to add a compliant bracket mount to the next probe prototype. | true | decision | T002 | keep_active_thread |

## Observações para revisar o gabarito

- H02 é uma tarefa preparatória. Não afirma que o freio cumpre o requisito; uma dependência explícita aparece em H03.
- H05 pode repetir a execução representada por H03 e H04. O resultado antigo não conclui a repetição nova.
- H08 afirma que a expansão muda a posição descrita em H07: a relação esperada é affects, com direção do efeito para a posição afetada.
- H10 deixa a temperatura real sem registro e não mede a posição da ponta. O resultado é partial em relação ao plano; não demonstra automaticamente o efeito alegado.
- H11 é requirement porque esclarece o significado de um parâmetro especificado. O esclarecimento do plano não recupera a condição ausente no registro da execução.

## Relações esperadas

A seta vai da fala mais recente (origem) para uma fala anterior (alvo) da mesma thread. Os IDs são de chunks, não números gerados de eventos. Cada linha é uma expectativa do gabarito, não uma resposta da IA.

`none` significa que o par foi revisado e não merece aresta direta. `not_applicable` mantém a relação, sem comparar configurações. Um par sem gabarito não recebe pontuação e não equivale a `none`.

### Pares com aresta esperada

| Origem | Texto da origem | Alvo | Texto do alvo | relation_type | configuration_match |
| --- | --- | --- | --- | --- | --- |
| H03 | Let us run holding test B1 on the A9 actuator brake with a stationary 120 N load while deenergized, to verify that holding requirement. Starting B1 depends on completing the locking-pin removal just requested. | H01 | The A9 actuator brake must hold a stationary 120 N load while the actuator is deenergized. | tests | exact |
| H03 | Let us run holding test B1 on the A9 actuator brake with a stationary 120 N load while deenergized, to verify that holding requirement. Starting B1 depends on completing the locking-pin removal just requested. | H02 | Please remove the locking pin from actuator A9 before beginning any brake test. | depends_on | not_applicable |
| H04 | B1 is complete: the deenergized A9 actuator brake was subjected to a stationary 120 N load and slipped. It therefore failed the specified 120 N holding requirement. | H01 | The A9 actuator brake must hold a stationary 120 N load while the actuator is deenergized. | contradicts | exact |
| H04 | B1 is complete: the deenergized A9 actuator brake was subjected to a stationary 120 N load and slipped. It therefore failed the specified 120 N holding requirement. | H03 | Let us run holding test B1 on the A9 actuator brake with a stationary 120 N load while deenergized, to verify that holding requirement. Starting B1 depends on completing the locking-pin removal just requested. | result_of | exact |
| H05 | Repeat B1 tomorrow as new run B2, again with actuator A9 deenergized and subjected to a stationary 120 N load. | H03 | Let us run holding test B1 on the A9 actuator brake with a stationary 120 N load while deenergized, to verify that holding requirement. Starting B1 depends on completing the locking-pin removal just requested. | repeats | exact |
| H05 | Repeat B1 tomorrow as new run B2, again with actuator A9 deenergized and subjected to a stationary 120 N load. | H04 | B1 is complete: the deenergized A9 actuator brake was subjected to a stationary 120 N load and slipped. It therefore failed the specified 120 N holding requirement. | repeats | exact |
| H08 | Expansion of the support bracket changes that P7 probe-tip position by 0.2 mm upward. | H07 | Separately, the tip of temperature probe P7 has an upward position offset of 0.2 mm. | affects | not_applicable |
| H09 | Let us run thermal trial P1 on probe P7 in a 60 C chamber for 30 minutes, measuring bracket expansion and probe-tip position to test the claimed effect of expansion on tip position. | H08 | Expansion of the support bracket changes that P7 probe-tip position by 0.2 mm upward. | tests | not_applicable |
| H10 | The P1 thermal-test report identifies probe P7 and a 30-minute duration, and records 0.2 mm of bracket expansion. The chamber-temperature page is missing and no tip-position measurement was recorded. | H09 | Let us run thermal trial P1 on probe P7 in a 60 C chamber for 30 minutes, measuring bracket expansion and probe-tip position to test the claimed effect of expansion on tip position. | result_of | partial |
| H11 | The 60 C specified in the P1 thermal-test plan is the chamber setpoint, not the probe temperature. | H09 | Let us run thermal trial P1 on probe P7 in a 60 C chamber for 30 minutes, measuring bracket expansion and probe-tip position to test the claimed effect of expansion on tip position. | clarifies | not_applicable |
| H12 | Based on the bracket-expansion measurement reported in P1, we decided to add a compliant bracket mount to the next probe prototype. | H10 | The P1 thermal-test report identifies probe P7 and a 30-minute duration, and records 0.2 mm of bracket expansion. The chamber-temperature page is missing and no tip-position measurement was recorded. | based_on | not_applicable |

### Pares sem aresta esperada

| Origem | Texto da origem | Alvo | Texto do alvo | relation_type | configuration_match |
| --- | --- | --- | --- | --- | --- |
| H02 | Please remove the locking pin from actuator A9 before beginning any brake test. | H01 | The A9 actuator brake must hold a stationary 120 N load while the actuator is deenergized. | none | — |
| H04 | B1 is complete: the deenergized A9 actuator brake was subjected to a stationary 120 N load and slipped. It therefore failed the specified 120 N holding requirement. | H02 | Please remove the locking pin from actuator A9 before beginning any brake test. | none | — |
| H05 | Repeat B1 tomorrow as new run B2, again with actuator A9 deenergized and subjected to a stationary 120 N load. | H01 | The A9 actuator brake must hold a stationary 120 N load while the actuator is deenergized. | none | — |
| H05 | Repeat B1 tomorrow as new run B2, again with actuator A9 deenergized and subjected to a stationary 120 N load. | H02 | Please remove the locking pin from actuator A9 before beginning any brake test. | none | — |
| H06 | The drawing number for the A9 actuator brake is BA-4. | H01 | The A9 actuator brake must hold a stationary 120 N load while the actuator is deenergized. | none | — |
| H06 | The drawing number for the A9 actuator brake is BA-4. | H02 | Please remove the locking pin from actuator A9 before beginning any brake test. | none | — |
| H06 | The drawing number for the A9 actuator brake is BA-4. | H03 | Let us run holding test B1 on the A9 actuator brake with a stationary 120 N load while deenergized, to verify that holding requirement. Starting B1 depends on completing the locking-pin removal just requested. | none | — |
| H06 | The drawing number for the A9 actuator brake is BA-4. | H04 | B1 is complete: the deenergized A9 actuator brake was subjected to a stationary 120 N load and slipped. It therefore failed the specified 120 N holding requirement. | none | — |
| H06 | The drawing number for the A9 actuator brake is BA-4. | H05 | Repeat B1 tomorrow as new run B2, again with actuator A9 deenergized and subjected to a stationary 120 N load. | none | — |
| H09 | Let us run thermal trial P1 on probe P7 in a 60 C chamber for 30 minutes, measuring bracket expansion and probe-tip position to test the claimed effect of expansion on tip position. | H07 | Separately, the tip of temperature probe P7 has an upward position offset of 0.2 mm. | none | — |
| H10 | The P1 thermal-test report identifies probe P7 and a 30-minute duration, and records 0.2 mm of bracket expansion. The chamber-temperature page is missing and no tip-position measurement was recorded. | H07 | Separately, the tip of temperature probe P7 has an upward position offset of 0.2 mm. | none | — |
| H10 | The P1 thermal-test report identifies probe P7 and a 30-minute duration, and records 0.2 mm of bracket expansion. The chamber-temperature page is missing and no tip-position measurement was recorded. | H08 | Expansion of the support bracket changes that P7 probe-tip position by 0.2 mm upward. | none | — |
| H11 | The 60 C specified in the P1 thermal-test plan is the chamber setpoint, not the probe temperature. | H07 | Separately, the tip of temperature probe P7 has an upward position offset of 0.2 mm. | none | — |
| H11 | The 60 C specified in the P1 thermal-test plan is the chamber setpoint, not the probe temperature. | H08 | Expansion of the support bracket changes that P7 probe-tip position by 0.2 mm upward. | none | — |
| H11 | The 60 C specified in the P1 thermal-test plan is the chamber setpoint, not the probe temperature. | H10 | The P1 thermal-test report identifies probe P7 and a 30-minute duration, and records 0.2 mm of bracket expansion. The chamber-temperature page is missing and no tip-position measurement was recorded. | none | — |
| H12 | Based on the bracket-expansion measurement reported in P1, we decided to add a compliant bracket mount to the next probe prototype. | H07 | Separately, the tip of temperature probe P7 has an upward position offset of 0.2 mm. | none | — |
| H12 | Based on the bracket-expansion measurement reported in P1, we decided to add a compliant bracket mount to the next probe prototype. | H08 | Expansion of the support bracket changes that P7 probe-tip position by 0.2 mm upward. | none | — |
| H12 | Based on the bracket-expansion measurement reported in P1, we decided to add a compliant bracket mount to the next probe prototype. | H09 | Let us run thermal trial P1 on probe P7 in a 60 C chamber for 30 minutes, measuring bracket expansion and probe-tip position to test the claimed effect of expansion on tip position. | none | — |
| H12 | Based on the bracket-expansion measurement reported in P1, we decided to add a compliant bracket mount to the next probe prototype. | H11 | The 60 C specified in the P1 thermal-test plan is the chamber setpoint, not the probe temperature. | none | — |

### Pares sem gabarito

Todos os pares anteriores da mesma thread estão anotados explicitamente. Pares entre threads diferentes não fazem parte dos candidatos.

## Fontes preservadas

Input e expectativas derivados de [tests/fixtures/typed-relations-holdout.json](../tests/fixtures/typed-relations-holdout.json). Relações derivadas de [tests/fixtures/typed-relations-holdout.json](../tests/fixtures/typed-relations-holdout.json). As fixtures de teste permanecem intactas.
