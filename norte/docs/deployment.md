# Implantação do Norte

## O que é publicado

O projeto possui dois destinos diferentes:

| Destino | Uso | Persistência | Organização remota |
| --- | --- | --- | --- |
| GitHub Pages | Demonstração e avaliação da interface | navegador de cada pessoa | análise local |
| Render + Neon | Uso real da equipe | PostgreSQL compartilhado | Gemini no servidor |

O GitHub Pages não executa Node.js, não oferece banco e não pode proteger uma chave do Gemini. Por isso ele nunca recebe segredos.

## 1. Banco no Neon

1. Entre em [console.neon.tech](https://console.neon.tech/).
2. Crie um projeto chamado `norte` na região mais próxima da equipe.
3. No botão **Connect**, selecione a conexão pooled.
4. Copie a URL iniciada por `postgresql://`.

Não coloque essa URL no GitHub, em arquivos `.env` versionados ou em capturas de tela.

## 2. Aplicação no Render

1. Abra [o Blueprint do Norte](https://render.com/deploy?repo=https://github.com/Raiagues/norte).
2. Conecte sua conta GitHub e autorize o repositório.
3. Preencha `DATABASE_URL` com a URL pooled do Neon.
4. Preencha `GEMINI_API_KEY` com a chave do Google AI Studio.
5. Revise e confirme o serviço `norte-missao`.

O arquivo [render.yaml](../render.yaml) fixa Node 24.20 LTS, verifica `/api/health` e só faz CD quando os checks do GitHub passam. O Render injeta os segredos no servidor; eles não entram no bundle do navegador.

Depois do deploy, confirme numa requisição que a extração de engenharia está configurada:

```
curl https://<seu-servico>.onrender.com/api/health
```

A resposta traz `"engineering": { "configured": true, "model": "..." }`. Se vier `false`, a variável `GEMINI_API_KEY` não chegou ao serviço: preencha em **Render > Environment** e refaça o deploy. O campo informa apenas a presença da chave, nunca o valor.

## 3. Primeiro acesso

Abra a URL HTTPS entregue pelo Render e crie a primeira conta. Ela se torna proprietária/admin. Depois use **Memória do projeto > Adicionar pessoa** para gerar convites individuais.

## Operação

- Rotacione imediatamente uma chave que tenha sido publicada por engano.
- Configure alertas de uso e cota no Gemini, Neon e Render.
- Para uso contínuo, escolha planos com política de disponibilidade e backup adequada à equipe.
- Exporte dados importantes antes de mudanças grandes e teste a restauração.
- Não use o ambiente demonstrativo do GitHub Pages para dados pessoais ou decisões reais.

## Documentos e migração de organização

O estado passa à versão 10 por migração aditiva, mantendo projetos, contas, arquivos e permissões. Não execute reset para aplicar a mudança. `DATABASE_URL` é obrigatória no Render: arquivos enviados e fontes editáveis ficam no PostgreSQL; os PDFs gerados são enviados em memória sem arquivos persistentes no serviço web. PDFKit funciona no Node e não exige Chromium ou serviço externo. Consulte [organização, permissões, presença e limites](PROJECT_ORGANIZATION.md).

### Convites e verificação de email

O estado é normalizado para schema 10 sem apagar solicitações ou documentos antigos. Configure `NORTE_PUBLIC_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, `SMTP_USER` e `SMTP_PASSWORD` somente no servidor para enviar convites/verificações. Sem SMTP, convites por nickname funcionam, e o envio por email retorna indisponibilidade explícita. Ver [fluxo, migração e limites](TEAM_COLLABORATION.md). O seed de múltiplos projetos recusa Render/produção e nunca integra build ou startup.
