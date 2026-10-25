# Implantação integrada

O `Dockerfile` da raiz compila o React e instala dependências Node de produção e Python. O launcher inicia Node na porta pública `PORT` e o motor de reunião em loopback. `render.yaml` define o serviço existente e seu PostgreSQL. Não há provisionamento de dados demonstrativos nem download de modelos locais no build.

## Configuração

- `DATABASE_URL`: armazenamento persistente obrigatório no Render. Não use JSON/SQLite efêmeros como banco de produção.
- `NORTE_MEETING_BRIDGE_SECRET`: segredo persistente de pelo menos 32 caracteres para a ponte assinada.
- `NORTE_BOOTSTRAP_TOKEN`: segredo privado para criar a primeira administração em produção. Cadastros públicos continuam contas comuns.
- `NORTE_ADMIN_ENCRYPTION_KEY`: chave estável para TOTP; ausente, usa o segredo da ponte. Preserve-a após inscrever o autenticador.
- `TYPESAFE_API_KEY`: classificação de trechos de reunião.
- `GOOGLE_API_KEY` ou `GEMINI_API_KEY`: análise solicitada, organização editorial e atas, conforme os controles `AI_*`.
- `NORTE_PRIVACY_CONTROLLER`, `NORTE_PRIVACY_EMAIL`, `NORTE_HOSTING_DESCRIPTION`: identificação pública, contato e descrição da hospedagem.
- `NORTE_TURN_URLS` e `NORTE_TURN_SECRET`: relay de áudio entre redes que exigem TURN.

As tarifas e os limites em `.env.example` são configuração do operador. Confira o contrato do modelo antes de habilitar chamadas. Uma credencial configurada não demonstra saldo disponível nem sucesso de inferência.

As métricas geográficas são opcionais. Um proxy confiável deve remover os headers fornecidos pelo cliente e adicionar `x-norte-geo-token`, `x-norte-country` e, se disponível, `x-norte-region`. O token corresponde a `NORTE_GEO_HEADER_SECRET`. Sem essa origem, a interface informa localização indisponível; não usa GPS.

## Processo

1. Execute testes e build com Node 24.20+.
2. Faça backup do PostgreSQL e preserve as chaves de sessão/administração. Se migrar dados locais, pare os serviços antes da cópia.
3. Revise o diff do Blueprint e valide seu schema. Não renomeie banco, região ou serviço como parte de uma atualização de código.
4. Publique o commit e aplique a configuração pelo fluxo da instalação.
5. Verifique `/api/health`, cadastro/login, permissões, um documento e uma reunião antes de liberar o uso.

Editar um Blueprint local não altera o serviço remoto. A [documentação do Render](https://render.com/docs/blueprint-spec#setting-environment-variables) esclarece que variáveis omitidas continuam no serviço; retirar uma opção do arquivo não apaga automaticamente o valor remoto. Variáveis dos módulos aposentados não têm consumidores no código novo.

`norte/render.yaml` é uma configuração anterior para executar apenas Node. A instalação com reuniões usa o Blueprint da raiz; não sincronize ambos sobre o mesmo serviço.

## Reuniões históricas locais

O comando abaixo apenas apresenta a migração planejada:

```bash
node norte/scripts/archive-legacy-meetings.mjs \
  --store .runtime/norte-data.json \
  --evidence-db .runtime/evidence.sqlite3 \
  --meeting-db .runtime/norte.sqlite3
```

Depois de parar a instalação e conferir o resultado, `--apply` produz backup e publica o arquivo convertido. Os bancos de origem permanecem intactos. Esse comando aceita JSON/SQLite locais; instalações PostgreSQL precisam de migração específica, sem tratar uma exportação antiga como estado corrente.
