# Fluxo de transcrição e classificação

A instalação ativa usa a interface React e a API Node, com a sala em `meetings/web` e o processamento Python em `meetings/engine`. O Node autoriza o acesso à reunião e encaminha os pedidos ao Python por uma ponte assinada em loopback. O navegador não recebe chaves dos provedores.

A descrição dos dados, limites, correções e persistência está em [Reuniões: processamento, dados persistidos e validação](docs/meeting-memory.md). A configuração de áudio e suas limitações de rede estão em [Áudio das reuniões](norte/docs/meeting-audio.md).

## Executar

Na raiz do repositório:

```bash
./setup
./start --no-browser
./stop
```

O endereço padrão é `http://127.0.0.1:8000`; `PORT` altera a porta pública. O supervisor `scripts/service.py` mantém Node e Python. Não é necessário iniciar o Python separadamente nem instalar modelos locais. Consulte o [README](README.md#executar) e a [implantação integrada](DEPLOY.md).

Configure `TYPESAFE_API_KEY` no ambiente privado para JEV. O provedor ativo é `official`; `NORTE_PROVIDER=local` não é suportado. A organização editorial depende de `AI_AGENTS_ENABLED`, `AI_EXTERNAL_REVIEW_ENABLED`, provedor, credenciais e orçamento configurados. A geração de atas usa a configuração Gemini correspondente. Os nomes e limites estão em `.env.example`; nunca coloque chaves em variáveis `VITE_*`.

## Da fala aos blocos

1. A pessoa autoriza o microfone. O reconhecimento de voz do navegador produz trechos de transcrição; texto escrito também pode entrar no fluxo compartilhado.
2. A sala conserva texto original, identificadores e tempos. A segmentação separa pontos curtos e evita usar uma transcrição inteira como um único bloco.
3. O JEV filtra e classifica os trechos, associa assuntos e avalia relações com o contexto limitado da mesma reunião.
4. O LLM editorial recebe os itens classificados para propor títulos e tópicos concisos. Guardas locais e revisão crítica comparam a proposta com a fala original antes de publicá-la.
5. A pessoa revisa os blocos e as classificações. O registro versionado preserva a origem e as correções; mudanças concorrentes precisam respeitar a versão esperada.

As correções humanas contextualizam pedidos JEV seguintes dentro da mesma reunião. O LLM pode organizar a explicação de uma correção, sem alterar a classe escolhida pela pessoa. Isso não treina pesos e não recupera memória de outros projetos ou reuniões.

Quando um provedor falha ou uma sugestão não passa na validação, a interface mantém o original disponível e informa o estado real. Não transforma um erro em um resumo aprovado.

## Inspeção e recuperação

O diagnóstico `#/admin/meetings` apresenta entradas, perguntas, respostas estruturadas, latência e versões efetivamente registradas. Exige administração e acesso à reunião. Não exibe raciocínio interno do modelo nem reconstrói trilhas ausentes do histórico.

Os registros da reunião integrada ficam no armazenamento do servidor, sob autorização e controle de versão. Estado transitório do navegador não substitui esse registro. Consulte a [tabela de persistência](docs/meeting-memory.md#o-que-existe-de-fato) para distinguir transcrição, contexto de assunto, memória editorial, correções e ata.

## Verificar alterações

Na raiz, com Node.js 24.20+ e dependências instaladas:

```bash
python3 -m unittest discover -s tests -p 'test_*.py'
node --test tests/*.test.cjs
npm --prefix norte run test:visual:meetings
```

Essas suítes usam dados temporários e provedores simulados. O teste visual integrado exercita duas sessões, áudio WebRTC, participação, persistência e apresentação móvel, sem chamadas pagas de IA. Os comandos e o escopo completo estão em [Qualidade](docs/testing.md).

A qualidade do microfone e do reconhecimento de voz precisa de testes reais consentidos. Acurácia de classificação e fidelidade dos resumos exigem um conjunto rotulado separado dos exemplos usados nas correções. Aprovação do crítico LLM, HTTP 200 ou um smoke com provedor simulado não demonstram essas medidas.
