// Envio de e-mails transacionais (recuperação de senha).
// Opcional: sem configuração, a recuperação é feita pelo suporte via WhatsApp
// (o proprietário gera o link no painel /admin e envia para a cliente).
//
//  • RESEND_API_KEY + MAIL_FROM  → envia pela API da Resend (https://resend.com), sem dependências extras
//  • MAIL_LOG=1                  → só escreve o e-mail no log do servidor (para testes no computador)
export const mailEnabled = () => !!((process.env.RESEND_API_KEY && process.env.MAIL_FROM) || process.env.MAIL_LOG === '1');

export async function sendMail({ to, subject, text }) {
  if (process.env.MAIL_LOG === '1') {
    console.log(`✉  [e-mail para ${to}] ${subject}\n${text}\n`);
    return { ok: true, logged: true };
  }
  if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM) throw new Error('Envio de e-mail não configurado.');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.MAIL_FROM, to: [to], subject, text }),
  });
  if (!res.ok) throw new Error(`Falha no envio (${res.status}).`);
  return { ok: true };
}
