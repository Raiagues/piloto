# Segurança do Norte

## Implementado

- senhas com Argon2id (`19 MiB`, 2 iterações, paralelismo 1);
- frases-senha de pelo menos 15 caracteres, sem regras artificiais de composição;
- sessão opaca de 256 bits armazenada apenas como hash;
- cookie `HttpOnly`, `SameSite=Strict` e `Secure` em produção;
- token CSRF para todas as alterações autenticadas;
- convites de uso único com validade de 7 dias;
- limitação de tentativas em cadastro, login e organização remota;
- JSON Schema, limite de requisição e cabeçalhos Helmet;
- papéis distintos para acesso, função na equipe e área técnica;
- redação de senhas, cookies e cabeçalhos de autorização nos logs;
- PostgreSQL com transações e bloqueio de escrita concorrente;
- frontend, API e cookies no mesmo domínio em produção;
- chave do Gemini usada somente no servidor;
- CI com testes, lint, tipagem, npm audit, scanner de segredos e CodeQL;
- GitHub Actions oficiais fixadas por SHA imutável.

## Dados enviados à organização remota

Quando a organização remota está ativa, o Norte envia ao Gemini somente o conteúdo necessário do mapa: textos das ideias, posições aproximadas, relações, estados e memória curta das ações da equipe. Senhas, cookies, códigos de convite e perfis dos membros não fazem parte desse pedido.

A liderança deve informar a equipe sobre esse processamento e evitar inserir dados pessoais, segredos industriais ou credenciais nos cartões.

## Limitações antes de uso institucional

Esta base é adequada para piloto controlado. Antes de uma adoção institucional ou tratamento de dados sensíveis:

1. adicionar verificação de e-mail, recuperação de senha e MFA para administradores;
2. definir backups automáticos, retenção, exportação e teste periódico de restauração;
3. contratar disponibilidade compatível com a operação e monitorar erros e uso;
4. realizar revisão independente de segurança, privacidade e autorização;
5. publicar termos, aviso de privacidade e canal responsável por solicitações de dados;
6. separar equipes em tenants antes de atender mais de uma organização no mesmo serviço;
7. substituir o documento JSONB compartilhado por tabelas normalizadas se houver edição simultânea intensa.

O cadastro evita CPF, RG, endereço, data de nascimento e anexos pessoais porque esses dados não são necessários para colaborar na missão.
