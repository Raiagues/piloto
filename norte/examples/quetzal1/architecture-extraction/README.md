# Extrações de fontes adicionais — Quetzal-1

Resultados reais de `createSystemAiService().generate()` usando `gemini-3.5-flash-lite`, obtidos em 08/09/2026 (UTC). Os JSONs preservam a saída aceita pelo serviço, incluindo modelo, timestamp e evidências. Nenhum gabarito, banco do usuário, telemetria ou resultado pós-voo foi enviado. As entradas foram somente os arquivos de projeto correspondentes em [architecture-sources](../architecture-sources/README.md), com metadados mínimos de projeto.

| Fonte | Entidades no fragmento | Relações técnicas | Resultado |
| --- | ---: | ---: | --- |
| ADCS-hardware | 4 | 1 | Aceito após correção de contrato pelo provedor |
| ADM-hardware | 5 | 1 | Aceito |
| ADCS-software | 6 | 0 | Aceito |
| MISSION-overview | 7 | 0 | Aceito |

A tentativa inicial com os três documentos ADCS/ADM juntos foi rejeitada por uma citação sem correspondência (`SYSTEM_EVIDENCE_INVALID`), mesmo após correção de contrato. Separar por documento produziu os fragmentos acima. A resposta rejeitada não integra o pacote. Estes resultados não são uma aprovação A0 do benchmark nem validação humana completa da arquitetura; a verificação automatizada comprova contrato e correspondência textual das citações, não completude técnica ou correção semântica de cada relação.

O servidor revalida os JSONs contra os bytes exatos anexados antes de mesclar. IDs recebem prefixos por fonte; nomes normalizados e tipos exatamente correspondentes são unificados quando há correspondência única. Se uma visão geral chama um subsistema de componente, o mesmo nome único sob o mesmo pai é reutilizado, preservando a classificação detalhada existente. Isso evita duplicar o ADM por diferença de classificação. Valores existentes prevalecem. A raiz extraída organiza os ramos do mesmo projeto, sem criar dependências físicas. Cenários recebem uma cópia da arquitetura anterior quando ainda não a possuem. O modelo e as posições originais são arquivados no projeto.

O mapa passa a incluir a visão geral da missão e detalhes documentados de ADCS/ADM, além do EPS anterior. OBC, payload e estrutura têm identificação, mas não especificações completas. Transceiver e NanoCom AX100 não são unificados por suposição: uma referência genérica não comprova identidade de hardware. Não há preenchimento artificial de requisitos, valores, térmica ou relações ausentes.

A importação usa extrações registradas, sem chamar Gemini no início do Render. Não é uma nova extração ao abrir a página. Aplica-se uma vez, apenas ao projeto existente com a proveniência real do EPS, preservando OBSAT e quaisquer edições posteriores. Uma falha aborta a transação e mantém o serviço acessível com o projeto anterior.
