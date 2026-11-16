// Banco de dados Postgres — RSIS02
// • Produção: Supabase (ou qualquer Postgres) pela variável DATABASE_URL.
// • Sem DATABASE_URL: Postgres embutido (PGlite) gravado em DATA_DIR/pgdata — para usar no computador e nos testes.
// A interface imita a anterior: db.prepare(sql).get/all/run(...params), agora assíncrona (use await).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
const SCHEMA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'schema.sql');

export const nowIso = () => new Date().toISOString();

// tabelas com coluna id gerada (INSERT devolve o id novo)
const WITH_ID = /^\s*INSERT\s+INTO\s+(users|clients|procedures|appointments|appointment_procedures|blocks|transactions|wa_messages|stock_items|stock_moves|companies|payments)\b/i;
const cache = new Map();
/** Converte a sintaxe usada no app (?) para a do Postgres ($1, $2…) */
function toPg(sql) {
  if (cache.has(sql)) return cache.get(sql);
  let n = 0;
  let out = sql.replace(/\bIS NOT \?/g, 'IS DISTINCT FROM ?').replace(/\?/g, () => `$${++n}`);
  if (WITH_ID.test(out) && !/\bRETURNING\b/i.test(out)) out += ' RETURNING id';
  cache.set(sql, out);
  return out;
}

function api(exec) {
  const prepare = (sql) => {
    const text = toPg(sql);
    return {
      all: async (...p) => (await exec(text, p)).rows,
      get: async (...p) => (await exec(text, p)).rows[0],
      run: async (...p) => {
        const r = await exec(text, p);
        return { changes: r.rowCount ?? r.affectedRows ?? 0, lastInsertRowid: r.rows?.[0]?.id ?? null, rows: r.rows };
      },
    };
  };
  return { prepare };
}

let impl = null;
export const db = {
  prepare: (sql) => {
    if (!impl) throw new Error('Banco ainda não iniciado (initDb).');
    return impl.api.prepare(sql);
  },
  exec: (sql) => impl.execMany(sql),
  get kind() { return impl?.kind; },
  close: () => impl?.close(),
};

/** Abre a conexão e cria as tabelas (se ainda não existirem) */
export async function initDb() {
  if (impl) return impl.kind;
  // tolera espaços, quebras de linha e aspas coladas junto no painel da hospedagem
  const url = String(process.env.DATABASE_URL || '').trim().replace(/^DATABASE_URL\s*=\s*/i, '').replace(/^["']|["']$/g, '').trim();
  if (url) {
    if (/SENHA_DO_BANCO|SUA-SENHA|\[YOUR-PASSWORD\]|SEU-PROJETO/i.test(url))
      throw new Error('a DATABASE_URL ainda tem o texto de exemplo no lugar da senha. Troque SENHA_DO_BANCO pela senha do banco do Supabase (Project Settings → Database).');
    try { new URL(url); } catch {
      throw new Error('a DATABASE_URL não é um endereço válido. Se a senha do banco tiver símbolos (@ # / ? %), gere outra só com letras e números no Supabase.');
    }
    const pg = (await import('pg')).default;
    pg.types.setTypeParser(20, (v) => Number(v)); // bigint (ids, COUNT, SUM) como número
    pg.types.setTypeParser(1700, (v) => Number(v)); // numeric
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url) || /sslmode=disable/.test(url);
    const finalUrl = local ? url : await supabasePooler(pg, url);
    const pool = new pg.Pool({
      connectionString: finalUrl, max: Number(process.env.DB_POOL || 5),
      ssl: local ? false : { rejectUnauthorized: false }, connectionTimeoutMillis: 15000,
    });
    pool.on('error', (e) => console.error('Banco (conexão ociosa):', e.message));
    impl = {
      kind: 'postgres',
      api: api((text, p) => pool.query(text, p)),
      execMany: (sql) => pool.query(sql),
      tx: async (fn) => {
        const c = await pool.connect();
        try {
          await c.query('BEGIN');
          const r = await fn(api((text, p) => c.query(text, p)));
          await c.query('COMMIT');
          return r;
        } catch (e) {
          await c.query('ROLLBACK').catch(() => {});
          throw e;
        } finally {
          c.release();
        }
      },
      close: () => pool.end(),
    };
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const dir = process.env.PGLITE_MEMORY === '1' ? undefined : path.join(DATA_DIR, 'pgdata');
    if (dir) fs.mkdirSync(dir, { recursive: true });
    const pgl = await PGlite.create(dir);
    impl = {
      kind: 'local',
      api: api((text, p) => pgl.query(text, p)),
      execMany: (sql) => pgl.exec(sql),
      tx: (fn) => pgl.transaction((t) => fn(api((text, p) => t.query(text, p)))),
      close: () => pgl.close(),
    };
  }
  try {
    await impl.execMany(fs.readFileSync(SCHEMA, 'utf8'));
  } catch (e) {
    if (impl.kind === 'postgres' && /password authentication failed/i.test(e.message)) {
      // resumo para conferir o que foi colado, sem mostrar a senha
      let info = '';
      try {
        const u = new URL(url);
        const pw = decodeURIComponent(u.password);
        info = ` (usuário "${decodeURIComponent(u.username)}", servidor "${u.hostname}", senha com ${pw.length} caracteres${pw.startsWith('@') ? ', começando com @' : ''})`;
      } catch {}
      impl = null;
      throw new Error(`senha do banco recusada pelo Supabase${info}. Confira a senha na DATABASE_URL ou gere outra em Supabase → Project Settings → Database.`);
    }
    impl = null;
    throw e;
  }
  return impl.kind;
}

/**
 * A conexão "Direct" do Supabase (db.<projeto>.supabase.co) só tem IPv6, e serviços como o Render
 * só saem por IPv4 (erro ENETUNREACH). Nesse caso, descobre sozinho o "Session pooler" do projeto
 * (que tem IPv4) testando as regiões do Supabase, e usa ele no lugar.
 */
const POOLER_REGIONS = ['us-east-1', 'sa-east-1', 'us-east-2', 'us-west-1', 'us-west-2', 'ca-central-1', 'eu-central-1', 'eu-central-2',
  'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-north-1', 'ap-south-1', 'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'ap-northeast-2'];
async function supabasePooler(pg, url) {
  const u = new URL(url);
  const m = u.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/i);
  if (!m) return url;
  const ref = m[1];
  const password = decodeURIComponent(u.password);
  const database = u.pathname.slice(1) || 'postgres';
  console.log('ℹ  DATABASE_URL usa a conexão "Direct" do Supabase (só IPv6). Procurando o Session pooler (IPv4)…');
  const hosts = POOLER_REGIONS.flatMap((r) => [`aws-0-${r}.pooler.supabase.com`, `aws-1-${r}.pooler.supabase.com`]);
  const probe = async (host) => {
    const c = new pg.Client({ host, port: 5432, user: `postgres.${ref}`, password, database, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 });
    try { await c.connect(); await c.end(); return host; } catch (e) {
      if (/password authentication failed/i.test(e.message)) return host; // região certa (a senha é conferida depois)
      throw e;
    }
  };
  let host;
  try { host = await Promise.any(hosts.map(probe)); } catch {
    throw new Error('não encontrei o Session pooler do projeto. No Supabase, use Connect → Connection string → Session pooler e coloque esse endereço na DATABASE_URL.');
  }
  const fixed = new URL(url);
  fixed.hostname = host;
  fixed.port = '5432';
  fixed.username = `postgres.${ref}`;
  console.log(`✓ Usando o Session pooler ${host}. Dica: coloque este endereço na DATABASE_URL para ligar mais rápido.`);
  return fixed.toString();
}

/** Transação: tudo ou nada. Use o "t" recebido para as consultas de dentro. */
export const tx = (fn) => impl.tx(fn);

// Catálogo inicial — Anexo A (durações são estimativas a confirmar)
const CATALOG = [
  ['Nanoblading', 'Micropigmentação que harmoniza o olhar através da naturalidade dos fios realistas.', 62000, 150],
  ['Design de sobrancelha', 'Sobrancelhas harmônicas e respeitando sua estrutura natural, olhar limpo e renovado.', 5000, 30],
  ['Brow lamination', 'Procedimento químico que alinha os fios e confere mais volume às sobrancelhas com os fios naturais.', 12000, 60],
  ['Extensão de cílios', 'Aplicação de fios sintéticos sobre os fios naturais; olhar marcante sem perder a naturalidade.', 17000, 120],
  ['Manutenção de cílios', 'Preenchimento das falhas após 20 dias da aplicação.', 12000, 90],
  ['Remoção de cílios', 'Retirada dos fios sintéticos com segurança e sem agredir os fios naturais.', 4500, 30],
  ['Lash lifting', 'Curva quimicamente os fios naturais, permitindo o uso de rímel e um olhar delicado e natural.', 18000, 60],
  ['Depilação buço', 'Limpeza dos pelinhos do buço (bigode) na linha ou cera fria.', 3500, 15],
  ['Limpeza de pele', 'Remoção de cravos e espinhas, recuperação do viço da pele e hidratação dos poros.', 20000, 75],
];

// Ajustes da empresa nº 1 (estúdio original, Esther Lino) — mantidos exatamente como antes
const LEGACY_SETTINGS = {
  open_time: '08:00',
  close_time: '20:00',
  work_days: '1,2,3,4,5,6', // 0 = domingo
  gap_min: '0',
  studio_name: 'Esther Lino Bio Estética',
  studio_address: 'Rua Aiapaina, 3A — Tatuapé',
  consent_text:
    'Declaro que as informações prestadas nesta ficha são verdadeiras e que fui informada sobre o procedimento, seus cuidados, riscos e contraindicações. Autorizo a realização do procedimento e me comprometo a seguir as orientações de pós-cuidado. Autorizo o armazenamento destes dados pessoais e de saúde exclusivamente para fins de atendimento, conforme a LGPD (Lei 13.709/2018).',
  // Mensagem pronta do botão WhatsApp. Campos trocados automaticamente: [nome] [data] [horário] [procedimento] [valor]
  whatsapp_template: [
    'Olá! Tudo bem? 🤍',
    '',
    'Passando para confirmar seu atendimento, agendado para o dia [data], às [horário].',
    '',
    '📍 *Studio – Rua Aiapaina, 3A - Tatuapé*',
    '',
    'Será um prazer receber você!',
    'Por favor, confirme sua presença respondendo: “Confirmo meu horário”.',
    '',
    'Assim, posso me preparar para recebê-la com todo carinho! ✨',
  ].join('\n'),
  // Robô de confirmação (Mais → WhatsApp)
  wa_auto: '0',
  wa_mode: 'same_day', // same_day = no dia · day_before = na véspera
  wa_time: '08:00',
  wa_footer: 'Responda com o número:\n*1* – Confirmo meu horário ✅\n*2* – Preciso remarcar 🗓️',
  wa_reply_confirm: 'Perfeito, [nome]! Seu horário de [data] às [horário] está confirmado ✨ Até lá! 🤍',
  wa_reply_reschedule: 'Sem problemas, [nome]! Já avisei aqui e logo te chamo para encontrarmos um novo horário 🤍',
};

// Ajustes iniciais de uma empresa nova (cadastro pelo site Lola)
export function defaultSettings(name = '') {
  return {
    ...LEGACY_SETTINGS,
    studio_name: name,
    studio_address: '',
    whatsapp_template: [
      'Olá, [nome]! Tudo bem? 🤍',
      '',
      'Passando para confirmar seu atendimento de [procedimento], no dia [data], às [horário].',
      '',
      'Será um prazer receber você! ✨',
    ].join('\n'),
  };
}

/** Prepara uma empresa: ajustes padrão e (só no estúdio original) o catálogo inicial */
export async function seedCompany(cid, { legacy = false, name = '' } = {}, q = db) {
  const t = nowIso();
  if (legacy) {
    const { n } = await q.prepare('SELECT COUNT(*) AS n FROM procedures WHERE company_id = ?').get(cid);
    if (n === 0) {
      for (const [i, [pname, d, p, m]] of CATALOG.entries())
        await q.prepare('INSERT INTO procedures (company_id, name, description, price_cents, duration_min, sort, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)').run(cid, pname, d, p, m, i, t, t);
    }
  }
  const defaults = legacy ? LEGACY_SETTINGS : defaultSettings(name);
  for (const [k, v] of Object.entries(defaults))
    await q.prepare('INSERT INTO company_settings (company_id, key, value) VALUES (?, ?, ?) ON CONFLICT (company_id, key) DO NOTHING').run(cid, k, v);
}

/** Compatibilidade: antes da Lola o app chamava seed() sem empresa. Agora só garante a migração. */
export async function seed() {
  await migrateLegacy();
}

const TENANT_TABLES = ['clients', 'procedures', 'appointments', 'blocks', 'transactions', 'wa_messages', 'stock_items'];

/**
 * Migração segura para o SaaS: se houver dados de antes da Lola (sem empresa),
 * cria a empresa nº 1 com o nome do estúdio e liga tudo a ela. Nada é apagado:
 * as tabelas antigas "settings" e "wa_auth" continuam no banco, só são copiadas.
 */
export async function migrateLegacy() {
  let orphan = false;
  for (const tb of TENANT_TABLES) {
    if (await db.prepare(`SELECT 1 AS x FROM ${tb} WHERE company_id IS NULL LIMIT 1`).get()) { orphan = true; break; }
  }
  const legacyUser = await db.prepare("SELECT * FROM users WHERE company_id IS NULL AND role = 'owner' ORDER BY id LIMIT 1").get();
  if (!orphan && !legacyUser) return null;
  return tx(async (t) => {
    const old = Object.fromEntries((await t.prepare('SELECT key, value FROM settings').all()).map((r) => [r.key, r.value]));
    const now = nowIso();
    let company = await t.prepare('SELECT id FROM companies ORDER BY id LIMIT 1').get();
    if (!company) {
      const name = old.studio_name || process.env.ADMIN_COMPANY || 'Minha empresa';
      const r = await t.prepare(
        "INSERT INTO companies (name, owner_name, email, status, trial_ends_at, notes, created_at, updated_at) VALUES (?,?,?,'active',NULL,?,?,?)"
      ).run(name, legacyUser?.name || null, legacyUser?.email || null, 'Empresa original do Agenda Expert (dados migrados).', legacyUser?.created_at || now, now);
      company = { id: r.lastInsertRowid };
    }
    const cid = company.id;
    for (const tb of TENANT_TABLES) await t.prepare(`UPDATE ${tb} SET company_id = ? WHERE company_id IS NULL`).run(cid);
    await t.prepare("UPDATE users SET company_id = ?, env_managed = 1 WHERE company_id IS NULL AND role = 'owner' AND id = ?").run(cid, legacyUser?.id ?? -1);
    await t.prepare("UPDATE users SET company_id = ? WHERE company_id IS NULL AND role = 'owner'").run(cid);
    for (const [k, v] of Object.entries(old))
      await t.prepare('INSERT INTO company_settings (company_id, key, value) VALUES (?,?,?) ON CONFLICT (company_id, key) DO NOTHING').run(cid, k, v);
    await t.prepare('INSERT INTO wa_sessions (company_id, key, value) SELECT ?, key, value FROM wa_auth ON CONFLICT (company_id, key) DO NOTHING').run(cid);
    await seedCompany(cid, { legacy: true }, t);
    console.log(`✓ Dados anteriores à Lola ligados à empresa nº ${cid} (nada foi apagado).`);
    return cid;
  });
}

export async function getSettings(cid) {
  if (!cid) throw new Error('getSettings: empresa não informada.');
  const rows = await db.prepare('SELECT key, value FROM company_settings WHERE company_id = ?').all(cid);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function setSetting(cid, key, value) {
  await db.prepare('INSERT INTO company_settings (company_id, key, value) VALUES (?, ?, ?) ON CONFLICT (company_id, key) DO UPDATE SET value = EXCLUDED.value').run(cid, key, String(value));
}
