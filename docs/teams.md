# Equipes, projetos e permissões

O modelo separa **nível de acesso**, **função na equipe** e **área técnica**. Assim, ser gerente de uma área não implica automaticamente ter controle administrativo sobre todas as contas.

## Funções na equipe

- Proprietário/admin: configura acessos e mantém a organização.
- Capitão: coordena missão, prioridades, integração e decisões de equipe.
- Gerente de área: responde por entregas e interfaces do subsistema atribuído.
- Membro: contribui nas áreas principal e secundárias.
- Orientador: revisa e aconselha, com acesso de leitura por padrão.

## Convites e identidade

- Cada conta possui `nickname` público, único sem distinguir maiúsculas/minúsculas. Aceita 3–30 letras ASCII, números ou `_`, começando por letra. Os IDs internos não mudam. A migração gera nicknames a partir do nome, resolvendo colisões com sufixos; o perfil permite alterá-los e copiar o identificador.
- O gestor pesquisa o nickname completo, confere a identidade pública e envia um convite. A busca retorna somente informações públicas e tem limite de frequência.
- A campainha e a página **Convites** mostram os convites pendentes. Aceitar ou recusar exige conta autenticada e CSRF; abrir a página não concede acesso. O capitão pode cancelar convites pendentes.
- Convites são exclusivos por equipe/destinatário enquanto pendentes. A decisão, a inclusão em `memberIds` e o encerramento do convite são atômicos, inclusive entre instâncias PostgreSQL.
- Convites por email ficam vinculados ao endereço exato. O destinatário precisa entrar/criar a conta correspondente e verificar o email; convite e verificação são operações separadas. A pessoa pode aceitar pela caixa de convites após provar o endereço. Um link compartilhado não permite que outra conta aceite.
- Tokens aleatórios de 256 bits aparecem somente nas mensagens de email e no fragmento do link, que não é enviado em requisições de página. O servidor guarda SHA-256; a interface remove o fragmento sensível do histórico ao abrir a caixa. Nenhum token é impresso em logs ou retornado ao capitão.
- Convites duram 7 dias; verificação de email dura 30 minutos. Aceite, recusa e cancelamento invalidam o token. Links antigos de verificação deixam de funcionar após reenvio ou uso. A confirmação exige a conta que solicitou a mensagem.
- Falha SMTP é apresentada como falha, e o convite é invalidado. É possível tentar de novo. Não há fila de reenvio automático nem indicação falsa de entrega ao destinatário: `sent` significa aceitação pelo servidor SMTP.

As rotas POST `/teams/:id/join-requests`, `/teams/:id/members`, `/team/members` e `/team/members/:id/invitation` retornam **410 INVITATION_REQUIRED**. Os pedidos antigos continuam no estado; não aparecem na interface e não podem ser aprovados pela rota antiga.

## E-mail

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

O estado existente permanece no armazenamento transacional. Migrações preservam IDs, arquivos e atribuições históricas; a conta continua precisando aceitar um convite válido para entrar na equipe.

## Permissões de projeto

A associação atual à equipe e as concessões do projeto/setor definem leitura e edição. A liderança pode administrar o escopo permitido; gerentes de setor não podem promover a si mesmos ou assumir o controle de outra área. Remover uma associação revoga acesso aos recursos que dependem dela.

A autoria de uma edição passada não concede acesso permanente. Trocar `ownerId` ou `scope` de artefatos pela API é recusado. Configurações com revisão desatualizada são rejeitadas para evitar sobrescrever mudanças de outra pessoa.

O papel administrativo da plataforma não dispensa o acesso à conversa ou reunião. Controles globais exigem MFA e retornam somente os campos previstos, sem hashes de senha ou tokens. O perfil pessoal não permite editar cargo/função definidos pela liderança.

## Estrutura do projeto

`MissionProject` preserva os identificadores e o contexto de equipe, setores, cargos e atribuições. Dados antigos de arquitetura permanecem disponíveis para compatibilidade e importação dos requisitos existentes; não são recriados na navegação. O frontend carrega páginas separadamente e não grava o documento inteiro ao trocar de tela.

Projetos novos começam sem requisitos, verificações ou cronograma. A pessoa informa o nome e pode escolher tipo/equipe; a criação é confirmada pela API antes de abrir o projeto. Documentos enviados, requisitos criados e sugestões aceitas são ações explícitas.

O estado continua transacional: JSONB no PostgreSQL ou arquivo JSON atômico no desenvolvimento. A aplicação verifica as permissões dentro das operações que modificam o estado; não depende de ocultar botões para impedir acesso indevido.

## Biblioteca e documentos de revisão

Documentos organiza materiais em categorias como atas, matrizes, planos e cronogramas. Fontes enviadas e documentos produzidos para revisões continuam vinculados ao projeto e sujeitos às mesmas permissões. A visualização permite consultar conteúdo antes de baixar.

PDFs produzidos pelo servidor usam PDFKit. O original enviado mantém seus bytes; visualização e exportação não comprovam aprovação técnica. Documentos de revisão têm estado e versão, e rascunhos gerados por assistência precisam de revisão humana. A geração não acontece automaticamente ao abrir a página.

Arquivos e referências históricos continuam armazenados. A retirada da antiga biblioteca de Memória não apaga documentos nem redistribui seus setores. Limites e formatos aceitos seguem os contratos da API, e a prévia não significa que todos os formatos possam ser interpretados por IA.

Referências da biblioteca: [PDFKit — texto](https://pdfkit.org/docs/text.html), [tabelas](https://pdfkit.org/docs/table.html) e [imagens](https://pdfkit.org/docs/images.html).

## Dados de perfil

O perfil pessoal permite manter nome, login, nickname, email e foto. Curso, período, instituição acadêmica e horas disponíveis foram retirados. Vínculos de equipe/empresa mostram cargo e função para leitura; somente a liderança autorizada da equipe pode alterá-los. Texto de cargo não concede acesso administrativo.

## Decisões de interface

- Um cabeçalho em `App` mantém idioma, convites e perfil na mesma posição em todas as páginas autenticadas. O perfil não é montado novamente em cada página ou na lateral.
- O projeto oferece visão geral com documentos, requisitos, cronograma e reuniões.
- Equipes mostram contas existentes e seus projetos. Cargo e função são gerenciados por quem tem autorização na equipe e aparecem somente para leitura no perfil pessoal.
- Contatos permite buscar e carregar mais resultados; respostas antigas não substituem uma busca mais recente.
- Navegação não grava snapshots inteiros do projeto. Cada ação confirma sua própria alteração e mantém as verificações de acesso no servidor.
- O perfil reúne identidade e vínculos profissionais. Não coleta campos acadêmicos ou horas disponíveis.

A [pesquisa do Nielsen Norman Group sobre formulários](https://www.nngroup.com/articles/4-principles-reduce-cognitive-load/) orientou o agrupamento e os campos condicionais. As [diretrizes de tooltips](https://www.nngroup.com/articles/tooltip-guidelines/) fundamentam explicações curtas, opcionais, acessíveis por foco e toque; rótulos e erros necessários continuam visíveis. O [padrão de diálogo da W3C](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) orienta foco contido, Escape e retorno ao acionador nos novos popups.

## Áreas e organização pesquisadas

Sistemas e integração; missão e carga útil; gestão do projeto; estruturas e térmica; potência; OBC e aviónica; software de voo; comunicações e segmento solo; ADCS/GNC; integração e testes; operações e análise orbital; segurança e regulação; finanças/compras/patrocínio; comunicação e documentação. São referências de pesquisa, não setores criados automaticamente no produto.

Os agrupamentos são uma síntese para equipes pequenas, não uma estrutura oficial obrigatória. Gestão/patrocínios e integração/testes foram agrupados para evitar dezenas de departamentos.

| Modalidade | Agrupamentos pesquisados | Fontes primárias |
| --- | --- | --- |
| Satélites / OBSAT prática | Estruturas; eletrônica e energia; software embarcado; comunicação; carga útil; testes e integração; gestão e patrocínios | [OBSAT: construção, programação e testes](https://wiki.obsat.org.br/books/modalidade-pratica/page/fase-2-construa-programe-teste-seu-satelite) |
| Foguetes | Aerodinâmica e estruturas; propulsão; aviônica; recuperação; carga útil; operações e testes; gestão | [NASA Student Launch](https://www.nasa.gov/learning-resources/nasa-student-launch/), [NASA: recuperação](https://www.nasa.gov/wp-content/uploads/2023/09/nasa-sl-2024-arw-recovery-systems-508.pdf), [equipe estudantil da Michigan](https://news.engin.umich.edu/2025/06/student-designed-engine-for-future-two-story-rocket-passes-final-engineering-milestone/) |
| AeroDesign | Aerodinâmica; estruturas; desempenho e estabilidade; propulsão; elétrica e controle; fabricação e testes; gestão | [Equipe da Tarleton](https://www.tarleton.edu/sae/competition/), [SAE Brasil: Regular, Advanced e Micro](https://legado.saebrasil.org.br/programas-estudantis/aero-design-sae-brasil/) |
| Fórmula SAE | Chassi; suspensão e direção; powertrain; elétrica e eletrônica; aerodinâmica; freios e ergonomia; gestão | [Colorado School of Mines: subsistemas](https://orgs.mines.edu/fsae/subsystems/), [SAE Brasil: classes Combustão e Elétrica](https://saebrasil.org.br/visao-geral/usp-sao-carlos-e-fei-sao-campeas-da-competicao-formula-sae-brasil-2026/) |
| Baja | Chassi e segurança; suspensão e direção; powertrain; freios; elétrica e instrumentação; fabricação e testes; gestão | [Nebraska Racing: subsistemas](https://nebraskaracing.unl.edu/baja/subsystems/) |

A [visão geral de 2026 da LASC](https://www.lasc.space/2026-lasc/overview) também foi consultada durante a pesquisa. Esses agrupamentos não são estruturas obrigatórias nem um catálogo ativo da aplicação; a documentação oficial de cada projeto continua sendo a referência.

Referências sobre equipes de satélite usadas nessa pesquisa.

- [NASA SSRI — Assembling a Team](https://s3vi.ndc.nasa.gov/ssri-kb/topics/4/)
- [University CubeSat Project Management for Success](https://s3vi.ndc.nasa.gov/ssri-kb/static/resources/University%20CubeSat%20Project%20Management%20for%20Success.pdf)
- [EPFL Spacecraft Team — Departments](https://www.epflspacecraftteam.ch/departments)
- [UCI CubeSat — Team](https://ucicubesat.com/aboutus/meet-the-team/)
- [Alabama CubeSat Initiative — Subsystem Teams](https://cubesatinitiative.org/spacecraft)
