# Persistência PostgreSQL

O estado de aplicação continua na linha `primary` de `norte_state`. A revisão e
o timestamp ficam em colunas separadas para verificar alterações sem transferir
todos os documentos. O armazenamento local em arquivo JSON não muda.

O leitor PostgreSQL aceita o JSON histórico e o envelope
`format: norte-postgres-state`, `version: 1` ou `version: 2`,
`encoding: gzip+base64+json-records`. O conteúdo descomprimido é uma sequência
de registros JSON delimitados por quebra de linha. O tamanho UTF-8 e o SHA-256
cobrem essa sequência exata, incluindo a delimitação, e não uma serialização
alternativa do objeto reconstruído. Decodificação inválida interrompe a
operação; nunca cria um estado vazio nem substitui dados danificados. A expansão
é limitada ao tamanho declarado e a 128 MiB de registros por snapshot. Esse
limite não é uma quota por projeto: documentos maiores exigem separar arquivos
do estado global.


A versão 2 registra cada string longa distinta uma única vez no fluxo. As
ocorrências seguintes apontam para uma string já concluída no mesmo snapshot.
Os identificadores são sequenciais; referências futuras, inválidas ou a objetos
são rejeitadas. Objetos e arrays são sempre reconstruídos separadamente. Além
do limite do fluxo, essa versão limita a 128 MiB a soma dos bytes UTF-8 de
todos os valores de string anexados, contando cada referência novamente. A
limitação impede multiplicar indefinidamente um texto com um fluxo pequeno.

## Publicação compatível

1. Publicar o leitor compatível, mantendo `NORTE_POSTGRES_COMPRESSION` ausente.
2. Confirmar o deploy ativo e o encerramento das instâncias anteriores.
3. Definir `NORTE_POSTGRES_COMPRESSION=1` e publicar novamente. A primeira gravação
   confirmada converte o snapshot. A inicialização por si só não o converte.

Para um banco já na versão 1, aplicar a mesma sequência antes da versão 2:

1. Publicar este leitor com `NORTE_POSTGRES_STRING_REFS` ausente. A compressão
   existente continua ativada.
2. Confirmar o encerramento de todas as instâncias que só leem a versão 1.
3. Definir `NORTE_POSTGRES_STRING_REFS=1` e publicar. A próxima gravação confirmada
   passa a usar referências de strings.

Depois da conversão, qualquer instância compatível preserva o formato comprimido,
mesmo com a variável desativada. **Não reverter para versões anteriores ao leitor
compatível**: elas não compreendem o envelope. Desativar a variável não desfaz a
conversão. Uma linha na versão 2 também permanece nessa versão se a flag de
referências estiver desativada; não voltar a um leitor que só suporta a versão 1.
Os utilitários de seed/reset também decodificam o envelope, preservam
o formato e produzem backups JSON completos; suas guardas de execução continuam
obrigatórias. Esses utilitários não são executados no início da aplicação.

Compressão e descompressão usam o pool de trabalho do Node. Strings são
segmentadas, os registros são analisados individualmente com `JSON.parse` e os
objetos são reconstruídos com propriedades próprias. Isso evita uma segunda
string JSON descomprimida do tamanho de todo o estado. Ainda há memória
proporcional ao objeto reconstruído e ao envelope comprimido. Strings longas
iguais compartilham o mesmo valor imutável apenas durante uma decodificação;
objetos e arrays permanecem independentes. A tabela temporária de strings é
liberada ao concluir a leitura. Gzip usa nível 1 para reduzir custo de CPU. A
compressão evita enviar repetidamente um parâmetro SQL muito grande, mas não
substitui a futura separação de arquivos e dados por projeto.

As transações continuam protegidas por `SELECT FOR UPDATE`. O cache só recebe a
nova versão após COMMIT confirmado. Conexões interrompidas são descartadas;
gravações e COMMIT de resultado incerto não são repetidos automaticamente. A
verificação de saúde continua consultando o banco, fora da fila de documentos.

A presença evita regravar todo o estado quando login ou heartbeat já gravaram
um horário há menos de 25 segundos. Na demonstração, esse atalho também exige
o cookie correto e retenção renovada nessa janela. Ausência de cookie ou
retenção antiga mantém a renovação normal. Autenticação e CSRF continuam
obrigatórios. O cliente não sobrepõe heartbeats da mesma aba.

## Verificação

`postgres-state-codec.test.mjs` verifica conteúdo, hashes e limites;
`postgres-compression.test.mjs` verifica publicação entre formatos, reinício,
rollback, migração de permissões e backup; `postgres-connections.test.mjs`
interrompe conexões reais de um banco local descartável. A variável
`NORTE_POSTGRES_TEST_URL` só aceita loopback e o banco `norte_test`.
