# Segurança e LGPD na Lola

## O que o sistema faz

| Item | Como |
|---|---|
| Isolamento entre empresas | Toda consulta de dados filtra pela empresa da sessão (`company_id`), **no servidor**. Ids de outra empresa respondem "não encontrado". Coberto por testes automáticos (`test/saas.test.js`). |
| Perfis | O proprietário (`/admin`) não acessa dados das clientes das empresas; as empresas não acessam o `/admin`. |
| Senhas | Hash scrypt com sal aleatório, nunca em texto. Limite de tentativas de login por IP. |
| Sessões | Cookie `HttpOnly`, `SameSite=Strict` e `Secure` em produção, com validade de 30 dias. Trocar a senha encerra as outras sessões. |
| Recuperação de senha | Token aleatório de uso único com validade de 2 h por e-mail e 24 h por link do admin; só o hash fica no banco. A resposta não revela se o e-mail existe. |
| Cabeçalhos | CSP restrita a `'self'`, `X-Frame-Options: DENY`, `nosniff`, HSTS em produção e proteção contra requisições de outros sites (CSRF). |
| Supabase | RLS ligado em **todas** as tabelas, sem nenhuma política: a API pública do Supabase não expõe nada. |
| Chaves secretas | Só em variáveis de ambiente. `.env` fica fora do Git e do ZIP. |
| Terceiros | Fontes servidas pelo próprio app (sem Google Fonts); nenhum script de rastreamento. |
| Backups | Diário no servidor (últimos 30) + Supabase + download pela própria empresa. Restauração testada (`npm run restaurar`). |
| Assinatura vencida | Mantém consulta e download dos dados (portabilidade), bloqueando só as alterações. |

## Checklist antes de vender

- [ ] Trocar a senha do banco do Supabase (o `.env` antigo continha a senha real).
- [ ] Completar a Política de Privacidade e os Termos com razão social, CNPJ e e-mail do encarregado, e revisar com um advogado (`public/privacidade/` e `public/termos/`).
- [ ] Usar HTTPS (o Render já fornece) e `NODE_ENV=production`.
- [ ] Senhas fortes em `PLATFORM_PASSWORD` e `ADMIN_PASSWORD`.
- [ ] Baixar periodicamente a cópia da plataforma (`data/backups/`) ou confiar nos backups do Supabase Pro.
- [ ] Orientar as clientes: a ficha de anamnese contém dados de saúde e deve ter o termo aceito.
