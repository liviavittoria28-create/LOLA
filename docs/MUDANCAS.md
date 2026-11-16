# Do Agenda Expert à Lola — o que mudou

## Preservado (nenhuma função removida)

Tudo continua funcionando como antes:

- agenda (dia, semana, mês e ano) e bloqueios;
- clientes, anamnese e termo de consentimento;
- catálogo com preço congelado no agendamento;
- financeiro com CSV e PDF;
- estoque;
- robô e mensagem pronta do WhatsApp;
- backup diário e download;
- PWA com uso offline;
- tutorial do WhatsApp;
- os 81 testes originais (adaptados, todos passando).

Os dados existentes viram a empresa nº 1, e o acesso `ADMIN_EMAIL`/`ADMIN_PASSWORD` continua igual.

## Servidor (SaaS)

| Arquivo | Mudança |
|---|---|
| `supabase/schema.sql` | Tabelas `companies`, `payments`, `password_resets`, `company_settings` e `wa_sessions`; coluna `company_id` e índices; RLS nas tabelas novas. Só acrescenta. |
| `server/db.js` | Migração automática dos dados antigos (`migrateLegacy`), ajustes por empresa e catálogo inicial só para a empresa original. |
| `server/saas.js` (novo) | Regras do teste grátis, vencimento e acesso; criação de empresas. |
| `server/api.js` | Todas as consultas filtradas pela empresa da sessão; cadastro, recuperação e troca de senha, relatórios, painel do dia ampliado, backup por empresa e rotas do `/admin`. |
| `server/index.js` | Perfis (empresa × proprietário), bloqueio de alterações com assinatura vencida (402), `PLATFORM_*`, páginas públicas, 404 e CSP só com o próprio domínio. |
| `server/whatsapp.js` | Uma conexão por empresa (cada uma conecta o próprio número). |
| `server/mail.js` (novo) | E-mail de recuperação opcional (Resend). |
| `server/scripts.js` | Restaura a cópia da plataforma, a cópia de uma empresa ou a cópia do Agenda Expert. |

## Interface

| Arquivo | Mudança |
|---|---|
| `public/index.html` | **Site comercial Lola** (antes era o app). |
| `public/app/index.html` | O sistema agora fica em `/app/`. O endereço antigo leva para lá sozinho. |
| `public/admin/`, `public/js/admin.js` | Painel do proprietário. |
| `public/cadastro/`, `entrar/`, `esqueci-senha/`, `redefinir-senha/`, `privacidade/`, `termos/`, `404.html` | Páginas públicas. |
| `public/css/app.css` | Nova identidade (blush, rosa queimado, nude, champagne, dourado), menu lateral no computador, tabelas, painel, relatórios e rótulos sem caixa-alta. |
| `public/css/site.css`, `public/site/` | Estilo, scripts, imagens reais e vídeo do site. |
| `public/css/fonts.css`, `public/fonts/` | Bodoni Moda + Manrope hospedadas no próprio app (licença OFL). |
| `public/js/views/dashboard.js`, `reports.js` (novos) | Painel e Relatórios. |
| `public/js/views/*.js` | Tabelas com busca, filtros e paginação (clientes, financeiro, serviços, estoque); Mais reorganizado; Minha conta; nome e endereço do espaço nos Ajustes; instalação no Android. |
| `public/manifest.webmanifest`, `public/sw.js`, `public/icons/` | PWA Lola (ícone com monograma, ícone *maskable*, `start_url` em `/app/`). |

## Ferramentas novas

- `scripts/demo-seed.js`: cria a empresa de demonstração.
- `scripts/site-shots.js`: tira os prints do site.
- `scripts/demo-video.js`: grava o vídeo 9:16.
- `scripts/e2e.js`: teste no navegador.
- `scripts/cdp.js`: controle do Chrome usado pelos três anteriores.
- `test/saas.test.js`: testes do SaaS.
- `test/fixtures/agenda-expert-v1-schema.sql`: banco antigo, para testar a migração.

## Pasta `legado/`

Arquivos do projeto original mantidos para referência:

- `Agenda-Expert-publicar.zip`: pacote antigo de publicação;
- `Tutorial-WhatsApp-Agenda-Expert.mp4`: vídeo antigo do tutorial, com o visual anterior.

O `.env` original **não** foi incluído porque continha a senha do banco.
