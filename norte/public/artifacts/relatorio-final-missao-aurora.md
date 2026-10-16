# Relatório final demonstrativo — Missão Aurora

> Documento fictício criado para testar a Memória do Projeto. Não representa uma submissão real à OBSAT.

## 1. Resumo da missão

A Missão Aurora avaliou um CanSat universitário para registrar temperatura, tensão da bateria e intensidade luminosa durante um voo de demonstração. O protótipo deveria produzir telemetria legível a cada segundo e manter os dados íntegros mesmo após uma reinicialização do computador de bordo.

## 2. Equipe e responsabilidades

| Área | Responsabilidade principal |
| --- | --- |
| Sistemas e integração | Requisitos, interfaces e revisões |
| OBC e software de voo | Aquisição, enquadramento e registro dos dados |
| Potência | Orçamento de energia e monitoramento da bateria |
| Estruturas e térmica | Envelope mecânico, fixação e proteção dos sensores |
| Comunicações e solo | Recepção, armazenamento e visualização da telemetria |

## 3. Requisitos de demonstração

- `REQ-01`: registrar uma amostra de telemetria a cada `1 s ± 100 ms`.
- `REQ-02`: medir temperatura entre `-10 °C` e `60 °C` com erro máximo de `±2 °C` após calibração.
- `REQ-03`: informar tensão da bateria com resolução mínima de `0,05 V`.
- `REQ-04`: reiniciar a aquisição automaticamente após uma falha de alimentação.
- `REQ-05`: permitir rastrear cada amostra por contador monotônico e tempo desde a inicialização.

## 4. Arquitetura utilizada

O protótipo usou um Arduino Uno como computador de bordo, um sensor analógico TMP36, um divisor resistivo para monitorar a bateria e uma interface serial para a estação solo. O código de referência está conectado à memória como `aurora/telemetria-arduino`.

## 5. Verificação

| Teste | Método | Resultado demonstrativo |
| --- | --- | --- |
| Taxa de aquisição | 30 min de operação em bancada | Aprovado; 99,8% dos intervalos dentro da tolerância |
| Calibração térmica | Comparação em três pontos | Aprovado com ressalva; erro máximo de 1,7 °C |
| Queda de alimentação | 20 ciclos controlados | Aprovado; aquisição retomada em menos de 3 s |
| Integridade do quadro | Injeção de ruído na recepção | Aprovado; checksum detectou todos os quadros alterados no ensaio |

## 6. Limitações conhecidas

- O ensaio térmico não representa vácuo nem toda a faixa esperada em voo.
- A interface serial é adequada para bancada, mas não substitui a validação do enlace de rádio.
- O orçamento de potência deve ser refeito com os componentes finais e suas tolerâncias.

## 7. Decisão recomendada

Prosseguir para uma revisão integrada somente após fechar o enlace de comunicação, repetir o orçamento energético com margens e registrar a rastreabilidade entre requisitos, testes e evidências.
