# Inputs e gabaritos de reunião

Para usar o B002, abra [B002.json na raiz](../B002.json), copie o arquivo inteiro e cole em **Carregar input**. Os outros exemplos estão abaixo. Não é necessário usar um botão específico por exemplo.

| Conjunto | Input para copiar e colar | Tabela para revisar | Gabarito de relações separado |
| --- | --- | --- | --- |
| B002 — reunião revisada | [b002.json](b002.json) | [b002.md](b002.md) | [b002.relations.json](b002.relations.json) |
| B002 — ensaios identificados | [b002-ensaios-identificados.json](b002-ensaios-identificados.json) | [b002-ensaios-identificados.md](b002-ensaios-identificados.md) | [b002-ensaios-identificados.relations.json](b002-ensaios-identificados.relations.json) |
| Ensaios e revisões | [ensaios-e-revisoes.json](ensaios-e-revisoes.json) | [ensaios-e-revisoes.md](ensaios-e-revisoes.md) | [ensaios-e-revisoes.relations.json](ensaios-e-revisoes.relations.json) |
| Freio e sensor | [freio-e-sensor.json](freio-e-sensor.json) | [freio-e-sensor.md](freio-e-sensor.md) | [freio-e-sensor.relations.json](freio-e-sensor.relations.json) |
| Reunião em português | [reuniao-em-portugues.json](reuniao-em-portugues.json) | [reuniao-em-portugues.md](reuniao-em-portugues.md) | [reuniao-em-portugues.relations.json](reuniao-em-portugues.relations.json) |

## Formato do input

Todos os arquivos da coluna **Input para copiar e colar** mantêm exatamente a estrutura original:

```json
{
  "batch_id": "B002",
  "cases": [
    {
      "id": "C01",
      "current_utterance": "The bracket is deforming too much.",
      "expected_store_memory": true,
      "expected_event_type": "observation"
    }
  ],
  "expected_threads": {
    "C01": {
      "expected_action": "create_new_thread",
      "expected_thread_id": "T001"
    }
  }
}
```

Não há `review_notes`, metadados de revisão nem `expected_typed_relations` nesses inputs. Os campos de gabarito avaliam o resultado localmente e não devem ser enviados como evidência ao classificador.

A aplicação continua criando relações entre eventos quando recebe esse formato. Os arquivos `.relations.json` são documentos separados de consulta e edição do gabarito; não são inputs para colar no modal e não são importados automaticamente junto do JSON. As tabelas em Markdown permitem comparar manualmente as relações produzidas.

## Como corrigir um exemplo

1. Edite a fala em `current_utterance` e revise `expected_store_memory` e `expected_event_type` no JSON do input.
2. Se o assunto mudou, revise também `expected_threads`. Um evento pendente mantém `expected_thread_id: null`.
3. Revise no arquivo `.relations.json` os pares afetados. A chave externa é o chunk de origem (mais recente) e a interna é o chunk alvo (anterior).
4. Atualize a tabela `.md` correspondente para manter a leitura humana de acordo com o JSON. As tabelas são arquivos de documentação; não atualizam o JSON automaticamente.

Os arquivos B002.json na raiz e b002.json nesta pasta começam idênticos. São cópias independentes: se você editar uma, a outra não muda automaticamente.

## Como ler as relações

- `relation_type: none`: o par foi revisado e não precisa de aresta; não há `configuration_match`.
- Outro `relation_type`: há uma ligação direta esperada, com a direção origem → alvo.
- `configuration_match: not_applicable`: a relação é válida, mas não exige comparar configurações.
- `exact`, `partial`, `mismatch` e `ambiguous`: indicam, respectivamente, compatibilidade explícita, detalhes omitidos, conflito explícito e identidade insuficientemente determinada.
- Par ausente do gabarito: não avaliado ou ambíguo, sem pontuação; ausência não significa `none`. As tabelas listam as ambiguidades conhecidas.

Estar na mesma thread não exige relação entre todos os pares. As tabelas preservam os `none` explícitos para permitir revisar essa distinção. Eventos ainda sem thread e pares entre threads diferentes ficam fora desse conjunto de candidatos.

Um resultado compatível pode registrar a execução de um teste, mas não prova automaticamente uma hipótese nem aprova um projeto. Uma repetição nova permanece aberta até receber seu próprio resultado compatível.

## Diferenças entre os dois B002

O B002 da raiz contém as revisões documentadas da primeira etapa: C08 e C22 mencionam explicitamente um teste, e a ação esperada de C13 é `keep_active_thread`. O [input originalmente fornecido](../tests/fixtures/memory-b002-original.json) continua preservado para comparação.

O exemplo **B002 — ensaios identificados** é uma cópia separada que altera somente C06, C08, C09, C15 e C24 para distinguir ensaio inicial e repetição à tarde. Sua tabela mostra as falas antes e depois. Os tipos de evento e as threads esperadas permanecem iguais ao B002 revisado.

Os JSONs desta pasta e as tabelas foram derivados das fixtures existentes, sem novas chamadas à API e sem alterar as fixtures usadas pelos testes.

## Reunião com simulação de vigas

A página **Simulação de vigas** (`#simulacao`) usa a mesma sala, gravação, memória e ata de **Reuniões**, com uma lista própria de reuniões. Criar uma reunião não liga o microfone. Canvas e Simulação aparecem inicialmente; Gráficos, Resultados e Cálculos aparecem quando solicitados e continuam acessíveis pela voz ou pelos botões.

Importe [reuniao-simulacao-transcricao.txt](testes_viga/reuniao-simulacao-transcricao.txt) para experimentar o fluxo. O arquivo contém apenas falas com horários e participantes, sem gabarito. Também é possível gravar ou abrir **Escrever**. Os exemplos são sugestões, não frases obrigatórias:

- “Norte, vamos simular uma viga.”
- “Muda essa força pra 12.” — durante a simulação, usa a força única e sua unidade exibida.
- “Muda a altura da seção para 25 centímetros.” — abre a seção em 3D.
- “Norte, mova a força P1 para 4 metros.”
- “Norte, compare o esforço cortante antes e depois.”
- “Quero ver os resultados.”
- “Volta para o canvas.”

O caso inicial é o do [HTML original](testes_viga/viga_editor_calculos_secao.html): balanço de 6 m, 10 kN na ponta, seção retangular de 120 × 240 mm e aço estrutural. Cada alteração preserva uma versão. O seletor de referência aparece ao solicitar uma comparação; “antes e depois” usa a anterior à atual. Um erro de transcrição como “12 km” pode ser interpretado como “12 kN” quando se trata inequivocamente da intensidade de uma força. A fala original e a interpretação permanecem no registro. Pedidos de posição não recebem essa conversão; alvos ou propriedades ainda ambíguos pedem esclarecimento.

Os comandos de simulação são classificados separadamente das falas da reunião. Falas longas são divididas em ideias, mantendo o trecho original e seus horários. Os testes e resultados calculados entram no fluxo normal de extração, assuntos e relações, com sua configuração e origem preservadas, sem aparecer como falas na transcrição. Uma edição manual pode ser registrada por **Registrar resultado na reunião**, no menu **⋯**. Clique em um elemento para abrir somente seus campos de edição.

O motor reutiliza os cálculos do HTML: forças verticais, momentos, massas e carregamentos uniformemente distribuídos; apoios articulados, roletes e engastes; seção retangular ou I, propriedades constantes ao longo da viga. A massa própria aplicada é um valor independente da densidade e pode ser preenchida pela massa geométrica. Flechas usam a integração numérica original de M/EI. O modelo é linear elástico e não inclui cargas horizontais, recalques ou não linearidade.

Verificações locais: `node --test tests/beam-engine.test.cjs tests/beam-commands.test.cjs tests/meeting-session.test.cjs`, `node tests/browser-beam-workspace.cjs` e `node tests/browser-beam-meeting.cjs`. O teste `node tests/live-beam-session.cjs --run-live` usa a API configurada e consome créditos; sem a opção, ele não faz requisições.
