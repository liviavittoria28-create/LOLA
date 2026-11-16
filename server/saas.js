// Lola — regras da assinatura (teste grátis, vencimento) e criação de empresas
import { db, nowIso, tx, seedCompany } from './db.js';
import { hashPassword } from './auth.js';
import { todayBR, addDays, diffDays } from './time.js';

export const TRIAL_DAYS = 15;
export const PRICE_CENTS = 4990;
export const SALES_WHATSAPP = '5511962822060';

/**
 * Situação de acesso da empresa:
 *  trial      — dentro dos 15 dias grátis
 *  active     — mensalidade em dia (ou ativa sem vencimento, ex.: cortesia definida pelo proprietário)
 *  expired    — teste ou mensalidade vencidos: consulta e cópia de segurança liberadas, alterações bloqueadas
 *  suspended / canceled — definidos pelo proprietário da plataforma
 */
export function companyAccess(c, today = todayBR()) {
  if (!c) return { state: 'none', can_write: false };
  const base = { trial_ends_at: c.trial_ends_at, paid_until: c.paid_until };
  if (c.status === 'suspended') return { ...base, state: 'suspended', can_write: false };
  if (c.status === 'canceled') return { ...base, state: 'canceled', can_write: false };
  if (c.paid_until && c.paid_until >= today) return { ...base, state: 'active', can_write: true, days_left: diffDays(today, c.paid_until) };
  if (c.status === 'active' && !c.paid_until) return { ...base, state: 'active', can_write: true, days_left: null };
  if (c.trial_ends_at && c.trial_ends_at >= today && !c.paid_until) return { ...base, state: 'trial', can_write: true, days_left: diffDays(today, c.trial_ends_at) };
  return { ...base, state: 'expired', can_write: false, days_left: 0 };
}

export const getCompany = (id) => db.prepare('SELECT * FROM companies WHERE id = ?').get(id);

/** Cria empresa + acesso da dona (cadastro pelo site ou pelo painel do proprietário) */
export async function createCompany({ company, owner_name, email, password, phone, city, segment }, { trialDays = TRIAL_DAYS, legacy = false, status = 'trial', envManaged = false } = {}) {
  const t = nowIso();
  const today = todayBR();
  return tx(async (q) => {
    const c = await q.prepare(
      `INSERT INTO companies (name, owner_name, email, phone, city, segment, status, trial_ends_at, price_cents, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).run(company, owner_name, email, phone || null, city || null, segment || null, status, status === 'trial' ? addDays(today, trialDays - 1) : null, PRICE_CENTS, t, t);
    const cid = c.lastInsertRowid;
    const u = await q.prepare(
      "INSERT INTO users (email, name, password_hash, company_id, role, env_managed, created_at, updated_at) VALUES (?,?,?,?,'owner',?,?,?)"
    ).run(email, owner_name || company, hashPassword(password), cid, envManaged ? 1 : 0, t, t);
    await seedCompany(cid, { legacy, name: company }, q);
    return { company_id: cid, user_id: u.lastInsertRowid };
  });
}

/** Soma meses a uma data AAAA-MM-DD (31/01 + 1 mês = 28 ou 29/02) */
export function addMonthsDate(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  const dt = new Date(Date.UTC(y, m - 1 + n, Math.min(d, last), 12));
  return dt.toISOString().slice(0, 10);
}
