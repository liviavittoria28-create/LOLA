// API REST da Lola (antigo Agenda Expert) — Postgres / Supabase
// Toda rota de dados usa ctx.cid (empresa da sessão): uma empresa nunca enxerga dados de outra.
import { db, nowIso, getSettings, setSetting, tx } from './db.js';
import {
  createSession, destroySession, verifyPassword, hashPassword, destroyUserSessions, validPassword,
  createResetToken, useResetToken, checkResetToken,
  loginAllowed, loginFailed, loginOk, COOKIE,
} from './auth.js';
import { companyAccess, getCompany, createCompany, addMonthsDate, TRIAL_DAYS, PRICE_CENTS, SALES_WHATSAPP } from './saas.js';
import { sendMail, mailEnabled } from './mail.js';
import { toMin, fromMin, stamp, stampTime, isDate, isTime, addDays, diffDays, weekday, fmtBR, todayBR } from './time.js';
export { routes as _routes };
import * as wa from './whatsapp.js';
import { targetDate } from './wa-logic.js';

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}
const bad = (msg, extra) => new HttpError(400, msg, extra);
const notFound = (what = 'Registro') => new HttpError(404, `${what} não encontrado.`);

const STATUSES = ['agendada', 'confirmada', 'concluida', 'cancelada', 'faltou'];
const FREEING = ['cancelada', 'faltou']; // RN07
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const digits = (s) => String(s || '').replace(/\D/g, '');
const str = (v, max = 2000) => (v == null ? null : String(v).trim().slice(0, max) || null);
const toCents = (v) => {
  if (typeof v === 'number') return Math.round(v);
  const n = Number(String(v ?? '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};
const marks = (n) => Array.from({ length: n }, () => '?').join(',');

/** Onde os dados ficam guardados (mostrado no app) */
export function storageStatus() {
  if (db.kind === 'postgres') return { mode: 'online', provider: /supabase/.test(process.env.DATABASE_URL || '') ? 'Supabase' : 'Postgres' };
  const hosted = !!(process.env.RENDER || process.env.KOYEB_APP_NAME || process.env.RAILWAY_ENVIRONMENT || process.env.FLY_APP_NAME);
  return { mode: hosted ? 'temporary' : 'disk' };
}

// ---------------------------------------------------------------- Roteador
const routes = [];
const route = (method, pattern, handler, opts = {}) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
  routes.push({ method, re, keys, handler, auth: opts.auth !== false, platform: !!opts.platform, anyRole: !!opts.anyRole, always: !!opts.always });
};
export function matchRoute(method, pathname) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = pathname.match(r.re);
    if (m) return { ...r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}

// ---------------------------------------------------------------- Auth
route('POST', '/api/login', async ({ body, ip, setCookie }) => {
  if (!loginAllowed(ip)) throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos.');
  const email = String(body.email || '').trim().toLowerCase();
  const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !verifyPassword(String(body.password || ''), user.password_hash)) {
    loginFailed(ip);
    throw new HttpError(401, 'E-mail ou senha incorretos');
  }
  loginOk(ip);
  const s = await createSession(user.id);
  setCookie(COOKIE, s.token, s.maxAge);
  await db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso(), user.id);
  return { user: { id: user.id, email: user.email, name: user.name, role: user.role }, redirect: user.role === 'platform' ? '/admin/' : '/app/' };
}, { auth: false });

// ---------------------------------------------------------------- Cadastro de empresa (teste grátis de 15 dias)
const signupAttempts = new Map();
route('POST', '/api/signup', async ({ body, ip, setCookie }) => {
  const a = signupAttempts.get(ip) || { n: 0, at: Date.now() };
  if (Date.now() - a.at > 3600e3) Object.assign(a, { n: 0, at: Date.now() });
  if (a.n >= 5) throw new HttpError(429, 'Muitos cadastros seguidos. Tente de novo mais tarde ou fale com a Lola no WhatsApp.');
  const company = str(body.company, 120);
  const owner_name = str(body.name, 120);
  const email = String(body.email || '').trim().toLowerCase().slice(0, 160);
  const phone = str(body.phone, 30);
  const password = String(body.password || '');
  const fields = [];
  if (!company) fields.push('company');
  if (!owner_name) fields.push('name');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fields.push('email');
  if (!phone || digits(phone).length < 10) fields.push('phone');
  if (!validPassword(password)) fields.push('password');
  if (fields.length) throw bad('Confira os campos destacados. A senha precisa ter pelo menos 8 caracteres.', { fields });
  if (!body.accept_terms) throw bad('Para começar, aceite os Termos de Uso e a Política de Privacidade.', { fields: ['accept_terms'] });
  if (await db.prepare('SELECT 1 AS x FROM users WHERE email = ?').get(email))
    throw new HttpError(409, 'Este e-mail já tem uma conta. Entre com sua senha ou use “Esqueci minha senha”.', { code: 'email_taken', fields: ['email'] });
  a.n++;
  signupAttempts.set(ip, a);
  const r = await createCompany({ company, owner_name, email, password, phone, city: str(body.city, 80), segment: str(body.segment, 80) });
  const s = await createSession(r.user_id);
  setCookie(COOKIE, s.token, s.maxAge);
  return { ok: true, company_id: r.company_id, trial_days: TRIAL_DAYS, redirect: '/app/' };
}, { auth: false });

// ---------------------------------------------------------------- Recuperação de senha
const resetAttempts = new Map();
const publicUrl = (path) => `${String(process.env.PUBLIC_URL || '').replace(/\/$/, '')}${path}`;
route('POST', '/api/password/forgot', async ({ body, ip }) => {
  const n = resetAttempts.get(ip) || 0;
  if (n >= 8) throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos.');
  resetAttempts.set(ip, n + 1);
  setTimeout(() => resetAttempts.delete(ip), 15 * 60e3).unref?.();
  const email = String(body.email || '').trim().toLowerCase();
  const user = email ? await db.prepare('SELECT * FROM users WHERE email = ?').get(email) : null;
  // mesma resposta exista ou não a conta (não revela quais e-mails estão cadastrados)
  const reply = { ok: true, email_enabled: mailEnabled(), whatsapp: SALES_WHATSAPP };
  if (!user || user.env_managed || !mailEnabled()) return reply;
  const token = await createResetToken(user.id);
  await sendMail({
    to: user.email,
    subject: 'Lola — redefinir sua senha',
    text: `Olá, ${user.name}!\n\nPara criar uma nova senha, abra o link abaixo (válido por 2 horas):\n${publicUrl('/redefinir-senha/?token=' + token)}\n\nSe não foi você, ignore este e-mail.\n\nLola`,
  }).catch((e) => console.error('E-mail de recuperação:', e.message));
  return reply;
}, { auth: false });
route('GET', '/api/password/reset', async ({ query }) => ({ valid: await checkResetToken(query.token) }), { auth: false });
route('POST', '/api/password/reset', async ({ body }) => {
  if (!validPassword(body.password)) throw bad('A senha precisa ter pelo menos 8 caracteres.', { fields: ['password'] });
  const userId = await useResetToken(body.token);
  if (!userId) throw bad('Este link expirou ou já foi usado. Peça um novo.', { code: 'invalid_token' });
  const u = await db.prepare('SELECT env_managed FROM users WHERE id = ?').get(userId);
  if (u?.env_managed) throw new HttpError(409, 'Este acesso é definido nas variáveis do servidor.', { code: 'account_managed' });
  await db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(hashPassword(body.password), nowIso(), userId);
  await destroyUserSessions(userId);
  return { ok: true };
}, { auth: false });

route('POST', '/api/logout', async ({ token, setCookie }) => {
  await destroySession(token);
  setCookie(COOKIE, '', 0);
  return { ok: true };
}, { auth: false });

// verificação de saúde para o serviço de hospedagem
route('GET', '/api/health', async () => {
  await db.prepare('SELECT 1 AS ok').get();
  return { ok: true };
}, { auth: false });

route('GET', '/api/me', async ({ user, cid }) => {
  if (user.role === 'platform') return { user, platform: true, today: todayBR() };
  const c = await getCompany(cid);
  return {
    user, settings: await getSettings(cid), today: todayBR(), storage: storageStatus(),
    company: { id: c.id, name: c.name, created_at: c.created_at },
    subscription: { ...companyAccess(c), price_cents: c.price_cents, whatsapp: SALES_WHATSAPP },
  };
}, { anyRole: true, always: true });
route('GET', '/api/storage', () => storageStatus(), { anyRole: true });

// Troca de senha pela própria dona. O acesso definido por variáveis (ADMIN_EMAIL/ADMIN_PASSWORD) continua só pelas variáveis.
route('PUT', '/api/account', async ({ user, body, token }) => {
  if (user.env_managed)
    throw new HttpError(409, 'O e-mail e a senha são definidos nas variáveis do servidor (ADMIN_EMAIL e ADMIN_PASSWORD).', { code: 'account_managed' });
  const row = await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  if (!verifyPassword(String(body.current_password || ''), row.password_hash)) throw bad('Senha atual incorreta.', { fields: ['current_password'] });
  const name = str(body.name, 120) || row.name;
  if (body.new_password && !validPassword(body.new_password)) throw bad('A nova senha precisa ter pelo menos 8 caracteres.', { fields: ['new_password'] });
  await db.prepare('UPDATE users SET name = ?, password_hash = ?, updated_at = ? WHERE id = ?')
    .run(name, body.new_password ? hashPassword(body.new_password) : row.password_hash, nowIso(), user.id);
  if (body.new_password) {
    // encerra as outras sessões, mantém a atual
    await db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(user.id, (await import('node:crypto')).createHash('sha256').update(token).digest('hex'));
  }
  return { ok: true };
}, { anyRole: true, always: true });

// ---------------------------------------------------------------- Ajustes
route('GET', '/api/settings', ({ cid }) => getSettings(cid));
route('PUT', '/api/settings', async ({ body, cid }) => {
  const allowed = ['studio_name', 'studio_address', 'open_time', 'close_time', 'work_days', 'gap_min', 'consent_text', 'whatsapp_template', 'wa_auto', 'wa_mode', 'wa_time', 'wa_footer', 'wa_reply_confirm', 'wa_reply_reschedule'];
  if (body.studio_name != null && !String(body.studio_name).trim()) throw bad('Informe o nome do estabelecimento.', { fields: ['studio_name'] });
  if (body.wa_time && !isTime(body.wa_time)) throw bad('Horário de envio inválido.');
  if (body.wa_mode && !['same_day', 'day_before'].includes(body.wa_mode)) throw bad('Opção de envio inválida.');
  if (body.wa_auto != null) body.wa_auto = body.wa_auto === true || body.wa_auto === '1' ? '1' : '0';
  if (body.open_time && !isTime(body.open_time)) throw bad('Horário de abertura inválido.');
  if (body.close_time && !isTime(body.close_time)) throw bad('Horário de fechamento inválido.');
  for (const k of allowed) if (body[k] != null) await setSetting(cid, k, String(body[k]).slice(0, 5000));
  if (body.studio_name) await db.prepare('UPDATE companies SET name = ?, updated_at = ? WHERE id = ?').run(String(body.studio_name).trim().slice(0, 120), nowIso(), cid);
  return getSettings(cid);
});

// ---------------------------------------------------------------- Clientes
function clientRow(c) {
  return {
    id: c.id, name: c.name, phone: c.phone, birth_date: c.birth_date, email: c.email, notes: c.notes,
    active: !!c.active, created_at: c.created_at, updated_at: c.updated_at,
    anamnese: c.a_consent == null ? 'pendente' : c.a_consent ? 'ok' : 'rascunho',
  };
}

route('GET', '/api/clients', async ({ query, cid }) => {
  const q = String(query.q || '').trim();
  const where = ['c.company_id = ?'];
  const args = [cid];
  if (query.inactive !== '1') where.push('c.active = 1');
  if (q) {
    const d = digits(q);
    if (d.length >= 3) {
      where.push('(c.name ILIKE ? OR c.phone_digits LIKE ?)');
      args.push(`%${q}%`, `%${d}%`);
    } else {
      where.push('c.name ILIKE ?');
      args.push(`%${q}%`);
    }
  }
  const rows = await db
    .prepare(
      `SELECT c.*, a.consent AS a_consent FROM clients c LEFT JOIN anamneses a ON a.client_id = c.id
       WHERE ${where.join(' AND ')} ORDER BY lower(c.name) LIMIT ${q ? 50 : 5000}`
    )
    .all(...args);
  // ordenação sem acento
  return rows.map(clientRow).sort((a, b) => norm(a.name).localeCompare(norm(b.name)));
});

async function validateClient(cid, body, id) {
  const name = str(body.name, 120);
  const phone = str(body.phone, 30);
  const fields = [];
  if (!name) fields.push('name');
  if (!phone || digits(phone).length < 10) fields.push('phone');
  if (fields.length) throw bad('Preencha nome e telefone válidos.', { fields });
  if (body.birth_date && !isDate(body.birth_date)) throw bad('Data de nascimento inválida.', { fields: ['birth_date'] });
  const email = str(body.email, 160);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('E-mail inválido.', { fields: ['email'] });
  const dup = await db.prepare('SELECT id, name FROM clients WHERE company_id = ? AND phone_digits = ? AND id IS NOT ?').get(cid, digits(phone), id ?? null);
  if (dup && !body.allow_duplicate)
    throw new HttpError(409, `Já existe cliente com este telefone: ${dup.name}.`, { code: 'duplicate_phone', existing_id: dup.id });
  return { name, phone, phone_digits: digits(phone), birth_date: body.birth_date || null, email, notes: str(body.notes) };
}

route('POST', '/api/clients', async ({ body, cid }) => {
  const c = await validateClient(cid, body);
  const t = nowIso();
  const r = await db
    .prepare('INSERT INTO clients (company_id, name, phone, phone_digits, birth_date, email, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(cid, c.name, c.phone, c.phone_digits, c.birth_date, c.email, c.notes, t, t);
  return getClient(cid, r.lastInsertRowid);
});

async function getClient(cid, id) {
  const c = await db.prepare('SELECT c.*, a.consent AS a_consent FROM clients c LEFT JOIN anamneses a ON a.client_id = c.id WHERE c.id = ? AND c.company_id = ?').get(id, cid);
  if (!c) throw notFound('Cliente');
  return clientRow(c);
}
const idParam = (v) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) throw notFound();
  return n;
};
async function links(clientId) { // clientId já validado como da empresa
  const a = await db.prepare('SELECT COUNT(*) AS n FROM appointments WHERE client_id = ?').get(clientId);
  const t = await db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE client_id = ?').get(clientId);
  return a.n + t.n;
}

route('GET', '/api/clients/:id', async ({ params, cid }) => {
  const client = await getClient(cid, idParam(params.id));
  const a = await db.prepare('SELECT * FROM anamneses WHERE client_id = ?').get(client.id);
  const history = await listAppointments(cid, 'a.client_id = ?', [client.id], 'ORDER BY a.start_at DESC');
  const spent = (await db.prepare("SELECT COALESCE(SUM(amount_cents),0) AS s FROM transactions WHERE client_id = ? AND type = 'in'").get(client.id)).s;
  return {
    ...client,
    anamnese_data: a ? { ...JSON.parse(a.data), consent: !!a.consent, filled_at: a.filled_at, updated_at: a.updated_at } : null,
    history,
    spent_cents: spent,
    can_delete: (await links(client.id)) === 0,
  };
});

route('PUT', '/api/clients/:id', async ({ params, body, cid }) => {
  const id = idParam(params.id);
  await getClient(cid, id);
  const c = await validateClient(cid, body, id);
  await db.prepare('UPDATE clients SET name=?, phone=?, phone_digits=?, birth_date=?, email=?, notes=?, updated_at=? WHERE id=? AND company_id=?').run(
    c.name, c.phone, c.phone_digits, c.birth_date, c.email, c.notes, nowIso(), id, cid
  );
  return getClient(cid, id);
});

route('POST', '/api/clients/:id/active', async ({ params, body, cid }) => {
  const id = idParam(params.id);
  await getClient(cid, id);
  await db.prepare('UPDATE clients SET active = ?, updated_at = ? WHERE id = ? AND company_id = ?').run(body.active ? 1 : 0, nowIso(), id, cid);
  return getClient(cid, id);
});

route('DELETE', '/api/clients/:id', async ({ params, cid }) => {
  const id = idParam(params.id);
  await getClient(cid, id);
  if ((await links(id)) > 0) throw new HttpError(409, 'Cliente com atendimentos ou movimentações não pode ser excluída — apenas inativada.'); // RN14
  await db.prepare('DELETE FROM clients WHERE id = ? AND company_id = ?').run(id, cid);
  return { ok: true };
});

// Anamnese — RF05, RF06
route('PUT', '/api/clients/:id/anamnese', async ({ params, body, cid }) => {
  const id = idParam(params.id);
  await getClient(cid, id);
  const consent = body.consent ? 1 : 0;
  const { consent: _c, filled_at: _f, updated_at: _u, ...data } = body;
  const t = nowIso();
  const filledAt = consent ? todayBR() : null;
  await db.prepare(
    `INSERT INTO anamneses (client_id, data, consent, filled_at, created_at, updated_at) VALUES (?,?,?,?,?,?)
     ON CONFLICT (client_id) DO UPDATE SET data = EXCLUDED.data, consent = EXCLUDED.consent,
       filled_at = COALESCE(EXCLUDED.filled_at, anamneses.filled_at), updated_at = EXCLUDED.updated_at`
  ).run(id, JSON.stringify(data).slice(0, 20000), consent, filledAt, t, t);
  if (!consent) await db.prepare('UPDATE anamneses SET filled_at = NULL WHERE client_id = ?').run(id);
  return { ok: true, state: consent ? 'ok' : 'rascunho' };
});

// ---------------------------------------------------------------- Procedimentos
const procRow = (p) => ({ ...p, active: !!p.active });
route('GET', '/api/procedures', async ({ query, cid }) =>
  (await db.prepare(`SELECT * FROM procedures WHERE company_id = ? ${query.all === '1' ? '' : 'AND active = 1'} ORDER BY active DESC, sort, name`).all(cid)).map(procRow)
);
function validateProc(body) {
  const name = str(body.name, 120);
  const price = toCents(body.price_cents ?? body.price);
  const dur = Number(body.duration_min);
  if (!name) throw bad('Informe o nome do procedimento.', { fields: ['name'] });
  if (!Number.isFinite(price) || price < 0) throw bad('O valor deve ser maior ou igual a zero.', { fields: ['price'] });
  if (!Number.isInteger(dur) || dur <= 0 || dur > 720) throw bad('A duração deve ser maior que zero (em minutos).', { fields: ['duration_min'] });
  return { name, description: str(body.description), price, dur };
}
route('POST', '/api/procedures', async ({ body, cid }) => {
  const p = validateProc(body);
  const t = nowIso();
  const sort = (await db.prepare('SELECT COALESCE(MAX(sort),0)+1 AS s FROM procedures WHERE company_id = ?').get(cid)).s;
  const r = await db.prepare('INSERT INTO procedures (company_id, name, description, price_cents, duration_min, sort, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(cid, p.name, p.description, p.price, p.dur, sort, t, t);
  return procRow(await db.prepare('SELECT * FROM procedures WHERE id = ?').get(r.lastInsertRowid));
});
route('PUT', '/api/procedures/:id', async ({ params, body, cid }) => {
  const id = idParam(params.id);
  if (!(await db.prepare('SELECT id FROM procedures WHERE id = ? AND company_id = ?').get(id, cid))) throw notFound('Procedimento');
  const p = validateProc(body);
  await db.prepare('UPDATE procedures SET name=?, description=?, price_cents=?, duration_min=?, active=?, updated_at=? WHERE id=? AND company_id=?')
    .run(p.name, p.description, p.price, p.dur, body.active === false ? 0 : 1, nowIso(), id, cid);
  return procRow(await db.prepare('SELECT * FROM procedures WHERE id = ?').get(id));
});

// ---------------------------------------------------------------- Agendamentos
async function listAppointments(cid, where, args, order = 'ORDER BY a.start_at') {
  const rows = await db
    .prepare(
      `SELECT a.*, c.name AS client_name, c.phone AS client_phone, an.consent AS a_consent,
         w.status AS wa_status, w.reply AS wa_reply, w.sent_at AS wa_sent_at, w.error AS wa_error
       FROM appointments a JOIN clients c ON c.id = a.client_id LEFT JOIN anamneses an ON an.client_id = a.client_id
       LEFT JOIN wa_messages w ON w.appointment_id = a.id
       WHERE a.company_id = ? AND (${where}) ${order}`
    )
    .all(cid, ...args);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const procs = await db.prepare(`SELECT * FROM appointment_procedures WHERE appointment_id IN (${marks(ids.length)}) ORDER BY id`).all(...ids);
  const byAppt = new Map();
  for (const p of procs) {
    if (!byAppt.has(p.appointment_id)) byAppt.set(p.appointment_id, []);
    byAppt.get(p.appointment_id).push({ procedure_id: p.procedure_id, name: p.name, price_cents: p.price_cents, duration_min: p.duration_min });
  }
  const txs = await db.prepare(`SELECT appointment_id, id FROM transactions WHERE appointment_id IN (${marks(ids.length)})`).all(...ids);
  const txBy = new Map(txs.map((t) => [t.appointment_id, t.id]));
  return rows.map((r) => ({
    id: r.id, client_id: r.client_id, client_name: r.client_name, client_phone: r.client_phone,
    date: r.date, start: stampTime(r.start_at), end: stampTime(r.end_at), start_at: r.start_at, end_at: r.end_at,
    status: r.status, cancel_reason: r.cancel_reason, notes: r.notes,
    total_cents: r.total_cents, duration_min: r.duration_min,
    anamnese: r.a_consent == null ? 'pendente' : r.a_consent ? 'ok' : 'rascunho',
    procedures: byAppt.get(r.id) || [],
    transaction_id: txBy.get(r.id) || null,
    wa: r.wa_status ? { status: r.wa_status, reply: r.wa_reply, sent_at: r.wa_sent_at, error: r.wa_error } : null,
    created_at: r.created_at, updated_at: r.updated_at,
  }));
}
const getAppointment = async (cid, id) => {
  const a = (await listAppointments(cid, 'a.id = ?', [id]))[0];
  if (!a) throw notFound('Agendamento');
  return a;
};

/** Bloqueios e atendimentos ativos de um dia (lidos uma vez) */
async function dayData(cid, date, excludeId) {
  const blocks = await db.prepare('SELECT * FROM blocks WHERE company_id = ? AND start_date <= ? AND end_date >= ?').all(cid, date, date);
  const appts = await db
    .prepare(
      `SELECT a.start_at, a.end_at, c.name FROM appointments a JOIN clients c ON c.id = a.client_id
       WHERE a.company_id = ? AND a.date = ? AND a.status NOT IN ('cancelada','faltou') AND a.id IS NOT ?`
    )
    .all(cid, date, excludeId ?? null);
  return { blocks, appts };
}

// Verifica sobreposição com atendimentos (RN02) e bloqueios (RN03)
function conflictIn({ blocks, appts }, startMin, endMin, gap) {
  for (const b of blocks) {
    if (b.all_day) return { type: 'block', message: `Agenda bloqueada neste dia: ${b.reason}.` };
    const bs = toMin(b.start_time), be = toMin(b.end_time);
    if (startMin < be && endMin > bs) return { type: 'block', message: `Horário bloqueado (${b.start_time}–${b.end_time}): ${b.reason}.` };
  }
  for (const a of appts) {
    const s = toMin(stampTime(a.start_at)), e = toMin(stampTime(a.end_at));
    if (startMin < e + gap && endMin + gap > s)
      return { type: 'appointment', message: `Conflito com o atendimento de ${a.name} (${fromMin(s)}–${fromMin(e)}).` };
  }
  return null;
}
async function findConflict(cid, date, startMin, endMin, excludeId) {
  const gap = Number((await getSettings(cid)).gap_min || 0);
  return conflictIn(await dayData(cid, date, excludeId), startMin, endMin, gap);
}

async function nextFree(cid, date, startMin, dur, excludeId) {
  const st = await getSettings(cid);
  const gap = Number(st.gap_min || 0);
  const open = toMin(st.open_time || '08:00'), close = toMin(st.close_time || '20:00');
  const days = String(st.work_days || '1,2,3,4,5,6').split(',').map(Number);
  let d = date;
  let m = Math.ceil(Math.max(startMin, open) / 15) * 15;
  for (let i = 0; i < 60; i++) {
    if (days.includes(weekday(d))) {
      const data = await dayData(cid, d, excludeId);
      for (; m + dur <= close; m += 15) {
        if (!conflictIn(data, m, m + dur, gap)) return { date: d, start: fromMin(m) };
      }
    }
    d = addDays(d, 1);
    m = open;
  }
  return null;
}

async function softWarnings(cid, clientId, date, procs, excludeId) {
  const w = [];
  const an = await db.prepare('SELECT consent FROM anamneses WHERE client_id = ?').get(clientId);
  if (!an || !an.consent) w.push({ code: 'anamnese', message: 'Esta cliente ainda não tem anamnese completa. Recomenda-se preencher antes do procedimento.' }); // RN13
  if (procs.some((p) => norm(p.name).includes('manutencao de cilios'))) {
    const last = await db
      .prepare(
        `SELECT a.date FROM appointments a JOIN appointment_procedures ap ON ap.appointment_id = a.id
         WHERE a.company_id = ? AND a.client_id = ? AND a.date <= ? AND a.id IS NOT ? AND a.status NOT IN ('cancelada','faltou')
         AND (lower(ap.name) LIKE '%extens%c%lios%' OR lower(ap.name) LIKE '%manuten%c%lios%')
         ORDER BY a.date DESC LIMIT 1`
      )
      .get(cid, clientId, date, excludeId ?? null);
    if (last) {
      const days = diffDays(last.date, date);
      if (days < 20)
        w.push({ code: 'cilios', message: `Última aplicação/manutenção de cílios em ${fmtBR(last.date)} (${days} dia${days === 1 ? '' : 's'}). A manutenção é indicada a partir de 20 dias.` }); // RN12
    }
  }
  return w;
}

async function prepareAppointment(cid, body, excludeId) {
  const clientId = Number(body.client_id);
  const client = Number.isSafeInteger(clientId) && clientId > 0 ? await db.prepare('SELECT id, active FROM clients WHERE id = ? AND company_id = ?').get(clientId, cid) : null;
  if (!client) throw bad('Selecione a cliente.', { fields: ['client'] });
  const ids = Array.isArray(body.procedure_ids) ? body.procedure_ids.map(Number).filter((n) => Number.isSafeInteger(n) && n > 0) : [];
  if (!ids.length) throw bad('Selecione ao menos um procedimento.', { fields: ['procedures'] });
  if (!isDate(body.date)) throw bad('Informe a data.', { fields: ['date'] });
  if (!isTime(body.start)) throw bad('Informe o horário de início.', { fields: ['start'] });

  // Ao editar, procedimentos já gravados mantêm valor e duração praticados (RN08)
  const kept = excludeId
    ? new Map((await db.prepare('SELECT * FROM appointment_procedures WHERE appointment_id = ?').all(excludeId)).map((p) => [p.procedure_id, p]))
    : new Map();
  const procs = [];
  for (const id of ids) {
    if (kept.has(id)) { procs.push(kept.get(id)); continue; }
    const p = await db.prepare('SELECT * FROM procedures WHERE id = ? AND company_id = ? AND active = 1').get(id, cid);
    if (!p) throw bad('Procedimento inválido ou desativado.');
    procs.push({ procedure_id: p.id, name: p.name, price_cents: p.price_cents, duration_min: p.duration_min });
  }
  const dur = procs.reduce((s, p) => s + p.duration_min, 0);
  const startMin = toMin(body.start);
  const endMin = startMin + dur; // RN04
  if (endMin > 24 * 60) throw bad('O atendimento ultrapassa a meia-noite. Escolha um horário mais cedo.');
  const total = procs.reduce((s, p) => s + p.price_cents, 0);
  return { clientId, procs, dur, total, date: body.date, startMin, endMin };
}

route('GET', '/api/appointments', async ({ query, cid }) => {
  const from = query.from, to = query.to;
  if (!isDate(from) || !isDate(to)) throw bad('Período inválido.');
  return { appointments: await listAppointments(cid, 'a.date BETWEEN ? AND ?', [from, to]), blocks: await listBlocks(cid, from, to) };
});

route('GET', '/api/appointments/year/:year', async ({ params, cid }) => {
  const y = String(Number(params.year));
  const counts = await db
    .prepare(
      `SELECT substr(date,6,2) AS m, COUNT(*) AS n FROM appointments
       WHERE company_id = ? AND substr(date,1,4) = ? AND status NOT IN ('cancelada','faltou') GROUP BY substr(date,6,2)`
    )
    .all(cid, y);
  const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, count: 0, blocked_days: 0, days: 0 }));
  for (const c of counts) months[Number(c.m) - 1].count = c.n;
  const blocks = await db.prepare('SELECT * FROM blocks WHERE company_id = ? AND all_day = 1 AND start_date <= ? AND end_date >= ?').all(cid, `${y}-12-31`, `${y}-01-01`);
  for (let i = 0; i < 12; i++) {
    const first = `${y}-${String(i + 1).padStart(2, '0')}-01`;
    const days = new Date(Date.UTC(Number(y), i + 1, 0)).getUTCDate();
    months[i].days = days;
    const set = new Set();
    for (const b of blocks) {
      for (let d = 0; d < days; d++) {
        const ds = addDays(first, d);
        if (ds >= b.start_date && ds <= b.end_date) set.add(ds);
      }
    }
    months[i].blocked_days = set.size;
  }
  return { year: Number(y), months };
});

route('POST', '/api/appointments/check', async ({ body, cid }) => {
  let excl = body.id ? Number(body.id) : null;
  if (excl) excl = (await getAppointment(cid, idParam(excl))).id;
  const p = await prepareAppointment(cid, body, excl);
  const conflict = await findConflict(cid, p.date, p.startMin, p.endMin, excl);
  return {
    end: fromMin(p.endMin), duration_min: p.dur, total_cents: p.total,
    conflict, next_free: conflict ? await nextFree(cid, p.date, p.startMin, p.dur, excl) : null,
    warnings: await softWarnings(cid, p.clientId, p.date, p.procs, excl),
  };
}, { always: true });

async function assertFree(cid, p, excludeId) {
  const conflict = await findConflict(cid, p.date, p.startMin, p.endMin, excludeId);
  if (conflict) throw new HttpError(409, conflict.message, { code: 'conflict', next_free: await nextFree(cid, p.date, p.startMin, p.dur, excludeId) });
}

async function saveProcs(t, apptId, procs) {
  await t.prepare('DELETE FROM appointment_procedures WHERE appointment_id = ?').run(apptId);
  const ins = t.prepare('INSERT INTO appointment_procedures (appointment_id, procedure_id, name, price_cents, duration_min) VALUES (?,?,?,?,?)');
  for (const p of procs) await ins.run(apptId, p.procedure_id, p.name, p.price_cents, p.duration_min);
}

route('POST', '/api/appointments', async ({ body, cid }) => {
  const p = await prepareAppointment(cid, body);
  await assertFree(cid, p);
  const now = nowIso();
  const id = await tx(async (t) => {
    const r = await t
      .prepare(
        `INSERT INTO appointments (company_id, client_id, date, start_at, end_at, status, notes, total_cents, duration_min, created_at, updated_at)
         VALUES (?,?,?,?,?,'agendada',?,?,?,?,?)`
      )
      .run(cid, p.clientId, p.date, stamp(p.date, fromMin(p.startMin)), stamp(p.date, fromMin(p.endMin)), str(body.notes), p.total, p.dur, now, now);
    await saveProcs(t, r.lastInsertRowid, p.procs);
    return r.lastInsertRowid;
  });
  return getAppointment(cid, id);
});

route('GET', '/api/appointments/:id', ({ params, cid }) => getAppointment(cid, idParam(params.id)));

route('PUT', '/api/appointments/:id', async ({ params, body, cid }) => {
  const id = idParam(params.id);
  const current = await getAppointment(cid, id);
  const p = await prepareAppointment(cid, body, id);
  if (!FREEING.includes(current.status)) await assertFree(cid, p, id);
  await tx(async (t) => {
    await t.prepare('UPDATE appointments SET client_id=?, date=?, start_at=?, end_at=?, notes=?, total_cents=?, duration_min=?, updated_at=? WHERE id=? AND company_id=?').run(
      p.clientId, p.date, stamp(p.date, fromMin(p.startMin)), stamp(p.date, fromMin(p.endMin)), str(body.notes), p.total, p.dur, nowIso(), id, cid
    );
    await saveProcs(t, id, p.procs);
  });
  return getAppointment(cid, id);
});

route('PATCH', '/api/appointments/:id/status', async ({ params, body, cid }) => {
  const id = idParam(params.id);
  const a = await getAppointment(cid, id);
  const status = String(body.status || '');
  if (!STATUSES.includes(status)) throw bad('Status inválido.');
  const reason = str(body.cancel_reason, 500);
  if (status === 'cancelada' && !reason) throw bad('Informe o motivo do cancelamento.', { fields: ['cancel_reason'] }); // RN05
  // Voltar de cancelada/faltou para um status ativo exige horário livre
  if (FREEING.includes(a.status) && !FREEING.includes(status)) {
    const c = await findConflict(cid, a.date, toMin(a.start), toMin(a.end), id);
    if (c) throw new HttpError(409, c.message + ' Reagende antes de reativar.');
  }
  await db.prepare('UPDATE appointments SET status = ?, cancel_reason = ?, updated_at = ? WHERE id = ? AND company_id = ?').run(
    status, status === 'cancelada' ? reason : null, nowIso(), id, cid
  );
  return getAppointment(cid, id);
});

route('DELETE', '/api/appointments/:id', async ({ params, cid }) => {
  const id = idParam(params.id);
  await getAppointment(cid, id);
  await tx(async (t) => {
    await t.prepare('UPDATE transactions SET appointment_id = NULL WHERE appointment_id = ? AND company_id = ?').run(id, cid);
    await t.prepare('DELETE FROM appointments WHERE id = ? AND company_id = ?').run(id, cid);
  });
  return { ok: true };
});

// ---------------------------------------------------------------- Bloqueios — RF19, RF20
async function listBlocks(cid, from, to) {
  return (await db.prepare('SELECT * FROM blocks WHERE company_id = ? AND start_date <= ? AND end_date >= ? ORDER BY start_date').all(cid, to, from))
    .map((b) => ({ ...b, all_day: !!b.all_day }));
}
route('GET', '/api/blocks', ({ query, cid }) => {
  const from = isDate(query.from) ? query.from : todayBR();
  const to = isDate(query.to) ? query.to : '9999-12-31';
  return listBlocks(cid, from, to);
});

function validateBlock(body) {
  const reason = str(body.reason, 200);
  if (!reason) throw bad('Informe o motivo do bloqueio.', { fields: ['reason'] });
  if (!isDate(body.start_date)) throw bad('Informe a data inicial.', { fields: ['start_date'] });
  const end = body.end_date || body.start_date;
  if (!isDate(end) || end < body.start_date) throw bad('A data final deve ser igual ou posterior à inicial.', { fields: ['end_date'] });
  const allDay = body.all_day !== false;
  if (!allDay) {
    if (!isTime(body.start_time) || !isTime(body.end_time) || body.end_time <= body.start_time)
      throw bad('Informe um intervalo de horário válido.', { fields: ['start_time', 'end_time'] });
  }
  return { reason, start_date: body.start_date, end_date: end, all_day: allDay ? 1 : 0, start_time: allDay ? null : body.start_time, end_time: allDay ? null : body.end_time };
}

async function apptsInBlock(cid, b) {
  const list = await listAppointments(cid, "a.date BETWEEN ? AND ? AND a.status NOT IN ('cancelada','faltou')", [b.start_date, b.end_date]);
  return list.filter((a) => b.all_day || (toMin(a.start) < toMin(b.end_time) && toMin(a.end) > toMin(b.start_time)));
}

async function saveBlock(cid, body, id) {
  const b = validateBlock(body);
  const inside = await apptsInBlock(cid, b);
  if (inside.length && !body.confirm)
    throw new HttpError(409, 'Há atendimentos neste período.', { code: 'appointments_in_block', appointments: inside }); // CSU07
  const t = nowIso();
  if (id) {
    await db.prepare('UPDATE blocks SET reason=?, start_date=?, end_date=?, all_day=?, start_time=?, end_time=?, updated_at=? WHERE id=? AND company_id=?')
      .run(b.reason, b.start_date, b.end_date, b.all_day, b.start_time, b.end_time, t, id, cid);
    return id;
  }
  return (await db.prepare('INSERT INTO blocks (company_id, reason, start_date, end_date, all_day, start_time, end_time, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(cid, b.reason, b.start_date, b.end_date, b.all_day, b.start_time, b.end_time, t, t)).lastInsertRowid;
}
const getBlock = async (cid, id) => {
  const b = await db.prepare('SELECT * FROM blocks WHERE id = ? AND company_id = ?').get(id, cid);
  if (!b) throw notFound('Bloqueio');
  return { ...b, all_day: !!b.all_day };
};
route('POST', '/api/blocks', async ({ body, cid }) => getBlock(cid, await saveBlock(cid, body)));
route('PUT', '/api/blocks/:id', async ({ params, body, cid }) => {
  const id = idParam(params.id);
  await getBlock(cid, id);
  return getBlock(cid, await saveBlock(cid, body, id));
});
route('DELETE', '/api/blocks/:id', async ({ params, cid }) => {
  const id = idParam(params.id);
  await getBlock(cid, id);
  await db.prepare('DELETE FROM blocks WHERE id = ? AND company_id = ?').run(id, cid);
  return { ok: true };
});

// ---------------------------------------------------------------- Financeiro — RF21–RF25
export const CATEGORIES = {
  in: ['Atendimento', 'Venda de produto', 'Outras entradas'],
  out: ['Materiais', 'Aluguel', 'Marketing', 'Contas (água, luz, internet)', 'Impostos e taxas', 'Equipamentos', 'Cursos', 'Outras saídas'],
};
export const METHODS = ['Pix', 'Cartão de crédito', 'Cartão de débito', 'Dinheiro', 'Transferência'];

route('GET', '/api/finance/meta', () => ({ categories: CATEGORIES, methods: METHODS }));

function monthTx(cid, month, f = {}) {
  if (!/^\d{4}-\d{2}$/.test(month || '')) throw bad('Mês inválido.');
  const where = ['t.company_id = ?', 't.date LIKE ?'];
  const args = [cid, `${month}-%`];
  if (f.type === 'in' || f.type === 'out') (where.push('t.type = ?'), args.push(f.type));
  if (f.category) (where.push('t.category = ?'), args.push(f.category));
  if (f.method) (where.push('t.method = ?'), args.push(f.method));
  return db
    .prepare(
      `SELECT t.*, c.name AS client_name FROM transactions t LEFT JOIN clients c ON c.id = t.client_id
       WHERE ${where.join(' AND ')} ORDER BY t.date DESC, t.id DESC`
    )
    .all(...args);
}

route('GET', '/api/transactions', async ({ query, cid }) => {
  const all = await monthTx(cid, query.month);
  const sum = (type) => all.filter((t) => t.type === type).reduce((s, t) => s + t.amount_cents, 0);
  const income = sum('in'), expense = sum('out'); // RN11
  const byCategory = {};
  for (const t of all) {
    const k = `${t.type}|${t.category}`;
    byCategory[k] = (byCategory[k] || 0) + t.amount_cents;
  }
  return {
    month: query.month,
    summary: { income_cents: income, expense_cents: expense, balance_cents: income - expense },
    by_category: Object.entries(byCategory).map(([k, v]) => ({ type: k.split('|')[0], category: k.split('|')[1], amount_cents: v })).sort((a, b) => b.amount_cents - a.amount_cents),
    items: await monthTx(cid, query.month, query),
  };
});

async function validateTx(cid, body) {
  const type = body.type;
  if (type !== 'in' && type !== 'out') throw bad('Escolha entrada ou saída.', { fields: ['type'] });
  const amount = toCents(body.amount_cents ?? body.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw bad('O valor deve ser maior que zero.', { fields: ['amount'] }); // RN10
  if (!isDate(body.date)) throw bad('Informe a data.', { fields: ['date'] });
  const category = str(body.category, 80);
  if (!category) throw bad('Escolha a categoria.', { fields: ['category'] });
  let clientId = body.client_id ? Number(body.client_id) : null;
  let apptId = body.appointment_id ? Number(body.appointment_id) : null;
  // só aceita cliente/atendimento da própria empresa
  if (clientId && !(await db.prepare('SELECT 1 AS x FROM clients WHERE id = ? AND company_id = ?').get(clientId, cid))) throw bad('Cliente inválida.');
  if (apptId && !(await db.prepare('SELECT 1 AS x FROM appointments WHERE id = ? AND company_id = ?').get(apptId, cid))) throw bad('Atendimento inválido.');
  return { type, amount, date: body.date, category, method: str(body.method, 40), description: str(body.description, 300), clientId, apptId };
}
const getTx = async (cid, id) => {
  const t = await db.prepare('SELECT t.*, c.name AS client_name FROM transactions t LEFT JOIN clients c ON c.id = t.client_id WHERE t.id = ? AND t.company_id = ?').get(id, cid);
  if (!t) throw notFound('Movimentação');
  return t;
};
route('POST', '/api/transactions', async ({ body, cid }) => {
  const v = await validateTx(cid, body);
  if (v.apptId) {
    const ex = await db.prepare('SELECT id FROM transactions WHERE appointment_id = ? AND company_id = ?').get(v.apptId, cid);
    if (ex && !body.allow_duplicate) throw new HttpError(409, 'Já existe uma entrada registrada para este atendimento.', { code: 'duplicate_tx', existing_id: ex.id });
  }
  const t = nowIso();
  const r = await db
    .prepare('INSERT INTO transactions (company_id, type, amount_cents, date, category, method, description, client_id, appointment_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(cid, v.type, v.amount, v.date, v.category, v.method, v.description, v.clientId, v.apptId, t, t);
  return getTx(cid, r.lastInsertRowid);
});
route('PUT', '/api/transactions/:id', async ({ params, body, cid }) => {
  const id = idParam(params.id);
  const cur = await getTx(cid, id);
  const v = await validateTx(cid, { ...body, client_id: body.client_id ?? cur.client_id, appointment_id: body.appointment_id ?? cur.appointment_id });
  await db.prepare('UPDATE transactions SET type=?, amount_cents=?, date=?, category=?, method=?, description=?, client_id=?, appointment_id=?, updated_at=? WHERE id=? AND company_id=?')
    .run(v.type, v.amount, v.date, v.category, v.method, v.description, v.clientId, v.apptId, nowIso(), id, cid);
  return getTx(cid, id);
});
route('DELETE', '/api/transactions/:id', async ({ params, cid }) => {
  const id = idParam(params.id);
  await getTx(cid, id);
  await db.prepare('DELETE FROM transactions WHERE id = ? AND company_id = ?').run(id, cid);
  return { ok: true };
});

// Exportação em planilha (CSV compatível com Excel pt-BR) — RF27
route('GET', '/api/transactions/export', async ({ query, cid }) => {
  const items = (await monthTx(cid, query.month)).slice().reverse();
  const money = (c) => (c / 100).toFixed(2).replace('.', ',');
  const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const lines = [['Data', 'Tipo', 'Categoria', 'Forma de pagamento', 'Descrição', 'Cliente', 'Valor (R$)'].map(q).join(';')];
  let inc = 0, out = 0;
  for (const t of items) {
    if (t.type === 'in') inc += t.amount_cents; else out += t.amount_cents;
    lines.push([fmtBR(t.date), t.type === 'in' ? 'Entrada' : 'Saída', t.category, t.method, t.description, t.client_name, (t.type === 'out' ? '-' : '') + money(t.amount_cents)].map(q).join(';'));
  }
  lines.push('', [q('Total de entradas'), money(inc)].join(';'), [q('Total de saídas'), money(out)].join(';'), [q('Saldo'), money(inc - out)].join(';'));
  return { __raw: '﻿' + lines.join('\r\n'), __type: 'text/csv; charset=utf-8', __filename: `financeiro-${query.month}.csv` };
});

// ---------------------------------------------------------------- Estoque (desejável) — RF28
route('GET', '/api/stock', ({ cid }) => db.prepare('SELECT * FROM stock_items WHERE company_id = ? AND active = 1 ORDER BY lower(name)').all(cid));
const getItem = async (cid, id) => {
  const it = await db.prepare('SELECT * FROM stock_items WHERE id = ? AND company_id = ?').get(id, cid);
  if (!it) throw notFound('Item');
  return it;
};
function validateItem(body) {
  const name = str(body.name, 120);
  if (!name) throw bad('Informe o nome do item.', { fields: ['name'] });
  const min = Number(String(body.min_quantity ?? 0).replace(',', '.'));
  if (!Number.isFinite(min) || min < 0) throw bad('Quantidade mínima inválida.', { fields: ['min_quantity'] });
  return { name, unit: str(body.unit, 20) || 'un', min };
}
route('POST', '/api/stock', async ({ body, cid }) => {
  const v = validateItem(body);
  const qty = Number(String(body.quantity ?? 0).replace(',', '.')) || 0;
  const t = nowIso();
  const r = await db.prepare('INSERT INTO stock_items (company_id, name, unit, quantity, min_quantity, created_at, updated_at) VALUES (?,?,?,?,?,?,?)').run(cid, v.name, v.unit, Math.max(0, qty), v.min, t, t);
  return getItem(cid, r.lastInsertRowid);
});
route('PUT', '/api/stock/:id', async ({ params, body, cid }) => {
  const id = idParam(params.id);
  await getItem(cid, id);
  const v = validateItem(body);
  await db.prepare('UPDATE stock_items SET name=?, unit=?, min_quantity=?, active=?, updated_at=? WHERE id=? AND company_id=?').run(v.name, v.unit, v.min, body.active === false ? 0 : 1, nowIso(), id, cid);
  return getItem(cid, id);
});
route('POST', '/api/stock/:id/move', async ({ params, body, cid }) => {
  const id = idParam(params.id);
  const item = await getItem(cid, id);
  const qty = Number(String(body.quantity ?? '').replace(',', '.'));
  if (!Number.isFinite(qty) || qty <= 0) throw bad('Informe uma quantidade maior que zero.', { fields: ['quantity'] });
  const type = body.type === 'out' ? 'out' : 'in';
  if (type === 'out' && qty > item.quantity) throw bad(`Estoque insuficiente (${item.quantity} ${item.unit}).`);
  await tx(async (t) => {
    await t.prepare('INSERT INTO stock_moves (item_id, type, quantity, date, note, created_at) VALUES (?,?,?,?,?,?)').run(id, type, qty, todayBR(), str(body.note), nowIso());
    await t.prepare('UPDATE stock_items SET quantity = quantity + ?, updated_at = ? WHERE id = ?').run(type === 'in' ? qty : -qty, nowIso(), id);
  });
  return getItem(cid, id);
});
route('GET', '/api/stock/:id/moves', async ({ params, cid }) => {
  const it = await getItem(cid, idParam(params.id));
  return db.prepare('SELECT * FROM stock_moves WHERE item_id = ? ORDER BY id DESC LIMIT 50').all(it.id);
});

// ---------------------------------------------------------------- WhatsApp (robô de confirmação)
route('GET', '/api/whatsapp', async ({ cid }) => {
  const date = targetDate(await getSettings(cid), todayBR());
  return { ...wa.waState(cid), target_date: date, appointments: await wa.appointmentsOn(cid, date) };
});
route('POST', '/api/whatsapp/connect', async ({ body, cid }) => {
  const phone = body.phone ? String(body.phone).replace(/\D/g, '') : null;
  if (phone && phone.length < 10) throw bad('Informe o número do WhatsApp do estúdio com DDD.');
  try { return await wa.connect(cid, { phone }); } catch (e) { throw new HttpError(502, 'Não foi possível iniciar a conexão com o WhatsApp.'); }
});
route('POST', '/api/whatsapp/logout', ({ cid }) => wa.logout(cid), { always: true });
route('POST', '/api/whatsapp/send', async ({ body, cid }) => {
  if (wa.waState(cid).status !== 'connected') throw new HttpError(409, 'Conecte o WhatsApp primeiro.');
  if (body.appointment_id) {
    const a = await getAppointment(cid, idParam(body.appointment_id));
    try { await wa.sendConfirmation(cid, a.id); } catch (e) { throw bad(e.message); }
    return { ok: true, sent: 1 };
  }
  const date = isDate(body.date) ? body.date : targetDate(await getSettings(cid), todayBR());
  return wa.sendBatch(cid, await wa.pendingFor(cid, date));
});

// ---------------------------------------------------------------- Painel do dia
route('GET', '/api/dashboard', async ({ cid }) => {
  const today = todayBR();
  const month = today.slice(0, 7);
  const todays = await listAppointments(cid, 'a.date = ?', [today]);
  const sumTx = async (type, like) => (await db.prepare('SELECT COALESCE(SUM(amount_cents),0) AS s FROM transactions WHERE company_id = ? AND type = ? AND date LIKE ?').get(cid, type, like)).s;
  const inc = await sumTx('in', `${month}-%`);
  const out = await sumTx('out', `${month}-%`);
  const low = (await db.prepare('SELECT COUNT(*) AS n FROM stock_items WHERE company_id = ? AND active = 1 AND quantity <= min_quantity AND min_quantity > 0').get(cid)).n;
  const upcoming = await listAppointments(cid, "a.date > ? AND a.date <= ? AND a.status IN ('agendada','confirmada')", [today, addDays(today, 7)]);
  const counts = await db.prepare('SELECT (SELECT COUNT(*) FROM clients WHERE company_id = ? AND active = 1) AS clients, (SELECT COUNT(*) FROM procedures WHERE company_id = ? AND active = 1) AS procedures').get(cid, cid);
  const pendingAnamnese = (await db.prepare('SELECT COUNT(*) AS n FROM clients c LEFT JOIN anamneses a ON a.client_id = c.id WHERE c.company_id = ? AND c.active = 1 AND (a.consent IS NULL OR a.consent = 0)').get(cid)).n;
  const birthdays = await db.prepare("SELECT id, name, birth_date FROM clients WHERE company_id = ? AND active = 1 AND birth_date IS NOT NULL AND substr(birth_date,6,2) = ? ORDER BY substr(birth_date,9,2)").all(cid, month.slice(5, 7));
  return {
    today, appointments: todays, month_balance_cents: inc - out, month_income_cents: inc, month_expense_cents: out, low_stock: low,
    upcoming, clients: counts.clients, procedures: counts.procedures, pending_anamnese: pendingAnamnese, birthdays,
  };
});

// ---------------------------------------------------------------- Relatórios (somente leitura, calculados dos dados reais)
route('GET', '/api/reports', async ({ query, cid }) => {
  const year = /^\d{4}$/.test(query.year || '') ? query.year : todayBR().slice(0, 4);
  const monthly = await db.prepare(
    `SELECT substr(date,6,2) AS m, type, COALESCE(SUM(amount_cents),0) AS s FROM transactions
     WHERE company_id = ? AND substr(date,1,4) = ? GROUP BY substr(date,6,2), type`
  ).all(cid, year);
  const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, income_cents: 0, expense_cents: 0, appointments: 0 }));
  for (const r of monthly) months[Number(r.m) - 1][r.type === 'in' ? 'income_cents' : 'expense_cents'] = r.s;
  const apptMonths = await db.prepare(
    `SELECT substr(date,6,2) AS m, COUNT(*) AS n FROM appointments WHERE company_id = ? AND substr(date,1,4) = ? AND status NOT IN ('cancelada','faltou') GROUP BY substr(date,6,2)`
  ).all(cid, year);
  for (const r of apptMonths) months[Number(r.m) - 1].appointments = r.n;
  const byStatus = await db.prepare('SELECT status, COUNT(*) AS n FROM appointments WHERE company_id = ? AND substr(date,1,4) = ? GROUP BY status').all(cid, year);
  const topProcedures = await db.prepare(
    `SELECT ap.name, COUNT(*) AS n, COALESCE(SUM(ap.price_cents),0) AS total_cents FROM appointment_procedures ap JOIN appointments a ON a.id = ap.appointment_id
     WHERE a.company_id = ? AND substr(a.date,1,4) = ? AND a.status NOT IN ('cancelada','faltou') GROUP BY ap.name ORDER BY n DESC, total_cents DESC LIMIT 8`
  ).all(cid, year);
  const topClients = await db.prepare(
    `SELECT c.id, c.name, COUNT(*) AS visits, COALESCE(SUM(a.total_cents),0) AS total_cents FROM appointments a JOIN clients c ON c.id = a.client_id
     WHERE a.company_id = ? AND substr(a.date,1,4) = ? AND a.status = 'concluida' GROUP BY c.id, c.name ORDER BY total_cents DESC LIMIT 8`
  ).all(cid, year);
  const methods = await db.prepare(
    `SELECT COALESCE(method,'Não informado') AS method, COALESCE(SUM(amount_cents),0) AS total_cents FROM transactions
     WHERE company_id = ? AND type = 'in' AND substr(date,1,4) = ? GROUP BY COALESCE(method,'Não informado') ORDER BY total_cents DESC`
  ).all(cid, year);
  const newClients = (await db.prepare('SELECT COUNT(*) AS n FROM clients WHERE company_id = ? AND substr(created_at,1,4) = ?').get(cid, year)).n;
  return { year: Number(year), months, by_status: byStatus, top_procedures: topProcedures, top_clients: topClients, methods, new_clients: newClients };
});

// ---------------------------------------------------------------- Cópia de segurança (download)
// Cópia de uma empresa (download pela própria dona — portabilidade de dados, LGPD art. 18)
const EXPORT_SQL = {
  clients: 'SELECT * FROM clients WHERE company_id = ? ORDER BY id',
  anamneses: 'SELECT an.* FROM anamneses an JOIN clients c ON c.id = an.client_id WHERE c.company_id = ? ORDER BY an.client_id',
  procedures: 'SELECT * FROM procedures WHERE company_id = ? ORDER BY id',
  appointments: 'SELECT * FROM appointments WHERE company_id = ? ORDER BY id',
  appointment_procedures: 'SELECT ap.* FROM appointment_procedures ap JOIN appointments a ON a.id = ap.appointment_id WHERE a.company_id = ? ORDER BY ap.id',
  blocks: 'SELECT * FROM blocks WHERE company_id = ? ORDER BY id',
  transactions: 'SELECT * FROM transactions WHERE company_id = ? ORDER BY id',
  stock_items: 'SELECT * FROM stock_items WHERE company_id = ? ORDER BY id',
  stock_moves: 'SELECT m.* FROM stock_moves m JOIN stock_items i ON i.id = m.item_id WHERE i.company_id = ? ORDER BY m.id',
  settings: 'SELECT key, value FROM company_settings WHERE company_id = ? ORDER BY key',
};
export async function exportCompany(cid) {
  const c = await getCompany(cid);
  const dump = { app: 'Lola', format: 2, company: { id: c.id, name: c.name }, exported_at: nowIso(), tables: {} };
  for (const [t, sql] of Object.entries(EXPORT_SQL)) dump.tables[t] = await db.prepare(sql).all(cid);
  return dump;
}
/** Cópia completa da plataforma (todas as empresas) — usada no backup diário do servidor */
export async function exportAll() {
  const tables = ['companies', 'payments', 'clients', 'anamneses', 'procedures', 'appointments', 'appointment_procedures', 'blocks', 'transactions', 'stock_items', 'stock_moves', 'company_settings', 'settings'];
  const dump = { app: 'Lola', format: 2, scope: 'platform', exported_at: nowIso(), tables: {} };
  for (const t of tables) dump.tables[t] = await db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all();
  return dump;
}
route('GET', '/api/backup', async ({ cid }) => ({
  __raw: JSON.stringify(await exportCompany(cid), null, 1), __type: 'application/json', __filename: `lola-backup-${todayBR()}.json`,
}));

// =====================================================================
// Painel do proprietário da plataforma (/admin) — somente usuário "platform"
// =====================================================================
const P = { platform: true };
const STATES = ['trial', 'active', 'expired', 'suspended', 'canceled'];

async function companyRows() {
  const rows = await db.prepare(
    `SELECT co.*, u.email AS owner_email, u.last_login_at, u.env_managed,
       (SELECT COUNT(*) FROM clients c WHERE c.company_id = co.id) AS clients,
       (SELECT COUNT(*) FROM appointments a WHERE a.company_id = co.id) AS appointments,
       (SELECT COALESCE(SUM(amount_cents),0) FROM payments p WHERE p.company_id = co.id) AS paid_total_cents
     FROM companies co LEFT JOIN users u ON u.id = (SELECT MIN(id) FROM users WHERE company_id = co.id AND role = 'owner')
     ORDER BY co.id DESC`
  ).all();
  const today = todayBR();
  return rows.map((c) => {
    const acc = companyAccess(c, today);
    return {
      id: c.id, name: c.name, owner_name: c.owner_name, email: c.owner_email || c.email, phone: c.phone, city: c.city, segment: c.segment,
      status: c.status, state: acc.state, days_left: acc.days_left ?? null, trial_ends_at: c.trial_ends_at, paid_until: c.paid_until,
      price_cents: c.price_cents, notes: c.notes, clients: c.clients, appointments: c.appointments, paid_total_cents: c.paid_total_cents,
      last_login_at: c.last_login_at, env_managed: !!c.env_managed, created_at: c.created_at,
    };
  });
}

route('GET', '/api/admin/overview', async () => {
  const list = await companyRows();
  const today = todayBR();
  const by = Object.fromEntries(STATES.map((s) => [s, list.filter((c) => c.state === s).length]));
  const paying = list.filter((c) => c.state === 'active' && c.paid_until);
  const months = [];
  for (let i = 11; i >= 0; i--) months.push(addMonthsDate(today.slice(0, 7) + '-01', -i).slice(0, 7));
  const pay = await db.prepare('SELECT substr(paid_at,1,7) AS m, COALESCE(SUM(amount_cents),0) AS s, COUNT(*) AS n FROM payments WHERE paid_at >= ? GROUP BY substr(paid_at,1,7)').all(months[0] + '-01');
  const payBy = new Map(pay.map((p) => [p.m, p]));
  return {
    today,
    totals: {
      companies: list.length, ...by,
      paying: paying.length,
      courtesy: list.filter((c) => c.state === 'active' && !c.paid_until).length,
      mrr_cents: paying.reduce((s, c) => s + c.price_cents, 0),
      trials_ending_3d: list.filter((c) => c.state === 'trial' && c.days_left <= 3).length,
      renewals_7d: list.filter((c) => c.state === 'active' && c.paid_until && diffDays(today, c.paid_until) <= 7).length,
      signups_30d: list.filter((c) => c.created_at >= new Date(Date.now() - 30 * 864e5).toISOString()).length,
    },
    revenue: months.map((m) => ({ month: m, amount_cents: payBy.get(m)?.s || 0, payments: payBy.get(m)?.n || 0 })),
    expiring: list.filter((c) => (c.state === 'trial' && c.days_left <= 5) || (c.state === 'active' && c.paid_until && diffDays(today, c.paid_until) <= 7) || c.state === 'expired')
      .sort((a, b) => String(a.paid_until || a.trial_ends_at).localeCompare(String(b.paid_until || b.trial_ends_at))).slice(0, 12),
    recent: list.slice(0, 6),
  };
}, P);

route('GET', '/api/admin/companies', async ({ query }) => {
  let list = await companyRows();
  if (STATES.includes(query.state)) list = list.filter((c) => c.state === query.state);
  const q = norm(query.q);
  if (q) list = list.filter((c) => norm(`${c.name} ${c.owner_name} ${c.email} ${c.phone} ${c.city}`).includes(q) || digits(c.phone).includes(digits(q) || '#'));
  return list;
}, P);

async function adminCompany(id) {
  const c = (await companyRows()).find((x) => x.id === id);
  if (!c) throw notFound('Empresa');
  return c;
}
route('GET', '/api/admin/companies/:id', async ({ params }) => {
  const c = await adminCompany(idParam(params.id));
  const payments = await db.prepare('SELECT * FROM payments WHERE company_id = ? ORDER BY paid_at DESC, id DESC').all(c.id);
  return { ...c, payments };
}, P);

// cria a conta de uma cliente que contratou pelo WhatsApp: devolve um link para ela definir a própria senha
route('POST', '/api/admin/companies', async ({ body }) => {
  const company = str(body.company, 120), owner_name = str(body.name, 120);
  const email = String(body.email || '').trim().toLowerCase();
  const fields = [];
  if (!company) fields.push('company');
  if (!owner_name) fields.push('name');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fields.push('email');
  if (fields.length) throw bad('Preencha empresa, nome e e-mail válidos.', { fields });
  if (await db.prepare('SELECT 1 AS x FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'Já existe uma conta com este e-mail.', { fields: ['email'] });
  const tmp = (await import('node:crypto')).randomBytes(18).toString('base64url');
  const r = await createCompany({ company, owner_name, email, password: tmp, phone: str(body.phone, 30), city: str(body.city, 80), segment: str(body.segment, 80) });
  const token = await createResetToken(r.user_id, 72);
  return { ...(await adminCompany(r.company_id)), setup_link: `/redefinir-senha/?token=${token}&novo=1` };
}, P);

route('PUT', '/api/admin/companies/:id', async ({ params, body }) => {
  const c = await adminCompany(idParam(params.id));
  const status = body.status ?? c.status;
  if (!['trial', 'active', 'suspended', 'canceled'].includes(status)) throw bad('Situação inválida.');
  for (const k of ['trial_ends_at', 'paid_until']) if (body[k] && !isDate(body[k])) throw bad('Data inválida.', { fields: [k] });
  const price = body.price_cents != null ? toCents(body.price_cents) : c.price_cents;
  if (!Number.isFinite(price) || price < 0) throw bad('Valor inválido.', { fields: ['price_cents'] });
  const pick = (k, max = 200) => (k in body ? str(body[k], max) : c[k]);
  await db.prepare('UPDATE companies SET name=?, owner_name=?, phone=?, city=?, notes=?, status=?, trial_ends_at=?, paid_until=?, price_cents=?, updated_at=? WHERE id=?').run(
    pick('name', 120) || c.name, pick('owner_name', 120), pick('phone', 30), pick('city', 80), pick('notes', 2000), status,
    'trial_ends_at' in body ? body.trial_ends_at || null : c.trial_ends_at, 'paid_until' in body ? body.paid_until || null : c.paid_until, price, nowIso(), c.id
  );
  return adminCompany(c.id);
}, P);

// registra um pagamento recebido (Pix, cartão…) e estende a assinatura
route('POST', '/api/admin/companies/:id/payments', async ({ params, body }) => {
  const c = await adminCompany(idParam(params.id));
  const amount = toCents(body.amount_cents ?? body.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw bad('Informe o valor recebido.', { fields: ['amount'] });
  const paidAt = isDate(body.paid_at) ? body.paid_at : todayBR();
  const months = Math.max(1, Math.min(24, Number(body.months) || 1));
  const today = todayBR();
  const start = c.paid_until && c.paid_until >= today ? addDays(c.paid_until, 1) : (c.state === 'trial' && c.trial_ends_at >= paidAt ? addDays(c.trial_ends_at, 1) : paidAt);
  const end = addDays(addMonthsDate(start, months), -1);
  await tx(async (t) => {
    await t.prepare('INSERT INTO payments (company_id, amount_cents, paid_at, method, period_start, period_end, provider, note, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(c.id, amount, paidAt, str(body.method, 40) || 'Pix', start, end, 'manual', str(body.note, 300), nowIso());
    await t.prepare("UPDATE companies SET paid_until = ?, status = 'active', updated_at = ? WHERE id = ?").run(end, nowIso(), c.id);
  });
  return adminCompany(c.id);
}, P);

route('DELETE', '/api/admin/payments/:id', async ({ params }) => {
  const p = await db.prepare('SELECT * FROM payments WHERE id = ?').get(idParam(params.id));
  if (!p) throw notFound('Pagamento');
  await tx(async (t) => {
    await t.prepare('DELETE FROM payments WHERE id = ?').run(p.id);
    const last = await t.prepare('SELECT MAX(period_end) AS e FROM payments WHERE company_id = ?').get(p.company_id);
    // sem pagamentos restantes, volta a valer o teste grátis (ou fica vencida); "ativa sem vencimento" só se o proprietário definir
    await t.prepare(`UPDATE companies SET paid_until = ?, status = CASE WHEN CAST(? AS text) IS NULL AND status = 'active' THEN 'trial' ELSE status END, updated_at = ? WHERE id = ?`)
      .run(last?.e || null, last?.e || null, nowIso(), p.company_id);
  });
  return adminCompany(p.company_id);
}, P);

route('GET', '/api/admin/payments', async ({ query }) => {
  const month = /^\d{4}-\d{2}$/.test(query.month || '') ? query.month : null;
  return db.prepare(
    `SELECT p.*, c.name AS company_name FROM payments p JOIN companies c ON c.id = p.company_id
     ${month ? 'WHERE p.paid_at LIKE ?' : ''} ORDER BY p.paid_at DESC, p.id DESC LIMIT 500`
  ).all(...(month ? [`${month}-%`] : []));
}, P);

// gera um link de redefinição de senha para enviar à cliente pelo WhatsApp (válido por 24 h)
route('POST', '/api/admin/companies/:id/reset-link', async ({ params }) => {
  const c = await adminCompany(idParam(params.id));
  const u = await db.prepare("SELECT * FROM users WHERE company_id = ? AND role = 'owner' ORDER BY id LIMIT 1").get(c.id);
  if (!u) throw notFound('Usuária');
  if (u.env_managed) throw new HttpError(409, 'O acesso desta empresa é definido nas variáveis do servidor (ADMIN_EMAIL/ADMIN_PASSWORD).', { code: 'account_managed' });
  return { link: `/redefinir-senha/?token=${await createResetToken(u.id, 24)}`, email: u.email, phone: c.phone };
}, P);
