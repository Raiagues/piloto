# Norte integrado

O Norte reúne contas, equipes, memória documental, mapa de engenharia, exploração de ideias e reuniões com ata. A interface do repositório [Raiagues/norte](https://github.com/Raiagues/norte) está em `norte/`, integrada à reunião JEV que já existia nesta pasta.

A base importada é o commit `eb7a8d5be670e3b36ab79c104c6c897a2508b894`, de 15/10/2026; a procedência está em [norte/UPSTREAM.json](norte/UPSTREAM.json). O destino desta integração é **Raiagues/piloto**, branch **main**. A publicação no Git não substitui a configuração Docker e Postgres do Render descrita em [DEPLOY.md](DEPLOY.md).

## Começar no computador

Pré-requisitos: Linux, Node.js **24.20 ou mais recente**, npm, Python 3 e Poppler (`pdftotext`/`pdfinfo`, pacote `poppler-utils`). As dependências Python estão em [requirements.txt](requirements.txt); use um ambiente virtual se necessário. `./setup` instala as dependências Node e compila a interface.

1. Se ainda não existir `.env`, copie [.env.example](.env.example) para `.env`. Preserve um `.env` existente.
2. Preencha `TYPESAFE_API_KEY` e `GOOGLE_API_KEY`. Google e Gemini usam **a mesma chave**, não duas chaves diferentes. `GEMINI_API_KEY` é um nome alternativo; mantenha apenas um deles preenchido para evitar uma chave antiga tomando prioridade.
3. Execute na raiz:

```bash
./start
```

Abra <http://127.0.0.1:8000>. `./stop` encerra os dois serviços; `./start` recompila e aplica alterações. O registro operacional fica em `.runtime/server.log`.

| Credencial | Usada para |
| --- | --- |
| `TYPESAFE_API_KEY` | JEV: classificação das falas, seleção de memória e interpretações rápidas de ideias elegíveis. |
| `GOOGLE_API_KEY` **ou** `GEMINI_API_KEY` | Gemini: leitura dos documentos, fallback de interpretação, agentes e redação da ata. |
| `NORTE_MEETING_BRIDGE_SECRET` | Segredo interno Node–Python. Gerado pelo launcher local; não é outra API e não exige créditos. |

As chaves do Gemini são criadas no [Google AI Studio](https://aistudio.google.com/apikey), conforme a [documentação oficial](https://ai.google.dev/gemini-api/docs/api-key). A configuração atual não exige OpenAI. Chamadas externas consomem a conta dos respectivos provedores; configurar uma chave não adiciona saldo automaticamente.

## Conta de teste e projeto real

A conta permanente preparada **nesta instalação** usa o e-mail `teste@norte.local`. A senha aleatória fica no arquivo local privado [.runtime/conta-teste.txt](.runtime/conta-teste.txt). Essa conta já possui os 17 documentos e o mapa processado; as 27 pendências permanecem acessíveis para revisão. Entre pelo formulário normal de login para continuar no mesmo projeto; não use o botão de demonstração para recuperar essa conta. Não envie o arquivo de senha ao GitHub.

Na tela inicial, escolha **Explorar com conta de teste**. O perfil local `validation` abre um ambiente isolado com:

- Uma equipe com a pessoa que está testando e sete perfis **EXEMPLO**, distribuídos em cinco setores. Esses perfis são fictícios, não possuem senha, sessões ou convites.
- O projeto **Quetzal-1**, com **17 documentos**, pastas por subsistema e referências de componentes.
- Um mapa inicial de **87 elementos**, reutilizando uma extração documental auditada. As pendências continuam disponíveis na aba **Conhecimento**; números e conexões não confirmados exigem revisão.
- Duas reuniões fictícias de aproximadamente 25 minutos, uma geral e uma setorial, além de planejamento e entregas de exemplo. As datas não representam a história real da missão.

Esses exemplos são preparados somente em contas demonstrativas novas. A retomada conserva o trabalho existente e não substitui o mapa. A conta permanente acima continua separada, sem os colegas fictícios.

A conta demonstrativa pode ser retomada no **mesmo navegador**: documentos, mapas e correções ficam salvos no servidor. A tela de acesso oferece **Retomar conta de teste** quando reconhece o acesso anterior. O acesso é renovável por 30 dias após o último uso; limpar os cookies ou usar outro navegador perde esse comprovante de retomada. Para acesso permanente com senha, use a conta local acima ou crie uma conta normal. Demos diferentes permanecem isoladas e não compartilham projetos nem reuniões.

Os originais e textos extraídos estão em [project-documents/quetzal-1](project-documents/quetzal-1/README.md). O [manifesto](project-documents/quetzal-1/manifest.json) registra URLs, revisões, páginas, licenças e hashes. Cópias de consulta de fabricantes em `local-reference/` ficam fora do Git; confira o corpus local antes de mover a instalação. O corpus inclui o manual ATmega328P de 653 páginas para validar documentos longos. As duas fontes de avaliação/benchmark ficam separadas e não entram na memória.

```bash
python3 scripts/download_project_docs.py --verify
# Em outra instalação, restaurar os arquivos ausentes sem reescrever o manifesto:
python3 scripts/provision_quetzal_demo.py
```

O Docker e o Blueprint desta instalação de teste já habilitam a demonstração Quetzal. O build provisiona os documentos usando fontes públicas e hashes fixos; não há nova extração paga ao abrir a conta. O servidor não baixa fontes durante o acesso. `originals/local-reference/` e `extracted/local-reference/` permanecem fora do Git e são preparados somente na imagem. Uma desativação explícita continua disponível com `NORTE_DEMO_ACCOUNT=0` no build e no ambiente.

No Render, `render.yaml` e `render.env` já incluem `NORTE_DEMO_ACCOUNT=1` e `NORTE_DEMO_PROFILE=validation`. Basta aplicar a configuração e reconstruir a imagem; apenas reiniciar uma imagem antiga não provisiona os documentos. Um serviço existente com desativação explícita precisa receber a configuração atual. Os segredos do Blueprint são gerados quando ausentes e os existentes são preservados. Confira `available: true` no log. Se a falha opcional de download estiver em cache, use **Clear build cache & deploy**. Como alternativa, disponibilize o corpus completo em um volume somente leitura e configure `NORTE_VALIDATION_DOCUMENTS` com esse diretório. Sem o manifesto ou algum texto necessário, a entrada demonstrativa retorna **503 `VALIDATION_DOCUMENTS_MISSING`** e não cria uma conta parcial. Contas normais continuam disponíveis. Veja o [procedimento de deploy e primeiro administrador](DEPLOY.md), incluindo backup dos dados antigos e `NORTE_BOOTSTRAP_TOKEN`.

## Primeiro acesso e continuidade

O primeiro acesso oferece começar um projeto, participar de uma equipe ou conhecer o caminho completo. O guia permanece no cabeçalho e o próximo passo sugerido acompanha o estado do projeto: nome → objetivo → fontes e arquitetura → requisitos revisados → verificação → entregas. Equipe, setores e documentos podem ser organizados depois; nenhuma etapa bloqueia explorar as demais páginas.

**Testar ideias** tem uma página própria, sessões de equipe/setor e sugestões de início. Uma hipótese é analisada com prévia do contexto enviado. A proposta mantém a configuração original intacta: confira parâmetros, impactos e fontes, solicite uma revisão independente e só então aplique a mudança. A aplicação preserva a versão anterior e marca verificações afetadas para revalidação.

## Documentos, mapa e correções

Abra o projeto e sua **Memória do projeto**. A ação **Abrir concepção** funciona mesmo sem documentos e permite construir a arquitetura manualmente. Na aba **Documentos**, use **Gerar mapa** ou **Atualizar mapa** para iniciar a leitura, que usa Gemini `gemini-3.8-flash` em trechos de até **32.000 caracteres**, com sobreposição. A geração segue em segundo plano, sem exigir um clique a cada 24 trechos. O painel mostra os documentos, o estado de cada arquivo e os trechos concluídos ou reutilizados. Minimize o painel para continuar navegando; reabra pelo indicador de progresso. Ao terminar, use a ação de revisão para conferir e aplicar a proposta.

O mapa só é aplicado após processar todos os trechos. Falhas de transporte, respostas incompletas, estrutura inválida e páginas ilegíveis impedem a aplicação. Depois de duas tentativas, afirmações sem comprovação e suas dependências são omitidas; a proposta apresenta essas pendências e exige revisão antes de aplicar. Trechos válidos ficam em cache por projeto, fontes, modelo, versão do prompt e correções. A tarefa e seus pontos de retomada são preservados. Após reiniciar o servidor, tarefas contínuas interrompidas retomam automaticamente quando suas fontes e permissões continuam válidas; falhas exigem **Retomar leitura** no painel. Os trechos salvos passam novamente pela validação antes de serem reutilizados. Trocar de página ou fechar a aba não interrompe o trabalho enquanto o servidor continua ativo.

Se os documentos mudarem, o mapa anterior deixa de ser usado como memória atual. **Atualizar mapa dos documentos** gera uma proposta sem substituir suas correções. Compare os objetos, valores, requisitos e fontes; apenas **Substituir mapa** aplica a proposta. Em **Versões anteriores do mapa**, consulte o relatório da leitura atual, suas pendências e fontes, além das versões anteriores preservadas. Correções feitas durante a leitura impedem a sobrescrita e exigem uma nova proposta.

A cobertura de leitura não garante interpretação perfeita. PDFs escaneados podem exigir OCR; relações visuais de esquemas precisam de conferência. Valores de datasheets não se tornam automaticamente requisitos da missão. Fontes divergentes ficam como pontos de revisão. A integração e o fluxo foram testados; a validação humana de uma extração completa de todo o corpus real continua necessária.

No chat **Administração**, envie uma sugestão, captura de tela ou desenho. Quando quiser usar a mensagem para corrigir futuras interpretações, marque essa opção explicitamente. O chat pode ser movido ou ocultado. **Dúvidas** é um guia de navegação; conversas de equipe, setor e individuais ficam separadas. Detalhes de prompts, versões técnicas, chamadas e tokens são administrativos; conteúdo privado continua exigindo acesso ao projeto.

As correções ajustam exemplos contextuais nas próximas interpretações. Uma mudança de fato ou requisito continua exigindo edição explícita do mapa. Não há treinamento automático dos pesos do modelo, promessa de precisão crescente nem garantia de que o custo total sempre cairá. Reuso e chamadas evitadas são medidos; custos não informados não são inventados.

## Organização e engenharia

**Novo projeto** pede primeiro o nome. Equipe, tipo e programa são opcionais no início; quando necessário, é criada uma equipe privada com apenas o criador. Tipos e modelos de setores podem ser configurados depois, sem transformar uma missão real em competição obrigatória.

A memória se divide em **Documentos**, **Resumo**, **Conhecimento** e **Configuração**. Os documentos têm busca, pastas, subpastas e movimentação por arraste; o leitor abre sobre a página, com anterior/próximo e caminho da pasta. **Conhecimento** reúne pendências com fonte e ações de revisão. O edital pode ser enviado à pasta **Edital e referências** ou ligado a um documento existente, sem duplicá-lo. O responsável administra os acessos; gerentes organizam seus setores e delegam edição. Pastas organizacionais não se tornam automaticamente sistemas técnicos.

A concepção oferece **Arquitetura**, **Interfaces** e **Componentes**: navegação por nível, matriz direcional de interfaces, parâmetros e fontes. Componentes ficam dentro de subsistemas; tipos e pais podem ser corrigidos explicitamente. Conexões ausentes continuam desconhecidas, e inferências aparecem como propostas de revisão. A arquitetura é uma representação documental do projeto; não simula telemetria de um satélite em operação.

O desenho separa decomposição e interfaces, conforme as referências de [decomposição lógica da NASA](https://www.nasa.gov/reference/4-3-logical-decomposition/) e [SysML da OMG](https://www.omg.org/sysml/sysmlv1/). O esquema interno não é um editor SysML certificado.

## Requisitos, verificações e cronograma

As funcionalidades do repositório [Raiagues/testes_requisitos](https://github.com/Raiagues/testes_requisitos), estudado no commit `692739d7b776fce1c8520d04bc4f9bb72a482318`, foram adaptadas à interface e à autoridade de contas deste Norte. Não foram importadas contas, segredos ou privilégios globais de projetos do outro ambiente.

- **Requisitos:** criar, editar, arquivar/restaurar, comentar, atribuir revisores e consultar versões. A revisão é independente do autor; alterações relevantes invalidam a aprovação anterior.
- **Verificação:** vincular testes a requisitos, descrever procedimento e critério, registrar resultado e evidência. Alterar um requisito exige revalidar resultados antigos.
- **Cronograma:** responsáveis, datas, tarefas, dependências sem ciclos e entregas vinculadas a requisitos/testes, com lista e linha do tempo.
- **Normas:** catálogo de 29 referências do projeto de origem, seleção opcional e possibilidade de referência própria. Selecionar uma norma não certifica conformidade.

Os registros ficam em `workspace.delivery`, com controle de versão no servidor, separados do mapa extraído. Reuniões e exploração JEV recebem os requisitos efetivos revisados; um texto corrigido não continua carregando silenciosamente seu limite numérico anterior. Os números precisam ser revisados antes de voltar a servir como restrições de cálculo.

## Pessoas, administração e planos

**Pessoas** mostra as contas acessíveis no ambiente, presença recente e último acesso, com busca e paginação. Contas demonstrativas continuam isoladas. **Mensagens** permite conversar entre contas; apenas participantes autorizados acessam o histórico. Ser administrador não abre conversas privadas de terceiros.

O menu da conta dá acesso à **Administração**. Os controles globais exigem senha na configuração inicial e um código de autenticador TOTP, com confirmação válida por dez minutos por sessão. Há contagem de pessoas online, contato por mensagem, solicitações comerciais e métricas de navegação autorizadas. Detalhes operacionais JEV/IA são administrativos.

A página pública apresenta o produto antes do cadastro. **Planos** inclui memória, documentos, arquitetura, ideias, requisitos, testes, cronograma, reuniões e atas. A cotação é calculada no servidor; pedidos repetidos por falha de rede não duplicam a solicitação. Os preços iniciais vieram da referência e ficam **não aprovados** até revisão comercial do administrador. A contratação segue o fluxo manual do projeto de origem: confirmação de 30 dias, sem cobrança de cartão, renovação automática ou comprovação de pagamento. O registro de contratação não implementa sozinho bloqueios de módulos ou uma quota unificada de IA.

As métricas de navegação são opcionais e começam somente após a pessoa marcar o consentimento. Registram telas, tempo ativo e opções de plano, sem textos de documentos, mensagens ou formulários. Desativar interrompe a coleta e solicita exclusão das métricas. O painel distingue contagens observadas de conversão ordenada; país/região só aparecem quando configurados por uma origem confiável no servidor. Confira [DEPLOY.md](DEPLOY.md).

## Aparência

Use o botão de sol/lua no cabeçalho para alternar entre **claro** e **escuro**. A escolha persiste neste navegador e sincroniza entre abas. Superfícies neutras, destaque caramelo, botões retos e cores funcionais são compartilhados entre páginas de conta, equipes, memória e engenharia. A sala de reunião acompanha a troca de tema sem recarregar a captura.

## Reuniões com ou sem memória

1. Entre em **Reuniões → Nova reunião**.
2. Escolha **Sem memória · testar somente a reunião**, ou selecione um projeto e **Usar o mapa e as fontes do projeto**.
3. O anfitrião inicia a gravação. A transcrição fica aberta por padrão e permite escrever como em um chat ou importar uma conversa. Outras contas acompanham os registros e enviam contribuições.
4. Convide pelo **nickname**. A outra pessoa aceita o convite na própria conta. Se a reunião usa memória, ela também precisa ter acesso ao projeto.
5. Com memória ligada, o servidor seleciona contexto e evidências acessíveis aos participantes, usando JEV quando disponível. **Consultar memória do projeto** permite abrir os pontos e fontes relacionados ao assunto. A fala não altera os fatos do mapa automaticamente.
6. Ao finalizar, revise a ata e gere o PDF. A ata separa categorias por assunto, mantém referências aos detalhes da reunião, mostra motivos curtos de incompatibilidade e pode organizar valores em tabelas. O histórico e os detalhes técnicos ficam no site; as referências exigem login e autorização.

Somente o anfitrião grava/processa a reunião. Escritas usam a versão esperada: duas abas concorrentes recebem um conflito legível, sem sobrescrever silenciosamente os registros. Contribuições usam identificadores para evitar duplicação por repetição de envio.

Reuniões podem ser gerais ou setoriais. O botão de participantes reúne convite, presença e entrada na chamada de áudio. Cada pessoa controla o próprio microfone; o anfitrião pode solicitar silenciamento, mas não pode abrir o microfone de outra pessoa. O áudio usa WebRTC, com limite de 12 participantes; redes restritas exigem TURN. O teste local de áudio entre navegadores não substitui a homologação entre redes externas.

## Contas e dados

**Node é a autoridade de autenticação e autorização.** O navegador acessa a interface e `/api` no mesmo endereço. O Python fica em `127.0.0.1:8790`, aceitando operações privadas assinadas pelo Node. O segredo da ponte não vai ao navegador. Acesso a equipes, documentos, memória e reuniões é conferido no servidor.

Contas normais usam e-mail, nickname e senha com pelo menos 15 caracteres. Em produção, criar a primeira administração exige o código privado `NORTE_BOOTSTRAP_TOKEN` configurado pelo responsável no servidor. Cadastros posteriores recebem acesso comum; esse código não promove outras contas. A administração não dá acesso automático aos projetos e reuniões privados de outras equipes.

Sem `DATABASE_URL`, os dados Node ficam em `.runtime/norte-data.json`, as reuniões Python em `.runtime/norte.sqlite3` e o cache em `.runtime/extraction-cache/`. Com `DATABASE_URL`, ambos usam Postgres em tabelas próprias, mas o cache e os checkpoints da extração continuam no sistema de arquivos. Preserve esse diretório em armazenamento persistente para retomar leituras após substituir o contêiner. Faça backup dos dois conjuntos de dados e preserve os documentos locais.

As contas e registros antigos do Python são preservados. **Não há migração automática de identidade** para as contas do Norte. `ADMIN_USERNAME`, `ADMIN_PASSWORD` e `SIGNUP_CODE` do serviço legado não são o login nem a política de cadastro da nova interface. Não apague a base antiga para iniciar a nova.

## Verificações

```bash
python3 -m unittest discover -s tests -p 'test_*.py'
node --test tests/norte-meeting-bridge.test.cjs tests/meeting-document.test.cjs
npm --prefix norte run typecheck
npm --prefix norte run lint
npm --prefix norte test
node norte/scripts/visual-integrated-live.mjs
```

O último comando usa Chrome (`NORTE_CHROME` permite informar o executável), Node, Python e SQLite reais em diretórios temporários. Verifica contas, convites, persistência, conflito de versão, isolamento, layout móvel, documentos e feedback **sem chamadas a provedores**. `norte/scripts/visual-meetings.mjs` cobre o processamento visual com provedor simulado. Testes com provedores reais devem ser executados explicitamente e consomem créditos.

As páginas **Software** e **Operações** estão temporariamente fora da navegação. Seus arquivos e dados existentes foram preservados.

Para implantação, confira [DEPLOY.md](DEPLOY.md). O [Dockerfile](Dockerfile) e o [render.yaml](render.yaml) iniciam a arquitetura integrada, com uma única porta pública.
