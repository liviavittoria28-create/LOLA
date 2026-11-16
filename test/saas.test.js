// Testes da Lola como SaaS: cadastro, isolamento entre empresas, assinatura,
// painel do proprietário, recuperação de senha, site público e migração dos dados antigos.
// Rodar: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 5950 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = { email: 'esther@lola.test', password: 'SenhaEsther123' };
const OWNER = { email: 'dono@lola.test', password: 'SenhaDono12345' };
let server, log = '';
const dirs = [];

function startServer(dataDir, extraEnv = {}) {
  return new Promise(async (resolve, reject) => {
    const proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], {
      cwd: ROOT,
      env: {
        ...process.env, NO_DOTENV: '1', PORT: String(PORT), DATA_DIR: dataDir, TRUST_PROXY: '1', NODE_ENV: 'test', WHATSAPP: '0', MAIL_LOG: '1',
        ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password, ADMIN_NAME: 'Esther', PLATFORM_EMAIL: OWNER.email, PLATFORM_PASSWORD: OWNER.password,
        DATABASE_URL: process.env.SAAS_DATABASE_URL || '', ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.stdout.on('data', (c) => (log += c));
    proc.stderr.on('data', (c) => (log += c));
    proc.on('exit', (code) => reject(Object.assign(new Error('Servidor encerrou:\n' + log), { code })));
    for (let i = 0; i < 80; i++) {
      try { if ((await fetch(BASE + '/api/health')).ok) return resolve(proc); } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    reject(new Error('Servidor não subiu:\n' + log));
  });
}
const stopServer = (proc) => new Promise((r) => { proc.removeAllListeners('exit'); proc.once('exit', r); proc.kill(); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'lola-')); dirs.push(d); return d; };

/** Sessão de navegador simples (guarda o cookie) */
function session(ip = '10.9.0.' + Math.floor(Math.random() * 250)) {
  let cookie = '';
  const req = async (method, p, body, headers = {}) => {
    const res = await fetch(BASE + p, {
      method, redirect: 'manual',
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), 'X-Forwarded-For': ip, ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.getSetCookie();
    if (set.length) cookie = set[0].split(';')[0];
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, text, headers: res.headers };
  };
  return {
    get: (p) => req('GET', p), post: (p, b) => req('POST', p, b || {}), put: (p, b) => req('PUT', p, b), del: (p) => req('DELETE', p), patch: (p, b) => req('PATCH', p, b),
    get cookie() { return cookie; },
  };
}

before(async () => { server = await startServer(tmp()); });
after(async () => {
  if (server) await stopServer(server);
  setTimeout(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })), 300);
});

const A = session(), B = session(), owner = session(), esther = session();
const ids = {};
const F = '2031-05-12';

// ------------------------------------------------------------------ Site público
test('site comercial: página inicial pública com preço, teste grátis e WhatsApp', async () => {
  const r = await session().get('/');
  assert.equal(r.status, 200);
  assert.match(r.text, /Lola/);
  assert.match(r.text, /49,90/);
  assert.match(r.text, /15 dias/);
  assert.match(r.text, /https:\/\/wa\.me\/5511962822060\?text=/);
  for (const p of ['/cadastro/', '/entrar/', '/esqueci-senha/', '/redefinir-senha/', '/privacidade/', '/termos/', '/app/', '/admin/']) {
    const x = await session().get(p);
    assert.equal(x.status, 200, p);
    assert.match(x.text, /<html lang="pt-BR">/, p);
  }
  assert.equal((await session().get('/cadastro')).status, 301, 'sem barra redireciona');
});

test('todos os links de WhatsApp do site apontam para o número comercial com mensagem pronta', async () => {
  const pages = ['/', '/cadastro/', '/entrar/', '/privacidade/', '/termos/', '/404.html'];
  let n = 0;
  for (const p of pages) {
    const html = (await session().get(p)).text;
    for (const m of html.matchAll(/https:\/\/wa\.me\/[^"'\s<)]*/g)) {
      n++;
      assert.match(m[0], /^https:\/\/wa\.me\/5511962822060\?text=[^&]+$/, `${p}: ${m[0]}`);
      assert.ok(decodeURIComponent(m[0].split('text=')[1]).length > 10, 'mensagem automática');
    }
  }
  assert.ok(n >= 6, `links encontrados: ${n}`);
});

// ------------------------------------------------------------------ Cadastro
test('cadastro: validações e aceite dos termos', async () => {
  const s = session();
  let r = await s.post('/api/signup', { company: '', name: '', email: 'x', phone: '1', password: '123' });
  assert.equal(r.status, 400);
  assert.deepEqual(r.data.fields.sort(), ['company', 'email', 'name', 'password', 'phone']);
  r = await s.post('/api/signup', { company: 'Studio X', name: 'Ana', email: 'ana@x.test', phone: '(11) 98888-7777', password: 'SenhaBoa123' });
  assert.equal(r.status, 400);
  assert.deepEqual(r.data.fields, ['accept_terms']);
});

test('cadastro: cria a empresa com 15 dias grátis, já logada e começando vazia', async () => {
  const r = await A.post('/api/signup', { company: 'Studio Rosa', name: 'Rosa Lima', email: 'rosa@studio.test', phone: '(11) 98888-1111', password: 'SenhaRosa123', accept_terms: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.trial_days, 15);
  const me = (await A.get('/api/me')).data;
  assert.equal(me.company.name, 'Studio Rosa');
  assert.equal(me.subscription.state, 'trial');
  assert.equal(me.subscription.days_left, 14, 'hoje conta como o 1º dos 15 dias');
  assert.equal(me.subscription.price_cents, 4990);
  assert.equal(me.settings.studio_name, 'Studio Rosa');
  assert.doesNotMatch(me.settings.whatsapp_template, /Aiapaina/, 'não herda dados do estúdio original');
  assert.deepEqual((await A.get('/api/procedures')).data, []);
  assert.deepEqual((await A.get('/api/clients')).data, []);
  const dup = await session().post('/api/signup', { company: 'Outro', name: 'Outra', email: 'ROSA@studio.test', phone: '(11) 98888-2222', password: 'SenhaOutra123', accept_terms: true });
  assert.equal(dup.status, 409);
  assert.equal(dup.data.code, 'email_taken');
});

// ------------------------------------------------------------------ Isolamento entre empresas
test('isolamento: cada empresa só vê e altera os próprios dados', async () => {
  assert.equal((await B.post('/api/signup', { company: 'Salão Bela', name: 'Bela', email: 'bela@salao.test', phone: '(21) 97777-0000', password: 'SenhaBela123', accept_terms: true })).status, 200);
  // dados da empresa A
  ids.procA = (await A.post('/api/procedures', { name: 'Manicure', price_cents: 4000, duration_min: 60 })).data.id;
  ids.cliA = (await A.post('/api/clients', { name: 'Cliente da Rosa', phone: '(11) 91234-5678' })).data.id;
  const ap = await A.post('/api/appointments', { client_id: ids.cliA, procedure_ids: [ids.procA], date: F, start: '10:00' });
  assert.equal(ap.status, 200, JSON.stringify(ap.data));
  ids.apA = ap.data.id;
  ids.txA = (await A.post('/api/transactions', { type: 'in', amount_cents: 4000, date: F, category: 'Atendimento', client_id: ids.cliA })).data.id;
  ids.blkA = (await A.post('/api/blocks', { reason: 'Folga', start_date: '2031-05-20' })).data.id;
  ids.stkA = (await A.post('/api/stock', { name: 'Esmalte', quantity: 5 })).data.id;

  // B não enxerga nada de A
  assert.deepEqual((await B.get('/api/clients')).data, []);
  assert.deepEqual((await B.get('/api/procedures?all=1')).data, []);
  assert.deepEqual((await B.get(`/api/appointments?from=${F}&to=${F}`)).data, { appointments: [], blocks: [] });
  assert.deepEqual((await B.get('/api/transactions?month=2031-05')).data.items, []);
  assert.deepEqual((await B.get('/api/stock')).data, []);
  assert.deepEqual((await B.get('/api/blocks?from=2031-01-01')).data, []);
  // nem por id
  for (const p of [`/api/clients/${ids.cliA}`, `/api/appointments/${ids.apA}`, `/api/stock/${ids.stkA}/moves`]) assert.equal((await B.get(p)).status, 404, p);
  for (const [m, p, body] of [
    ['put', `/api/clients/${ids.cliA}`, { name: 'Hack', phone: '(11) 90000-0000' }],
    ['del', `/api/clients/${ids.cliA}`],
    ['put', `/api/clients/${ids.cliA}/anamnese`, { consent: true }],
    ['post', `/api/clients/${ids.cliA}/active`, { active: false }],
    ['put', `/api/procedures/${ids.procA}`, { name: 'X', price_cents: 1, duration_min: 10 }],
    ['put', `/api/appointments/${ids.apA}`, { client_id: ids.cliA, procedure_ids: [ids.procA], date: F, start: '11:00' }],
    ['patch', `/api/appointments/${ids.apA}/status`, { status: 'concluida' }],
    ['del', `/api/appointments/${ids.apA}`],
    ['put', `/api/transactions/${ids.txA}`, { type: 'out', amount_cents: 1, date: F, category: 'Materiais' }],
    ['del', `/api/transactions/${ids.txA}`],
    ['put', `/api/blocks/${ids.blkA}`, { reason: 'x', start_date: '2031-05-21' }],
    ['del', `/api/blocks/${ids.blkA}`],
    ['put', `/api/stock/${ids.stkA}`, { name: 'x' }],
    ['post', `/api/stock/${ids.stkA}/move`, { type: 'out', quantity: 1 }],
  ]) assert.equal((await B[m](p, body)).status, 404, `${m} ${p}`);
  // não consegue usar cliente/procedimento/atendimento de A nos próprios cadastros
  const procB = (await B.post('/api/procedures', { name: 'Escova', price_cents: 6000, duration_min: 45 })).data.id;
  const cliB = (await B.post('/api/clients', { name: 'Cliente da Bela', phone: '(11) 91234-5678' })).data;
  assert.equal(cliB.name, 'Cliente da Bela', 'o mesmo telefone pode existir em empresas diferentes');
  assert.equal((await B.post('/api/appointments', { client_id: ids.cliA, procedure_ids: [procB], date: F, start: '10:00' })).status, 400);
  assert.equal((await B.post('/api/appointments', { client_id: cliB.id, procedure_ids: [ids.procA], date: F, start: '10:00' })).status, 400);
  assert.equal((await B.post('/api/appointments/check', { id: ids.apA, client_id: cliB.id, procedure_ids: [procB], date: F, start: '10:00' })).status, 404);
  assert.equal((await B.post('/api/transactions', { type: 'in', amount_cents: 100, date: F, category: 'Atendimento', client_id: ids.cliA })).status, 400);
  assert.equal((await B.post('/api/transactions', { type: 'in', amount_cents: 100, date: F, category: 'Atendimento', appointment_id: ids.apA })).status, 400);
  // a agenda de B não conflita com a de A no mesmo horário
  assert.equal((await B.post('/api/appointments', { client_id: cliB.id, procedure_ids: [procB], date: F, start: '10:00' })).status, 200);
  // A continua intacta
  assert.equal((await A.get(`/api/clients/${ids.cliA}`)).data.name, 'Cliente da Rosa');
  assert.equal((await A.get(`/api/appointments/${ids.apA}`)).data.status, 'agendada');
  // ajustes, painel, relatórios e cópia de segurança separados
  await B.put('/api/settings', { whatsapp_template: 'Mensagem da Bela' });
  assert.notEqual((await A.get('/api/settings')).data.whatsapp_template, 'Mensagem da Bela');
  assert.equal((await B.get('/api/dashboard')).data.clients, 1);
  assert.equal((await A.get('/api/reports?year=2031')).data.months[4].income_cents, 4000);
  assert.equal((await B.get('/api/reports?year=2031')).data.months[4].income_cents, 0);
  const bk = (await B.get('/api/backup')).data;
  assert.equal(bk.company.name, 'Salão Bela');
  assert.equal(bk.tables.clients.length, 1);
  assert.ok(bk.tables.clients.every((c) => c.company_id === bk.company.id));
  assert.ok(!JSON.stringify(bk).includes('Cliente da Rosa'));
});

// ------------------------------------------------------------------ Perfis
test('perfis: painel do proprietário só para o proprietário', async () => {
  assert.equal((await session().get('/api/admin/overview')).status, 401);
  assert.equal((await A.get('/api/admin/overview')).status, 403);
  assert.equal((await A.get('/api/admin/companies')).status, 403);
  const l = await owner.post('/api/login', OWNER);
  assert.equal(l.status, 200);
  assert.equal(l.data.redirect, '/admin/');
  assert.equal((await owner.get('/api/clients')).status, 403, 'o proprietário não lê dados das clientes das empresas');
  assert.equal((await owner.get('/api/admin/overview')).status, 200);
});

test('painel do proprietário: empresas, testes, assinaturas e receita recorrente', async () => {
  const o = (await owner.get('/api/admin/overview')).data;
  assert.equal(o.totals.companies, 3, 'Esther + Rosa + Bela');
  assert.equal(o.totals.trial, 2);
  assert.equal(o.totals.courtesy, 1, 'empresa original ativa sem vencimento');
  assert.equal(o.totals.mrr_cents, 0);
  const list = (await owner.get('/api/admin/companies?state=trial')).data;
  assert.deepEqual(list.map((c) => c.name).sort(), ['Salão Bela', 'Studio Rosa']);
  ids.rosa = list.find((c) => c.name === 'Studio Rosa').id;
  assert.equal((await owner.get('/api/admin/companies?q=bela')).data.length, 1);
});

// ------------------------------------------------------------------ Assinatura
test('assinatura vencida: consulta liberada, alterações bloqueadas no servidor', async () => {
  const r = await owner.put(`/api/admin/companies/${ids.rosa}`, { trial_ends_at: '2020-01-01' });
  assert.equal(r.status, 200);
  assert.equal(r.data.state, 'expired');
  const me = (await A.get('/api/me')).data;
  assert.equal(me.subscription.state, 'expired');
  assert.equal(me.subscription.can_write, false);
  assert.equal((await A.get('/api/clients')).status, 200, 'consulta liberada');
  assert.equal((await A.get('/api/backup')).status, 200, 'cópia de segurança liberada (LGPD)');
  const w = await A.post('/api/clients', { name: 'Nova', phone: '(11) 95555-5555' });
  assert.equal(w.status, 402);
  assert.equal(w.data.code, 'subscription_inactive');
  assert.equal(w.data.whatsapp, '5511962822060');
  assert.equal((await A.patch(`/api/appointments/${ids.apA}/status`, { status: 'concluida' })).status, 402);
  assert.equal((await A.del(`/api/transactions/${ids.txA}`)).status, 402);
});

test('pagamento registrado pelo proprietário reativa e entra no histórico e na receita', async () => {
  const today = (await owner.get('/api/admin/overview')).data.today;
  const r = await owner.post(`/api/admin/companies/${ids.rosa}/payments`, { amount: '49,90', method: 'Pix', months: 1, paid_at: today });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.state, 'active');
  assert.ok(r.data.paid_until > today);
  assert.equal((await A.post('/api/clients', { name: 'Nova', phone: '(11) 95555-5555' })).status, 200, 'pode alterar de novo');
  const det = (await owner.get(`/api/admin/companies/${ids.rosa}`)).data;
  assert.equal(det.payments.length, 1);
  assert.equal(det.payments[0].amount_cents, 4990);
  const o = (await owner.get('/api/admin/overview')).data;
  assert.equal(o.totals.paying, 1);
  assert.equal(o.totals.mrr_cents, 4990);
  assert.equal(o.revenue.at(-1).amount_cents, 4990);
  assert.equal((await owner.get('/api/admin/payments')).data.length, 1);
  // excluir o pagamento volta o vencimento
  const d = await owner.del(`/api/admin/payments/${det.payments[0].id}`);
  assert.equal(d.data.paid_until, null);
  assert.equal(d.data.state, 'expired');
  await owner.post(`/api/admin/companies/${ids.rosa}/payments`, { amount: 99.8, months: 2 });
  assert.equal((await A.get('/api/me')).data.subscription.state, 'active');
});

test('empresa suspensa não altera dados', async () => {
  await owner.put(`/api/admin/companies/${ids.rosa}`, { status: 'suspended' });
  assert.equal((await A.post('/api/clients', { name: 'X', phone: '(11) 94444-4444' })).status, 402);
  await owner.put(`/api/admin/companies/${ids.rosa}`, { status: 'active' });
  assert.equal((await A.post('/api/clients', { name: 'X', phone: '(11) 94444-4444' })).status, 200);
});

// ------------------------------------------------------------------ Senhas
test('troca de senha pela própria dona', async () => {
  assert.equal((await A.put('/api/account', { current_password: 'errada', new_password: 'NovaSenha123' })).status, 400);
  const other = session();
  assert.equal((await other.post('/api/login', { email: 'rosa@studio.test', password: 'SenhaRosa123' })).status, 200);
  assert.equal((await A.put('/api/account', { current_password: 'SenhaRosa123', new_password: 'NovaSenha123' })).status, 200);
  assert.equal((await A.get('/api/me')).status, 200, 'sessão atual continua');
  assert.equal((await other.get('/api/me')).status, 401, 'outras sessões encerradas');
  assert.equal((await session().post('/api/login', { email: 'rosa@studio.test', password: 'NovaSenha123' })).status, 200);
});

test('recuperação de senha por e-mail: link de uso único', async () => {
  const unknown = await session().post('/api/password/forgot', { email: 'ninguem@x.test' });
  const known = await session().post('/api/password/forgot', { email: 'rosa@studio.test' });
  assert.deepEqual(unknown.data, known.data, 'não revela se o e-mail existe');
  let token;
  for (let i = 0; i < 20 && !token; i++) { token = log.match(/redefinir-senha\/\?token=([\w-]+)/)?.[1]; if (!token) await new Promise((r) => setTimeout(r, 100)); }
  assert.ok(token, 'e-mail com o link (MAIL_LOG)');
  assert.equal((await session().get(`/api/password/reset?token=${token}`)).data.valid, true);
  assert.equal((await session().post('/api/password/reset', { token, password: 'curta' })).status, 400);
  assert.equal((await session().post('/api/password/reset', { token, password: 'SenhaRecuperada1' })).status, 200);
  assert.equal((await session().post('/api/password/reset', { token, password: 'OutraSenha999' })).status, 400, 'não reutiliza');
  assert.equal((await A.get('/api/me')).status, 401, 'sessões antigas encerradas');
  assert.equal((await A.post('/api/login', { email: 'rosa@studio.test', password: 'SenhaRecuperada1' })).status, 200);
});

test('venda pelo WhatsApp: proprietário cria a conta e envia o link para a cliente definir a senha', async () => {
  const r = await owner.post('/api/admin/companies', { company: 'Clínica Nude', name: 'Nina', email: 'nina@nude.test', phone: '(11) 93333-2222' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.state, 'trial');
  const token = new URL(BASE + r.data.setup_link).searchParams.get('token');
  assert.equal((await session().post('/api/password/reset', { token, password: 'SenhaDaNina123' })).status, 200);
  const nina = session();
  assert.equal((await nina.post('/api/login', { email: 'nina@nude.test', password: 'SenhaDaNina123' })).status, 200);
  assert.equal((await nina.get('/api/me')).data.company.name, 'Clínica Nude');
  const link = await owner.post(`/api/admin/companies/${r.data.id}/reset-link`);
  assert.match(link.data.link, /^\/redefinir-senha\/\?token=/);
});

test('acesso da empresa original continua pelas variáveis de ambiente', async () => {
  const l = await esther.post('/api/login', ADMIN);
  assert.equal(l.status, 200);
  assert.equal(l.data.redirect, '/app/');
  const me = (await esther.get('/api/me')).data;
  assert.equal(me.company.name, 'Esther Lino Bio Estética');
  assert.equal(me.subscription.state, 'active');
  assert.equal((await esther.get('/api/procedures')).data.length, 9, 'catálogo original');
  assert.equal((await esther.put('/api/account', { current_password: ADMIN.password, new_password: 'Outra12345' })).data.code, 'account_managed');
  const rl = await owner.post(`/api/admin/companies/${me.company.id}/reset-link`);
  assert.equal(rl.status, 409);
});

test('logada, a página inicial leva direto ao sistema (inclusive o app instalado antigo)', async () => {
  const r = await esther.get('/');
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/app/');
  assert.equal((await owner.get('/')).headers.get('location'), '/admin/');
});

// ------------------------------------------------------------------ Migração do Agenda Expert
test('migração: banco do Agenda Expert vira a empresa nº 1 sem perder nada', async () => {
  await stopServer(server);
  server = null;
  const dir = tmp();
  // cria um banco exatamente como o do Agenda Expert (schema da 1ª versão) com dados
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = await PGlite.create(path.join(dir, 'pgdata'));
  await pg.exec(fs.readFileSync(path.join(ROOT, 'test/fixtures/agenda-expert-v1-schema.sql'), 'utf8'));
  const t = new Date().toISOString();
  await pg.query("INSERT INTO users (email, name, password_hash, created_at, updated_at) VALUES ('antigo@studio.test','Esther','scrypt$x$y',$1,$1)", [t]);
  await pg.query("INSERT INTO settings (key, value) VALUES ('studio_name','Esther Lino Bio Estética'), ('whatsapp_template','Modelo personalizado da Esther'), ('open_time','09:00')");
  await pg.query("INSERT INTO procedures (name, price_cents, duration_min, created_at, updated_at) VALUES ('Lash lifting', 18000, 60, $1, $1)", [t]);
  await pg.query("INSERT INTO clients (name, phone, phone_digits, created_at, updated_at) VALUES ('Maria Antiga', '(11) 98765-4321', '11987654321', $1, $1)", [t]);
  await pg.query("INSERT INTO appointments (client_id, date, start_at, end_at, status, total_cents, duration_min, created_at, updated_at) VALUES (1, '2031-02-02', '2031-02-02T10:00:00-03:00', '2031-02-02T11:00:00-03:00', 'concluida', 18000, 60, $1, $1)", [t]);
  await pg.query("INSERT INTO appointment_procedures (appointment_id, procedure_id, name, price_cents, duration_min) VALUES (1, 1, 'Lash lifting', 18000, 60)");
  await pg.query("INSERT INTO transactions (type, amount_cents, date, category, client_id, appointment_id, created_at, updated_at) VALUES ('in', 18000, '2031-02-02', 'Atendimento', 1, 1, $1, $1)", [t]);
  await pg.query("INSERT INTO wa_auth (key, value) VALUES ('creds', '{\"x\":1}')");
  await pg.close();

  server = await startServer(dir, { ADMIN_EMAIL: 'antigo@studio.test', ADMIN_PASSWORD: 'SenhaAntiga123', DATABASE_URL: '' });
  const s = session();
  assert.equal((await s.post('/api/login', { email: 'antigo@studio.test', password: 'SenhaAntiga123' })).status, 200);
  const me = (await s.get('/api/me')).data;
  assert.equal(me.company.name, 'Esther Lino Bio Estética');
  assert.equal(me.subscription.state, 'active');
  assert.equal(me.settings.whatsapp_template, 'Modelo personalizado da Esther', 'ajustes preservados');
  assert.equal(me.settings.open_time, '09:00');
  const clients = (await s.get('/api/clients')).data;
  assert.deepEqual(clients.map((c) => c.name), ['Maria Antiga']);
  const ficha = (await s.get(`/api/clients/${clients[0].id}`)).data;
  assert.equal(ficha.history.length, 1);
  assert.equal(ficha.spent_cents, 18000);
  assert.equal((await s.get('/api/procedures')).data.map((p) => p.name).join(), 'Lash lifting', 'não duplica o catálogo');
  assert.equal((await s.get('/api/transactions?month=2031-02')).data.summary.income_cents, 18000);
  // reiniciar de novo não muda nada
  await stopServer(server);
  server = await startServer(dir, { ADMIN_EMAIL: 'antigo@studio.test', ADMIN_PASSWORD: 'SenhaAntiga123', DATABASE_URL: '' });
  assert.equal((await s.get('/api/clients')).data.length, 1);
  // a nova empresa cadastrada pelo site não vê os dados migrados
  const n = session();
  await n.post('/api/signup', { company: 'Nova', name: 'Nova', email: 'nova@x.test', phone: '(11) 92222-1111', password: 'SenhaNova1234', accept_terms: true });
  assert.deepEqual((await n.get('/api/clients')).data, []);
});

test('PWA: tudo o que o app guarda para uso offline existe, e o app instalado abre no sistema', async () => {
  const s = session();
  const sw = (await s.get('/sw.js')).text;
  const shell = JSON.parse(sw.match(/const SHELL = (\[[\s\S]*?\]);/)[1].replace(/'/g, '"').replace(/,\s*\]/, ']'));
  assert.ok(shell.includes('/app/index.html'));
  for (const f of shell) assert.equal((await fetch(BASE + f)).status, 200, f);
  const m = (await s.get('/manifest.webmanifest')).data;
  assert.equal(m.short_name, 'Lola');
  assert.match(m.start_url, /^\/app\//);
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
  for (const i of m.icons) assert.equal((await fetch(BASE + i.src)).status, 200, i.src);
});

test('site: imagens, vídeo de demonstração e fontes servidos pelo próprio servidor', async () => {
  const html = (await session().get('/')).text;
  const assets = [...html.matchAll(/(?:src|poster|href)="(\/(?:site|fonts|css|icons)\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(assets.length > 10);
  for (const a of new Set(assets)) assert.equal((await fetch(BASE + a)).status, 200, a);
  const v = await fetch(BASE + '/site/lola-demonstracao.mp4', { headers: { Range: 'bytes=0-99' } });
  assert.equal(v.status, 206, 'vídeo em partes (para o player avançar)');
  assert.doesNotMatch(html, /fonts\.googleapis/, 'sem dependência do Google Fonts');
});
