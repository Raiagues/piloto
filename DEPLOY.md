# Colocar o Norte no ar — GitHub + Render + Postgres

Guia para seguir na ordem, copiando e colando. Tempo total: uns 15 minutos.

Para as novas camadas de IA, comandos naturais e dashboard, siga também [AGENTES.md](AGENTES.md). Ele inclui a configuração atual de provedores, chaves, limites e operação em segundo plano.

## O que o site faz agora

- **Login e cadastro**: qualquer pessoa cria uma conta com usuário e senha.
- **Conta comum**: vê só **Simulação de vigas** (reuniões com simulação).
- **Conta admin**: vê tudo o que já existia (Ao vivo, Manual, Automatizados, Memória, Memória V2, Reuniões e Simulação de vigas).
- **Reuniões salvas no banco (Postgres)**, separadas por conta. Entrou em outro computador, as reuniões continuam lá.
- **Chaves e senhas não ficam no código.** Você preenche tudo no painel do Render.

## 1. Separe as 3 informações secretas

| Campo no Render | O que é | Onde conseguir |
| --- | --- | --- |
| `ADMIN_PASSWORD` | Senha da conta admin (o usuário é `admin`) | Já está no seu `.env` local, na linha `ADMIN_PASSWORD=`. Ou invente uma com 8+ caracteres. |
| `TYPESAFE_API_KEY` | Chave do Jev (TypeSafe), que classifica as falas | A mesma chave que você já usa: no seu `.env` local ela está como `JEV_KEY_API=`. |
| `GOOGLE_API_KEY` | Chave do Gemini, que escreve a ata | Abra <https://aistudio.google.com/apikey> → **Create API key** → copie. Se preferir pelo Google Cloud: <https://console.cloud.google.com/apis/credentials>. Pode ser a mesma `GOOGLE_API_KEY` do seu `.env`. |

Para ver os valores do `.env` local, no terminal da pasta do projeto:

```bash
cat .env
```

> Dica de segurança (Google Cloud): em <https://console.cloud.google.com/apis/credentials>, abra a chave → **API restrictions** → **Restrict key** → marque só **Generative Language API**. Assim, se a chave vazar, ela não serve para outros serviços.

## 2. GitHub

O código já foi enviado para <https://github.com/Raiagues/piloto> (branch `main`). O arquivo `.env` e a pasta `.runtime/` **não** foram enviados (estão no `.gitignore`).

Para enviar alterações futuras (o Render atualiza o site sozinho a cada envio):

```bash
git add -A
git commit -m "Descreva a mudança"
git push
```

O repositório está **público**: qualquer pessoa pode ler o código (mas nenhuma chave está nele). Para deixar privado: <https://github.com/Raiagues/piloto/settings> → final da página (**Danger Zone**) → **Change visibility** → **Make private**. O Render funciona igual com repositório privado.

## 3. Render (site + banco de dados)

O arquivo `render.yaml` já descreve tudo: o site (`norte`) e o banco Postgres (`norte-db`). O Render lê esse arquivo e cria os dois de uma vez.

1. Crie a conta: <https://dashboard.render.com/register> → **GitHub** (entre com a conta `Raiagues`).
2. Abra <https://dashboard.render.com> → botão **New** (no topo) → **Blueprint**.
3. Se aparecer **Connect GitHub** / **Configure account**: clique, escolha **Only select repositories** → `piloto` → **Install**.
4. Na lista, ao lado de `Raiagues/piloto`, clique **Connect**.
5. **Blueprint Name**: `norte`. **Branch**: `main`.
6. O Render mostra o que vai criar: `norte` (Web Service) e `norte-db` (PostgreSQL). Mais abaixo aparecem 3 campos para preencher — cole os valores do passo 1:
   - `ADMIN_PASSWORD`
   - `TYPESAFE_API_KEY`
   - `GOOGLE_API_KEY`
7. Clique **Deploy Blueprint** (ou **Apply**). Aguarde de 3 a 5 minutos, até `norte` ficar **Live**.
8. Abra <https://dashboard.render.com> → clique em **norte** → o endereço aparece no topo (algo como `https://norte-xxxx.onrender.com`).
9. Entre com usuário **`admin`** e a senha que você colocou em `ADMIN_PASSWORD`.

Atalho para os passos 2–4: <https://render.com/deploy?repo=https://github.com/Raiagues/piloto>

### Conferir se deu certo

- Abra o endereço do site **sem estar logada** → deve aparecer a tela de login.
- Em uma janela anônima, clique **Criar conta**, crie um usuário de teste → deve aparecer **só** a Simulação de vigas.
- Entre como `admin` → aparecem todas as páginas na barra lateral.
- O microfone funciona no **Chrome** (o Render já usa HTTPS, que o navegador exige).
- **Sair** fica no canto inferior esquerdo da barra lateral.

## 4. Custos e limites do plano gratuito (leia antes de divulgar)

- **O site "dorme"** depois de 15 minutos sem acesso. O primeiro acesso depois disso demora ~1 minuto.
- **O Postgres gratuito expira 30 dias depois de criado.** Depois há 14 dias de carência e então **o banco e os dados (contas e reuniões) são apagados**. Antes disso, mude o banco para um plano pago: <https://dashboard.render.com> → **norte-db** → **Upgrade** (ou **Settings → Instance Type**). O preço aparece na tela.
- Para o site não dormir: **norte** → **Settings → Instance Type** → um plano pago.
- **Toda conta usa as suas chaves** (TypeSafe e Gemini) e consome os seus créditos. Para limitar quem pode criar conta, crie um código de convite: **norte** → **Environment** → **Add Environment Variable** → `SIGNUP_CODE` = um código qualquer → **Save, rebuild, and deploy**. A tela de cadastro passa a pedir esse código.

## 5. Tarefas do dia a dia

**Trocar a senha do admin**: **norte** → **Environment** → edite `ADMIN_PASSWORD` → **Save, rebuild, and deploy**. As sessões antigas do admin são encerradas.

**Trocar o nome do usuário admin**: edite `ADMIN_USERNAME` do mesmo jeito. A conta antiga deixa de ser admin.

**Ver erros**: **norte** → **Logs**.

**Domínio próprio** (ex.: `norte.com.br`): **norte** → **Settings → Custom Domains** → **Add Custom Domain** e siga as instruções de DNS. Depois adicione em **Environment**: `ALLOWED_HOSTS` = `norte.com.br,www.norte.com.br`.

## 6. Rodar no seu computador

```bash
./start
```

Abre <http://127.0.0.1:8000>. Entre com `admin` e a senha do `.env`. No computador o banco é um arquivo SQLite em `.runtime/norte.sqlite3` (não precisa instalar Postgres). Para encerrar: `./stop`.

Observação: as reuniões e testes que você fez antes ficaram guardados no navegador, no endereço `127.0.0.1:8000`. Eles não são copiados automaticamente para o site no Render.

## 7. Problemas comuns

| Sintoma | Causa provável | Como resolver |
| --- | --- | --- |
| "A conexão de processamento não está pronta" | `TYPESAFE_API_KEY` vazia ou errada | Corrija em **Environment** e salve. |
| Ata / PDF não gera | `GOOGLE_API_KEY` vazia, errada ou sem a Generative Language API | Gere outra chave no AI Studio e salve em **Environment**. |
| Deploy falha com "ADMIN_USERNAME/ADMIN_PASSWORD" | Senha com menos de 8 caracteres | Use uma senha maior. |
| Deploy falha no "health check" | Banco ainda criando ou fora do ar | Espere o `norte-db` ficar **Available** e clique **Manual Deploy → Deploy latest commit**. |
| Primeiro acesso muito lento | Plano gratuito dormindo | Normal; ou mude para plano pago. |
| "Sua sessão terminou" | Sessão expirou (30 dias) ou senha do admin mudou | Entre de novo pelo link que aparece. |

## Referência: variáveis de ambiente

| Variável | Obrigatória | Para que serve |
| --- | --- | --- |
| `ADMIN_PASSWORD` | Sim | Senha da conta admin. |
| `ADMIN_USERNAME` | Não (padrão `admin`) | Usuário da conta admin. |
| `TYPESAFE_API_KEY` | Sim | Chave do Jev / TypeSafe. |
| `GOOGLE_API_KEY` | Para a ata | Chave do Gemini. |
| `GEMINI_MODEL` | Não | Modelo do Gemini (padrão `gemini-3.1-pro-preview`). |
| `DATABASE_URL` | No Render, automática | Endereço do Postgres; o `render.yaml` liga sozinho. |
| `SIGNUP_CODE` | Não | Código de convite para criar conta. |
| `ALLOWED_HOSTS` | Só com domínio próprio | Domínios extras aceitos pelo site. |
| `MINUTES_CONCURRENCY` | Não (padrão 3) | Quantas atas o Gemini gera ao mesmo tempo no servidor. |
