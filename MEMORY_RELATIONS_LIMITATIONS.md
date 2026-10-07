# Relações, ata e limites da Memória V2

## O que o grafo representa

Uma thread identifica uma linha de investigação. Uma aresta registra uma afirmação direta entre dois eventos dessa linha. Compartilhar componente, valor ou assunto não é suficiente. O sentido é sempre **evento atual → evento anterior**; não há arestas entre threads nem para eventos ainda sem atribuição.

O vocabulário contém os nove tipos propostos (`result_of`, `supports`, `contradicts`, `depends_on`, `affects`, `supersedes`, `repeats`, `related_to`, `none`) e três distinções adicionais:

- `tests`: um plano investiga uma hipótese ou requisito; não é evidência de sucesso.
- `clarifies`: uma fala esclarece o escopo ou significado de outra; não inventa medições faltantes.
- `based_on`: uma decisão cita uma evidência como sua justificativa; não endossa a qualidade dessa decisão.

Os nomes são um contrato do acompanhamento dos eventos. Os textos das perguntas e dos critérios são editáveis em **Questões → Relações**, com versões TRQ e snapshots por execução. Não há `has_relation` na etapa nova. A etapa antiga permanece compatível com seus próprios arquivos.

## Inferência e auditoria

As perguntas do JEV são independentes e não leem a resposta de outra pergunta no mesmo request. Por isso o tipo é avaliado antes da configuração. Esta escolha de arquitetura segue a [documentação oficial do JEV](https://docs.typesafe.ai/introduction).

Na arquitetura 2, o tipo usa os eventos anteriores da thread como contexto para resolver referências. A configuração recebe um único par e o tipo efetivamente previsto, sem outros candidatos ou histórico. Isso impede que o comparador complete silenciosamente parâmetros ausentes com dados de outro ensaio. As [respostas Choice](https://docs.typesafe.ai/primitives/choice) incluem probabilidades por opção; a aplicação conserva a distribuição e o `confidence` original, mas seu limiar de revisão usa **a probabilidade da classe escolhida**, que é uma medida diferente.

`none` não cria aresta nem consulta match. Toda outra previsão cria uma aresta, inclusive com baixa probabilidade ou erro posterior no comparador. Nesses casos a aresta exige revisão; não é descartada nem substituída por um gabarito. `not_applicable` mantém a relação, com `configuration_applicable=false` e sem valor de comparação na memória; a resposta original continua na auditoria.

`mismatch` significa conflito de configuração, e não ausência de relação. `partial` mantém os detalhes faltantes como faltantes. `ambiguous` indica que nem a identidade da configuração foi estabelecida. Identificadores de duas execuções podem diferir sem mudar a configuração; uma versão, temperatura, espessura ou carga explicitamente diferente é outro caso. Resultado medido e limite de aceitação não são, por si, configurações em conflito.

Requests são construídos a partir de campos semânticos permitidos, sem gabaritos, notas de revisão, estados derivados ou eventos futuros. A restauração verifica os requests e outputs, reconstrói arestas e nunca faz novas chamadas. O processamento não repete automaticamente chamadas faturáveis. Erros, interrupções e pares que não puderam ser processados ficam visíveis.

## Conclusões e pendências

- Um teste é concluído automaticamente somente por `result_of` confirmado, de um resultado para uma proposta, com match `exact` confirmado. O limiar é 0,8 em ambas as classificações. Isso significa execução correspondente relatada; não significa aprovação, resultado favorável ou validação definitiva.
- Um resultado com `partial`, `mismatch`, `ambiguous` ou erro no comparador não comprova a execução solicitada. A aresta permanece disponível para revisão.
- Pedir repetição cria uma nova pendência. Um resultado anterior não conclui esse novo pedido.
- Hipóteses e requisitos acumulam suporte, contestação ou evidência mista. Não são transformados automaticamente em causas comprovadas ou requisitos permanentemente encerrados.
- `supersedes` representa substituição explícita, não conclusão bem-sucedida. Pode conservar `mismatch` por uma mudança deliberada de versão/configuração. Uma fonte posteriormente substituída deixa de sustentar fechamento ou evidência vigente; suas arestas históricas permanecem auditáveis. Substituir uma substituição não reativa automaticamente versões antigas ou resultados retirados.
- Eventos sem thread, como requisitos sem sujeito identificado, permanecem pendentes. A etapa de relações não reassocia esses eventos retroativamente. Isso requer um mecanismo próprio de resolução de atribuições; uma relação intrathread não pode contornar essa incerteza.

O status inicial de `meeting_events` não é reescrito. O acompanhamento é uma projeção separada calculada a partir das evidências. Probabilidade alta não garante correção semântica: ata e diagrama continuam revisáveis.

## Gabaritos e ambiguidades reais

Os testes novos cobrem duas investigações por reunião, evidências conflitantes, parâmetros incompatíveis, resultados incompletos, novas execuções, revisão de plano, requisitos e referências indiretas. Os modos de avaliação são distintos: `--isolated` fornece eventos/threads anotados e mede apenas relações; o modo integral mede o fluxo real; `--from-run` reutiliza outputs reais verificados sem repetir os chunks.

Em `typed-relations-b002.json`, os textos, tipos e threads são os mesmos do B002 revisado. Há 125 pares elegíveis: 112 têm gabarito explícito e 13 permanecem sem anotação por ambiguidade. Não ter gabarito não significa `none` nem conta como acerto. Após a auditoria final, esses 112 pares são 18 positivos e 94 negativos. C24 retoma o ensaio inicial com `repeats` para C06/C08; impedir `result_of` para o plano inicial não elimina essa relação. A correção e a reavaliação sem novas chamadas estão no relatório. Em particular, C15 não identifica qual execução de 4 mm está relatando; C24 menciona um rerun, mas não prova que seja a mesma execução de C15. C38 relata uma trinca sem afirmar que veio de um teste. As notas da fixture detalham cada omissão.

Um grafo esparso não precisa eliminar toda redundância semanticamente útil. Um pedido que identifica um ensaio anterior pode apontar à proposta e ao relato dessa execução. Duas arestas do mesmo pedido não representam dois novos ensaios; contagens devem usar o ID do evento de origem. Ter um caminho indireto não prova nem proíbe uma aresta direta adicional: o texto deve estabelecer esse vínculo. Uma fala pode conter mais de um ato; o classificador atual preserva um tipo principal por chunk e uma relação principal por par. Para extrair todos os atos seria necessário segmentar eventos compostos, preservando sua origem.

Alterações de gabarito não substituem resultados de API. Os artefatos antigos conservam perguntas, inputs e respostas da rodada original. L05 do conjunto de ensaios e H11 do conjunto independente foram corrigidos de `observation` para `requirement`: esclarecem a condição especificada no plano, conforme a definição já existente de requisito. Isso não recupera a condição realmente aplicada num teste anterior. Outra revisão retirou restrições excessivas do gabarito: uma execução identificada pode ser alvo de `repeats` mesmo sendo registrada como resultado, e implementar uma decisão explícita de substituição pode ligar a nova proposta ao plano substituído. O comparativo de L06 passou a nomear o plano L1 para eliminar a ambiguidade de qual ensaio estava sendo contrastado. As notas registram também revisões anteriores à primeira inferência, como explicitar uma hipótese de necessidade do frio e separar decisão de revisão de uma nova proposta de ensaio.

## Ata, PDF e comentários

A ata organiza as falas retidas em tópicos, na ordem em que ocorreram dentro de cada discussão. O título é o da thread quando disponível; caso contrário, usa `Discussão T001`, por exemplo. Falas retidas ainda sem thread aparecem em **Pontos sem assunto definido**. Não há agrupamento por tipo de evento, IDs de chunks, probabilidades, relações ou acompanhamento de testes no corpo da ata ou PDF. Esses dados continuam disponíveis na auditoria da aplicação e no JSON de feedback. A ata não inventa participantes, data da reunião, consenso ou aprovação. O PDF é gerado localmente com **jsPDF e DejaVu Sans**, sem CDN nem nova chamada à IA; versões, licenças e hashes estão em [vendor/minutes/README.md](vendor/minutes/README.md).

Comentários podem ser ancorados em um tópico ou numa seleção específica. O JSON de feedback conserva texto citado, offsets UTF-16, IDs de eventos/relações, assinatura do documento, configuração, estrutura da ata e proveniência da execução. A simplificação visual preserva os IDs e a identidade da fonte para não invalidar comentários já salvos. Comentários antigos sobre blocos de auditoria continuam no feedback, embora esses blocos não sejam mais parte do corpo da ata. Comentários são locais ao navegador, podem ser resolvidos/reabertos e não alteram previsões. Exportar o feedback é necessário para transportá-lo ou preservá-lo fora desse navegador. Não há sincronização multiusuário nem treinamento automático; feedback humano também precisa de revisão antes de virar dado de treinamento.

A fonte incorporada cobre português e os caracteres usuais dos exemplos. Se houver um caractere sem cobertura, o gerador bloqueia a exportação e informa o problema em vez de omitir texto; a ata HTML mantém o conteúdo. Idiomas/escritas adicionais exigem fontes correspondentes.

## Limites operacionais

Na Memória V2, histórico, recuperação da execução e rascunhos por aba ficam no **IndexedDB**. Os registros antigos de `localStorage`/`sessionStorage` são validados e copiados integralmente; a chave antiga só é removida depois da confirmação da gravação, se não mudou durante a migração. Perguntas, requests, respostas, probabilidades e relações permanecem na auditoria. As gravações do histórico são transacionais; conflitos na recuperação compartilhada não sobrescrevem o rascunho de outra aba. A memória anterior continua usando seu armazenamento original.

Isso corrige o estouro da quota de Web Storage causado pelos snapshots grandes, mas não torna o armazenamento ilimitado nem cria backup externo. Limpar os dados do site remove também o IndexedDB. Se o navegador negar uma gravação, a página informa o erro e preserva os registros anteriores; resultados que existam somente na RAM de uma aba antiga não podem ser recuperados por uma migração após fechar essa aba. Preferências de interface e comentários da ata continuam pequenos registros locais separados; o feedback deve ser exportado para preservação fora do navegador.

O protótipo aceita até 100 chunks. Comparar todos os eventos anteriores da mesma thread tem custo quadrático no tamanho dessa thread; não foi implementada busca aproximada que pudesse eliminar candidatos silenciosamente. Os limites locais de request (32 questões, state de 16 mil caracteres e corpo de 64 KB) são verificados antes de enviar. Requests são divididos quando possível; evidência grande demais gera erro explícito, sem truncar uma identidade/configuração para obter uma resposta.

A precisão depende das etapas anteriores. Um chunk ignorado incorretamente ou colocado em outra thread pode impedir uma relação correta; esses pares esperados são contados como não processados, não removidos do denominador. O conjunto independente e o B002 servem para observar generalização; nenhum conjunto pequeno estabelece desempenho universal em reuniões reais.

Resultados medidos e caminhos dos artefatos estão em `RELATIONS_VALIDATION.md`.

## Uso na página

Abra **Memória V2**, em `/?profile=memory-v2#memoria`. **Carregar input** mantém apenas o editor de JSON e seus controles de copiar, formatar, cancelar e aplicar. O formato continua `batch_id`, `cases` e `expected_threads`, sem campos adicionais obrigatórios. Copie [B002.json](B002.json) na raiz ou um dos inputs de [exemplos-testes](exemplos-testes/README.md). Cada exemplo tem uma tabela de falas e resultados esperados, além de um arquivo de relações separado para consulta. Esses gabaritos separados não são importados automaticamente nem enviados à IA.

Em **Questões**, as abas Chunks, Threads e Relações mostram os textos efetivos e permitem salvar versões. **Usar padrão revisado** coloca o padrão atual no editor; salve a versão para usá-lo. Isso permite atualizar uma sessão antiga sem reescrever testes históricos nem apagar perguntas personalizadas.

A etapa de relações da página usa uma fila contínua: cada evento entra quando sua atribuição de thread termina. As respostas acrescentam/atualizam arestas imediatamente enquanto os próximos chunks continuam sendo processados. O snapshot de fila é versão 3; a construção semântica das perguntas continua equivalente à arquitetura 2. Eventos futuros não entram nos requests. Uma relação pode aparecer antes de seu match terminar; nesse intervalo continua em revisão. Interromper a execução não provoca retry, e reabrir uma execução parcial preserva os resultados já recebidos sem retomar chamadas.

A aba **Canvas** mantém o diagrama do fluxo. **Mapa de relações** mostra os eventos como nós e as relações reais como setas do evento de origem ao alvo. Cores distinguem tipos; tracejado identifica relações em revisão. Passe o mouse ou dê foco a um tópico para destacar vizinhos e consultar conexões; clique para fixar a seleção. É possível mover nós, arrastar o fundo, ampliar e ajustar o enquadramento. Compartilhar thread não cria automaticamente uma ligação; eventos sem thread ficam isolados.

**Ata / PDF** abre somente os títulos das discussões e os chunks em tópicos. Selecione um trecho para ancorar um comentário; exporte o feedback JSON para preservar comentários e proveniência fora deste navegador. Auditoria e acompanhamento técnico continuam no aplicativo e no feedback, separados do corpo da ata.
