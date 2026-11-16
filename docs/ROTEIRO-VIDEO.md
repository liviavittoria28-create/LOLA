# Vídeo de demonstração (9:16) — roteiro e regravação

O vídeo `public/site/lola-demonstracao.mp4` (720×1280, cerca de 1min15) foi **gravado do sistema real**, com a empresa de demonstração *Studio Aurora Beauty* e dados fictícios. Ele aparece na seção **Demonstração** do site. Também pode ser enviado direto pelo WhatsApp ou usado nos Status e Reels.

## Cenas

| # | Legenda na tela | O que acontece |
|---|---|---|
| 1 | A página inicial | Abre o site e rola pelo título, os botões e as funcionalidades |
| 2 | O painel do dia | Painel com o previsto de hoje, o saldo do mês, as ações rápidas e a lista de hoje |
| 3 | Agendar um atendimento | Agenda do dia → **+** → busca a cliente → escolhe o serviço → horário → **Salvar agendamento** |
| 4 | Cadastrar uma cliente | Clientes → **+** → nome e WhatsApp → **Salvar** → abre a ficha |
| 5 | Consultar a agenda | Visão do mês → toca num dia → lista do dia → visão da semana |
| 6 | Controlar o financeiro | Saldo do mês e categorias → **+** → saída de R$ 89,90 (“Esmaltes novos”) → **Salvar** |
| 7 | Ver os relatórios | Faturamento, resultado, ticket médio e o gráfico do ano |
| 8 | Use pelo celular, como um app | Mais → **Instalar no celular** (passo a passo para iPhone e Android) |
| — | Encerramento | Lola · “Agenda cheia, clientes fiéis e o caixa em dia.” · 15 dias grátis · R$ 49,90/mês · WhatsApp (11) 96282-2060 |

## Como regravar (depois de mudar telas ou textos)

```bash
npm start                                            # em um terminal
npm run demo -- http://localhost:5173                # cria a empresa de demonstração (só na primeira vez)
npm run site:prints -- http://localhost:5173         # atualiza as imagens do site
npm run site:video -- http://localhost:5173 public/site/lola-demonstracao.mp4
```

Precisa do Chrome ou do Edge e do **ffmpeg** instalados. As legendas, a ordem das cenas e o cartão final ficam em `scripts/demo-video.js`.

## Versão narrada (opcional, para gravar com a sua voz)

1. *(cena 1)* “Esta é a Lola, o sistema feito para profissionais da beleza.”
2. *(cena 2)* “Ao abrir, você já vê o seu dia: quem vem, quanto vai entrar e o que precisa de atenção.”
3. *(cena 3)* “Para agendar, é só escolher a cliente, o serviço e o horário. O sistema calcula o término e avisa se houver conflito.”
4. *(cena 4)* “Cadastrar uma cliente leva segundos, e a ficha guarda a anamnese e todo o histórico.”
5. *(cena 5)* “A agenda mostra o dia, a semana, o mês e o ano, com cores para cada situação.”
6. *(cena 6)* “No financeiro você lança entradas e saídas e acompanha o saldo do mês.”
7. *(cena 7)* “Os relatórios mostram o faturamento, os serviços mais feitos e as clientes que mais investiram.”
8. *(cena 8)* “E tudo funciona no celular, como um aplicativo. Teste grátis por 15 dias, sem cartão. Me chama no WhatsApp!”
