# Retirada das áreas experimentais

Memória de projeto, Concepção, Testar ideias, planos comerciais e painel de atividade da equipe foram retirados para todas as contas. Dados históricos são preservados pelo normalizador; navegação não regrava snapshots de projeto.

Os scripts abaixo dependiam de rotas retiradas, importavam módulos excluídos ou preparavam demonstrações aposentadas. O instalador continua criando somente a estrutura de armazenamento, sem seed automático. Nenhum banco ou conteúdo de `.runtime`, `novo_teste` e `project-documents` foi apagado. O seed atual `seed-workspace-review.mjs` e `examples/lyle-review` foram preservados.

## Scripts retirados

- `scripts/acceptance-discovery.mjs`
- `scripts/acceptance-quetzal-memory.mjs`
- `scripts/apply-architecture-cleanup.mjs`
- `scripts/apply-local-reviewed-map.mjs`
- `scripts/attach-benchmark-context.mjs`
- `scripts/benchmark-lyle.mjs`
- `scripts/benchmark-manifest.mjs`
- `scripts/benchmark-quetzal.mjs`
- `scripts/benchmark-structural.mjs`
- `scripts/build-lyle-synthetic-pdf.mjs`
- `scripts/build-public-quetzal-model.mjs`
- `scripts/dev-team-preview.mjs`
- `scripts/diagnose-extraction.mjs`
- `scripts/diagnose-project-memory.mjs`
- `scripts/extract-quetzal.mjs`
- `scripts/live-corpus-extraction.mjs`
- `scripts/live-integrated-check.mjs`
- `scripts/live-memory-check.mjs`
- `scripts/offline-acceptance.mjs`
- `scripts/prepare-existing-quetzal-demo.mjs`
- `scripts/prepare-local-test-account.mjs`
- `scripts/probe-quetzal-contamination.mjs`
- `scripts/propose-quetzal-architecture-cleanup.mjs`
- `scripts/quetzal-evaluator.mjs`
- `scripts/reset-validation-data.mjs`
- `scripts/seed-lyle.mjs`
- `scripts/seed-quetzal-validation.mjs`
- `scripts/seed-quetzal-workspace.mjs`
- `scripts/seed-team-preview.mjs`
- `scripts/summarize-extraction.mjs`
- `scripts/visual-artifact-upload.mjs`
- `scripts/visual-check.mjs`
- `scripts/visual-engineering-architecture.mjs`
- `scripts/visual-evidence-document.mjs`
- `scripts/visual-extraction-background.mjs`
- `scripts/visual-idea-lifecycle.mjs`
- `scripts/visual-integrated-live.mjs`
- `scripts/visual-live-extraction.mjs`
- `scripts/visual-lyle.mjs`
- `scripts/visual-map-regeneration.mjs`
- `scripts/visual-memory-cards.mjs`
- `scripts/visual-memory-workspace-v2.mjs`
- `scripts/visual-onboarding-ideas.mjs`
- `scripts/visual-organization.mjs`
- `scripts/visual-persistent-account.mjs`
- `scripts/visual-persistent-demo.mjs`
- `scripts/visual-project-loading.mjs`
- `scripts/visual-project-navigation.mjs`
- `scripts/visual-project-workspace.mjs`
- `scripts/visual-quetzal.mjs`
- `scripts/visual-schedule-workspace.mjs`
- `scripts/seed-meeting-examples.mjs`
- `scripts/meeting-example-summaries.mjs`
- `scripts/visual-meeting-review.mjs`
- `scripts/visual-team-collaboration.mjs`
- `scripts/visual-chat.mjs` — substituído pelo fluxo atual de administração e mensagens em `visual-collaboration-refresh.mjs`.
- `scripts/visual-platform-flow.mjs` — exercitava propostas comerciais e contratação retiradas; permissões, MFA e telemetria continuam cobertas por testes da plataforma.
- `scripts/visual-project-delivery.mjs` — seletores e fluxos antigos substituídos por `visual-collaboration-refresh.mjs` e testes atuais de revisão/entregas.

## Documentação de funcionalidades retiradas

- `docs/DISCOVERY_AI_RELIABILITY.md`
- `docs/EXTRACTION_EXPERIMENT_PLAN.md`
- `docs/EXTRACTION_RELIABILITY_AUDIT.md`
- `docs/QUETZAL1_ADDITIONAL_SUBSYSTEMS.md`
- `docs/QUETZAL_VALIDATION_SOURCES.md`
- `docs/SYSTEM_WORKSPACE_INTERACTIONS.md`
- `docs/UI_POLISH_2026-08.md`
- `docs/VALIDATED.md`
- `docs/VALIDATION_QUETZAL1.md`
- `docs/idea-analysis-routing.md`

Pesquisas `UX_RESEARCH.md` e `PRODUCT_RESEARCH_ENGINEERING_REASONING.md` preservam as referências. Suas descrições de concepção e mapas são históricas. `WORKSPACE_UX.md` preserva fontes de organização e descreve os fluxos atuais. O smoke `npm run test:visual` valida rotas, contas reais, perfil, política pública, tema e navegação sem gravar snapshots de projeto. `test:visual:collaboration` cobre documentos, chat e áreas de engenharia; não exige dados de demonstração pré-carregados.

## Ativos sem consumidores retirados

- `examples/aurora-cansat-arduino/aurora-cansat-arduino.ino`
- `examples/aurora-cansat-arduino/platformio.ini`
- `examples/quetzal1/architecture-sources/ADM-hardware.txt`
- `examples/quetzal1/architecture-sources/licenses/GPL-3.0.txt`
- `examples/quetzal1/architecture-sources/licenses/CC-BY-SA-4.0.txt`
- `examples/quetzal1/architecture-sources/ADCS-hardware.txt`
- `examples/quetzal1/architecture-sources/MISSION-overview.txt`
- `examples/quetzal1/architecture-sources/manifest.json`
- `examples/quetzal1/architecture-sources/ADCS-software.txt`
- `examples/quetzal1/source-manifest.mjs`
- `examples/quetzal1/architecture-extraction/norte-extra-ADCS-hardware.json`
- `examples/quetzal1/architecture-extraction/norte-extra-ADCS-software.json`
- `examples/quetzal1/architecture-extraction/norte-extra-MISSION-overview.json`
- `examples/quetzal1/architecture-extraction/norte-extra-ADM-hardware.json`
- `public/meeting-mocks/geral-25min.txt`
- `public/meeting-mocks/setor-25min.txt`
- `public/artifacts/licoes-aprendidas-missao-aurora.csv`
- `public/profiles/emily-raiane.png`
- `public/artifacts/relatorio-final-missao-aurora.md`
- `public/artifacts/arduino/aurora-cansat-arduino.ino`
- `public/brand/obsat-logo.png`
- `public/satellites/sat-3.jpg.b64.txt`
- `public/satellites/sat-4.jpg.b64.txt`
- `public/satellites/sat-1.jpg.b64.txt`
- `public/satellites/sat-5.jpg.b64.txt`
- `public/satellites/sat-2.jpg.b64.txt`
- `public/satellites/sat-2.webp`
- `public/satellites/sat-1.webp`
- `public/satellites/source-note.txt`
- `public/satellites/sat-3.webp`
- `public/satellites/approved/sat-1-03.txt`
- `public/satellites/approved/sat-1-01.txt`
- `public/satellites/approved/sat-1-05.txt`
- `public/satellites/approved/sat-1-02.txt`
- `public/satellites/approved/sat-1-04.txt`

## Módulos sem consumidores de produção

A auditoria das importações a partir de `src/main.tsx` e `server/index.mjs` removeu:

- `src/lib/projectLearning.ts` e o evento/endpoint de correção do projeto no chat, cujo destino já havia sido retirado. O feedback de reuniões permanece no módulo de reuniões.
- Os pares `.mjs`/`.d.mts` de `discovery-limits`, `engineering-architecture`, `engineering-schema`, `impact-engine`, `project-knowledge`, `project-memory` e `workspace-templates`.
- Testes exclusivos do motor de impacto e dos templates aposentados. Os testes de autorização de pastas e referências continuam cobrindo as mesmas fronteiras com fixtures explícitas.

`src/lib/engineeringSystem.ts` conserva os tipos dos snapshots históricos usados por `projectStore`, documentos e hierarquia técnica; seus helpers de interface sem consumidores foram retirados. O leitor de documentos, o parser XLSX e o transporte Gemini mantêm comportamento e códigos de erro. Seus textos agora descrevem a análise de engenharia.

O cliente JEV Node usado somente pela extração foi retirado após conferência de consumidores. A reunião mantém seu transporte pela ponte assinada e os testes de gateway.

## Interface antiga na raiz do repositório

A sala ativa está em `meetings/web`. O servidor Python e o gateway Node servem os arquivos dessa pasta; `login.html`, `auth.css` e `auth.js` continuam na raiz para autenticação. A retirada abaixo preservou originais do usuário, históricos, armazenamento e módulos de processamento das reuniões.

Foram retiradas 24 fontes sem consumidores no aplicativo atual, com backup privado em `.runtime/validation/retired-root-ui-and-unit-tests.tar.gz`:

- Conta e observatório antigos: `account.css`, `account.js`, `ai-client.js`, `ai-observatory.css`, `ai-observatory.js`.
- Laboratório e shell antigos: `app.js`, `automation.js`, `classifier.js`, `index.html`, `lab.js`, `reuniao.html`, `styles.css`, `workspace.js`.
- Simulador de vigas: `beam-commands.js`, `beam-engine.js`, `beam-workspace.css`, `beam-workspace.js`, `meeting-beam.css`, `meeting-beam.js`.
- Janelas antigas de memória e relações: `memory-flow.css`, `memory-page.js`, `relation-map.css`, `relation-map.js`, `typed-relations-page.js`.

O mesmo backup guarda seis testes unitários exclusivos desses módulos — `tests/ai-client.test.cjs`, `tests/automation.test.cjs`, `tests/beam-commands.test.cjs`, `tests/beam-engine.test.cjs`, `tests/beam-natural-navigation.test.cjs`, `tests/replay-beam-intent.test.cjs` — e `scripts/replay-beam-intent.cjs`.

Foram retirados também 24 harness de navegador e cinco scripts de chamadas reais exclusivos dessas telas. A lista exata está em `.runtime/validation/retired-browser-harness.json`, com backup em `.runtime/validation/retired-browser-harness.tar.gz`:

- Laboratório: `browser-automation.cjs`, `browser-cache.cjs`, `browser-editor.cjs`, `browser-free-state.cjs`, `browser-navigation.cjs`, `browser-official.cjs`, `browser-smoke.cjs`.
- Simulador: `browser-beam-meeting.cjs`, `browser-beam-speech.cjs`, `browser-beam-spoken-edits.cjs`, `browser-beam-suggestions.cjs`, `browser-beam-workspace.cjs`, `browser-deployed-smoke.cjs`.
- Janelas de memória e relações: `browser-memory-burst.cjs`, `browser-memory-layout.cjs`, `browser-memory-storage.cjs`, `browser-memory-v2.cjs`, `browser-memory.cjs`, `browser-relation-map.cjs`, `browser-relations.cjs`, `browser-threads.cjs`, `browser-typed-relations.cjs`.
- Conta e observatório: `browser-accounts.cjs`, `browser-ai-observatory.cjs`.
- Chamadas reais do simulador: `live-beam-commands.cjs`, `live-beam-natural.cjs`, `live-beam-session.cjs`, `live-beam-spoken-edits.cjs`, `live-natural-acceptance.cjs`.

Todos os nomes do grupo acima estavam em `tests/`. Esses harness carregavam fontes ou elementos das telas retiradas, não a entrada atual da sala.

### Cobertura preservada

`tests/browser-meeting-room.cjs` agora serve `meetings/web` e valida histórico intacto, criação sem inferência, importação, classificação progressiva, fontes, zoom, transcrição, cancelamento, fala final, persistência, reabertura, atas e edição que preserva o original. Somente a navegação para laboratório, modo manual e janela V2 foi retirada. O teste passou após a migração.

`tests/browser-meeting-minutes.cjs` e `tests/browser-gemini-minutes.cjs` passaram com os assets atuais, tema claro, revisão e exportação efetiva de PDFs, incluindo Unicode, fontes e links. O provedor é simulado nesses testes. O primeiro conferiu 62 links em 11 páginas nos formatos retrato e paisagem.

`tests/live-meeting-simulation.cjs` conserva a transcrição longa, fatos indivisíveis, separação de assuntos, fala final, persistência e reabertura. Foram retiradas apenas as expectativas de comandos e estado físico do simulador. Exige URL explícita de um worker isolado e `--run-live`; nesta revisão foram validados sintaxe e bloqueio sem opt-in, sem chamadas pagas. `tests/live-meeting-thickness.cjs` permanece como avaliação de processamento.

Os testes de processamento `meeting*`, `memory*`, relações, threads e armazenamento permanecem; o conjunto preservado executado passou em 306 testes. `tests/test_workbook.py` mantém as duas regressões locais contra o workbook original do usuário, com fonte e gabaritos em `.runtime/backups/retired-inputs/`. Sem esses arquivos privados, o teste é ignorado explicitamente. Os testes públicos de transporte usam um estado sintético independente, preservando as perguntas de contrato JEV.

## Retirada explícita do ambiente Quetzal

Na revisão seguinte, o usuário pediu retirar também o projeto de satélite, suas fontes e os ambientes de teste duplicados, mantendo o projeto LYLE selecionado. Foram retirados 72 arquivos de `project-documents/quetzal-1`, `norte/benchmark/quetzal1`, `norte/benchmark/structural`, `norte/data/quetzal-public-model-v1.json`, `scripts/download_project_docs.py`, `scripts/provision_quetzal_demo.py` e `tests/test_provision_quetzal_demo.py`. A auditoria não encontrou consumidores no produto ativo. O backup privado está em `.runtime/backups/retired-quetzal-sources-20261024-195107.tar.gz`. Os originais em `novo_teste` e os testes de processamento de reuniões permanecem.

`scripts/retire_legacy_workspace.py` realiza a migração dos dados locais separadamente. O modo padrão e `--check` leem somente estrutura e conteúdo para calcular um plano e seu fingerprint, sem gravar. O relatório contém IDs e contagens; não inclui credenciais, documentos ou transcrições. `--apply` exige o fingerprint revisado e o supervisor parado. A migração prepara cópias privadas dos três armazenamentos, verifica integridade SQLite e idempotência antes de publicar; uma falha na publicação restaura as cópias anteriores.

O projeto e a equipe selecionados, as contas reais, credenciais e permissões permanecem intactos. Não se concede participação automaticamente à administração. Somente contas com marca explícita de demonstração, seus membros e os escopos aposentados são retirados. O SQLite mantém contas nativas e reuniões independentes; identidades da ponte sem reunião retida e seus registros são removidos. O banco de evidências legado mantém seu esquema e fontes globais não associadas aos projetos retirados.

Os cinco testes em `tests/test_retire_legacy_workspace.py` cobrem ausência de escrita em `--check`, preservação de contas/ACL/fontes compartilhadas, backup privado, fingerprint divergente, supervisor ativo e recuperação após falha de publicação.

Na instalação local, a aplicação revisada retirou sete projetos, seis equipes, onze contas de demonstração, 55 artefatos e onze reuniões vinculadas aos ambientes aposentados. Permaneceram quatro contas reais, a equipe do projeto `lyle-review-1afd66d1` e seus dois documentos. Os quatro usuários nativos e os sete registros independentes do SQLite foram preservados. O backup da aplicação está em `.runtime/backups/workspace-retirement-ttu4qye5`; a conferência posterior não encontrou novas remoções a aplicar. Nenhuma migração foi executada em ambiente remoto.

## Publicação sem fontes privadas

O repositório público e o contexto Docker excluem originais de `novo_teste`, JSONs derivados, cenários, gabaritos e resultados. Somente READMEs e scripts específicos sem conteúdo do usuário entram na lista de exceções. O corpus de avaliação sintético também permanece local. O PDF LYLE antigo da raiz, o workbook original, seus gabaritos e `TEST_AUDIT.md` foram preservados em `.runtime/backups/retired-inputs/`, com acesso privado; a auditoria corrente de testes está em `docs/testing.md`.

Os smokes de workspace e documentos agora criam dados genéricos em armazenamento temporário, sem ler os documentos privados. Ambos passaram, assim como os 22 testes direcionados de transporte, validação e workbook. As sete capturas finais de equipes ficam em `novo_teste/resultados/interface/equipes`, fora da publicação.

A auditoria final arquivou também `B002.json`, `MEMORY_RELATIONS_LIMITATIONS.md`, `RELATIONS_VALIDATION.md` e os 22 arquivos de `exemplos-testes/` em `.runtime/backups/retired-inputs/`. São cenários, gabaritos e relatórios das telas aposentadas, sem consumidores no produto. Os fixtures usados pelos testes ativos de processamento permanecem no código de teste. Os nomes aposentados estão excluídos do Git e do contexto Docker para evitar sua reinclusão acidental.
