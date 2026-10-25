# Dados de revisão

Os originais e o manifesto de requisitos ficam localmente em `novo_teste/projeto/requirements.json`, fora do Git e da imagem Docker. O manifesto inclui o hash do documento fornecido; não é carregado automaticamente pelo aplicativo. Ele não está disponível em um clone público.

Use `node norte/scripts/seed-workspace-review.mjs --check` para conferir integridade e `--help` para o preparo explícito. Nenhum participante fictício, resultado de ensaio ou aprovação é criado.

Os smokes públicos usam `norte/scripts/visual-fixtures.mjs`, com dados genéricos independentes desses originais.
