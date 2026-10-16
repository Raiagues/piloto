# Implantar o Norte integrado

Esta versão publica a interface Norte e a API Node, mantendo o processamento Python de reuniões privado no mesmo contêiner. Use o [Dockerfile](Dockerfile) da **raiz deste projeto**. Publicar apenas `server.py` ou apenas a pasta `norte/` deixa a integração incompleta.

O destino confirmado nesta implementação é **Raiagues/piloto**, branch **main**. O serviço existente é `norte-r007.onrender.com`. Preserve os dados e as variáveis do serviço; mudar o código não exige recriar o banco.

## 1. Confirmar o repositório

No serviço Render, confira **Settings → Build & Deploy** e a origem mostrada nos logs de deploy. O repositório escolhido precisa conter, na raiz, `Dockerfile`, `render.yaml`, `server.py`, `scripts/service.py` e a pasta `norte/` com o código integrado.

Deixe **Root Directory** vazio, **Dockerfile Path** como `./Dockerfile` e **Docker Command** sem override. Assim o contêiner usa o supervisor definido no Dockerfile.

A pasta `norte/` foi importada de [Raiagues/norte](https://github.com/Raiagues/norte), commit `eb7a8d5be670e3b36ab79c104c6c897a2508b894`. Isso registra a origem do código; não altera sozinho o repositório conectado no Render. Confira [norte/UPSTREAM.json](norte/UPSTREAM.json).

## 2. Preencher as chaves

São **duas chaves externas** nesta configuração:

| Campo | O que colocar |
| --- | --- |
| `TYPESAFE_API_KEY` | A chave da sua conta TypeSafe/JEV. |
| `GOOGLE_API_KEY` | A chave Gemini criada no [AI Studio](https://aistudio.google.com/apikey). Ela atende documentos, agentes, ideias e ata. |

Google e Gemini não exigem duas chaves separadas. `GEMINI_API_KEY` é uma alternativa a `GOOGLE_API_KEY`; uma chave antiga nesse campo pode tomar prioridade. Escolha um nome e remova o valor conflitante. As chaves ficam no servidor, conforme a [documentação Gemini](https://ai.google.dev/gemini-api/docs/api-key).

Também configure:

| Campo | Finalidade |
| --- | --- |
| `DATABASE_URL` | Postgres persistente. O Blueprint preenche a partir de `norte-db`. |
| `NORTE_MEETING_BRIDGE_SECRET` | Segredo interno aleatório com pelo menos 32 caracteres. O Blueprint usa `generateValue: true`. Não é uma chave paga. |
| `NORTE_BOOTSTRAP_TOKEN` | Código aleatório de pelo menos 32 caracteres para cadastrar o primeiro administrador em produção. O Blueprint usa `generateValue: true`. |
| `NODE_ENV=production` | Modo de produção. |
| `NORTE_DEMO_ACCOUNT=0` | Desabilita o acesso demonstrativo na publicação normal. Para homologação com demo, habilite deliberadamente com `1`. |
| `NORTE_DEMO_PROFILE=validation` | Perfil Quetzal-1 quando a conta demonstrativa estiver habilitada. O launcher já usa esse padrão. |

`ADMIN_PASSWORD`/`ADMIN_USERNAME` referem-se às contas antigas do Python. Se o Blueprint solicitar esses campos, preserve os valores legados; eles não criam o login da interface Norte. Para cadastrar o primeiro administrador Norte em produção, copie em segredo o valor de `NORTE_BOOTSTRAP_TOKEN` no **Environment** do Render e cole no campo **Código de configuração inicial** do cadastro. O código não é uma chave de API: não o coloque em URL, Git, variável `VITE_` ou mensagem pública. Depois do primeiro cadastro, ele não é reutilizado e pode ser removido do Environment. Um banco que já possui administração inicial não exige esse código para os cadastros seguintes.

Na configuração manual de um serviço existente, gere um valor com `openssl rand -hex 32` e salve-o em `NORTE_BOOTSTRAP_TOKEN` no Environment. O segredo da ponte deve ter outro valor aleatório; preserve o valor existente quando já estiver configurado.

### Email e recuperação de acesso

Cadastro, login e convites por nickname funcionam sem SMTP. Para enviar convites por email e verificar endereços, configure no servidor:

```dotenv
NORTE_PUBLIC_URL=https://seu-dominio/
SMTP_HOST=seu-servidor-smtp
SMTP_PORT=587
SMTP_FROM=Norte <remetente@seu-dominio>
SMTP_USER=usuario-smtp
SMTP_PASSWORD=senha-smtp
```

Use a URL pública real da interface; inclua `/norte/` somente se ela for servida nesse caminho. Em produção, a URL precisa usar HTTPS. A porta 587 exige STARTTLS; a 465 usa TLS desde a conexão. Use o remetente autorizado pelo seu provedor e suas credenciais SMTP, quando ele exigir autenticação. Essas credenciais não são outra chave Gemini/JEV e nunca devem usar prefixo `VITE_`.

O remetente verifica o próprio email na página **Convites** antes de convidar por email. O destinatário entra na conta do endereço convidado, verifica esse endereço e aceita o convite. Sem configuração, essas operações retornam `EMAIL_UNAVAILABLE`; convites por nickname continuam disponíveis. Links de verificação expiram em 30 minutos e convites em 7 dias. A demonstração não envia emails.

**Esta versão não implementa “Esqueci minha senha” nem redefinição de senha por email.** Configurar SMTP não habilita recuperação de senha. Não prometa esse fluxo aos usuários antes de implementá-lo e testá-lo. Os testes de email usam um transporte simulado; entrega real ainda precisa ser verificada com as credenciais do ambiente e uma caixa controlada pela equipe. Aceitação pelo servidor SMTP não comprova chegada à caixa de entrada. O contrato está em [norte/docs/TEAM_COLLABORATION.md](norte/docs/TEAM_COLLABORATION.md).

## 3. Configurar o Render

O [render.yaml](render.yaml) declara um Web Service Docker e Postgres. Os planos selecionados são pagos; confira os valores exibidos no painel antes de aplicar o Blueprint. O código não adiciona saldo aos provedores nem limita todos os gastos pela configuração de agentes.

O Blueprint cria `norte-db` para uma instalação nova; ele não migra SQLite, JSON, contas ou reuniões de outro banco. Em um serviço existente, preserve a `DATABASE_URL` atual e faça backup/exportação dos dados antes de redeploy ou mudança de armazenamento.

Para uma instalação nova, conecte no Render o repositório que contém **esta integração**, selecione o Blueprint e revise os recursos e variáveis. Para um serviço existente, confirme que ele usa Docker e o Dockerfile da raiz. O comando do contêiner já está no Dockerfile; não mantenha um override antigo que inicie somente o Python. O Render documenta essas opções em [Docker on Render](https://render.com/docs/docker).

Se o serviço atual ainda usa Python, abra **Settings → Build → Source → Edit**, selecione `Raiagues/piloto`, branch `main`, e mude **Runtime** para **Docker**. Deixe **Root Directory** vazio, **Dockerfile Path** como `./Dockerfile` e **Docker Command** sem override. Prepare o banco e as variáveis antes de confirmar o deploy. Esse procedimento atualiza o serviço existente, conforme [Changing a service's runtime](https://render.com/docs/native-runtimes#changing-a-services-runtime).

Em **Environment → Environment Variables**, use **Edit** se a tabela estiver somente em modo de leitura. Depois use **Add from .env** para importar [render.env](render.env), ou adicione os campos manualmente. Cole o conteúdo desse arquivo público; não substitua suas chaves, banco ou segredo da ponte pelos exemplos. A seção **Secret Files** não é o campo de importação de variáveis. Salve usando **Save, rebuild, and deploy** quando for aplicar o novo código. Veja [Environment Variables and Secrets](https://render.com/docs/configure-environment-variables).

O build inclui Node 24.20, Python e Poppler. O supervisor inicia:

- Node na porta pública indicada por `PORT`, servindo a interface, contas e APIs.
- Python apenas em `127.0.0.1:8790`, com autenticação interna HMAC.
- Health check público em `/api/health`.

Depois do deploy, abra `/api/health` e confira `version: "1.0.0"`, `storage: "postgresql"` e o objeto `engineering`. Um HTTP 200 sozinho não identifica a integração: o servidor Python antigo também responde nesse caminho. `engineering.configured` indica presença da configuração, não comprova saldo nem sucesso de geração.

Não exponha a porta 8790. Use uma instância de aplicação enquanto tarefas de extração e seus checkpoints estiverem vinculados ao processo local. Tarefas contínuas interrompidas retomam após reiniciar quando o cache, os metadados, as fontes e as permissões continuam válidos. Preserve o diretório de cache em armazenamento persistente, além do banco. O Blueprint não declara disco persistente para esse cache: um redeploy pode exigir novo processamento, embora os documentos enviados, mapas aplicados e reuniões permaneçam no Postgres. Tarefas antigas sem os novos metadados de retomada precisam ser iniciadas novamente; mapas já aplicados não são afetados.

## 4. Modelos e limites

| Função | Configuração aplicada |
| --- | --- |
| Classificação da reunião e seleção rápida de memória/ideias | JEV, pela `TYPESAFE_API_KEY`. |
| Extração documental | `GEMINI_EXTRACTION_MODEL=gemini-3.8-flash`; trechos de 32.000 caracteres, com até duas chamadas simultâneas no serviço. |
| Continuação da extração | Automática em segundo plano, com progresso por documento; aplicação somente após cobertura completa e revisão da proposta. |
| Interpretação de ideias que exige LLM | `GEMINI_DISCOVERY_MODEL=gemini-3.5-flash-lite`. |
| Organização e agentes | `GEMINI_ORGANIZATION_MODEL` / `AI_AGENT_MODEL=gemini-3.5-flash-lite`. |
| Redação da ata | `GEMINI_MODEL=gemini-3.8-flash`. |

`NORTE_EXTRACTION_CHUNKS_PER_RUN=24` limita uma rodada no modo manual/diagnóstico. A interface usa geração contínua em segundo plano e não exige pausas entre rodadas; esse parâmetro não limita o total de chamadas da tarefa nem é um orçamento diário. `AI_DAILY_BUDGET_USD` e `AI_DAILY_CALL_LIMIT` limitam o módulo de agentes legado; não são limites globais de todos os documentos, reuniões e usuários. As estimativas dependem das tarifas configuradas. Confira cobrança, quota e modelos disponíveis nos próprios provedores; este guia não fixa preços ou promete economia automática.

A administração mostra chamadas, tokens reportados, reusos, exemplos e feedback. O chat **Administração** recebe sugestões da equipe; somente correções explicitamente marcadas entram como feedback das interpretações. Valores ausentes ficam sem estimativa monetária. Correções ajustam exemplos contextualizados; não retreinam os pesos do modelo nem alteram requisitos físicos sem uma edição autorizada.

## 5. Validar antes de uso com a equipe

1. Entre no endereço público e crie a primeira conta normal com e-mail, nickname, senha de pelo menos 15 caracteres e o **Código de configuração inicial** do Environment, quando solicitado.
2. Crie uma segunda conta normal em outro perfil do navegador. Crie uma reunião sem memória, envie convite pelo nickname e aceite na segunda conta.
3. Confirme que a segunda conta acompanha e contribui, enquanto somente o anfitrião inicia e grava o processamento. Recarregue e confira a persistência.
4. Adicione os documentos ao projeto, execute a leitura completa e revise as evidências e divergências. Crie outra reunião com **Usar o mapa e as fontes do projeto**. Os participantes precisam também de acesso ao projeto.
5. Use **Consultar memória do projeto**, confira as referências e registre uma avaliação. Verifique a versão e os contadores no painel.
6. Gere a ata e confira seus links em uma sessão autorizada. Teste também com uma conta que não participa: ela não deve acessar a reunião nem suas fontes.

A conta de teste é apropriada para avaliação isolada: Quetzal-1, o visitante e sete perfis fictícios de setor, identificados como EXEMPLO e sem senha de login. As reuniões, revisões e prazos de exemplo não representam a operação histórica da missão. Um cookie de retomada HttpOnly permite recuperar documentos, mapa e correções no mesmo navegador, com validade renovável de 30 dias. Apenas o hash desse comprovante fica salvo no servidor. Limpar cookies perde o acesso por esse mecanismo; para acesso permanente entre dispositivos, use uma conta normal com senha. Demos diferentes não colaboram entre si. Os **17 documentos** usados localmente têm originais e textos em [project-documents/quetzal-1](project-documents/quetzal-1/README.md). As referências de fabricantes excluídas do Git precisam ser provisionadas localmente no ambiente de homologação antes de habilitar esse corpus; não presuma que um novo clone contém esses arquivos. A extração completa real e a revisão humana de todos os documentos devem ser verificadas no ambiente desejado.

Para preparar o corpus, execute na cópia administrativa do projeto, com Python e Poppler instalados:

```bash
python3 scripts/provision_quetzal_demo.py
python3 scripts/download_project_docs.py --verify
```

Use o provisionador em produção: ele restaura arquivos ausentes sem reescrever o manifesto. O comando antigo com `--verify` continua sendo uma verificação offline.

Para habilitar a demonstração no Render, **depois de importar `render.env`** (que define a demo como `0`), edite **Environment** e defina `NORTE_DEMO_ACCOUNT=1` e `NORTE_DEMO_PROFILE=validation`. Escolha **Save, rebuild, and deploy**. O Render fornece essas variáveis como argumentos de build e no runtime; o Dockerfile declara o argumento `NORTE_DEMO_ACCOUNT`. Reiniciar ou republicar apenas a imagem existente não baixa o corpus. [Variáveis no Docker do Render](https://render.com/docs/docker#environment-variable-translation), [opções de salvamento](https://render.com/docs/configure-environment-variables#in-the-render-dashboard).

O build executa `scripts/provision_quetzal_demo.py --optional`: baixa somente os arquivos ausentes das fontes fixadas no manifesto, verifica hashes dos originais/textos e não substitui arquivos divergentes. Isso prepara as cópias de consulta apenas nessa instalação; elas continuam excluídas do Git. Se algum fabricante estiver indisponível ou tiver alterado a revisão, o site normal continua funcionando e a demo informa indisponibilidade, sem criar uma conta parcial. Confira `available: true` no log do provisionamento antes de testar. Se uma falha opcional ficou armazenada no cache do build, use **Manual Deploy → Clear build cache & deploy** para repetir o provisionamento.

Alternativamente, provisione o diretório completo em um volume e configure `NORTE_VALIDATION_DOCUMENTS` para esse caminho. O runtime não baixa documentos nem repete a extração LLM. Novas contas Quetzal reutilizam uma versão pública com citações remapeadas, pendências explícitas e exemplos fictícios de organização, reuniões e planejamento. Retomar uma conta existente preserva seus documentos, correções e mapa.


## 6. Dados antigos e manutenção

Faça backup/exportação dos dados Python e Node antigos **antes** do redeploy. Arquivos em disco efêmero podem desaparecer quando o contêiner é substituído; a publicação não os preserva nem transfere automaticamente. Mantenha a `DATABASE_URL` existente quando os dados já estão em Postgres. O Norte usa contas próprias; não associa identidades automaticamente por nome ou senha. Uma reunião antiga não passa a ser acessível a uma nova conta por essa coincidência. Planeje uma migração explícita se precisar transferir o histórico antigo.

Sem Postgres, o launcher local usa `.runtime/norte-data.json` e `.runtime/norte.sqlite3`. Em produção, preserve `DATABASE_URL` e backups do banco. Para obter registros operacionais no Render, use **Logs**; localmente use `.runtime/server.log`. Não publique `.env`, cookies, bancos, logs privados nem a chave HMAC.

| Sintoma | Conferência |
| --- | --- |
| Aparece a interface antiga | Repositório, branch, Dockerfile e comando do contêiner. |
| Login `admin` antigo não entra no Norte | São sistemas de identidade diferentes; use uma conta Norte. |
| Reunião não abre | Sessão, convite aceito, acesso ao projeto e serviço Python privado. |
| Serviço de reuniões indisponível | Segredo HMAC igual nos dois processos, Python na porta privada e logs do supervisor. |
| Leitura não avança | Abra o acompanhamento. **Retomar leitura** tenta novamente uma falha; **Reconectar** atualiza um acompanhamento indisponível. Mudanças nas fontes exigem nova proposta. |
| PDF sem texto ou páginas faltando | Corrija o arquivo/aplique OCR e reinicie a leitura. |
| API sem saldo ou sem acesso ao modelo | Confira a chave, quota, cobrança e modelo no respectivo provedor. |
| Conflito de versão ao salvar reunião | Outra aba gravou primeiro; recarregue antes de continuar. |
| Demo retorna `VALIDATION_DOCUMENTS_MISSING` | Baixe/verifique o corpus, provisione os textos e originais no serviço e confira `NORTE_VALIDATION_DOCUMENTS`. |
| Email retorna `EMAIL_UNAVAILABLE` | Configure SMTP e `NORTE_PUBLIC_URL`; convites por nickname continuam disponíveis. |
| Pessoa esqueceu a senha | Recuperação por email ainda não está implementada nesta versão. SMTP não adiciona esse fluxo. |


## 7. Administração, contratação e métricas

Os endpoints `/api/platform/admin/*` exigem uma conta normal `owner_admin` e autenticação adicional por TOTP. Entre em **Administração**, confirme sua senha para configurar o aplicativo autenticador e informe seu código de seis dígitos. O segredo é cifrado em repouso com AES-GCM, vinculado ao usuário; códigos usados não são reutilizáveis. A elevação expira em dez minutos por sessão. Nenhuma conta real foi inscrita automaticamente durante os testes.

Defina uma chave persistente de pelo menos 32 caracteres em `NORTE_ADMIN_ENCRYPTION_KEY` **antes da primeira inscrição**, se quiser separar a cifra administrativa da ponte de reuniões. Se ela estiver ausente, o serviço usa `NORTE_MEETING_BRIDGE_SECRET`. Preserve a chave escolhida junto aos backups: trocá-la depois da inscrição torna os segredos existentes ilegíveis. Não há recuperação automática de TOTP ou códigos de reserva nesta versão; preserve o acesso ao autenticador. Isso é separado da senha do usuário e de chaves dos modelos.

Em **Solicitações e preços**, revise valores e aprove o catálogo antes de confirmar contratos. A confirmação manual registra o período de 30 dias. Não há gateway de pagamento, checkout de cartão nem webhook que comprove pagamento. O estado comercial não deve ser apresentado como cobrança concluída. Capacidade e cotas efetivas continuam dependentes das regras configuradas no ambiente; não há medidor de cobrança unificado para todos os módulos de IA.

O painel de uso mostra somente navegação consentida, com retenção de até 90 dias e visão resumida dos últimos 30. As etapas contam sessões distintas e não pressupõem uma sequência exata. Tempo ativo é observado no navegador com a tela visível e interação recente; não é relógio de produtividade individual.

Para país/região, use um proxy confiável que remova cabeçalhos fornecidos pelo cliente, determine a localização e encaminhe:

- `x-norte-country`: código ISO de duas letras;
- `x-norte-region`: região, quando disponível;
- `x-norte-geo-token`: segredo compartilhado com `NORTE_GEO_HEADER_SECRET` (pelo menos 32 caracteres).

O token nunca deve ir ao navegador. Cabeçalhos sem esse segredo são ignorados. O código não consulta um serviço geográfico externo nem infere país pelo idioma; sem proxy configurado, o painel apresenta localização não informada. Essa integração precisa ser provisionada e validada no ambiente publicado. Esta atualização local não alterou o Render.

A referência `testes_requisitos` utiliza Supabase em seu ambiente. Esta implementação mantém as autoridades existentes Node/Python e testa suas próprias regras de acesso; não é uma migração automática das políticas RLS do Supabase. Administração global não concede leitura de projetos, documentos ou conversas privadas de outras equipes.


## 8. Chamada de áudio e tamanho do serviço

Para homologação com equipe, use um **Web Service Docker pago**, uma instância, e **Postgres persistente**. O Blueprint mantém a opção inicial de 0,5 CPU/512 MB; para uso simultâneo de extração documental, Node e Python, recomendo começar com **1 CPU/2 GB (`1c-2g`)** e medir memória/latência. Essa recomendação é de capacidade inicial, não resultado de teste de carga nem contratação automática. Confira o preço vigente no [painel de planos](https://render.com/pricing); os [identificadores de recursos](https://render.com/docs/blueprint-spec#plan) estão na documentação oficial.

O Render publica uma porta HTTP por serviço. Configure um **TURN externo** (coturn ou serviço compatível com credenciais HMAC temporárias); aumentar o plano Render não substitui o TURN. No Environment, adicione `NORTE_TURN_URLS` e `NORTE_TURN_SECRET` conforme [áudio das reuniões](norte/docs/meeting-audio.md). Mantenha a chave fora do Git e do navegador. Valide uma chamada entre redes diferentes depois de configurar. Sem esse teste, a conexão de produção ainda não está comprovada.

O áudio suporta até 12 participantes simultâneos nesta implementação. Reunião geral/setorial usa as permissões atuais da equipe. A pessoa autoriza o próprio microfone; o anfitrião pode silenciar, mas liberar não o ativa à distância. A captura de falas só funciona durante a gravação autorizada pelo anfitrião. A transcrição depende do reconhecimento de voz disponível no navegador; áudio e transcrição são serviços diferentes.

## 9. Tutorial, conversas e primeiro acesso

O primeiro acesso apresenta três caminhos: começar um projeto, entrar em equipe ou conhecer o fluxo. O guia permanece no cabeçalho e mostra objetivo, organização, documentos, arquitetura, requisitos, verificação e cronograma. A sugestão do próximo passo usa os dados existentes e não bloqueia a navegação.

O chat flutuante aceita texto, imagem colada/anexada, captura da tela e desenho. **Administração** é um canal humano; **Tirar dúvidas** é o guia de navegação, sem envio à administração. Mensagens também oferece grupos da equipe, dos setores e conversas individuais. Grupos de setor verificam o vínculo atual a cada leitura/escrita; retirar o vínculo também retira o acesso aos anexos.

Para substituir a animação de exemplo pelo seu vídeo:

1. Grave um MP4 curto, sem dados pessoais ou credenciais, mostrando captura → anotação → envio e desenho de uma sugestão.
2. Salve como `norte/public/tutorials/feedback.mp4` e publique com o aplicativo, ou hospede em um endereço HTTPS estável que sirva o arquivo de vídeo diretamente.
3. Defina `NORTE_CHAT_TUTORIAL_URL=https://norte-r007.onrender.com/tutorials/feedback.mp4` no Environment e reinicie/deploy. Se usar outro host, informe a URL completa; a política de mídia libera apenas a origem configurada pelo administrador.
4. Abra **Como usar o chat** para testar reprodução. Sem URL configurada, a animação incorporada continua disponível.

As análises de ideias mostram uma prévia antes do envio a JEV/TypeSafe/Gemini. O consentimento fica vinculado à hipótese e ao contexto daquela versão. Propostas não alteram o mapa: um revisor independente aprova e a liderança incorpora. Mudanças preservam a versão anterior e exigem revalidar verificações afetadas. Cache e exemplos corrigidos podem reduzir repetição de chamadas; não constituem treinamento dos pesos nem garantia de melhoria contínua de precisão/custo.
