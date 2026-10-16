# Equipes, convites, organização e ambiente de teste

## Estrutura aproveitada e correções

O estado existente já relacionava várias entradas de `workspace.projects` à mesma equipe por `document.context.teamId`. Setores, cargos, participantes e pastas continuam em `context`, com os mesmos IDs. O estado permanece em JSONB transacional no PostgreSQL ou arquivo JSON atômico no desenvolvimento. Não foi criado outro banco ou uma organização dependente de IA.

Antes desta mudança, `joinRequests` era uma lista de pedidos; as rotas de membros incluíam pessoas imediatamente, e o suposto convite apenas marcava um perfil como convidado. Não existiam envio SMTP, verificação de email ou caixa de convites com aceite. A lista de pessoas e o desenho da equipe também não representavam a hierarquia por projeto/setor.

A implementação foi dividida em identidade/convites, organização, Memória, estatísticas e dados de teste. Testes cobrem as regras no servidor e os fluxos reais no navegador.

## Identidade e convites

- Cada conta possui `nickname` público, único sem distinguir maiúsculas/minúsculas. Aceita 3–30 letras ASCII, números ou `_`, começando por letra. Os IDs internos não mudam. A migração gera nicknames a partir do nome, resolvendo colisões com sufixos; o perfil permite alterá-los e copiar o identificador.
- O capitão pesquisa o nickname completo, confere nome/instituição e envia um convite. A busca retorna somente informações públicas e tem limite de frequência.
- A campainha e a página **Convites** mostram os convites pendentes. Aceitar ou recusar exige conta autenticada e CSRF; abrir a página não concede acesso. O capitão pode cancelar convites pendentes.
- Convites são exclusivos por equipe/destinatário enquanto pendentes. A decisão, a inclusão em `memberIds` e o encerramento do convite são atômicos, inclusive entre instâncias PostgreSQL.
- Convites por email ficam vinculados ao endereço exato. O destinatário precisa entrar/criar a conta correspondente e verificar o email; convite e verificação são operações separadas. A pessoa pode aceitar pela caixa de convites após provar o endereço. Um link compartilhado não permite que outra conta aceite.
- Tokens aleatórios de 256 bits aparecem somente nas mensagens de email e no fragmento do link, que não é enviado em requisições de página. O servidor guarda SHA-256; a interface remove o fragmento sensível do histórico ao abrir a caixa. Nenhum token é impresso em logs ou retornado ao capitão.
- Convites duram 7 dias; verificação de email dura 30 minutos. Aceite, recusa e cancelamento invalidam o token. Links antigos de verificação deixam de funcionar após reenvio ou uso. A confirmação exige a conta que solicitou a mensagem.
- Falha SMTP é apresentada como falha, e o convite é invalidado. É possível tentar de novo. Não há fila de reenvio automático nem indicação falsa de entrega ao destinatário: `sent` significa aceitação pelo servidor SMTP.

As rotas POST `/teams/:id/join-requests`, `/teams/:id/members`, `/team/members` e `/team/members/:id/invitation` retornam **410 INVITATION_REQUIRED**. Os pedidos antigos continuam no estado; não aparecem na interface e não podem ser aprovados pela rota antiga. O modo estático de demonstração também fecha essas rotas e explica que convites reais exigem o servidor.

## Email: configuração necessária

Não havia serviço de email no repositório. Foi incluído SMTP com [Nodemailer](https://nodemailer.com/smtp), usando TLS e sem debug de mensagens. Não há contratação, provedor obrigatório ou serviço pago adicionado.

Configure no ambiente do servidor:

```dotenv
NORTE_PUBLIC_URL=https://seu-dominio/norte/
SMTP_HOST=seu-servidor-smtp
SMTP_PORT=587
SMTP_FROM=Norte <remetente@seu-dominio>
SMTP_USER=usuario-smtp
SMTP_PASSWORD=segredo-do-servidor
```

Porta 465 usa TLS desde a conexão; 587 exige STARTTLS. Em produção, a URL pública precisa ser HTTPS. Segredos ficam somente no servidor. Não use variáveis `VITE_` para eles. Antes de convidar por email, o remetente verifica o próprio endereço em **Convites**.

Sem essa configuração, convites por nickname continuam funcionando; envio por email e verificação apresentam **EMAIL_UNAVAILABLE**. Os testes usam uma caixa em memória, sem enviar a pessoas reais. Entrega real ao provedor SMTP precisa ser validada no ambiente onde essas credenciais forem configuradas.

## Três hierarquias distintas

| Estrutura | Fonte principal | Significado |
| --- | --- | --- |
| Equipe | `team.captainMemberId`, `memberIds`, projetos com `teamId` | Organização principal, capitão e projetos |
| Projeto | `context.sectors`, `roles`, `assignments`, `sectorRoles` | Responsável, setores, gerentes e participantes |
| Produto | `engineeringSystem.entities` e relações técnicas | Sistemas, subsistemas e componentes |

O identificador histórico de cargo `captain` dentro do projeto foi preservado, mas é apresentado como **Responsável pelo projeto**. Ele não implica ser capitão da equipe. A migração identifica o capitão da equipe pelo criador existente, quando possível; não escolhe o gerente de um projeto como capitão. O capitão pode transferir essa responsabilidade para outro membro ativo em **Editar equipe**. Administrações explícitas legadas em `adminMemberIds` e o administrador global são respeitados.

`shared/organization-tree.mjs` produz a mesma árvore para lista, organograma, configuração e exportação SVG de cada projeto. Ramificações podem ser recolhidas. Um membro aparece em vários setores quando possui vínculos explícitos; não é criada outra pessoa. Pastas e objetos técnicos não entram nessa árvore de pessoas. Gerências não configuradas aparecem como tal, sem uma atribuição inventada.

**Equipe do projeto** abre em **Setores**. Permite renomear, ordenar e excluir setores vazios; a aba **Cargos e membros** seleciona pessoas já pertencentes à equipe principal e define o papel no projeto e em cada setor. Não pede nome/email nem cria usuários. Os setores são os mesmos da Memória e das regras de acesso.

Permissões não são copiadas para outro projeto. Ser responsável por um projeto não autoriza administrar a equipe inteira. Membros da equipe podem ler seus projetos; editar exige a responsabilidade ou concessão daquele projeto/setor. O criador continua responsável pelo projeto conforme a regra existente, enquanto pertencer à equipe. Gerentes de setor delegam leitura/edição apenas no próprio setor e não promovem responsáveis, outros gerentes ou a si mesmos.

Projetos podem publicar **nome e tipo** no perfil público da equipe pela opção na Memória. O padrão é privado. Documentos, pessoas e estrutura interna nunca entram nesse resumo. A comunidade atual é acessível a contas autenticadas; não foi criado um portal anônimo separado.

## Memória e permissões

**Expandir navegação** abre uma área de documentos com a árvore real de setores/pastas à esquerda, usando as linhas, controles e cores do explorador da Concepção. Pastas são recolhíveis; documentos podem ser trocados na árvore ou lista da pasta, mantendo o caminho visível. PDFs aparecem no leitor do navegador, imagens e texto têm prévia, e os demais formatos abrem/baixam o original. Em telas menores a árvore fica acima do leitor e pode rolar.

**Pode editar** e **Somente leitura** indicam a decisão do backend. Leitura não fica desabilitada; o leitor explica que edição é restrita aos participantes autorizados do setor. Não há botões de editar, excluir ou mover o original quando faltam permissões. Documentos sem acesso não são listados; tentar seus IDs diretamente também é recusado. Concessões em múltiplos setores são consideradas.

**Documentos da equipe** e os caminhos para adicionar/selecionar novos documentos nessa biblioteca foram retirados da interface. Nenhum arquivo foi apagado ou transferido automaticamente. Referências já vinculadas continuam disponíveis para leitura na Memória. `team.artifactIds`, `artifact.scope=team`, `ownerId`, bytes e metadados continuam no banco. Administradores podem recuperá-los pelas rotas autenticadas existentes `GET /api/artifacts` e `GET /api/artifacts/:id/content`, ou pelo backup do estado. A exclusão de uma equipe com esses arquivos é recusada para evitar apagá-los indiretamente. Uma futura migração deverá escolher explicitamente o projeto de destino.

## Estatísticas com retenção limitada

Somente o capitão/administradores autorizados acessam `/teams/:id/insights`. A interface informa a todos os membros o que é registrado.

- Visitas ao perfil público: total desde a ativação e visitantes únicos dos últimos 30 dias, com gráfico diário e tabela acessível. Contabiliza contas autenticadas externas à equipe. Reaberturas pelo mesmo visitante em até 30 minutos contam como uma visita.
- Identificadores dos visitantes são pseudônimos HMAC específicos por equipe, retidos por até 30 dias. O endpoint não revela identificadores, IPs, emails ou nomes de visitantes. Não há fingerprinting nem cookies analíticos.
- Participação: último acesso, última atividade no projeto, dias ativos, acessos espaçados em 30 minutos, contagens de criação/edição de artefatos e alterações de organização, com resumo diário por projeto/pessoa.
- Sem histórico de leitura de documentos, movimentos, cliques ou estimativa de produtividade/horas. Presença recente continua usando o heartbeat existente com aba visível e interação recente.
- Contadores de projeto e pseudônimos de visitas são eliminados após a janela de 30 dias, em manutenção diária na primeira requisição da API. O total agregado de visitas permanece. Dias usam UTC. Estatísticas são indicativas de uso, não medidas de desempenho individual.

## Cópia local com três projetos

O exemplo local usa uma conta ativa já existente no arquivo de origem e pode ser preparado em **`var/team-preview-data.json`**, uma cópia separada marcada `team-preview-test`. Dados pessoais e arquivos dessa cópia não fazem parte do repositório. O arquivo de origem, os projetos originais e a conta original não foram modificados. A cópia mantém a senha existente da conta para login local.

Para abrir:

```bash
npm run dev:team-preview
```

Endereço padrão: `http://127.0.0.1:5291/norte/`. Entre com a conta existente e abra **Equipe Horizonte · TESTE**. Há três projetos (foguete, pesquisa atmosférica e estação solo), setores distintos, responsáveis por projeto, gerentes e membros em vários setores, seis contas fictícias e nove documentos. Cada pessoa fictícia tem email `@example.test`, nome com `TESTE` e `isTestAccount=true`. Nenhum convite é criado ou email enviado pelo seed.

O servidor de prévia usa somente a cópia JSON local e um cookie de sessão separado; ignora `.env` do servidor, desativa SMTP e Gemini e recusa Render, produção e `DATABASE_URL`. O teste visual acessa a API real com arquivos temporários, sem alterar essa cópia.

Para criar outra cópia a partir de um arquivo local explicitamente escolhido:

```bash
NODE_ENV=development NORTE_ALLOW_TEAM_PREVIEW=1 npm run seed:team-preview -- \
  --source var/mission-dev-data.json \
  --output var/outra-copia-teste.json \
  --email conta-existente@example.test
npm run dev:team-preview -- var/outra-copia-teste.json
```

O comando exige que a conta já exista e esteja ativa, não sobrescreve a origem/saída, não aceita banco remoto e não roda no startup. O arquivo recebe permissão `0600` e permanece ignorado pelo Git. Dentro da cópia, é possível testar login de uma pessoa fictícia com seu email indicado no estado e a senha local `norte fictitious local test account`. Essas credenciais são exclusivas da cópia protegida por essas guardas, nunca de uma conta real.

## Migração e validação

Schema do estado: **10**; documento de projeto: **2**, sem mudanças de IDs. A migração acrescenta nicknames, verificação, capitão explícito, convites e contadores. Não remove solicitações nem arquivos. Perfis antigos sem conta marcados `invited`, que antes já apareciam como membros, ficam preservados em `legacyInvitedMemberIds`; só uma conta verificada pode reivindicar esse perfil, e entrar na equipe ainda exige aceite. Atribuições históricas ficam guardadas; acesso a projeto de equipe exige a associação atual à equipe.

Testes:

- `npm run quality`: tipos, lint, Vitest, integração Node e build.
- `node --test --test-isolation=none server/team-collaboration.test.mjs`: identidade, concorrência JSON/PostgreSQL via pg-mem, aceite/recusa/cancelamento/expiração, verificação, permissões, agregados, migração e seed.
- `npm run test:visual:teams`: duas contas no Chrome, convite/aceite, três projetos, configuração por setores, SVG, permissões e leitor em desktop/celular.
- `npm run test:visual:organization`: criação, pastas, documento, download PDF, recarga e movimentação.

Não foi realizada implantação no Render, envio real de emails ou chamada paga ao Gemini. A migração segue o armazenamento existente; mantenha o procedimento normal de backup antes de publicar.
