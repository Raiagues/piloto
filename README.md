# Norte

O Norte organiza requisitos, cronogramas, documentos e reuniões de engenharia. A equipe acompanha a origem de cada requisito, suas versões, a revisão humana e a situação de cada documento.

A aplicação começa vazia. Contas, equipes, projetos e participantes só aparecem quando existem no armazenamento. Análises de requisitos, pesquisa de referências e sugestões de verificação são executadas por solicitação explícita.

## Executar com Docker

```bash
docker compose up --build -d
```

Abra `http://localhost:8000`. A imagem inclui Node, Python, dependências e Poppler; o volume `norte-data` conserva os dados. As chaves opcionais são lidas do `.env`, nunca copiadas para a imagem.

O editor Overleaf Community Edition pode rodar localmente:

```bash
python3 scripts/prepare_overleaf.py
docker compose --profile overleaf up --build -d overleaf
```

Abra `http://localhost:8081/launchpad` para criar a conta local. Baixe o ZIP LaTeX de um documento do Norte e importe-o como projeto. O perfil inclui MongoDB, Redis e TeX da imagem oficial, sem montar o socket Docker. Ele fica restrito ao computador local; CE pressupõe usuários confiáveis. A preparação conserva o segredo de convites em arquivo privado. Veja [instalação, exportação e validação local](docs/overleaf.md) e a [documentação oficial](https://github.com/overleaf/toolkit/blob/master/doc/quick-start-guide.md).

O botão **Enviar cópia ao Overleaf** usa a [API oficial](https://www.overleaf.com/devs) para abrir uma cópia em overleaf.com, somente por solicitação. Essa cópia não sincroniza automaticamente; revisão e aprovação vigentes continuam no Norte.

## Executar sem Docker

Requisitos: Linux, Python 3, Node.js 24.20+ e Poppler (`poppler-utils`).

```bash
./setup
./start --no-browser
./stop
```

`./setup` instala as dependências e compila a interface. `./start` abre o navegador; `--no-browser` mantém apenas os serviços. O endereço padrão é `http://127.0.0.1:8000`; `PORT` no `.env` altera a porta. `./prepare-local` prepara as ferramentas necessárias quando o Node do sistema é antigo. Dados e logs locais ficam em `.runtime/`, fora do Git.

Crie uma conta com nome, login e senha. O e-mail é opcional. Convites por nickname funcionam sem SMTP. Em produção, a primeira administração exige o código privado `NORTE_BOOTSTRAP_TOKEN`; o cadastro público não concede esse privilégio. As estatísticas globais exigem autenticação adicional por TOTP.

## Arquitetura

```mermaid
flowchart LR
  UI[React / TypeScript] --> API[Node / Fastify]
  API --> DATA[JSON local ou PostgreSQL]
  UI --> ROOM[Sala de reunião]
  ROOM --> API
  API -->|ponte assinada| MEET[Python / reuniões]
  MEET --> MEM[SQLite local ou PostgreSQL]
  MEET --> JEV[JEV: classificação]
  MEET --> LLM[LLM: organização e atas]
  API --> ASSIST[Gemini: análises solicitadas]
```

O Node é a autoridade de contas, permissões, projetos, documentos e revisões. O Python recebe operações de reunião pela ponte privada em loopback; sua chave nunca chega ao navegador. Ambos são supervisionados por `scripts/service.py`, com uma única porta pública.

| Diretório | Responsabilidade |
| --- | --- |
| `norte/src/pages` | Páginas carregadas sob demanda |
| `norte/src/components` | Componentes de equipes, chat e entregas |
| `norte/src/lib` | Sessão, navegação, estado remoto e contratos de interface |
| `norte/src/styles` | Tokens, base, layout e estilos por funcionalidade |
| `norte/server` | API, autorização, persistência, documentos e análises |
| `norte/shared` | Regras e referências compartilhadas |
| `meetings/web` | Captura, transcrição, blocos, revisão e atas |
| `meetings/engine` | JEV, assistência editorial e correções por reunião |
| `scripts` | Instalação, supervisão e diagnóstico |
| `tests`, `norte/tests`, `norte/server/*.test.mjs` | Testes isolados e contratos |
| `novo_teste` | Originais LYLE, cenário extraído e resultados em subpastas |

Veja [arquitetura e dados](docs/architecture.md), [reuniões e memórias](docs/meeting-memory.md), [estilos](norte/src/styles/README.md), [implantação](DEPLOY.md) e [instruções para manutenção](AGENTS.md).

## Fluxos principais

- **Navegação:** o cabeçalho mostra *equipe › projeto › setor › área* e um único botão Voltar à esquerda; quando uma área tem um nível interno aberto (requisito, documento, reunião ou ata), Voltar fecha esse nível primeiro. A barra lateral reúne Início, Equipes, Reuniões e o projeto ativo, cujo nome aparece como texto e abre a lista de projetos agrupada por equipe. No celular, a barra vira gaveta. O ícone do Norte leva ao Início. *Abertos recentemente* (ícone de relógio no cabeçalho e “Continuar de onde parou” no Início) identifica o tipo de cada item, o projeto, quando foi aberto, a situação e rascunhos locais não salvos.
- **Visão geral do projeto:** primeira página ao abrir um projeto. Mostra objetivo, equipe, setores e pessoas; indicadores de requisitos, apontamentos, documentos e próximo marco; o registro de documentos com tipo, versão e situação (rascunho não submetido, aguardando revisão, alterações pedidas, versão final, arquivo original e ata); próximos marcos, reuniões do projeto e requisitos com apontamentos. Tudo vem dos registros existentes. `#/documents` redireciona para cá.
- **Requisitos:** tabela ou árvore por subsistema; a árvore de subsistemas fica sob *Requisitos* na barra lateral e o filtro fica na URL. Busca, filtros, colunas configuráveis e abertura pela linha em painel lateral (folha inferior no celular). Apontamentos destacam o trecho literal e apontam à referência oficial. A IA sugere; uma pessoa revisa.
- **Versão de teste somente leitura:** com `NORTE_DELIVERY_READ_ONLY=1`, o servidor mostra requisitos, cronograma e documentos, mas recusa toda escrita dessas áreas (HTTP 423) e não inicia análises. Reuniões, equipes e configurações do projeto continuam editáveis.
- **Cronograma:** começa vazio. A equipe escolhe um modelo de referência e entra em edição. Há hierarquia, dependências, deslocamento encadeado, desfazer e aprovação independente.
- **Documentos:** pacotes por revisão e área de edição/prévia em página inteira, abertos a partir da visão geral. Rascunhos locais são separados por conta e versão. PDF e ZIP LaTeX usam a versão salva.
- **Equipes:** cada equipe representa a empresa ou o grupo. A carteira lista os projetos com responsável, setores e equipe do projeto; *Pessoas* mostra cargo, função e alocação; *Alocação* cruza pessoas e projetos com o papel e o setor atribuídos; *Convites* fica com a gestão.
- **Mensagens:** texto e imagens na ordem de composição, colagem e anotações. Ajuda e feedback abrem a Administração (menu da conta ou botão flutuante).
- **Reuniões:** uma única barra com título e situação à esquerda, gravação e áudio no centro, até três participantes (o terceiro círculo resume os demais) e *Ata / PDF* à direita; a página não rola. Texto e transcrições entram por frase (até 40 palavras; frases maiores viram orações) e o microfone em trechos de 12 a 18 palavras. O JEV classifica cada trecho numa chamada e escolhe o assunto entre os recentes ou abre um novo; em segundo plano, enquanto a reunião acontece, o modelo editorial escreve as notas e o título de cada assunto, sem botão. Correções de classificação ajustam as perguntas do JEV só nesta reunião. A transcrição aceita texto digitado e arquivo de transcrição, inclusive para continuar uma reunião concluída. Editar um bloco no canvas (duplo clique ou lápis) preserva a fala original e passa a correção para a ata como `human_summary`. Abrir uma reunião salva não grava nem reorganiza nada. A sala segue o idioma PT/EN do Norte; a fala e os textos da reunião não são traduzidos. Detalhes em [processamento das reuniões](docs/meeting-memory.md).
- **Administração:** contas, métricas opcionais e diagnóstico das reuniões às quais a administradora tem acesso. O diagnóstico mostra entradas, perguntas, classificações e memórias efetivamente registradas.

A tela de Verificação foi retirada da interface; planos e execuções já gravados continuam preservados no servidor e nos documentos de revisão. Planos comerciais, comunidade, memória de projeto, concepção, laboratório de ideias e painéis de atividade de equipe foram retirados. A limpeza explícita do ambiente de teste remove os projetos Quetzal e exemplos antigos; uma instalação nova não cria nenhum projeto.

Para instalações PostgreSQL, `node norte/scripts/retire-workspace.mjs --help` descreve a manutenção por plano e fingerprint, com backup transacional privado. O procedimento está em [arquitetura e dados](docs/architecture.md).

## IA e privacidade

Preencha `TYPESAFE_API_KEY` para classificação JEV e `GOOGLE_API_KEY` para Gemini. A configuração detalhada está em `.env.example`. Chaves ausentes não geram resultados fictícios. Os testes padrão usam provedores simulados, sem cobranças.

`#/privacy` e `#/terms` ficam disponíveis antes do cadastro. A política explica armazenamento, áudio do navegador, provedores externos e métricas opcionais. O contato público inicial é `emillyraianerodrigues@gmail.com`; `NORTE_PRIVACY_CONTROLLER`, `NORTE_PRIVACY_EMAIL` e `NORTE_HOSTING_DESCRIPTION` permitem configurar a instalação.

Métricas começam desativadas. Quando autorizadas, registram páginas, tempo ativo e funções predefinidas; não incluem textos, mensagens ou documentos. A administração vê país/região somente quando há proxy confiável configurado. Desativar solicita a exclusão dessas métricas.

## Projeto de revisão LYLE

`node norte/scripts/seed-lyle-workspace.mjs --help` prepara o caso LYLE **numa conta existente** — por padrão a administradora, com o login e a senha lidos de um arquivo privado (`NORTE_SEED_CREDENTIALS`, padrão `.runtime/norte-admin-credentials.txt`). Cria a equipe *Equipe LYLE*, o projeto Veículo Orbital LYLE com os seis subsistemas, os oito requisitos com enunciado, localização e comentários do DOCX, os arquivos de origem (DOCX, leitura e PDF de transcrições), a checagem por regras sem IA (que destaca os trechos sob revisão MTCR em cada requisito), um cronograma provisório ECSS, os rascunhos SRR derivados dos requisitos (especificação e matriz de rastreabilidade) e as três reuniões já avaliadas do PDF de transcrições. Não registra contas, não chama provedores e não sobrescreve registros editados; `--check` confere as fontes sem acessar o servidor.

Os requisitos só são gravados com `NORTE_DELIVERY_READ_ONLY` desligado: prepare o caso, depois ative o modo de leitura e reinicie. Para a publicação, use `NORTE_REVIEW_ORIGIN=https://norte-r007.onrender.com NORTE_REVIEW_PUBLISH=1`.

`node norte/scripts/seed-workspace-review.mjs --help` continua disponível para preparar o mesmo caso numa conta comum nova. Os procedimentos são explícitos e repetíveis; não rodam ao iniciar o servidor. Referências oficiais e apontamentos não equivalem à determinação de aplicabilidade ou conformidade.

## Verificar alterações

```bash
npm --prefix norte run typecheck
npm --prefix norte run lint
npm --prefix norte test
python3 -m unittest discover -s tests -p 'test_*.py'
node --test tests/*.test.cjs
npm --prefix norte run test:visual
VITE_BASE_PATH=/ npm --prefix norte run build
```

Os testes visuais usam Chrome e armazenamento temporário. A documentação de [qualidade](docs/testing.md) distingue testes determinísticos, integração e avaliação de modelos. Um teste com provedor simulado não mede precisão do modelo real.
