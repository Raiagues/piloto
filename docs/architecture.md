# Arquitetura e dados

## Responsabilidades

O frontend React usa rotas por hash e importa páginas sob demanda. As áreas de projeto são `#/project` (visão geral e documentos), `#/requirements` e `#/schedule`; `#/documents` e `#/verification` redirecionam para a visão geral. `useProjectWorkspace` carrega os projetos autorizados, conserva a seleção e cancela pedidos obsoletos. O armazenamento do servidor é a fonte de verdade; o navegador não conserva uma cópia completa do projeto para reenviá-la automaticamente.

`norte/server/app.mjs` configura Fastify, sessão, CSRF, origens, armazenamento e os contratos centrais de conta/equipe/projeto. Os serviços de entrega, reuniões, mensagens, convites e administração são módulos próprios. As regras de autorização são compartilhadas com as operações de cada domínio; elas não dependem de esconder botões.

| Módulo | Dados e operações |
| --- | --- |
| `project-delivery.mjs` | Requisitos, propostas, revisões, planos de verificação e execuções preservados, cronograma, documentos, histórico e o modo somente leitura da versão de teste |
| `engineering-assistant.mjs` | Execuções explícitas, etapas de progresso, fontes oficiais, resultados propostos e checagem de versão/acesso antes da conclusão |
| `conversation-service.mjs` | Participantes e blocos ordenados de texto/imagem |
| `team-invitations.mjs`, `project-organization.mjs` | Aceite de convite, membros, gestores, setores e permissões |
| `meeting-service.mjs`, `meeting-gateway.mjs` | Reuniões, convites, ponte assinada e sala dedicada |
| `meeting-observability.mjs` | Projeção das entradas/respostas e memórias acessíveis à administradora |
| `platform-security.mjs`, `platform-telemetry.mjs` | TOTP, sessões de métricas consentidas, retenção e estatísticas |
| `privacy.mjs` | Identificação e provedores públicos da instalação, sem expor segredos |

## Persistência e concorrência

Localmente, contas e projetos ficam em `.runtime/norte-data.json`; o motor de reunião usa `.runtime/norte.sqlite3`. O store JSON serializa escritas, grava arquivo temporário privado e publica por rename somente depois de concluir a operação. Falhas não substituem o estado válido.

Com `DATABASE_URL`, o Node usa uma linha de estado versionada no PostgreSQL e o Python usa suas tabelas de registros. A atualização Node é transacional. A leitura verifica a revisão entre processos para que remoções de membros e sessões tenham efeito imediato. O codec comprimido preserva formatos anteriores; consulte [formato do estado](../norte/docs/postgres-state-format.md).

Esse armazenamento facilita a operação de uma instalação pequena. A linha de estado é um limite real de escala: bibliotecas grandes e muitas escritas simultâneas ainda transferem/serializam bastante conteúdo. A próxima migração, quando as medições justificarem, deve separar documentos/binários e agregados transacionais. Não há afirmação de capacidade ilimitada nem de alta disponibilidade com filas apenas em memória.

Revisões, documentos, tarefas e registros de reunião usam a versão esperada. Aprovações são ligadas ao conteúdo e às fontes atuais. Revogação de acesso, alteração de requisito ou mudança no plano invalida o resultado aplicável sem apagar a decisão histórica.

## Versão de teste somente leitura

`NORTE_DELIVERY_READ_ONLY=1` (ou `buildApp({ deliveryReadOnly: true })`) mantém requisitos, cronograma e documentos visíveis e retira deles toda permissão de edição: a resposta de entrega traz `permissions.readOnly`, nenhuma linha fica editável e as rotas de ações, análise e execuções do assistente respondem 423 `DELIVERY_READ_ONLY` antes de abrir uma transação. Reuniões, equipes, convites e configuração do projeto não são afetados. O preparo do caso LYLE exige o modo desligado enquanto grava.

## Engenharia assistida

Abrir páginas e filtrar requisitos não inicia IA. O botão de análise cria uma execução com etapas persistidas. O servidor consulta somente referências oficiais do catálogo selecionado, registra disponibilidade e valida os resultados propostos. O catálogo não pretende descobrir toda norma possível na internet.

O resultado distingue análise ainda não realizada, apontamentos, revisão regulatória e ausência de alertas dentro do escopo consultado. Trechos destacados precisam existir literalmente no requisito. Links de fonte incluem a localização quando disponível; uma sugestão de aplicabilidade exige confirmação humana.

Sugestões de verificação indicam método, critério e vínculo ao requisito. Não inventam um resultado de ensaio. Documentos gerados são rascunhos; exportação e prévia usam o mesmo conteúdo salvo. Fonte, versão e revisão independente permanecem rastreáveis.

## Aparência

`tokens.css` é a fonte das cores, tipografia, raios (`--norte-radius` 6 px, `--norte-radius-panel` 10 px, `--norte-radius-pill`), altura do cabeçalho e sombras de elementos flutuantes. O tema claro é aplicado antes de montar a interface. A sala recebe o tema do documento pai antes de pintar e usa os mesmos tokens. Folhas por funcionalidade acompanham o carregamento sob demanda; não há uma sequência de temas globais antigos sobrescrevendo a página.

Scripts, estilos e fontes da sala são arquivos públicos de uma lista fechada em `/meeting-assets/`; usam ETag por conteúdo e revalidação HTTP, sem consultar o banco a cada arquivo. O HTML com os dados de entrada da sala permanece autenticado e sem cache, assim como suas APIs continuam sujeitas às permissões da reunião.

Na sala integrada, a barra da reunião pertence à página do Norte. A sala informa o estado dos próprios controles (`norte:meeting-controls`: rótulo e bloqueio da gravação, cronômetro, encerrar/interromper, ata) e recebe ações (`norte:meeting-command`), que acionam os mesmos botões internos e suas regras; a linha de cabeçalho interna fica oculta. O anfitrião pode continuar uma reunião concluída por texto, arquivo ou microfone: a sessão retoma o registro salvo (`continued_at` marca o novo período) e grava o estado em andamento antes de aceitar contribuições. `meeting-i18n.js` troca as cadeias exatas da interface quando o Norte está em inglês e as restaura em português; falas, blocos, títulos e textos digitados nunca são traduzidos. Na ata, só os controles e o painel de revisão mudam de idioma: o documento segue o idioma da reunião, igual ao PDF exportado.

A sala pré-carrega seus módulos em paralelo, mantendo a ordem de execução. A consulta ao serviço de processamento habilita a gravação, mas não bloqueia a leitura dos registros salvos. Reabrir uma reunião como anfitrião ou participante aceito não repete a escrita de entrada; o HTML e cada API continuam verificando o acesso atual.

Durante a reunião, a sala envia cada trecho ao JEV pela ponte (eventos, assuntos e relações) e o motor Python agenda as notas do modelo editorial por assunto, encadeando o assunto seguinte sem depender da sala; o fluxo está em [processamento das reuniões](meeting-memory.md). Abrir uma reunião salva ou sua ata não grava registros nem agenda revisão editorial. O PDF exporta o documento visível, mantendo a conferência das pendências; somente a ação de resumir solicita IA para a ata. Correções humanas e a geração solicitada continuam sendo salvas.

O cronômetro de uma transcrição importada usa apenas a duração informada nos metadados. Se ela for desconhecida, o cronômetro fica oculto; o tempo de processamento não representa a duração da reunião.

## Privacidade e autoridade

Senhas usam Argon2id; cookies de sessão são HttpOnly. Escritas exigem CSRF e origem válida. O bootstrap administrativo de produção exige segredo privado, e métricas globais exigem TOTP. Ser administrador não ignora a autorização de uma equipe, reunião ou conversa.

O diagnóstico não mostra raciocínio interno do modelo: ele apresenta a entrada enviada, as perguntas, as respostas estruturadas, a latência e as correções registradas. Métricas opcionais usam uma lista fechada de ações, sem conteúdo de mensagens ou documentos. A coleta começa desativada; retirar consentimento interrompe envios e solicita apagar os eventos correspondentes. A retenção é verificada na inicialização, em operações de métricas e periodicamente.

## Histórico preservado

A retirada de uma tela não autoriza apagar dados existentes. Campos históricos de arquitetura permanecem apenas quando necessários para ler fontes e requisitos antigos. Não há novos jobs de extração ou memória de projeto.

`archive-legacy-meetings.mjs` converte formatos de reunião aposentados em arquivo de consulta. O padrão é dry-run. Aplicação exige serviços parados, conferência dos bancos de origem e backup privado. O arquivo preserva os payloads, além da apresentação legível; continua sujeito à autorização da reunião.

## Documentos e navegação

A seleção de projeto, documento, requisito, subsistema e ata fica na URL. *Abertos recentemente* mantém até oito atalhos por conta na sessão, com tipo derivado do próprio link (reunião, ata, requisito, documento, arquivo de origem, pacote de revisão, atividade), projeto, horário de abertura, situação e aviso de rascunho local. Uma página com nível interno aberto registra `claimBack` para que o Voltar do cabeçalho feche esse nível antes de navegar. O editor guarda rascunhos por conta/projeto/documento/versão; uma versão remota nova exige recarregar antes de salvar. A prévia é local e não inicia IA. A exportação LaTeX escapa o conteúdo como texto, inclui o Markdown original e metadados de versão no ZIP. O envio ao Overleaf é uma cópia por POST explícito, sem URL pública do documento.

A limpeza autorizada de exemplos antigos usa `scripts/retire_legacy_workspace.py`: plano verificável, serviços parados, backups privados e checagem de integridade. Não é executada na inicialização. Os únicos cenários novos vêm dos originais em `novo_teste`, com resultados separados de entradas e gabaritos.

Em PostgreSQL, `norte/scripts/retire-workspace.mjs --config /caminho/privado/operacao.json` usa os modos `inventory`, `plan` e `apply`. A configuração contém `id`, `keepProject` e `removeProjectIds`; aplicar exige `expectedFingerprint` do plano atual. Contas reais, projetos não selecionados, permissões preservadas e reuniões independentes permanecem intactos. As identidades do worker são selecionadas pelo vínculo exato com reuniões removidas.

O estado original e as linhas do worker ficam em `norte_retirement_backups`, sem endpoint público. Backup, remoção e revisão do estado pertencem à mesma transação; qualquer falha desfaz tudo. O identificador de operação impede reaplicação. Em hospedagem sem shell, o operador pode fornecer esse mesmo JSON em `NORTE_WORKSPACE_RETIREMENT` para uma execução explícita antes da API iniciar e limpar a variável depois. Sem essa configuração não há limpeza automática. Logs de manutenção contêm apenas IDs, contagens e hashes; os documentos e credenciais ficam no backup privado do banco.
