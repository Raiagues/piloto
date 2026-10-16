# Validação da integração Norte + reuniões

Registro de 15/10/2026. A integração está preparada nesta pasta, com base em [Raiagues/norte](https://github.com/Raiagues/norte), commit `eb7a8d5be670e3b36ab79c104c6c897a2508b894`, identificado em [UPSTREAM.json](norte/UPSTREAM.json). Este relatório registra verificações locais; não representa publicação no GitHub ou no Render.

Para abrir, execute `./start` **na raiz de testes_JEV** e acesse <http://127.0.0.1:8000>. Em **Explorar com conta de teste**, o perfil de validação cria Quetzal-1, uma equipe com apenas o criador e **17 documentos**, sem colegas fictícios e sem mapa pronto. Os arquivos e suas origens estão no [manifesto do corpus](project-documents/quetzal-1/manifest.json). Referências de fabricantes ficam fora do Git e precisam ser provisionadas em outra instalação. Instruções completas: [README.md](README.md).

**Verificações executadas**

| Verificação | Resultado e alcance |
| --- | --- |
| JavaScript da reunião e componentes legados | **517 aprovados**, nenhuma falha. Evidência: `.runtime/root-js-final.log`. |
| Norte completo | **130 testes de interface e 287 de servidor aprovados**, nenhuma falha; TypeScript, lint e compilação de produção concluídos. Evidências: `.runtime/norte-quality-final.log` e `.runtime/norte-tests-final.log` (inclui os últimos testes de apresentação do relatório). A compilação informa um pacote acima de 500 kB, uma oportunidade de otimização. |
| Python | **105 testes: 103 aprovados e 2 ignorados**, nenhuma falha. Os dois casos dependentes de PostgreSQL foram cobertos na rodada específica abaixo. Evidência: `.runtime/python-final.log`. |
| Contas com PostgreSQL real | **14 aprovados**, incluindo os dois casos antes ignorados. Evidência local: `/tmp/norte-postgres-accounts-test.log`. |
| Reuniões e autorização | **16 aprovados**, incluindo convite e aceite, isolamento entre equipes, CSRF, gravação exclusiva pelo anfitrião, conflito de versão, revogação de acesso e regeneração do mapa. Arquivo: `norte/server/meetings.test.mjs`. Estes casos também integram a suíte Norte. |
| Navegador com serviços reais | Chrome → Node → assinatura interna → Python → SQLite: criação, convite, contribuição, persistência, reabertura, versão concorrente, isolamento, layout móvel, documentos e feedback passaram, sem erros JavaScript. Script: `norte/scripts/visual-integrated-live.mjs`. Esta rodada **não chama provedores de IA**. |
| PostgreSQL compartilhado | Node e Python coexistiram no mesmo banco de teste: identidades independentes, sessões, convites, reunião e conflito de versão preservados. Vinte gravações concorrentes, reinício e cópia/restauração com `pg_dump`/`pg_restore` passaram. Nenhum banco do usuário foi alterado. |
| Docker | Imagem construída; verificações de saúde, autenticação, página da reunião e comunicação com o serviço privado responderam corretamente. Cookie seguro, interface, arquivos da reunião, bloqueio anônimo e transporte para o Python foram verificados sem chaves externas; o contêiner descartável foi removido. Evidência: `.runtime/validation/docker-smoke.json`. A porta pública pertence ao Node. A existência da imagem não substitui o provisionamento do corpus nem a configuração dos provedores no ambiente de destino. |
| PDF extenso real | ATmega328P original, **33,32 MB e 653 páginas**: o parser assíncrono leu todas as páginas, sem lacunas, e extraiu 1.939.244 caracteres em cerca de 1,61 s. A preparação do projeto produziu o mesmo texto. Limites de tamanho e texto fornecido pelo cliente foram verificados. Evidência: `.runtime/validation/long-pdf-parser.json`. Este teste não chama LLM. |
| Upload pelo navegador | O mesmo PDF foi selecionado no formulário, enviado por HTTP, salvo e reaberto. A classificação projeto/referência permaneceu salva; mudar a classificação preservou os bytes. O parser após o upload leu **653/653 páginas**. Evidência: `.runtime/validation/long-pdf-upload-browser.json`; nenhum provedor chamado. |

Os totais pertencem a conjuntos diferentes, com sobreposição; não devem ser somados. Os relatórios em `.runtime/` e `/tmp/` são evidências locais, não arquivos necessariamente presentes em um novo clone.

**Inferência real e respostas controladas**

Uma extração real com Gemini `gemini-3.8-flash` concluiu **duas fontes** do Quetzal-1, sobre hardware EPS e ADCS: **24 entidades, 24 relações, 4 requisitos e 15 evidências**. O relatório registra os dois trechos concluídos e as tentativas do provedor. Evidências: [relatório](.runtime/validation/chunk-extraction/report.json) e [modelo verificado](.runtime/validation/chunk-extraction/verified-model.json). Essa amostra não valida o corpus inteiro nem o manual de 653 páginas.

Também passaram chamadas reais JEV: classificação de reunião **sem memória** ([registro](.runtime/validation/integrated-check.json)) e, em ambiente separado com o mapa dessas duas fontes, classificação **com memória**, preservação do formato esperado pela reunião e exploração rápida de ideia. A consulta devolveu cinco referências e reutilizou o cache; a exploração rápida usou JEV e registrou 313 ms nessa chamada. **A recuperação da memória usou seleção lexical após a tentativa JEV**, portanto não foi tratada como seleção JEV confirmada. O mapa permaneceu inalterado. Evidência: [validação com memória](.runtime/validation/memory-check.json). Esses tempos são observações pontuais, não promessa de desempenho.

A reunião também foi testada com o **mapa completo de 17 documentos**: consulta por código de componente com sufixo, evidência retornada, reutilização do cache e classificação real JEV passaram, sem alterar o mapa. A seleção desta chamada foi lexical após tentativa JEV. Evidência: [reunião com mapa completo](.runtime/validation/full-map-memory-check.json).

A exploração de ideias foi validada pela API autenticada usando o mapa completo e o feedback da conta permanente. A proposta de tensão de **3,3 V para 3,0 V** selecionou o ATmega328P do EPS e a propriedade correta. A interpretação usou o fallback Gemini e levou cerca de 2,9 s nessa chamada; o valor salvo continuou em 3,3 V. A repetição retornou o cache **sem novas chamadas JEV/LLM**, verificado pelos contadores. Evidência: [exploração com mapa completo](.runtime/validation/full-map-discovery-check.json).

Os testes de Session e de interface com respostas controladas verificam contratos, retomada e apresentação; não medem a qualidade real do modelo. A rodada de navegador com serviços reais confirma o transporte e a persistência sem simular Node, Python ou SQLite, mas mantém essa distinção quanto à IA.

**Proteções verificadas e limites**

Convidados recebem uma visão de leitura sem requisições internas, respostas brutas ou tarefas dos agentes; o anfitrião conserva o estado necessário à retomada. Memória desativada não aceita contexto de projeto fornecido pelo cliente. Mudanças nos documentos invalidam a memória anterior; regeneração exige revisão, conserva a versão anterior e recusa sobrescrever correções concorrentes. Revogar acesso durante início, consulta, retomada ou publicação da extração impede devolver ou publicar o resultado.

Feedback gera exemplos versionados e métricas de uso, sem alterar automaticamente os fatos do mapa. Reuso, tentativas e tokens são observáveis; melhoria geral de qualidade e redução contínua de custo **não foram demonstradas**. Não há treinamento automático dos pesos. Evidências textuais e cobertura reduzem erros, mas não dispensam revisão de números, unidades, requisitos, tabelas, esquemas e conflitos entre fontes. Segurança validada nos cenários descritos não equivale a uma auditoria externa completa.

**Resultado completo do corpus**

A extração real concluiu **17/17 documentos e 116/116 trechos**, sem trechos falhos. A última rodada reutilizou **115 trechos** e reprocessou um com validação adicional. A aplicação autenticada da proposta foi verificada na conta isolada, com reconhecimento explícito das pendências. Resultado: **84 objetos, 49 relações, 11 requisitos e 177 citações verificadas**. Evidências: [extração completa](.runtime/validation/corpus-report.json), [auditoria final](.runtime/validation/final-extraction-audit.json) e [aplicação pela API](.runtime/validation/corpus-apply.json).

**27 afirmações foram omitidas**, com motivo registrado; permanecem **2 conflitos**, **22 objetos e 7 relações inferidos**. A leitura integral não significa extração de todos os fatos. Foram corrigidas validações de citações, unidades, tabelas e limites absolutos de dano: esses limites não podem ser usados como condições normais de operação. Ambiguidades de esquemas continuam exigindo conferência visual, incluindo a identificação U23 na placa EPS.

Os documentos entraram nesta extração como textos integrais verificados contra os originais; por isso o relatório de trabalho não atribui contagem de páginas aos arquivos de texto. O corpus original contém **928 páginas em 10 PDFs**. O teste separado de upload e parsing comprova a leitura das **653 páginas do manual original**, sem usar um resumo como substituto.

Dois artigos acadêmicos foram mantidos em `evaluation-heldout/`, fora do manifesto ativo e dos prompts. Em sete comparações documentais escolhidas, cinco fatos estavam representados e dois parcialmente estruturados: os três rails do EPS e o momento magnético do ADCS ainda não estão completos como propriedades estruturadas. Isso não é um benchmark cego nem uma taxa geral de precisão. Não foram inseridos fatos dos artigos no mapa para completar artificialmente a avaliação. Evidência: [avaliação documental](.runtime/validation/heldout-evaluation.json).


**Conta permanente pronta para uso**

A conta local `teste@norte.local` possui uma equipe com somente seu criador, 17 documentos e o mapa completo já aplicado. A senha fica no arquivo privado [.runtime/conta-teste.txt](.runtime/conta-teste.txt). O teste no navegador confirmou login normal, mapa, 27 pendências visíveis, link autenticado para fonte e preservação integral do projeto, sem chamadas a modelos. Evidências: [aplicação com backup](.runtime/validation/reusable-map-apply-report.json) e [navegador da conta permanente](.runtime/validation/persistent-browser-map.json).

O painel de melhorias contém uma avaliação técnica real sobre a distinção entre limite absoluto e operação, observada durante esta validação. Ela gerou a versão 1 dos exemplos contextuais sem mudar o mapa, sem inventar aceitações e sem declarar ganho de precisão medido. Evidência: [avaliação registrada](.runtime/validation/persistent-feedback-check.json). O mapa reutiliza a extração já validada das mesmas fontes públicas; não foram atribuídas à conta permanente chamadas ou custos fictícios.

**Atualização: leitura em segundo plano e retomada da demonstração — 15/10/2026**

A tela bloqueante foi substituída por um painel minimizável, com lista dos documentos, estado por arquivo, trechos concluídos e reutilizados. A leitura segue automaticamente entre os lotes, com limite de duas chamadas simultâneas no serviço. A conclusão oferece revisão explícita, sem trocar o projeto ativo nem aplicar a proposta automaticamente. Software saiu da navegação; seus dados foram preservados.

| Verificação desta atualização | Resultado |
| --- | --- |
| Qualidade completa | **143 testes de interface e 305 de servidor aprovados**; TypeScript, ESLint e build de produção passaram. Evidência: `.runtime/extraction-ux-quality.log`. Permanece o aviso de pacote JavaScript acima de 500 kB. |
| Tarefas e proteção dos dados | Continuação automática, concorrência global, deduplicação, recuperação de checkpoints após reinício, revalidação das fontes, revogação de acesso e aplicação explícita passaram. Uma aba com geração antiga recebe conflito, em vez de sobrescrever um mapa novo. |
| Navegador: progresso | `norte/scripts/visual-extraction-background.mjs` passou com 17 arquivos, desktop e celular: minimizar, navegar para Reuniões, recarregar sem duplicar a tarefa, trocar de projeto e revisar/aplicar sem roubar o foco. A extração deste teste usa respostas controladas, não mede a interpretação do LLM. |
| Navegador: conta demonstrativa | `norte/scripts/visual-persistent-demo.mjs` passou com API e armazenamento reais: logout, cookie HttpOnly de retomada, reinício do servidor, recuperação da mesma conta/documento/mapa sem duplicação, isolamento de outro navegador e bloqueio de acesso entre contas. Evidência: `.runtime/validation/persistent-demo-browser.json`. |
| Regressão integrada | Chrome, Node, Python e SQLite reais passaram novamente: reuniões, convites, persistência, autorização, memória e feedback. Evidência: `.runtime/extraction-ux-integrated-browser.log`. |
| Instalação local atualizada | Serviço reiniciado e saúde HTTP 200. A demonstração existente conservou **90 objetos e 17 documentos**; a conta permanente conservou **84 objetos e 17 documentos**. Hashes dos dois mapas, registros documentais e revisões permaneceram iguais. Evidência: `.runtime/validation/extraction-ux-preservation.json`. |
| Conta permanente no serviço atualizado | Login, memória, mapa, pendências e fontes conferidos no navegador; nenhuma alteração de projeto e nenhuma chamada a modelos. Evidência: `.runtime/extraction-ux-live-account.log`. |

Esta rodada não repetiu a extração paga do corpus e não mede redução percentual do tempo do LLM. As melhorias eliminam pausas manuais, reaproveitam trechos válidos e permitem continuar usando a plataforma. A retomada da demonstração vale por 30 dias renováveis no mesmo navegador; limpar cookies perde esse comprovante. Para recuperar tarefas após substituir o servidor, é necessário preservar o diretório de cache além do banco. Mapas aplicados e documentos já salvos permanecem nos dados do projeto.

**Atualização: engenharia, requisitos, colaboração e temas — 15/10/2026**

O projeto `Raiagues/testes_requisitos` foi estudado no commit `692739d7b776fce1c8520d04bc4f9bb72a482318`. Requisitos, revisão independente, verificações, cronograma, catálogo opcional de normas e contratação manual foram adaptados à autoridade de contas e ao visual deste Norte. As políticas Supabase daquele ambiente não foram presumidas equivalentes: os endpoints locais foram exercitados com contas e permissões próprias.

A interface agora separa arquitetura por nível, interfaces e inventário de componentes. Projetos começam pelo nome e podem abrir a concepção sem documentos. A memória tem abas Documentos/Resumo/Configuração, pastas editáveis e edital vinculado ao arquivo original. Equipes e páginas de conta compartilham a paleta neutra/caramelo, com temas claro e escuro persistentes. A reunião recebe o tema sem recarregar o iframe.

| Verificação | Resultado |
| --- | --- |
| Suíte Norte | **165 testes de interface e 335 de servidor passaram**; TypeScript, ESLint e build passaram. Evidência: `.runtime/engineering-rework-quality-final.log`. As últimas correções de enquadramento do organograma e CSS tiveram typecheck/lint específicos e navegador real, seguidos do build final em `.runtime/engineering-build-final.log`. |
| Segredos e ponte | Varredura de 397 arquivos passou; seis testes da ponte JavaScript passaram. Evidências: `.runtime/engineering-secrets-final.log` e `.runtime/engineering-meeting-bridge-tests.log`. |
| Arquitetura e tema | Navegação entre níveis, matriz de interfaces, busca de componentes, evidências, edição manual sem IA, foco de teclado, 390px, persistência e sincronização de tema passaram. Contraste dos tokens de texto/link ≥4,5 nas superfícies verificadas; isso não equivale a uma auditoria completa WCAG. Relatórios: `theme-browser.json` e `engineering-architecture-browser.json` em `.runtime/validation/`. |
| Memória e edital | Nome primeiro, equipe privada, criação explícita de setores, subpastas, upload, busca, leitura/download, vinculação do edital sem duplicar bytes e persistência passaram. Treze testes de organização/ACL cobrem vínculos de referências, bloqueio externo e limpeza após exclusão. Evidências: `.runtime/project-workspace-browser.log` e `.runtime/project-workspace-acl.log`. |
| Pessoas e equipes | Diretório com **205 contas descartáveis**, três páginas, atualização sem duplicar, cancelamento de busca antiga, menu móvel e temas passou. Convite real e aceite por outra conta, delegação a múltiplos setores, edição em Aviônica/leitura em Propulsão, organograma/exportação e painel do capitão passaram. Evidências: `.runtime/people-directory-browser.log` e `.runtime/team-collaboration-browser.log`. |
| Requisitos até a entrega | Duas contas reais no ambiente temporário: edição, revisão independente, aprovação, invalidação após mudança, teste com evidência, catálogo opcional, cronograma, reload, temas e mobile passaram. Correções chegam à memória das reuniões/JEV e à análise de impacto; condições numéricas anteriores são descartadas quando o enunciado muda. Relatório: `.runtime/validation/delivery-browser.json`. |
| Administração e contratação | TOTP, segregação de sessões, mensagens privadas e bloqueio de terceiros, cotação no servidor, confirmação manual, telemetria consentida e exclusão após revogar consentimento passaram. Uma resposta perdida não duplica o pedido. Mudança de preço mostra a cotação atual e exige nova confirmação. Relatório: `.runtime/validation/platform-browser.json`. |
| Reuniões e retomada | Chrome/Node/Python/SQLite passaram novamente com convites, persistência, CAS, CSRF e isolamento. Troca de tema preservou a mesma sala/iframe. Extração em segundo plano e retomada da demonstração após reinício passaram. Evidências: `.runtime/engineering-integrated-browser.log`, `.runtime/engineering-background-browser.log` e `.runtime/engineering-demo-browser.log`. |
| Dados reais preservados | **Seis projetos e 55 artefatos** preservados; todos os bytes dos documentos e os demais projetos permaneceram iguais. O Quetzal demonstrativo passou de 90 para 87 objetos por consolidação de três aliases; conserva 17 documentos, 54 relações e 221 evidências. A alocação de três componentes está explicitamente marcada como inferida para revisão. A versão de 90 objetos está no histórico e em backup privado. Relatório: `.runtime/validation/engineering-preservation-after.json`. |
| Instalação em uso | Serviço em `http://127.0.0.1:8000`, saúde HTTP 200, build atualizado. Login normal da conta permanente, 17 documentos, mapa de 84 objetos, 27 pendências, fontes, modos de reunião e barreira MFA administrativa passaram sem alterar o projeto. Evidência: `.runtime/engineering-live-account.log`. |

Esta rodada não repetiu a extração paga dos documentos e não mede melhoria de precisão do LLM. Os fluxos de interface usam dados controlados ou fontes já salvas, sem chamadas externas de IA. As contas usadas nos testes de MFA, planos e conversas são temporárias; nenhum autenticador foi inscrito na conta real do usuário.

O Quetzal foi corrigido com `propose-quetzal-architecture-cleanup.mjs` e aplicação offline com validação de hashes, backup integral privado e histórico de modelo. Não foram unificadas instâncias de componentes apenas por part number, nem inventadas conexões elétricas. A alocação física/funcional ambígua continua identificada como interpretação.

O build ainda avisa sobre um pacote JavaScript maior que 500 kB (aproximadamente 226 kB comprimido nessa rodada). País/região requer um proxy confiável configurado; sem ele aparece não informado. Contratação é manual, não há cobrança por cartão nem comprovante automático. Os contadores comerciais não implementam um bloqueio global de módulos ou quotas de IA. TOTP não possui recuperação automática/códigos de reserva nesta versão. Esses limites estão detalhados em [DEPLOY.md](DEPLOY.md). Ao encerrar a rodada de 15/10, as alterações ainda não haviam sido publicadas.

## Atualização: colaboração, configuração e primeiros passos — 16/10/2026

O primeiro acesso agora apresenta três caminhos: começar um projeto, participar de uma equipe ou conhecer o fluxo. O guia permanece acessível no cabeçalho e sugere uma ação conforme os dados atuais: objetivo, arquitetura, requisitos revisados, verificação e entregas. Organização de equipe e documentos são opcionais; o guia não bloqueia a navegação. Foram exercitadas jornadas de iniciante, criação apenas pelo nome, retorno a um projeto existente, preferência persistente, navegação anterior real, teclado, celular e tema claro.

**Testar ideias** tornou-se uma página de sessões de equipe/setor, com exemplos de início, comentários e propostas de configuração. Antes da interpretação externa, a prévia e a autorização identificam a hipótese, a revisão, o projeto, as fontes e as correções. A análise preserva o mapa; aplicar exige revisão independente, autorização atual e versões compatíveis. O fluxo no navegador percorreu duas contas, proposta de 3,3 V para 3,0 V, aprovação, aplicação, preservação da versão anterior e marcação de teste como **Revalidar**. Essa rodada usa resposta de interpretação controlada; avalia o fluxo, não a precisão do provedor.

| Verificação desta rodada | Evidência local e resultado |
| --- | --- |
| Suítes finais | `norte-release-quality.log`: 165 testes de interface e 393 de servidor aprovados, sem falhas. `python-release-tests.log`: 112 casos, 110 aprovados e dois dependentes de Postgres ignorados nesta rodada. A suíte JavaScript raiz manteve 517 aprovados em `root-js-final.log`. Lint, TypeScript e build passaram; permanece o aviso de pacote acima de 500 kB, cerca de 244 kB comprimido. |
| Onboarding | `.runtime/validation/journey-browser.json`: primeiro acesso, persistência com conflito de versão, projeto pelo nome, próximo passo, ideias, voltar, celular e temas. Sem chamadas externas. |
| Gestão de configuração | `.runtime/validation/ideas-lifecycle-browser.json`: duas contas, revisão independente e aplicação com histórico e revalidação. Testes de servidor cobrem mudança concorrente e revogação de acesso. |
| Memória e documentos | `visual-memory-workspace-v2.mjs`: leitor em modal, caminho da pasta, anterior/próximo, PDF real, continuidade do cabeçalho, organização e jornadas iniciante/sênior. Presença de múltiplas abas, conflito de versão e revisão de pendências possuem testes de servidor. |
| Reunião e áudio | `visual-meetings.mjs`: dois navegadores, áudio RTP real nos dois sentidos, microfone próprio, silenciamento pelo anfitrião, transcrição, participantes e convite. O reconhecimento de fala foi controlado no teste; o transporte de áudio foi real. |
| Conversas | `visual-chat.mjs`: mensagens entre duas contas, canais de setor, revogação de acesso, 122 mensagens paginadas, imagem com anotação, administração com MFA, ajuda separada, widget móvel/ocultável e celular. |
| Entregas e administração | `visual-delivery.mjs` e `visual-platform-flow.mjs`: revisão de requisitos, evidências, cronograma com revisões, normas opcionais, PDF, contratação manual, consentimento de métricas, exclusão e barreiras administrativas. |
| Docker de produção | `.runtime/validation/docker-release-final.json`: imagem `7f431ddd2e93`, Postgres 17 real e navegador com TLS. Bootstrap pelo formulário, códigos inválidos/reutilizados rejeitados, cookie Secure/HttpOnly/Strict, ponte Python assinada, isolamento e corpus de 87 objetos/17 documentos. Após recriar o contêiner sem o código inicial, contas, sessões, registro Python e mapa persistiram; novo cadastro continuou funcionando. Zero erros de navegador e nenhuma chamada a provedores. Infraestrutura temporária removida; nenhum segredo ou banco de produção usado. |
| Provisionamento | `scripts/provision_quetzal_demo.py`: fontes públicas fixas, limite de tamanho, validação de hashes e ausência de sobrescrita. Os textos e páginas foram conferidos com Poppler de Ubuntu e Debian. Falta de corpus retorna 503 legível sem criar uma conta parcial. |

A revisão de publicação também corrigiu três condições concorrentes: requisitos alterados entre a análise e a proposta, documentos alterados antes de revisar/incorporar e encerramento do processo antes de concluir o checkpoint da leitura. O encerramento agora aguarda as gravações pendentes e impede novas chamadas ao provedor. Os testes usam bloqueios controlados para reproduzir essas condições, sem atrasos artificiais para esconder a corrida.

O primeiro administrador em produção exige um código privado de bootstrap; o consumo é atômico, não grava o segredo no banco e não reabre a configuração se o dono for desativado. Nove testes cobrem código ausente/incorreto, reutilização, concorrência e persistência. A auditoria npm apontou seis dependências vulneráveis; atualizações compatíveis, incluindo Fastify 5.12.7, eliminaram os achados conhecidos no relatório final `.runtime/release-npm-audit-final.json` (**zero vulnerabilidades reportadas**). Isso não equivale a uma auditoria externa de segurança.

O teste Docker revelou uma diferença de encapsulamento do Fastify com arquivos estáticos: o tratamento de erros registrado depois das rotas deixava a API usar o formato padrão. O handler agora é registrado antes dos plugins. Regressões cobrem os dois modos e confirmam que falhas internas não devolvem caminhos ou detalhes privados ao cliente, mantendo a mensagem de provisionamento permitida.

### Quetzal preservado e organizado

A demonstração local existente recebeu cinco setores, oito pessoas incluindo o visitante, pastas por subsistema/componente, duas reuniões fictícias de aproximadamente 25 minutos e entregas de exemplo. Os perfis **EXEMPLO** não têm senhas, sessões nem convites. As reuniões contêm assuntos retomados, falas extensas e decisões; são fixtures, não gravações de uma missão real. As datas do planejamento também são fictícias.

Perfis fictícios demonstram a organização e os responsáveis, mas não podem ser selecionados como revisores efetivos nem produzir aprovações. A interface explica a necessidade de uma segunda conta real para revisão independente; não simula aprovação em nome de outra pessoa.

A alteração foi aplicada com o serviço parado, backup privado e guarda dos hashes de 17 fontes e do mapa. Os **87 objetos técnicos**, relações, evidências e requisitos existentes foram preservados. Os **55 artefatos** da instalação conservaram os conteúdos, e os outros cinco projetos permaneceram iguais. A persistência foi conferida após reiniciar. Evidências: `.runtime/validation/quetzal-workspace-continuity/applied.json` e `persisted.json`. A conta permanente de 84 objetos não foi substituída.

Novas demonstrações recebem uma cópia pública sanitizada do mapa de 87 elementos, com referências remapeadas para a própria conta. A cópia não inclui histórico, correções ou dados privados de usuários. A auditoria localizou 220 citações factuais e uma inferência explícita; as pendências continuam visíveis. A atribuição comprovada do endereço I²C 0x99 foi corrigida nessa cópia nova. No mapa existente, ela permanece uma ação de revisão, preservando o trabalho do usuário. Não houve nova extração paga de todos os 116 trechos nesta rodada.

### Chamada real autorizada

Após autorização explícita, uma hipótese de potência foi analisada em uma cópia isolada do projeto público. A prévia continha 87 entidades, 54 relações, 221 evidências e 17 documentos. O Gemini `gemini-3.8-flash` retornou o alvo e o parâmetro esperado, de 3,15 W para 3,0 W, em aproximadamente 10,1 s no fluxo completo. Foram uma chamada, 24.932 tokens de entrada, 186 de saída e 754 de raciocínio reportados. O mapa não foi alterado; as 325 referências retornadas pertenciam ao contexto autorizado. Evidência: `.runtime/validation/idea-real-provider-smoke.json`.

Essa chamada herdou `GEMINI_MODEL` no processo de teste; o launcher de produção configura separadamente `GEMINI_DISCOVERY_MODEL`. Ela **não comprova impacto físico nem desempenho geral**. A investigação também corrigiu uma seleção lexical que fazia `operating_power` incluir componentes com “Power” no nome e provocar fallback desnecessário. Dez regressões offline preservaram as guardas de ambiguidade, quantidade e negação; não houve chamada paga adicional. Detalhes em [roteamento de ideias](norte/docs/idea-analysis-routing.md).

### Limites de publicação

O destino confirmado é `Raiagues/piloto`, branch `main`. O serviço público ainda respondia como Python legado na verificação anterior à publicação. A nova versão requer Docker da raiz e Postgres; um push não transforma o runtime do serviço existente. TURN externo precisa ser configurado e validado entre redes distintas para áudio confiável; a chamada tem limite de 12 participantes. O tutorial aceita vídeo HTTPS configurado pelo responsável, mas a gravação pessoal solicitada ainda precisa ser fornecida pelo usuário. Consulte [DEPLOY.md](DEPLOY.md).

O guia de dúvidas é uma ajuda de navegação, não um atendente humano ou um LLM. Capturas e desenhos são enviados ao canal escolhido; somente feedback explicitamente marcado entra como exemplo de interpretação. Melhorias de custo e precisão não são garantidas: cache, roteamento, uso e correções são observáveis, mas não há treinamento automático dos pesos. As evidências normativas são específicas das fontes cadastradas; o sistema não conhece automaticamente toda legislação aplicável a qualquer projeto.


## Navegação visual e edição direta — 16/10/2026

Esta rodada mantém o cabeçalho e a navegação do Norte, compacta as áreas de trabalho e move os avisos de orientação para controles expansíveis. Os caminhos de equipe e projeto são clicáveis. A concepção oferece blocos, diagrama, pastas, lista e interfaces; a lista de conhecimento abre o objeto correspondente com destaque.

A árvore principal da memória agora inclui os arquivos. O leitor mantém a pasta do arquivo ativo e oferece edição, movimentação e exclusão conforme as permissões. Foram exercitados edição e exclusão no leitor, mudança de pasta, navegação entre arquivos, presença, conflito de edição e preservação da hierarquia.

As evidências de engenharia abrem o PDF autorizado no mesmo diálogo. O leitor usa PDF.js carregado sob demanda, localiza citações por correspondência textual normalizada e marca sua posição na página. Permite alternar entre evidências e páginas. Texto ausente, PDF sem texto pesquisável e formatos não suportados não recebem um destaque inventado. O teste usa um PDF real de duas páginas com CSP de produção, incluindo uma citação divergente que deve permanecer sem marcação.

Testar ideias passou a usar canvas e abas por hipótese. Elementos, relações e posições são editáveis em uma cópia persistente; propostas conservam revisão independente, histórico, controle de versão e invalidação de aprovações após edição. As fontes acrescentadas pelo usuário não são promovidas a comprovação documental. O cronograma reúne Gantt editável, painel de fases, base normativa sob revisão e árvore de documentos por revisão, com cobertura derivada dos registros atuais.

Validação desta rodada:

- `ux2-quality.log`: 168 testes de interface e 400 de servidor aprovados, TypeScript, ESLint e compilação de produção concluídos. Ajustes posteriores tiveram verificações focais e novo build.
- `ux2-root-final.log`: 522 testes JavaScript aprovados. `ux2-server-final.log`: repetição final dos 400 testes de servidor aprovada após os resumos dos exemplos.
- `ux2-python-final.log`: 112 testes executados, 110 aprovados e dois casos dependentes de Postgres ignorados nesta rodada. A divergência inicial de versão dos assets foi corrigida antes desta execução final.
- `ux2-audit.log`: nenhuma vulnerabilidade conhecida encontrada pelo npm audit. `ux2-secrets-root.log`: varredura de segredos do repositório aprovada.
- Navegador: memória, documentos, evidências em PDF, arquitetura, ideias e entregas em contas isoladas. O teste `project-navigation-browser.json` reproduz gravação atrasada e falha de gravação ao clicar no breadcrumb, comprovando preservação do rascunho e retorno à página anterior. Ideias e propostas normativas foram revisadas com duas contas diferentes. A análise de ideias utilizou transporte simulado; não houve chamadas pagas nesta rodada.
- Reuniões: PDF real do exemplo, cópia privada editável, revisão humana, recarga, áudio WebRTC local nos dois sentidos e mute. A operação entre redes externas continua dependente da infraestrutura TURN configurada no serviço.

As evidências detalhadas e capturas ficam em `.runtime/validation/` e nos logs locais citados; dados privados e arquivos de ambiente não integram o commit. O build ainda informa um pacote principal acima de 500 kB. O leitor PDF e seu worker ficam em arquivos separados.

## Recuperação de projetos e acesso a ideias — 16/10/2026

O incidente no Render apresentou projetos ausentes na interface e a entrada de ideias desativada. O evento de falha do servidor registrou timeout de cinco segundos na verificação de saúde; os logs mostraram consultas de equipe e projetos aguardando a mesma fila de recarga integral do estado. Não houve indicação de exclusão de projetos nessa falha.

A verificação de saúde agora consulta a conexão PostgreSQL sem entrar na fila dos documentos. As demais consultas verificam a revisão do estado e só transferem o JSON quando ele muda. O marcador de data também detecta gravações de instâncias antigas durante a publicação. Leituras de autenticação, equipes e projetos clonam apenas o resultado necessário. A migração acrescenta uma coluna, preservando os dados existentes.

A interface distingue falha de carregamento de uma lista vazia, permite tentar novamente e mantém a entrada de ideias disponível para selecionar ou recuperar o projeto. O carregamento de equipes e pessoas não condiciona o acesso aos projetos. Respostas de acesso negado descartam os dados em cache correspondentes; resumos públicos não reutilizam listas privadas. Atualizar a lista não substitui um documento aberto nem o rascunho de uma ideia.

Validações específicas em ambiente isolado:

- Seis regressões passaram com PostgreSQL 17 real: migração de tabela anterior, consultas simultâneas, gravação concorrente e rollback, atualização por outra instância, revogação após um SELECT em andamento e saúde independente da fila. O contêiner descartável foi removido.
- Sessenta e quatro regressões de servidor, autenticação, demonstração, equipes e organização passaram antes da verificação integrada.
- O teste de navegação preservou edições durante gravação atrasada, falha de gravação e nova tentativa. Evidência: `.runtime/project-recovery-navigation.log`.
- A verificação integrada passou com 171 testes de interface e 406 de servidor, além de TypeScript, ESLint e build. O lint inicial apontou seis problemas no novo script de teste; foram corrigidos antes da execução final de ESLint. Logs: `.runtime/project-recovery-quality.log`, `project-recovery-lint.log` e `project-recovery-build-final.log`. Permanece o aviso de tamanho do pacote principal.
- O navegador reproduziu HTTP 502 e 403, recuperação dos cartões, seleção de projeto em ideias, separação de cache público/privado e preservação do rascunho. Com a resposta de equipes retida, editar e salvar o projeto funcionou; com a resposta de pessoas retida, os cartões apareceram. Evidência: `.runtime/validation/project-loading-browser.json`.

Esta rodada não configura áudio, não altera plano do Render, não abre o banco para acesso externo e não executa chamadas de IA.
