# Testes: referência

O [README](../README.md#6-testes) explica o que cada suíte protege, como ler as métricas e quais foram os resultados. Este arquivo guarda o que interessa a quem vai mexer no código, ou seja, o que conferir em cada tipo de mudança e como rodar as avaliações que custam dinheiro.

## O que conferir em cada mudança

| Mudança | O que conferir |
| --- | --- |
| Visual | Primeira pintura, celular, teclado e os dois temas |
| Permissões | Conta sem acesso, convite aceito, acesso revogado e sessão expirada |
| Escrita com versão | Duas versões concorrentes e rollback |
| Migração | Cópia completa preservada, backup, integridade e permissões |
| Prompt ou pergunta do JEV | Testes da sala e uma rodada LYLE para comparar com a anterior |
| IA | Entrada enviada, fonte citada, trecho apontado, recusa de conteúdo inventado, limite de orçamento e estado obsoleto ao concluir |

Depois das suítes visuais, rode `VITE_BASE_PATH=/ npm --prefix norte run build`, porque elas compilam a interface com outro caminho base e o site local fica em branco.

## Integração contínua

`.github/workflows/ci.yml` procura segredos, audita dependências e roda tipos, lint, testes Node e Vitest, build e as suítes Python e JavaScript da reunião. Os testes com navegador real são comandos separados e ficam fora desse workflow.

## Avaliações com provedor real

Estes comandos usam dados locais de `novo_teste/` e, quando dizem pago, chaves reais. Nenhum deles roda sozinho. Os resultados ficam em `novo_teste/resultados/`, fora do Git.

| Comando | O que faz | Custo |
| --- | --- | --- |
| `python3 tests/lyle/build_answer_key.py` | Lê as 13 marcações do PDF LYLE e gera o gabarito | Grátis |
| `node tests/lyle/highlights.cjs run --note "o que mudou"` | Roda os alertas nas três reuniões LYLE com o JEV real e guarda uma nova rodada | Cerca de US$ 0,01 |
| `node tests/lyle/highlights.cjs report` | Refaz o relatório a partir das rodadas salvas | Grátis |
| `python3 tests/lyle/compare_minutes.py --saved` | Mede as atas já salvas | Grátis |
| `python3 tests/lyle/compare_minutes.py --live` | Gera atas novas com o provedor configurado e compara | Pago |
| `python3 scripts/refine_highlight_questions.py --round N` | Pede à LLM ajustes nas perguntas, a partir dos erros da rodada N | Pago |
| `node scripts/verify-memory-v2.cjs` | Mede retenção, tipo e assunto do JEV em casos rotulados | Pago |
| `node scripts/verify-typed-relations.cjs` | Mede as relações entre eventos em casos rotulados | Pago |
| `node tests/live-meeting-simulation.cjs --run-live` | Fala uma reunião longa na sala real, com microfone simulado | Pago |

## Como fazer uma nova rodada de alertas

1. Mude as perguntas em `prompts/jev/questions.js` e aumente `highlightVersion`.
2. Rode `node --test tests/*.test.cjs`, que confere o formato das perguntas sem gastar nada.
3. Rode `node tests/lyle/highlights.cjs run --note "o que mudou e por quê"`.
4. Abra `novo_teste/resultados/destaques/RELATORIO.md`. Ele mostra a entrada, o esperado, o texto das perguntas, o que mudou em relação à rodada anterior e o resultado de cada alerta.

Cada rodada guarda em `rodada-N/` as perguntas usadas (`perguntas.json`) e as notas de cada frase (`resultado.json`), então qualquer número pode ser conferido depois.

## Limites

Testes com provedor simulado mostram que o transporte, as validações e a interface funcionam. Eles não medem se o modelo acerta. Uma medida de qualidade exige falas rotuladas por especialistas e um conjunto separado dos exemplos usados nas correções.
