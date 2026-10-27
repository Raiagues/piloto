# Qualidade

## Suites

- `npm --prefix norte run typecheck` e `lint`: contratos TypeScript e problemas estáticos.
- `npm --prefix norte test`: componentes/regras em Vitest e contratos API em Node.
- `python3 -m unittest discover -s tests -p 'test_*.py'`: validação de entradas, transporte, correções, memória editorial e fronteira assinada.
- `node --test tests/*.test.cjs`: segmentação, relações, blocos, ata e persistência da sala.
- `npm --prefix norte run test:visual`: navegador real, instalação temporária, conta comum, tema, rotas e permissões.
- `npm --prefix norte run test:visual:collaboration`: mensagens com imagens, documentos, filtros e cronograma em desktop/mobile.
- `npm --prefix norte run test:visual:meetings`: sala, participação, transcrição, atas e persistência usando provedor simulado.
- `node norte/scripts/visual-meeting-observability.mjs`: mapa administrativo preenchido, memórias, MFA e autorização por reunião, em desktop/mobile.
- `node tests/browser-meeting-room.cjs`, `browser-meeting-minutes.cjs` e `browser-gemini-minutes.cjs`: sala, ata, PDF e idioma da interface num Chrome real, com provedor simulado.

Os testes usam diretórios temporários e mocks declarados. Não removem os dados do usuário e não fazem chamadas pagas por padrão. O PostgreSQL é exercitado pelo adaptador de testes; os casos que exigem servidor PostgreSQL real informam o skip quando não há uma instância descartável configurada.

## Integração contínua

O workflow `.github/workflows/ci.yml` executa varredura de segredos, auditoria de dependências, tipos, lint, testes Node/Vitest, build e suítes Python/JavaScript da reunião. Os testes visuais com navegador são comandos separados e não fazem parte desse workflow. A validação de uma mudança visual deve registrar também o resultado do smoke correspondente.

## O que verificar por mudança

Alterações visuais precisam de primeiro carregamento e viewport móvel, incluindo navegação por teclado. Mudanças de permissões precisam de conta sem acesso, convite/aceite, revogação e sessão expirada. Operações versionadas precisam de duas versões concorrentes e rollback. Migrações precisam preservar uma cópia completa e manter ACL.

Para IA, verifique entrada enviada, fonte citada, identificação do trecho, rejeição de conteúdo inventado, limite de orçamento e estado obsoleto ao concluir. Testes de transporte não demonstram precisão. Uma avaliação de qualidade exige falas/requisitos rotulados por especialistas e um conjunto separado dos exemplos usados nas correções.

## Resultados locais

As evidências desta revisão ficam em `.runtime/validation`, `.runtime/stage2-interface-review` e `.runtime/collaboration-review`. São artefatos locais, não uma suite pública nem uma garantia para outro ambiente. A versão final deve passar novamente depois de qualquer alteração posterior em código, configuração ou dependências.

Na revisão de 24/10/2026 passaram 51 testes frontend, 211 de API, 439 de lógica da sala e 112 Python. Cinco casos que exigem PostgreSQL real ficaram sem execução. Typecheck, lint, build, auditoria npm e varredura de segredos passaram; a auditoria não reportou vulnerabilidades. O container foi compilado e iniciado localmente, com API, página e política de privacidade respondendo. Os smokes de navegador conferiram a conta LYLE, PDFs, colaboração, reuniões e o diagnóstico administrativo preenchido. A validação não incluiu publicação remota nem medição de acurácia dos provedores reais.

Na revisão de 26/10/2026 passaram 54 testes frontend, 226 de API (12 sem PostgreSQL real), 448 de lógica da sala e 124 Python (2 ignorados). Typecheck, lint, build, varredura de segredos e auditoria npm (sem vulnerabilidades) passaram, assim como os smokes visuais de workspace, documentos, colaboração, reuniões e diagnóstico administrativo, e os três testes de navegador da sala e das atas. Esses testes foram atualizados para o fluxo atual: títulos provisórios, tokens atuais, ata como página, filtro e tipo numa só etapa do diagnóstico, pergunta única de assunto e comando perguntado só quando a fala cita o Norte. A avaliação com provedores reais está em `docs/meeting-memory.md`; ela registra contagens e custos, não precisão.
