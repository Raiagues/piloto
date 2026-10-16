# Organização, colaboração e documentos

As mudanças de convites, organogramas, navegação, estatísticas e o exemplo com três projetos estão em [Colaboração de equipes](TEAM_COLLABORATION.md).

## Arquitetura reaproveitada

A implementação mantém React/TypeScript, Fastify, sessões em cookies com CSRF e o documento `MissionProject` versão 2. Os setores, cargos e participantes continuam em `context`; não foi criada outra hierarquia de equipes nem outro banco. A versão do estado persistido passa de 8/9 para 10. A normalização é aditiva e conserva usuários, sessões, arquivos, cargos personalizados e atribuições antigas.

Os arquivos continuam no estado transacional existente (`norte_state.data`, JSONB no PostgreSQL; JSON atômico apenas no desenvolvimento local). As permissões são verificadas dentro da transação que modifica esse estado. Não há tabelas ou políticas RLS por usuário: o aplicativo continua responsável pela autorização, usando a conta de serviço do banco. A inicialização PostgreSQL migra sob bloqueio de linha e os pedidos de API atualizam a leitura do estado para observar sessões e permissões alteradas por outra instância.

## Fluxo e organização

1. Em **Equipes**, crie uma equipe ou aceite um convite de uma existente. Solicitações de entrada foram encerradas.
2. Em **Novo projeto**, informe nome, objetivo opcional, equipe e tipo: competição, pesquisa, produto ou personalizado. Competição, pesquisa e produto sugerem três setores editáveis; personalizado começa vazio. A criação aguarda a confirmação da API antes de abrir a Memória. Não depende do Gemini nem de anexos.
3. Os setores existentes são as pastas principais da Memória. Crie somente as subpastas necessárias: por exemplo, Referências, Desenvolvimento e Testes. Nomes e níveis são livres; ciclos e remoção de pastas com conteúdo são recusados. É possível mover uma pasta para outro setor ou outra pasta.
4. A estrutura de pessoas permanece em **Equipe do projeto**. O cargo principal e o setor anterior de cada participante são preservados. Permissões adicionais permitem atuar em vários setores e ter níveis diferentes em cada um.
5. Arquivos e links podem apontar para um objeto técnico já cadastrado. Uma pasta pode representar explicitamente um sistema, subsistema ou componente antes da extração; essa classificação é opcional. Setores organizacionais não viram sistemas automaticamente.
6. A biblioteca da equipe foi retirada da navegação. Documentos antigos e referências já vinculadas são preservados; novas inclusões são feitas diretamente nos projetos.

Documentos de projetos antigos permanecem em **Sem pasta**. A migração não tenta adivinhar seu setor. O capitão ou administrador pode distribuí-los. Cargos personalizados continuam armazenados, mas seu nome não concede poder administrativo; a política usa os identificadores existentes de capitão, gerente, membro e orientador e os novos vínculos por setor.

## Permissões

| Perfil | Leitura do projeto | Artefatos | Organização |
| --- | --- | --- | --- |
| Administrador da plataforma | Todos os projetos | Todos | Usuários, projetos, equipes e setores |
| Criador / responsável pelo projeto | Próprio projeto | Todos os setores | Participantes, cargos, setores e permissões |
| Gerente de setor | Projeto associado | Edita nos setores concedidos | Pastas do seu setor; concede leitura/edição aos participantes existentes desse setor |
| Membro de setor | Projeto associado | Edita nos setores concedidos | Move arquivos somente entre setores em que pode editar |
| Outro participante / orientador | Projeto associado | Somente leitura fora dos setores concedidos; orientador sempre somente leitura | Sem administração |

O gerente de setor não pode promover capitães/gerentes, alterar o próprio poder, convidar por esse cargo para toda a equipe nem excluir o projeto. Edição da arquitetura técnica compartilhada e configurações gerais continua reservada à liderança. A administração da equipe exige capitão explícito, administrador autorizado ou administrador global; o responsável por um projeto não administra automaticamente a equipe.

As regras cobrem upload, edição, exclusão, arquivo original, PDF, destino e origem de movimentações, alteração de pastas, projeto inteiro e a rota antiga de workspace. Um `updatedBy` não concede mais acesso permanente. Mudar `ownerId` ou `scope` de um artefato pela API é recusado. Pastas e concessões ficam no mesmo estado durável dos projetos; logout não as remove. Uma revisão de organização recusa configurações obsoletas em vez de sobrescrever alterações de outra pessoa.

## Presença

**Administrar usuários**, na página inicial, está disponível para `owner_admin`. O capitão também vê a atividade apenas dos participantes do projeto na Memória. A lista administrativa usa uma seleção explícita de campos públicos; nunca inclui hashes de senha, tokens de sessão ou convites.

Cada sessão recebe um `lastSeenAt`. O navegador envia heartbeat autenticado com CSRF a cada 30 segundos enquanto a página está visível e houve interação nos últimos dois minutos. Uma sessão é online se não expirou e seu último sinal tem menos de 90 segundos. Fechar a aba, perder conexão ou ficar inativo expira o indicador automaticamente; logout elimina a sessão imediatamente. Havendo outra sessão ativa da mesma conta, o usuário permanece online. O último acesso fica preservado no usuário. A listagem atualiza a cada 30 segundos, sem deploy ou edição manual do banco.

## Documentos e PDF

Em **Adicionar → Escrever documento**, o conteúdo é editado em Markdown. Títulos, subtítulos, tabelas, referências e imagens PNG/JPEG incorporadas compõem o PDF produzido pelo PDFKit no servidor. **Abrir** exibe o PDF no visualizador do navegador; **Baixar PDF** o baixa. Editar continua abrindo o texto original.

O PDF gerado é uma representação sob demanda: não grava arquivos no disco do Render nem substitui o original. Os PDFs enviados pelo usuário ficam no banco e podem ser visualizados ou baixados. CAD, código, imagens, arquivos compactados e planilhas mantêm seus bytes e formatos originais; não passam pela conversão para PDF. A interpretação de formatos pelo Gemini continua explícita: armazenamento não significa que a IA sabe ler o arquivo.

Limites atuais:

- Arquivos enviados: 4 MB, conservando o limite existente do aplicativo.
- Documento editável: 200 mil caracteres; o editor limita cada imagem inserida a 100 KB. A leitura pelo Gemini continua sujeita aos limites anteriores de 120 mil caracteres e 12 MB de fontes por extração.
- PDF: subconjunto de Markdown com títulos, parágrafos, blocos de código, tabelas e referências. Imagens devem ser incorporadas; URLs de imagem e caminhos locais não são buscados. Não é um conversor de DOCX, CAD ou planilha nem um editor visual de paginação.
- A demonstração estática do GitHub Pages mantém arquivos no navegador; autoria/exportação de PDF e presença real exigem a API conectada. O editor de documentos não é oferecido na demonstração.
- O estado JSONB único é adequado à arquitetura atual, mas regrava o conjunto nas mutações. Um acervo maior exigirá armazenamento de objetos e granularidade maior no banco; isso não foi introduzido nesta mudança.

Referência da biblioteca utilizada: [PDFKit — texto](https://pdfkit.org/docs/text.html), [tabelas](https://pdfkit.org/docs/table.html) e [imagens](https://pdfkit.org/docs/images.html).

## Gemini e compatibilidade

A extração recebe os setores, caminhos de pastas, vínculos de artefatos e classificações técnicas definidas pelo usuário. Esses dados são tratados como contexto, não instruções. Novas respostas são recusadas se um componente não pertencer a um subsistema, se um subsistema não pertencer a sistema/subsistema ou se a classificação/hierarquia contradizer uma pasta técnica reconhecida. A ausência de evidência continua podendo produzir um modelo incompleto ou uma falha explícita, nunca uma arquitetura pronta substituta.

Modelos históricos permanecem legíveis sem reclassificação automática. Ao editar um modelo antigo, a validação estrita vale para os vínculos alterados; dados e cenários antigos não são apagados. O importador histórico de fontes já existente conserva seu contrato anterior para as extrações arquivadas. Não foram feitas chamadas pagas ao Gemini nem alterados projetos hospedados nesta implementação.

**Testar ideias** substitui a nomenclatura anterior na navegação, no painel e nas ações das hipóteses. O painel não aparece na Memória; continua disponível nas áreas técnicas, preservando cenários e análises de consequências.

## Validação e publicação

- `npm run quality`: TypeScript, ESLint, testes e build.
- `node --test --test-isolation=none server/organization.test.mjs`: criação, persistência JSON/PostgreSQL (pg-mem), permissões, movimentação, migração, presença, hierarquia e PDF.
- `npm run test:visual:organization`: navegador Chrome com API real e banco temporário; criação de equipe/projeto, subpastas, autoria, download de PDF, movimentação, recarga e atividade administrativa.

No Render, `DATABASE_URL` deve apontar para o PostgreSQL persistente já usado. A aplicação recusa iniciar no Render sem essa variável, para não armazenar arquivos de usuários no disco efêmero. Não é necessário disco adicional, Chromium no servidor ou serviço de conversão pago. Não há SQL destrutivo nem comando de reset: a migração é aplicada no carregamento do estado. Antes da publicação, mantenha o procedimento normal de backup do banco. O teste PostgreSQL usa pg-mem; a implantação real e a geração ao vivo com Gemini permanecem verificações do ambiente hospedado.
