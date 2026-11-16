# Publicar a Lola (Supabase + GitHub + Render)

> **Já usa o Agenda Expert publicado?** Vá direto para [Atualizar do Agenda Expert para a Lola](#atualizar-do-agenda-expert-para-a-lola). Os dados atuais são preservados.

- **Supabase:** guarda o **banco de dados** online, de graça. Clientes, agendamentos, financeiro e a conexão do WhatsApp ficam lá, **sempre salvos**.
- **GitHub:** guarda o código do app.
- **Render:** roda o site e o sistema num endereço **https://…**, que as clientes instalam no celular.

---

## 1. Criar o banco de dados no Supabase

1. Entre em <https://supabase.com> e crie uma conta (pode ser com o GitHub).
2. Clique em **New project** e preencha:
   - **Name:** `agenda-expert`
   - **Database Password:** clique em **Generate a password** e **copie e guarde** essa senha. Ela vai ser usada no passo 3.
   - **Region:** **South America (São Paulo)**
   - **Plan:** Free
3. Clique em **Create new project** e espere uns 2 minutos.

### Criar as tabelas

O app cria as tabelas sozinho na primeira vez que liga. Se preferir criar antes ou conferir:

1. No Supabase, abra **SQL Editor → New query**.
2. Cole todo o conteúdo do arquivo [`supabase/schema.sql`](supabase/schema.sql) e clique em **Run**.

Pode rodar quantas vezes quiser: ele **não apaga nada**.

> 🔒 **Segurança (LGPD):** o arquivo liga a proteção **RLS** em todas as tabelas. Com ela, os dados **não ficam acessíveis pela API pública** do Supabase, nem com a chave "anon". Só o servidor do app lê e grava. Por isso o app **não usa** as chaves `anon`/`service_role`: ele usa só a connection string do passo 3.

### Pegar a connection string

1. No topo do projeto no Supabase, clique em **Connect**.
2. Escolha **Connection string → Session pooler**. O pooler é necessário porque o Render só usa IPv4.
3. Copie o endereço. Ele é parecido com este:
   ```
   postgresql://postgres.abcdefghijk:[YOUR-PASSWORD]@aws-0-sa-east-1.pooler.supabase.com:5432/postgres
   ```
4. Troque `[YOUR-PASSWORD]` pela senha do banco que você guardou no passo 2. Tire também os colchetes.

> Se a senha tiver símbolos como `@ # / ? %`, gere outra só com letras e números em **Project Settings → Database → Reset database password**. Esses símbolos atrapalham o endereço.

**Não mande essa connection string para ninguém, nem no chat.** Ela vai direto no Render, no passo 3.

---

## 2. Subir o código para o GitHub

O repositório deve ser **privado**. O `.gitignore` já impede que o `.env` (com senhas) e a pasta `data/` sejam enviados.

### Com o GitHub Desktop (mais fácil)

1. **File → Add local repository** e escolha a pasta do projeto.
2. Escreva uma mensagem, como "Banco de dados Supabase", e clique em **Commit to main**.
3. Clique em **Publish repository** (ou **Push origin**, se já tinha publicado) e deixe **Keep this code private** marcado.

### Pelo terminal

```bash
git add .
```

```bash
git commit -m "Banco de dados Supabase"
```

```bash
git push
```

---

## 3. Criar o serviço no Render

1. Entre em <https://dashboard.render.com> com a sua conta do GitHub.
2. Clique em **New + → Blueprint** e escolha o repositório **agenda-expert**. O Render lê o `render.yaml` sozinho.
3. Ele vai pedir três variáveis:

| Variável | Valor |
|---|---|
| `PLATFORM_EMAIL` | **o seu e-mail** de acesso ao painel do proprietário (`/admin`) |
| `PLATFORM_PASSWORD` | uma senha forte, com pelo menos 8 caracteres |
| `ADMIN_EMAIL` | e-mail da empresa nº 1, o estúdio original (pode ficar em branco numa instalação nova) |
| `ADMIN_PASSWORD` | senha da empresa nº 1 (8+ caracteres; em branco se `ADMIN_EMAIL` estiver em branco) |
| `DATABASE_URL` | a **connection string** do Supabase (passo 1) |
| `PUBLIC_URL` | o endereço do site, ex.: `https://lola.onrender.com` |

4. Clique em **Apply**.

> **Já tinha criado o serviço antes?** Abra o serviço no Render, vá em **Environment**, adicione `DATABASE_URL` e clique em **Save Changes**. Se você usa Docker, o `Dockerfile` também já está pronto.

A publicação leva uns 2 minutos. Em **Logs** deve aparecer:

```
✓ Banco de dados online conectado (Postgres/Supabase)
```

### Conferir que está salvando

1. Abra `https://SEU-APP/app/`, entre e veja **Mais**: tem que aparecer **"Dados salvos online ✓"**.
2. Cadastre uma cliente de teste.
3. No Render, clique em **Manual Deploy → Restart service**.
4. Abra o app de novo: **a cliente tem que continuar lá**. No Supabase, em **Table Editor → clients**, ela também aparece.

Se aparecer um **aviso vermelho** no topo das telas, o app não está usando o Supabase. Confira a `DATABASE_URL`.

---

## 4. Instalar no iPhone

1. Abra `https://SEU-APP/app/` no **Safari** e faça o login.
2. Toque em **Compartilhar** e depois em **Adicionar à Tela de Início**.

No Android, abra no **Chrome** e toque em **⋮ → Instalar aplicativo**. O próprio sistema mostra o passo a passo em **Mais → Instalar no celular**.

## 5. Conectar o WhatsApp (robô de confirmação)

1. No app, abra **Mais → WhatsApp** (tem o botão **▶ Tutorial**).
2. Conecte de um dos dois jeitos:
   - **Pelo computador:** escaneie o QR code.
   - **Pelo próprio iPhone:** use **Conectar com número**.
3. Ligue o **envio automático**.

A conexão fica guardada **no Supabase**, então continua ativa depois de reinícios.

---

## Trocar o e-mail ou a senha de acesso

1. No Render, vá em **Environment** e edite `ADMIN_EMAIL` e/ou `ADMIN_PASSWORD`.
2. Clique em **Save Changes**. O app reinicia com o novo acesso, e quem estava conectado precisa entrar de novo.

Se a senha estiver vazia ou tiver menos de 8 caracteres, o app **não sobe** e mostra o motivo em **Logs**.

## Plano Free do Render: o servidor "dorme"

Os dados ficam no Supabase, então **nada se perde**. Mas depois de 15 minutos sem uso, o servidor do Render desliga sozinho:

- a primeira abertura depois disso leva cerca de 1 minuto;
- enquanto ele dorme, o robô do WhatsApp não envia mensagens.

Para manter acordado de graça, crie um monitor em <https://uptimerobot.com> que acessa `https://SEU-APP.onrender.com/api/health` a cada 5 minutos.

## Cópias de segurança

| Tipo | Onde fica |
|---|---|
| Banco de dados | No **Supabase**, que tem os próprios backups. |
| Arquivo com todos os dados | No app, em **Mais → Baixar cópia de segurança**. Vale guardar uma vez por mês no iCloud ou no Drive. |
| Restaurar uma cópia | No computador, com a `DATABASE_URL` no `.env`: `npm run restaurar -- arquivo.json` |

## Se algo der errado

- **`✖ Não foi possível conectar ao banco de dados`** nos Logs: a `DATABASE_URL` está errada. Os erros mais comuns são:
  - a senha ainda está como `[YOUR-PASSWORD]`;
  - a senha tem símbolos;
  - foi usada a conexão "Direct" em vez de **Session pooler**.
- **`✖ Defina ADMIN_EMAIL e ADMIN_PASSWORD`** nos Logs: faltam essas variáveis, ou a senha é curta.
- **O projeto do Supabase foi pausado:** no plano Free, o Supabase pausa projetos sem uso por cerca de uma semana. É só entrar no painel e clicar em **Restore project**. Os dados continuam lá. Com o UptimeRobot acessando o app a cada 5 minutos, isso não acontece.


---

## Atualizar do Agenda Expert para a Lola

A atualização é feita **sobre o mesmo banco do Supabase**, sem apagar nada.

1. **Antes de tudo, faça uma cópia:** na versão antiga, abra **Mais → Baixar cópia de segurança** e guarde o arquivo. O Supabase também tem os próprios backups.
2. **Troque a senha do banco no Supabase.** O arquivo `.env` do projeto antigo veio com a senha real dentro; por segurança, gere outra em **Project Settings → Database → Reset database password** e atualize a `DATABASE_URL` no Render. O `.env` **não** vai no ZIP da Lola.
3. Substitua os arquivos do repositório pelos da Lola e envie para o GitHub: commit e push.
4. No Render, em **Environment**, **acrescente**:
   - `PLATFORM_EMAIL` e `PLATFORM_PASSWORD` (o seu acesso ao `/admin`);
   - `PUBLIC_URL` (o endereço do site).

   Mantenha `ADMIN_EMAIL`, `ADMIN_PASSWORD` e `DATABASE_URL` como estão.
5. O Render publica sozinho. Nos **Logs** deve aparecer:
   ```
   ✓ Dados anteriores à Lola ligados à empresa nº 1 (nada foi apagado).
   ```
   Essa linha só aparece na primeira vez.
6. Confira:
   - `https://SEU-APP/app/` → entre com o acesso antigo (ADMIN_*). Clientes, agenda e financeiro devem estar lá.
   - `https://SEU-APP/admin/` → entre com PLATFORM_*. A empresa nº 1 aparece como **Ativa (sem vencimento)**.
   - O ícone já instalado no iPhone continua funcionando: o endereço antigo leva direto ao sistema.
7. Reconecte o WhatsApp se ele pedir. A sessão é copiada, mas o WhatsApp pode exigir um novo pareamento.

Se algo der errado, publique de novo a versão anterior no Render (**Manual Deploy → Deploy a specific commit**). As tabelas novas não atrapalham a versão antiga, e a cópia baixada no passo 1 pode ser restaurada com `npm run restaurar -- arquivo.json`.

## Domínio próprio (ex.: seudominio.com.br)

1. Registre o domínio (registro.br).
2. No Render: **Settings → Custom Domains → Add**. O Render mostra o registro DNS que você precisa criar.
3. No registro.br, crie o registro indicado (CNAME para `www` ou ALIAS/A para o domínio raiz).
4. Depois que o HTTPS ficar ativo, atualize `PUBLIC_URL` para o novo endereço.

## Para vender: recomendações de hospedagem

- **Plano do Render:** o plano Free "dorme" depois de 15 minutos sem uso. A primeira visita ao site depois disso demora cerca de 1 minuto, o que é ruim para quem chega por um anúncio, e o robô do WhatsApp para enquanto o servidor dorme. Para vender, use pelo menos o plano **Starter** do Render.
- **WhatsApp de várias empresas:** cada empresa que conecta o WhatsApp mantém uma conexão aberta no servidor e usa memória. Com muitas empresas conectadas, aumente o plano do servidor.
- **Supabase:** o plano Free pausa projetos sem uso. Com o site recebendo visitas isso não acontece, mas para produção considere o plano Pro, que inclui backups diários com restauração por data.

## E-mail de recuperação de senha (opcional)

Sem configuração, a recuperação de senha passa pelo WhatsApp: a cliente toca em **Esqueci minha senha**, chama você, e você gera o link em **/admin → Empresas → Link de senha**.

Para mandar por e-mail automaticamente:

1. Crie uma conta na [Resend](https://resend.com) e valide o seu domínio.
2. Defina no Render `RESEND_API_KEY` e `MAIL_FROM` (ex.: `Lola <nao-responda@seudominio.com.br>`), e confira `PUBLIC_URL`.
