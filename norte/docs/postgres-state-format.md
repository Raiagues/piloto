# Persistência PostgreSQL

O estado de aplicação continua na linha `primary` de `norte_state`. A revisão e
o timestamp ficam em colunas separadas para verificar alterações sem transferir
todos os documentos. O armazenamento local em arquivo JSON não muda.

O leitor PostgreSQL aceita o JSON histórico e o envelope
`format: norte-postgres-state`, `version: 1`,
`encoding: gzip+base64+json-records`. O conteúdo descomprimido é uma sequência
de registros JSON delimitados por quebra de linha. O tamanho UTF-8 e o SHA-256
cobrem essa sequência exata, incluindo a delimitação, e não uma serialização
alternativa do objeto reconstruído. Decodificação inválida interrompe a
operação; nunca cria um estado vazio nem substitui dados danificados. A expansão
é limitada ao tamanho declarado e a 128 MiB de registros por snapshot. Esse
limite não é uma quota por projeto: documentos maiores exigem separar arquivos
do estado global.

## Publicação compatível

1. Publicar o leitor compatível, mantendo `NORTE_POSTGRES_COMPRESSION` ausente.
2. Confirmar o deploy ativo e o encerramento das instâncias anteriores.
3. Definir `NORTE_POSTGRES_COMPRESSION=1` e publicar novamente. A primeira gravação
   confirmada converte o snapshot. A inicialização por si só não o converte.

Depois da conversão, qualquer instância compatível preserva o formato comprimido,
mesmo com a variável desativada. **Não reverter para versões anteriores ao leitor
compatível**: elas não compreendem o envelope. Desativar a variável não desfaz a
conversão. Os utilitários de seed/reset também decodificam o envelope, preservam
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

## Verificação

`postgres-state-codec.test.mjs` verifica conteúdo, hashes e limites;
`postgres-compression.test.mjs` verifica publicação entre formatos, reinício,
rollback, migração de permissões e backup; `postgres-connections.test.mjs`
interrompe conexões reais de um banco local descartável. A variável
`NORTE_POSTGRES_TEST_URL` só aceita loopback e o banco `norte_test`.
