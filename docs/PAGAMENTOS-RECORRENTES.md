# Pagamentos recorrentes (preparação)

Hoje a venda e o recebimento são feitos **pelo WhatsApp**. No painel `/admin`, você registra cada pagamento recebido, e a Lola:

- grava o pagamento na tabela `payments` (valor, data, forma, período coberto, observação);
- estende a assinatura (`companies.paid_until`) a partir do vencimento atual ou do fim do teste grátis;
- calcula o MRR e o histórico de receita.

Não existe checkout nem cobrança simulada.

## O que já está pronto para um gateway

- `payments.provider` (hoje sempre `manual`) e `payments.provider_ref`, para guardar o identificador da cobrança no Mercado Pago, Asaas, Stripe e similares.
- `companies.price_cents`: mensalidade de cada empresa (padrão R$ 49,90; pode ser alterada por empresa no `/admin`).
- `companies.status`, `trial_ends_at` e `paid_until`, com a regra de acesso em `server/saas.js` (`companyAccess`).

## Passos para ligar a cobrança automática no futuro

1. Escolha o provedor (para o Brasil: Asaas ou Mercado Pago, que têm assinatura com Pix e cartão).
2. Crie a assinatura no provedor quando a cliente contratar, guardando o id em `provider_ref`.
3. Crie uma rota `POST /api/webhooks/<provedor>` sem login. Ela deve:
   - **conferir a assinatura do webhook** com o segredo do provedor, guardado em variável de ambiente e nunca no código;
   - ao receber "pagamento confirmado", fazer o mesmo que `POST /api/admin/companies/:id/payments`: inserir em `payments` com `provider` e `provider_ref` e estender `paid_until`;
   - ignorar eventos repetidos (use `provider_ref` como chave única).
4. Coloque o botão de pagamento na tela de assinatura vencida (`subscriptionSheet` em `public/js/ui.js`) e no site, no lugar do link do WhatsApp.
