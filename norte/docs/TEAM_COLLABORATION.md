# Equipes e convites

Revisão de 24/10/2026. Equipes agrupam contas existentes e projetos. Uma instalação nova começa vazia; não há colegas fictícios ou projetos de demonstração automáticos. Comunidade e painel de atividade da equipe foram retirados.

## Identidade e convites

- Cada conta possui `nickname` público, único sem distinguir maiúsculas/minúsculas. Aceita 3–30 letras ASCII, números ou `_`, começando por letra. Os IDs internos não mudam. A migração gera nicknames a partir do nome, resolvendo colisões com sufixos; o perfil permite alterá-los e copiar o identificador.
- O gestor pesquisa o nickname completo, confere a identidade pública e envia um convite. A busca retorna somente informações públicas e tem limite de frequência.
- A campainha e a página **Convites** mostram os convites pendentes. Aceitar ou recusar exige conta autenticada e CSRF; abrir a página não concede acesso. O capitão pode cancelar convites pendentes.
- Convites são exclusivos por equipe/destinatário enquanto pendentes. A decisão, a inclusão em `memberIds` e o encerramento do convite são atômicos, inclusive entre instâncias PostgreSQL.
- Convites por email ficam vinculados ao endereço exato. O destinatário precisa entrar/criar a conta correspondente e verificar o email; convite e verificação são operações separadas. A pessoa pode aceitar pela caixa de convites após provar o endereço. Um link compartilhado não permite que outra conta aceite.
- Tokens aleatórios de 256 bits aparecem somente nas mensagens de email e no fragmento do link, que não é enviado em requisições de página. O servidor guarda SHA-256; a interface remove o fragmento sensível do histórico ao abrir a caixa. Nenhum token é impresso em logs ou retornado ao capitão.
- Convites duram 7 dias; verificação de email dura 30 minutos. Aceite, recusa e cancelamento invalidam o token. Links antigos de verificação deixam de funcionar após reenvio ou uso. A confirmação exige a conta que solicitou a mensagem.
- Falha SMTP é apresentada como falha, e o convite é invalidado. É possível tentar de novo. Não há fila de reenvio automático nem indicação falsa de entrega ao destinatário: `sent` significa aceitação pelo servidor SMTP.

As rotas POST `/teams/:id/join-requests`, `/teams/:id/members`, `/team/members` e `/team/members/:id/invitation` retornam **410 INVITATION_REQUIRED**. Os pedidos antigos continuam no estado; não aparecem na interface e não podem ser aprovados pela rota antiga.

## Email: configuração necessária

O envio usa SMTP com [Nodemailer](https://nodemailer.com/smtp), usando TLS e sem debug de mensagens. Não há contratação, provedor obrigatório ou serviço pago adicionado.

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

## Associação, cargos e acesso

A equipe usa `captainMemberId` e `memberIds`; os projetos mantêm setores, cargos e atribuições em `context`. Participar da equipe não cria uma atribuição em todos os setores nem concede edição irrestrita. As decisões de acesso são verificadas no servidor e atualizadas após revogação de vínculos.

Cargo e função profissional ficam em `team.professionalProfiles`. Somente a liderança autorizada da equipe pode alterá-los. O perfil pessoal mostra esses vínculos para leitura. Texto de cargo não concede permissões: a política usa os papéis e concessões explícitas.

Contatos mostra nomes públicos, nickname e presença de contas ativas reais. A listagem não expõe emails, credenciais ou tokens. Perfis fictícios históricos continuam armazenados para compatibilidade, mas não aparecem como participantes ou revisores elegíveis.

Administração global exige MFA para controles administrativos. Ela não substitui o vínculo necessário para acessar conversas privadas ou reuniões. Métricas de uso dependem de consentimento separado; não há painel de desempenho individual da equipe.

## Persistência e validação

O estado existente permanece no armazenamento transacional. Migrações preservam IDs, arquivos e atribuições históricas; a conta continua precisando aceitar um convite válido para entrar na equipe. Consulte [organização e documentos](PROJECT_ORGANIZATION.md) e [segurança](security.md).

- `node --test server/team-collaboration.test.mjs server/collaboration-security.test.mjs server/workspace-access.test.mjs`: convites, identidade, concorrência, revogação, escopo e cargos profissionais.
- `npm run test:visual`: conta comum/admin, equipes reais, cargos, perfil, contatos, políticas e consentimento em banco temporário.
- `npm run test:visual:collaboration`: chat, documentos e áreas de engenharia em instalação isolada.

Os smokes não enviam emails nem acionam provedores de IA externos. Dados reais do usuário e o arquivo de origem LYLE não são apagados pela limpeza das demonstrações antigas.
