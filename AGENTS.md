# Manutenção do Norte

Leia README.md e docs/architecture.md antes de alterar fluxos entre serviços. Use o estado atual dos arquivos como fonte; não restaure módulos aposentados a partir de documentação antiga.

## Escopo

O produto ativo contém contas, equipes, contatos, mensagens, requisitos, verificação, cronograma, documentos, reuniões e administração. Não reintroduza planos comerciais, comunidade, memória de projeto, concepção, ideias ou laboratório de simulação sem solicitação explícita.

A instalação começa vazia. Fixtures ficam nos testes; seeds são comandos explícitos. Não invente pessoas, evidências, execuções ou aprovações. Preserve os documentos originais do usuário e os registros existentes durante migrações.

## Organização

- React e TypeScript: `norte/src`; páginas sob demanda, componentes por funcionalidade, estado remoto nos hooks de `lib`.
- Estilos: tokens em `norte/src/styles/tokens.css`; regras base de baixa especificidade; estilos locais em `features` ou no módulo existente. A sala usa os mesmos tokens. Não crie outra camada global de sobrescritas.
- API: `norte/server/app.mjs` compõe serviços e contratos de conta/equipe/projeto. Funcionalidades próprias ficam nos módulos de domínio existentes.
- Reuniões: navegador em `meetings/web`; Python em `meetings/engine`; `server.py` mantém a entrada do worker. O Node autoriza a ponte.
- Comente apenas decisões importantes, de modo curto. Prefira funções diretas a abstrações sem consumidor real.

## Contratos que precisam permanecer

- Autorização e revisão são verificadas no servidor, novamente antes de concluir operações assíncronas. Administração não dá acesso automático a projetos, conversas ou reuniões privados.
- Escritas usam a versão esperada e uma transação do store. Preserve conflito entre abas, rollback e revogação de acesso.
- Requisito, método, critério, fonte e resultado são conceitos separados. Mudanças relevantes invalidam evidências/aprovações antigas.
- Análises de engenharia rodam só após ação explícita. O progresso mostra etapas e fontes consultadas, sem simular pesquisa ou revelar raciocínio privado do modelo.
- JEV classifica trechos; o modelo editorial produz tópicos. Preserve fala original, IDs e correções humanas. Exemplos de uma reunião não podem vazar para outra.
- Métricas são opt-in, com ações em allowlist. Nunca registre conteúdo de formulários, documentos ou mensagens na telemetria.
- Segredos e dados locais ficam fora do Git. Não imprima `.env`, cookies ou arquivos de credenciais. Nunca transforme um erro de provedor em sucesso fictício.

## Validação

Execute os testes do domínio alterado, typecheck e lint. Após mudanças entre serviços, execute as suites API/Python/JavaScript e um smoke integrado. Use `npm --prefix norte run test:visual` para navegação, permissões e tema. Verifique a primeira pintura quando alterar CSS ou a sala.

Use Node 24.20+. A cópia local fica em `.runtime/tools/node-v24.20.0-linux-x64/bin`. Testes padrão não devem usar chaves reais nem fazer chamadas pagas. Testes de migração usam cópias temporárias e verificam backup, integridade e ACL antes da aplicação em dados existentes.

Atualize README/arquitetura quando mudar comandos, pastas, configuração, persistência ou provedores. Não marque precisão do modelo como validada por testes de transporte ou fixtures.
