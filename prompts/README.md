# Prompts do Norte

Tudo o que o Norte pede a um modelo está nesta pasta. Para mudar um comportamento, edite o arquivo e reinicie o serviço; não é preciso mexer no código.

## `llm/`: modelos de linguagem

| Arquivo | Quando roda | Modelo padrão | Quem lê |
| --- | --- | --- | --- |
| `meeting-common.md` | Início de toda tarefa de reunião | `gpt-6-luna` | `meetings/engine/block_agents.py` |
| `meeting-notes.md` | Durante a reunião, para redigir as notas | `gpt-6-luna` | `meetings/engine/block_agents.py` |
| `meeting-notes-judge.md` | Confere se a nota é fiel à fala | `gpt-6-luna` | `meetings/engine/block_agents.py` |
| `meeting-note-problems.json` | Na segunda tentativa, diz ao editor o que falhou na nota | `gpt-6-luna` | `meetings/engine/block_agents.py` |
| `meeting-correction-reason.md` | Explica uma correção humana | `gpt-6-luna` | `meetings/engine/block_agents.py` |
| `meeting-jev-adaptation.md` | Propõe exemplos para o JEV com base nas correções | `gpt-6-luna` | `meetings/engine/block_agents.py` |
| `minutes.md` | Ao organizar a ata | `gpt-6.1-sol` | `meetings/engine/minutes.py` |
| `requirement-review.md` | Ao pedir a revisão de um requisito | `gpt-6.1-sol` | `norte/server/requirement-analysis.mjs` |
| `engineering-assistant.md` | Regras comuns das análises de engenharia | `gpt-6.1-sol` | `norte/server/engineering-assistant.mjs` |
| `engineering-standards.md` | Ao pedir referências aplicáveis | `gpt-6.1-sol` | `norte/server/engineering-assistant.mjs` |
| `engineering-verification.md` | Ao pedir métodos de verificação | `gpt-6.1-sol` | `norte/server/engineering-assistant.mjs` |
| `engineering-document.md` | Ao pedir o rascunho de um documento | `gpt-6.1-sol` | `norte/server/engineering-assistant.mjs` |
| `highlight-questions.md` | Só por comando: propõe ajustes às perguntas de destaque | `gpt-6.1-sol` | `scripts/refine_highlight_questions.py` |

Os modelos mudam por variável de ambiente (veja `.env.example`). Cada linha dos arquivos é uma frase, para a alteração ficar fácil de revisar.

## `jev/`: perguntas de classificação

`jev/questions.js` guarda todas as perguntas. `jev/meeting-feedback.md` é o aviso somado à pergunta de tipo quando a reunião tem exemplos corrigidos por pessoas.

| Grupo | O que decide | Respostas |
| --- | --- | --- |
| `speechStatus` | O orador terminou o ponto ou vai continuar | `finished`, `unfinished` |
| `speechJoin` | O pedaço seguinte completa o anterior | `same_point`, `separate` |
| `commandCompletion` | A fala seguinte completa um comando | `completes`, `separate` |
| `commands` | É um comando ao Norte ou conversa | `rename_topic`, `other_command`, `conversation` |
| `memory` | O trecho guarda informação do projeto e qual é o tipo | sim/não; `observation`, `hypothesis`, `test_proposal`, `test_result`, `decision`, `requirement`, `other` |
| `topics` | A qual tópico o evento pertence | um tópico existente ou `new_topic` |
| `relations` | Vínculo direto entre dois eventos e se a configuração bate | `supports`, `contradicts`, `tests`… |
| `review` | A fala excluída e o comentário bastam para classificar | `sufficient` ou o que falta |
| `highlights` | Se a frase tem um dos oito problemas abaixo | sim/não por pergunta |
| `highlightFragment` | Qual pedaço da frase carrega o problema | sim/não por pedaço |
| `highlightEvidence` | Qual fala anterior prova o problema | uma fala anterior ou `none` |
| `memoryContext` | Frases somadas às perguntas de `memory` quando o trecho chega com a fala anterior | texto fixo |
| `threads`, `threadCandidate`, `relationHistory` | Reuniões antigas; não rodam em reuniões novas | não se aplica |

## Perguntas de destaque

Rodam depois da reunião, quando alguém clica em **Analisar falas**. Cada frase recebe as oito perguntas, junto com as 11 frases anteriores da mesma reunião. A frase vira alerta quando uma pergunta passa de 0,6; se mais de uma passar, fica a mais forte. `highlightRules` guarda o título, a explicação e o próximo passo que a pessoa lê.

| Pergunta | O que procura | Exemplo de forma | O que não conta |
| --- | --- | --- | --- |
| `regulatory_dismissal` | Afastar um regime de controle sem classificação concluída | “é para pesquisa, então a regra não se aplica” | Mencionar o regime para pedir análise |
| `meaning_conflict` | O mesmo valor com segunda leitura ou número diferente | um chama de altitude, outro de alcance | Primeira menção, pedido de definição, comentário sobre o conflito |
| `contradicts_record` | Registrar como fato o oposto do que já foi dito | marcar como inexistente o que acabou de ser informado | Concordar, corrigir ou apontar o erro |
| `premature_commitment` | Fechar agora e deixar a dependência para depois | congelar hoje e analisar a restrição depois | Manter preliminar ou esperar a análise |
| `unsupported_conclusion` | Ir de uma evidência parcial a uma conclusão ampla | uma aprovação “cobre tudo”; uma fonte “garante” o conjunto | Limitar a conclusão ao que foi informado |
| `controlled_transfer` | Plano de enviar conteúdo técnico a terceiro estrangeiro sem verificar controles | enviar desenhos ao integrador de fora | Segurar o envio; compra sem troca de conteúdo técnico |
| `schedule_conflict` | Data confirmada que não cabe nos prazos já ditos | confirmar em quatro semanas o que leva doze | Prazo estimado ou condicionado |
| `status_without_evidence` | Um registro mostra status além da evidência | checklist diz verificado sem ensaio concluído | Concordâncias curtas, status correto, correção do status |

Os exemplos acima explicam a pergunta para quem lê. Eles não são enviados ao JEV.

Para melhorar as perguntas com base em correções:

1. Na sala, marque cada alerta como **Procede** ou **Não procede** e use **Exportar correções**.
2. Rode `python3 scripts/refine_highlight_questions.py --round N --corrections correcoes-alertas.json`. É uma chamada paga e explícita.
3. Leia `proposta.json`. Propostas que repetem quatro palavras seguidas de uma reunião são recusadas.
4. Copie o que fizer sentido para `jev/questions.js`, mude `highlightVersion` e rode a suíte LYLE para ver se melhorou.

Ao mudar uma pergunta:

1. Mantenha as chaves de `criteria`: o código usa esses nomes.
2. Mantenha os marcadores `{{...}}`: são preenchidos a cada requisição.
3. Não coloque exemplos de uma reunião real: a pergunta vale para todas as reuniões.
4. Rode `node --test tests/*.test.cjs` e compare o resultado com a suíte LYLE (veja o README).
