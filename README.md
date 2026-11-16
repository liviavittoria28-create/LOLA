# Lola

Plataforma SaaS de gestão para salões de beleza, clínicas de estética, manicures, cabeleireiras e profissionais da beleza: agenda, clientes, anamnese, serviços, financeiro, estoque, relatórios e confirmação pelo WhatsApp.

A Lola é a evolução do **Agenda Expert**. Todas as funções originais foram mantidas, e o sistema passou a atender várias empresas, cada uma com os próprios dados. Os dados do estúdio original continuam guardados como a **empresa nº 1**.

| Endereço | O que é |
|---|---|
| `/` | Site comercial (página de vendas) com planos, demonstração e WhatsApp |
| `/cadastro/` | Teste grátis de 15 dias, sem cartão |
| `/entrar/` · `/esqueci-senha/` · `/redefinir-senha/` | Acesso das clientes da Lola |
| `/app/` | Sistema interno (PWA instalável no celular) |
| `/admin/` | Painel do proprietário da plataforma: empresas, testes, assinaturas, pagamentos e receita |
| `/privacidade/` · `/termos/` | Política de Privacidade e Termos de Uso (modelos para revisar) |
| `/tutorial/` | Tutorial do robô do WhatsApp |

## Tecnologia

- **Back-end:** Node.js 22.13 ou mais novo, com API própria e sem framework (`server/`).
- **Banco:** Postgres no **Supabase**, pela variável `DATABASE_URL`. Sem ela, o app usa um Postgres embutido (PGlite) em `data/`. Tabelas em [`supabase/schema.sql`](supabase/schema.sql).
- **Front-end:** HTML, CSS e JavaScript puro (`public/`), com service worker para uso offline.
- **Visual:** rosa blush, rosa queimado, nude, champagne, branco e dourado suave. As fontes Bodoni Moda e Manrope ficam hospedadas no próprio app, sem Google Fonts.

## Como rodar no computador

```bash
cp .env.example .env      # preencha PLATFORM_EMAIL/PLATFORM_PASSWORD (e ADMIN_*, DATABASE_URL se usar)
npm install
npm start                 # http://localhost:5173
```

- Site: <http://localhost:5173/>
- Sistema: <http://localhost:5173/app/>
- Painel do proprietário: <http://localhost:5173/admin/>, com `PLATFORM_EMAIL` e `PLATFORM_PASSWORD`.

### Quem é quem (acessos)

| Variáveis | Acesso |
|---|---|
| `PLATFORM_EMAIL` / `PLATFORM_PASSWORD` | **Você**, proprietária da plataforma. Entra em `/admin/`. Não enxerga clientes, fichas nem financeiro das empresas. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Dona da **empresa nº 1**, o estúdio original. Funciona como no Agenda Expert: mudou a variável e reiniciou, o acesso muda. |
| Cadastro pelo site ou pelo `/admin` | Demais empresas. Cada dona troca a própria senha em **Mais → Minha conta**. |

Em produção (`NODE_ENV=production`) o servidor só sobe se houver ao menos um dos pares acima válido (senha com 8+ caracteres).

### Empresa de demonstração (para mostrar o sistema)

```bash
npm run demo -- http://localhost:5173          # cria "Studio Aurora Beauty" com dados fictícios
# acesso: demo@lola.test / LolaDemo2026
```

## Como funciona a venda

1. A visitante conhece a Lola no site e cria a conta grátis em `/cadastro/`. São 15 dias, sem cartão.
2. Os botões comerciais abrem o seu WhatsApp, **(11) 96282-2060**, já com uma mensagem pronta:
   - Quero conhecer o sistema
   - Quero contratar
   - Tenho dúvidas
   - Quero começar meu teste grátis
3. Você combina o pagamento pelo WhatsApp e, em **/admin → Empresas → Registrar pagamento**, lança o valor recebido. A assinatura fica ativa até o fim do período pago.
4. Para quem prefere que você crie a conta: **/admin → Nova empresa** gera um link para a cliente criar a própria senha. É só enviar pelo WhatsApp.

Não há checkout nem cobrança automática. Para ligar um meio de pagamento recorrente no futuro, veja [docs/PAGAMENTOS-RECORRENTES.md](docs/PAGAMENTOS-RECORRENTES.md).

**Assinatura vencida ou suspensa:** a empresa continua entrando, consultando tudo e baixando a cópia de segurança. Só as alterações ficam bloqueadas, e o bloqueio é feito no servidor. Ela vê o botão para renovar pelo WhatsApp.

## Funcionalidades do sistema (todas as do Agenda Expert + novas)

- **Painel** (novo): atendimentos de hoje, previsto, saldo do mês, próximos 7 dias, avisos (estoque baixo, anamnese pendente, pedidos para remarcar, confirmações), aniversariantes e primeiros passos.
- **Agenda:** dia, semana, mês e ano; conflitos e próximo horário livre; bloqueios; status com cores.
- **Clientes:** tabela com busca, filtro de anamnese e paginação; ficha, anamnese com termo de consentimento, histórico, total gasto e inativação.
- **Serviços:** catálogo com preço e duração; o preço fica congelado no agendamento.
- **Financeiro:** entradas e saídas, filtros, categorias, exportação CSV (Excel) e PDF.
- **Relatórios** (novo): faturamento, resultado, ticket médio, gráfico mensal, serviços mais feitos, clientes que mais investiram, situação dos atendimentos e formas de pagamento.
- **Estoque:** quantidade mínima, entradas e saídas, filtro de abaixo do mínimo.
- **WhatsApp:** mensagem pronta com um toque e robô de confirmação. Agora **cada empresa conecta o próprio número**.
- **Backup:** diário no servidor (`data/backups/lola-AAAA-MM-DD.json`, todas as empresas) e download pela própria empresa (só os dados dela).
- **PWA:** instalação no iPhone e no Android, com consulta da agenda offline.

No celular, as tabelas viram cartões, o menu fica na barra inferior e os botões são grandes. No computador, o menu fica na lateral e as listas viram tabelas.

## Testes automáticos

```bash
npm test                # 101 testes (API original, SaaS/isolamento, WhatsApp e interface)
npm run test:postgres   # API + SaaS pelo protocolo de rede do Postgres (como no Supabase)
npm run e2e -- http://localhost:5173   # navegador real: site, cadastro, todas as telas no celular e no computador
```

Os testes cobrem tudo o que já era testado no Agenda Expert e também:

- cadastro com teste grátis;
- **isolamento entre empresas**: listagem, leitura, edição e exclusão por id, e uso cruzado de clientes, serviços e atendimentos;
- vencimento e bloqueio de escrita, suspensão e pagamentos;
- MRR e painel do proprietário;
- perfis (empresa × proprietário);
- troca e recuperação de senha com link de uso único;
- links de WhatsApp do site;
- arquivos do PWA;
- **migração de um banco do Agenda Expert** sem perda de dados.

## Banco de dados e migração

Ao ligar, o app roda `supabase/schema.sql`. O script só **acrescenta** tabelas e colunas: `companies`, `payments`, `password_resets`, `company_settings`, `wa_sessions` e a coluna `company_id`. Se houver dados de antes da Lola, sem empresa, eles são ligados automaticamente à **empresa nº 1**, que recebe o nome do estúdio, e os ajustes e a sessão do WhatsApp são copiados. As tabelas antigas `settings` e `wa_auth` **não são apagadas**.

Antes de publicar a nova versão sobre o banco do Agenda Expert, baixe uma cópia em **Mais → Baixar cópia de segurança** na versão antiga. Mais detalhes em [DEPLOY.md](DEPLOY.md).

Restaurar uma cópia: `npm run restaurar -- arquivo.json`. O comando aceita a cópia diária da plataforma, a cópia de uma empresa e a cópia do antigo Agenda Expert.

## Site, prints e vídeo

- Imagens do site: `public/site/img/`, geradas do **sistema real** com a empresa de demonstração (`npm run site:prints -- http://localhost:5173`).
- Vídeo vertical 9:16: `public/site/lola-demonstracao.mp4`, gravado do sistema real (`npm run site:video -- http://localhost:5173`, precisa do ffmpeg). O roteiro está em [docs/ROTEIRO-VIDEO.md](docs/ROTEIRO-VIDEO.md).
- Textos do site: `public/index.html`. Número do WhatsApp: busque por `5511962822060` para trocar.

## Marca

A pasta `marca/` tem:

- o logo da Lola em fundo claro e em fundo escuro (`lola-logo-clara.png` e `lola-logo-escura.png`);
- o ícone para a foto de perfil do WhatsApp Business (`lola-icone-perfil-whatsapp.png`).

O símbolo é um arco, como um espelho de salão, com o "L". Os ícones do aplicativo estão em `public/icons/`.

Antes de investir em divulgação, consulte o nome "Lola" na busca de marcas do INPI, na classe 42 (software), e veja se o domínio .com.br está livre. Já existem marcas de beleza com "Lola", como a Lola From Rio, de cabelos.

## Mais documentação

- [DEPLOY.md](DEPLOY.md): publicar (Supabase + GitHub + Render), domínio e atualização a partir do Agenda Expert.
- [docs/SEGURANCA-LGPD.md](docs/SEGURANCA-LGPD.md): o que protege os dados e o checklist de LGPD.
- [docs/PAGAMENTOS-RECORRENTES.md](docs/PAGAMENTOS-RECORRENTES.md): como ligar cobrança automática no futuro.
- [docs/MUDANCAS.md](docs/MUDANCAS.md): tudo o que mudou do Agenda Expert para a Lola.
