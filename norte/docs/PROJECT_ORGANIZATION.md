# Organização e documentos

Revisão de 24/10/2026. O projeto oferece Requisitos, Verificação, Cronograma e Documentos. Memória, Concepção, Testar ideias, Comunidade e o painel de atividade da equipe foram retirados para todas as contas. Veja a [lista de retiradas](workspace-retirement.md).

## Estrutura atual

`MissionProject` preserva os identificadores e o contexto de equipe, setores, cargos e atribuições. Dados antigos de arquitetura permanecem disponíveis para compatibilidade e importação dos requisitos existentes; não são recriados na navegação. O frontend carrega páginas separadamente e não grava o documento inteiro ao trocar de tela.

Projetos novos começam sem requisitos, verificações ou cronograma. A pessoa informa o nome e pode escolher tipo/equipe; a criação é confirmada pela API antes de abrir o projeto. Documentos enviados, requisitos criados e sugestões aceitas são ações explícitas.

O estado continua transacional: JSONB no PostgreSQL ou arquivo JSON atômico no desenvolvimento. A aplicação verifica as permissões dentro das operações que modificam o estado; não depende de ocultar botões para impedir acesso indevido.

## Equipes e permissões

A associação atual à equipe e as concessões do projeto/setor definem leitura e edição. A liderança pode administrar o escopo permitido; gerentes de setor não podem promover a si mesmos ou assumir o controle de outra área. Remover uma associação revoga acesso aos recursos que dependem dela.

A autoria de uma edição passada não concede acesso permanente. Trocar `ownerId` ou `scope` de artefatos pela API é recusado. Configurações com revisão desatualizada são rejeitadas para evitar sobrescrever mudanças de outra pessoa. Convites e cargos profissionais estão documentados em [Equipes e convites](TEAM_COLLABORATION.md).

O papel administrativo da plataforma não dispensa o acesso à conversa ou reunião. Controles globais exigem MFA e retornam somente os campos previstos, sem hashes de senha ou tokens. O perfil pessoal não permite editar cargo/função definidos pela liderança.

## Biblioteca e documentos de revisão

Documentos organiza materiais em categorias como atas, matrizes, planos e cronogramas. Fontes enviadas e documentos produzidos para revisões continuam vinculados ao projeto e sujeitos às mesmas permissões. A visualização permite consultar conteúdo antes de baixar.

PDFs produzidos pelo servidor usam PDFKit. O original enviado mantém seus bytes; visualização e exportação não comprovam aprovação técnica. Documentos de revisão têm estado e versão, e rascunhos gerados por assistência precisam de revisão humana. A geração não acontece automaticamente ao abrir a página.

Arquivos e referências históricos continuam armazenados. A retirada da antiga biblioteca de Memória não apaga documentos nem redistribui seus setores. Limites e formatos aceitos seguem os contratos da API, e a prévia não significa que todos os formatos possam ser interpretados por IA.

Referências da biblioteca: [PDFKit — texto](https://pdfkit.org/docs/text.html), [tabelas](https://pdfkit.org/docs/table.html) e [imagens](https://pdfkit.org/docs/images.html).

## Verificação

- `npm run quality`: tipos, lint, testes e build.
- `node --test server/organization.test.mjs`: persistência, permissões, pastas, arquivos, migração e PDF.
- `npm run test:visual`: navegação, equipes, perfis, contas e consentimento.
- `npm run test:visual:collaboration`: requisitos, documentos, chat e edição do cronograma.

Os testes usam armazenamento temporário. A configuração de produção e os procedimentos de backup estão em [implantação](deployment.md) e [formato do PostgreSQL](postgres-state-format.md).
