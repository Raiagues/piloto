# Overleaf local e exportação LaTeX

O Norte exporta a versão salva de um documento como projeto LaTeX. O ZIP contém `main.tex`, o Markdown original, metadados de versão e instruções. O compilador previsto é **pdfLaTeX**. A revisão e a aprovação vigentes continuam no Norte; editar a cópia não altera o documento de origem.

## Iniciar o editor local

```bash
python3 scripts/prepare_overleaf.py
docker compose --profile overleaf up --build -d overleaf
```

Abra [localhost:8081/launchpad](http://localhost:8081/launchpad) para configurar a primeira conta. Não há conta, senha ou documento de exemplo criado automaticamente. O perfil usa Overleaf Community Edition 6.3.2, MongoDB 8.0 com replica set e Redis 6.2.

O primeiro comando cria uma única vez o segredo de convites exigido pela imagem oficial, em `.runtime/overleaf.env`, com permissão `0600`. Execuções seguintes preservam o valor. Esse arquivo não deve ser publicado nem substituído em upgrades; a troca invalida convites existentes. O `.env` do Norte não é alterado.

`docker/overleaf/Dockerfile` estende a imagem oficial apenas com `booktabs` e `xcolor`, ausentes na instalação mínima e necessários à exportação do Norte. Os demais pacotes usados pelo exportador já vêm na imagem. Não é instalada a distribuição TeX completa. Ao atualizar a imagem, confira também a versão do TeX Live e o repositório compatível, conforme a documentação oficial abaixo.

A porta HTTP fica em `127.0.0.1:8081`; MongoDB e Redis não publicam portas no host. O socket Docker não é montado. O editor local atende pessoas confiáveis: a edição Community não oferece o isolamento de compilação por contêiner do Server Pro. A configuração não desativa recursos de isolamento do Docker nem amplia o acesso de rede.

Os volumes `overleaf-data`, `overleaf-mongo` e `overleaf-redis` persistem projetos, contas e estado. Para interromper somente o editor e seus serviços, conservando os dados:

```bash
docker compose --profile overleaf stop overleaf overleaf-mongo overleaf-redis
```

## Levar um documento ao editor

No Norte, abra o documento, salve sua versão e baixe **LaTeX ZIP**. No Overleaf local, importe o ZIP como novo projeto e compile `main.tex` com pdfLaTeX. A importação é uma cópia; não existe sincronização automática com o Norte.

O botão **Enviar cópia ao Overleaf** tem outro destino, informado na interface: `overleaf.com`. Ele só envia após clique explícito e usa o importador oficial por POST. Não publica uma URL do documento nem transfere dados ao editor local automaticamente.

## Verificar a instalação

Com o perfil local iniciado, Node 24 e Poppler disponíveis:

```bash
node norte/scripts/check-overleaf-export.mjs
```

Esse teste consulta o launchpad, gera um ZIP com texto genérico, compila duas vezes dentro do contêiner com `-no-shell-escape` e confere o PDF com `pdftotext`. Abrange tabelas, acentos, caracteres reservados e os símbolos `≥ ≤ ° ±`. Não cria usuários nem usa documentos reais. As fontes, o PDF e os logs ficam em `novo_teste/resultados/infra/overleaf`, fora dos artefatos publicados.

Para apenas gerar o ZIP de teste, sem depender do serviço iniciado:

```bash
node norte/scripts/check-overleaf-export.mjs --prepare-only
```

## Referências oficiais

- [Toolkit — instalação local](https://github.com/overleaf/toolkit/blob/master/doc/quick-start-guide.md).
- [Toolkit — pacotes TeX Live na Community Edition](https://github.com/overleaf/toolkit/blob/master/doc/ce-upgrading-texlive.md). A imagem inclui um conjunto mínimo; pacotes adicionais devem acompanhar a versão do TeX Live presente na imagem.
- [API de importação de projetos no Overleaf](https://www.overleaf.com/devs).
