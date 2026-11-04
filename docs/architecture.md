# Arquitetura e dados

## Responsabilidades

O frontend React usa rotas por hash e importa páginas sob demanda. As áreas de projeto são `#/project` (visão geral e documentos), `#/requirements` e `#/schedule`; `#/documents` e `#/verification` redirecionam para a visão geral. `useProjectWorkspace` carrega os projetos autorizados, conserva a seleção e cancela pedidos obsoletos. O armazenamento do servidor é a fonte de verdade; o navegador não conserva uma cópia completa do projeto para reenviá-la automaticamente.

`norte/server/app.mjs` configura Fastify, sessão, CSRF, origens, armazenamento e os contratos centrais de conta/equipe/projeto. Os serviços de entrega, reuniões, mensagens, convites e administração são módulos próprios. As regras de autorização são compartilhadas com as operações de cada domínio; elas não dependem de esconder botões.

| Módulo | Dados e operações |
| --- | --- |
| `project-delivery.mjs` | Requisitos, propostas, revisões, planos de verificação e execuções preservados, cronograma, documentos, sugestões de revisores, modelos preenchidos, histórico e o modo somente leitura da versão de teste |
| `delivery-documents.mjs`, `document-latex.mjs` | Rascunho a partir do modelo (seções, orientação e dados existentes), PDF e ZIP LaTeX para pdfLaTeX |
| `engineering-assistant.mjs` | Execuções explícitas, etapas de progresso, fontes oficiais, resultados propostos e checagem de versão/acesso antes da conclusão |
| `requirement-analysis.mjs` | Revisão de um requisito a pedido da pessoa, com os trechos apontados validados contra o enunciado |
| `llm-config.mjs`, `llm-transport.mjs`, `ai-keys.mjs` | Provedor e modelos em uso, formato HTTP de cada provedor e leitura das chaves |
| `conversation-service.mjs` | Participantes e blocos ordenados de texto/imagem |
| `team-invitations.mjs`, `project-organization.mjs` | Aceite de convite, membros, gestores, setores e permissões |
| `meeting-service.mjs`, `meeting-gateway.mjs` | Reuniões, convites, notas pessoais, ponte assinada e sala dedicada |
| `meeting-observability.mjs` | Projeção das entradas/respostas e memórias acessíveis à administradora |
| `platform-security.mjs`, `platform-telemetry.mjs` | TOTP, sessões de métricas consentidas, retenção e estatísticas |
| `privacy.mjs` | Identificação e provedores públicos da instalação, sem expor segredos |

## Persistência e concorrência

Localmente, contas e projetos ficam em `.runtime/norte-data.json`; o motor de reunião usa `.runtime/norte.sqlite3`. O store JSON serializa escritas, grava arquivo temporário privado e publica por rename somente depois de concluir a operação. Falhas não substituem o estado válido.

Com `DATABASE_URL`, o Node usa uma linha de estado versionada no PostgreSQL e o Python usa suas tabelas de registros. A atualização Node é transacional. A leitura verifica a revisão entre processos para que remoções de membros e sessões tenham efeito imediato. O codec comprimido preserva formatos anteriores; consulte [formato do estado](postgres-state-format.md).

Esse armazenamento facilita a operação de uma instalação pequena. A linha de estado é um limite real de escala: bibliotecas grandes e muitas escritas simultâneas ainda transferem/serializam bastante conteúdo. A próxima migração, quando as medições justificarem, deve separar documentos/binários e agregados transacionais. Não há afirmação de capacidade ilimitada nem de alta disponibilidade com filas apenas em memória.

Revisões, documentos, tarefas e registros de reunião usam a versão esperada. Aprovações são ligadas ao conteúdo e às fontes atuais. Revogação de acesso, alteração de requisito ou mudança no plano invalida o resultado aplicável sem apagar a decisão histórica.

## Versão de teste somente leitura

`NORTE_DELIVERY_READ_ONLY=1` (ou `buildApp({ deliveryReadOnly: true })`) mantém requisitos, cronograma, documentos e modelos visíveis (inclusive PDF e ZIP LaTeX) e retira deles toda permissão de edição: a resposta de entrega traz `permissions.readOnly`, nenhuma linha fica editável e as rotas de ações, análise e execuções do assistente respondem 423 `DELIVERY_READ_ONLY` antes de abrir uma transação. Reuniões, equipes, convites e configuração do projeto não são afetados. O preparo do caso LYLE exige o modo desligado enquanto grava.

## Pacotes de documentos e revisão

`norte/shared/document-templates.mjs` é o catálogo usado pelo servidor e pelo navegador. Para cada documento guarda código, título, a DRD ou o apêndice de origem, a maturidade por revisão e as seções com uma orientação resumida (paráfrase, não o texto da norma) e o tipo de preenchimento. ECSS segue a Tabela A-1 da ECSS-E-ST-10C Rev.1 e as DRDs chamadas por ela (ECSS-E-ST-10-06, -02, -24, -03, ECSS-M-ST-10, ECSS-U-AS-10); NASA segue o NPR 7123.1D 5.2.2.2 e o Apêndice G, com estruturas dos apêndices do NASA/SP-2016-6105 Rev2. Para a TRR ECSS, que a Tabela A-1 não detalha, o pacote é uma seleção da Norte (plano AIT, especificação e procedimento de ensaio), marcada assim. O pacote é uma proposta: o contrato e o tailoring aprovado definem o que se aplica.

`draftDeliveryDocument` monta o rascunho a partir dessas seções e dos registros que a pessoa já vê na entrega (requisitos, verificações, fases, revisões, setores, objetos técnicos e relações). Valores numéricos só aparecem quando copiados literalmente de um requisito; o restante fica como PENDENTE. `GET /api/projects/:id/delivery/templates/:taskId/:templateId` devolve o modelo preenchido sem gravar nada (`?format=md|pdf|latex` exporta), inclusive na versão somente leitura. Criar o rascunho é uma escrita comum (`document.save`).

Sugestões de revisores (`document.suggest`) exigem revisor atribuído à versão atual, diferente do autor, e um trecho citado que aparece exatamente uma vez. `document.resolve_suggestion` aplica (substitui o trecho, cria nova versão, zera pareceres e o hash de revisão) ou descarta; a versão esperada é conferida e um trecho alterado depois da sugestão é recusado com 409. O exemplo de revisão da interface (`src/lib/documentReviewExample.ts`) é determinístico, usa perfis fictícios rotulados e só altera o rascunho local; perfis fictícios continuam fora de membros, revisores e aprovações.

## Prompts e provedores

Tudo o que vai a um modelo fica em `prompts/`. Os textos dos modelos de linguagem estão em `prompts/llm/` e as perguntas do JEV em `prompts/jev/questions.js`. O código só lê esses arquivos. No Python a leitura é `llm.prompt`, no Node é `prompt` em `llm-config.mjs`, e a sala recebe as perguntas pelo asset `jev-questions.js`.

`meetings/engine/llm.py` e `norte/server/llm-transport.mjs` conhecem o formato HTTP de cada provedor e nada mais. Os fluxos escolhem modelo e prompt, e as verificações de cada fluxo ficam nele, sem depender do provedor. `NORTE_LLM_PROVIDER` escolhe OpenAI (padrão) ou o adaptador Google. O diagnóstico (`scripts/check_apis.py`), o registro de uso das reuniões (`ai_runtime.py`, com provedor e modelo de cada chamada) e a política de privacidade (`privacy.mjs`) mostram o provedor em uso. As análises de engenharia somam tokens em `engineering-metrics.mjs`.

## Engenharia assistida

Abrir páginas e filtrar requisitos não inicia IA. O botão de análise cria uma execução com etapas persistidas. O servidor consulta somente referências oficiais do catálogo selecionado, registra disponibilidade e valida os resultados propostos. O catálogo não pretende descobrir toda norma possível na internet.

O resultado distingue análise ainda não realizada, apontamentos, revisão regulatória e ausência de alertas dentro do escopo consultado. Trechos destacados precisam existir literalmente no requisito. Links de fonte incluem a localização quando disponível; uma sugestão de aplicabilidade exige confirmação humana.

Sugestões de verificação indicam método, critério e vínculo ao requisito. Não inventam um resultado de ensaio. Documentos gerados são rascunhos; exportação e prévia usam o mesmo conteúdo salvo. Fonte, versão e revisão independente permanecem rastreáveis.

## Aparência

`tokens.css` é a fonte das cores, tipografia, raios (`--norte-radius`, `--norte-radius-panel` e `--norte-radius-pill`, todos 0: superfícies retangulares que se separam pelo tom do fundo), altura do cabeçalho e sombras de elementos flutuantes. O tema claro usa fundo bege; o escuro, azul-marinho. O tema claro é aplicado antes de montar a interface. A sala recebe o tema do documento pai antes de pintar e usa os mesmos tokens. Folhas por funcionalidade acompanham o carregamento sob demanda; não há uma sequência de temas globais antigos sobrescrevendo a página.

Scripts, estilos e fontes da sala são arquivos públicos de uma lista fechada em `/meeting-assets/`; usam ETag por conteúdo e revalidação HTTP, sem consultar o banco a cada arquivo. O HTML com os dados de entrada da sala permanece autenticado e sem cache, assim como suas APIs continuam sujeitas às permissões da reunião.

Na sala integrada, a barra da reunião pertence à página do Norte. A sala informa o estado dos próprios controles (`norte:meeting-controls`: rótulo e bloqueio da gravação, cronômetro, encerrar/interromper, ata) e recebe ações (`norte:meeting-command`), que acionam os mesmos botões internos e suas regras; a linha de cabeçalho interna fica oculta. O anfitrião pode continuar uma reunião concluída por texto, arquivo ou microfone: a sessão retoma o registro salvo (`continued_at` marca o novo período) e grava o estado em andamento antes de aceitar contribuições. `meeting-i18n.js` troca as cadeias exatas da interface quando o Norte está em inglês e as restaura em português; falas, blocos, títulos e textos digitados nunca são traduzidos. Na ata, só os controles e o painel de revisão mudam de idioma: o documento segue o idioma da reunião, igual ao PDF exportado.

A sala pré-carrega seus módulos em paralelo, mantendo a ordem de execução. A consulta ao serviço de processamento habilita a gravação, mas não bloqueia a leitura dos registros salvos. Reabrir uma reunião como anfitrião ou participante aceito não repete a escrita de entrada; o HTML e cada API continuam verificando o acesso atual.

Enquanto a reunião acontece, canvas e ata são apenas leitura. A trava fica na interface da sala, porque o registro em andamento é um documento escrito pelo navegador do anfitrião. As notas pessoais ficam no store do Node, separadas por pessoa, e não entram no registro nem em pedidos a modelos. Depois de encerrar, a sala oferece a correção do canvas, a ata e a análise de alertas (`meeting-highlights.js`), que só roda por clique.

Durante a reunião, a sala envia cada trecho ao JEV pela ponte (eventos, assuntos e relações) e o motor Python agenda as notas do modelo editorial por assunto, encadeando o assunto seguinte sem depender da sala; o fluxo está em [processamento das reuniões](meeting-memory.md). Abrir uma reunião salva ou sua ata não grava registros nem agenda revisão editorial. O PDF exporta o documento visível, mantendo a conferência das pendências; somente a ação de resumir solicita IA para a ata. Correções humanas e a geração solicitada continuam sendo salvas.

O cronômetro de uma transcrição importada usa apenas a duração informada nos metadados. Se ela for desconhecida, o cronômetro fica oculto; o tempo de processamento não representa a duração da reunião.

## Privacidade e autoridade

Senhas usam Argon2id; cookies de sessão são HttpOnly. Escritas exigem CSRF e origem válida. O bootstrap administrativo de produção exige segredo privado, e métricas globais exigem TOTP. Ser administrador não ignora a autorização de uma equipe, reunião ou conversa.

O diagnóstico não mostra raciocínio interno do modelo: ele apresenta a entrada enviada, as perguntas, as respostas estruturadas, a latência e as correções registradas. Métricas opcionais usam uma lista fechada de ações, sem conteúdo de mensagens ou documentos. A coleta começa desativada; retirar consentimento interrompe envios e solicita apagar os eventos correspondentes. A retenção é verificada na inicialização, em operações de métricas e periodicamente.

## Histórico preservado

A retirada de uma tela não autoriza apagar dados existentes. Campos históricos de arquitetura permanecem apenas quando necessários para ler fontes e requisitos antigos. Não há novos jobs de extração ou memória de projeto.

`archive-legacy-meetings.mjs` converte formatos de reunião aposentados em arquivo de consulta. O padrão é dry-run. Aplicação exige serviços parados, conferência dos bancos de origem e backup privado. O arquivo preserva os payloads, além da apresentação legível; continua sujeito à autorização da reunião.

## O que foi retirado

Memória de projeto, concepção, laboratório de ideias, planos comerciais, comunidade, painel de atividade da equipe, simulador de vigas, tela de verificação e as janelas antigas de memória e relações saíram do produto. Os dados gravados continuam no armazenamento e o normalizador os preserva. Os backups das fontes retiradas ficam em `.runtime/validation/` e `.runtime/backups/retired-inputs/`, fora do Git. O ambiente Quetzal foi retirado a pedido da pessoa dona dos dados, por `scripts/retire_legacy_workspace.py`, com plano verificável e backup. Antes de recriar qualquer item desta lista, confira o `AGENTS.md`.

## Documentos e navegação

A seleção de projeto, revisão, documento, requisito, subsistema e ata fica na URL. *Abertos recentemente* mantém até oito atalhos por conta na sessão, com tipo derivado do próprio link (reunião, ata, requisito, documento, arquivo de origem, pacote de revisão, atividade), projeto, horário de abertura, situação e aviso de rascunho local. Uma página com nível interno aberto registra `claimBack` para que o Voltar do cabeçalho feche esse nível antes de navegar. O editor guarda rascunhos por conta/projeto/documento/versão; uma versão remota nova exige recarregar antes de salvar. A prévia é local e não inicia IA. A exportação LaTeX escapa o conteúdo como texto, inclui o Markdown original e metadados de versão no ZIP. O envio ao Overleaf é uma cópia por POST explícito, sem URL pública do documento.

`workspaceIndex.ts` carrega sob demanda o estado de entrega do projeto ativo e a lista de reuniões e os compartilha entre barra lateral, busca e Início; `useProjectDelivery` publica ali cada leitura ou escrita concluída, e a perda de acesso descarta a cópia. `sidebarTree.ts` deriva a árvore (revisões com documentos, reuniões por pasta e mês), `searchIndex.ts` e `workspaceSearch.ts` montam e consultam o índice local da busca, `homeOverview.ts` calcula o painel do Início e `ganttLayout.ts` posiciona faixas, empilhamento e régua do Gantt. Esses módulos não gravam dados nem chamam IA.

A limpeza autorizada de exemplos antigos usa `scripts/retire_legacy_workspace.py`: plano verificável, serviços parados, backups privados e checagem de integridade. Não é executada na inicialização. Os únicos cenários novos vêm dos originais em `novo_teste`, com resultados separados de entradas e gabaritos.

Em PostgreSQL, `norte/scripts/retire-workspace.mjs --config /caminho/privado/operacao.json` usa os modos `inventory`, `plan` e `apply`. A configuração contém `id`, `keepProject` e `removeProjectIds`; aplicar exige `expectedFingerprint` do plano atual. Contas reais, projetos não selecionados, permissões preservadas e reuniões independentes permanecem intactos. As identidades do worker são selecionadas pelo vínculo exato com reuniões removidas.

O estado original e as linhas do worker ficam em `norte_retirement_backups`, sem endpoint público. Backup, remoção e revisão do estado pertencem à mesma transação; qualquer falha desfaz tudo. O identificador de operação impede reaplicação. Em hospedagem sem shell, o operador pode fornecer esse mesmo JSON em `NORTE_WORKSPACE_RETIREMENT` para uma execução explícita antes da API iniciar e limpar a variável depois. Sem essa configuração não há limpeza automática. Logs de manutenção contêm apenas IDs, contagens e hashes; os documentos e credenciais ficam no backup privado do banco.
