// Servidor HTTP da Lola (antigo Agenda Expert)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { db, initDb, migrateLegacy, nowIso, seedCompany } from './db.js';
import { getSessionUser, hashPassword, verifyPassword, destroyUserSessions, COOKIE } from './auth.js';
import { matchRoute, HttpError } from './api.js';
import { companyAccess, getCompany, createCompany, SALES_WHATSAPP } from './saas.js';
import { startBackups } from './backup.js';
import { autoStart as startWhatsApp } from './whatsapp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(__dirname, '..', 'public');
loadEnv(path.resolve(__dirname, '..', '.env'));
const PORT = Number(process.env.PORT || 5173);
const SECURE = process.env.COOKIE_SECURE === '1' || process.env.NODE_ENV === 'production';
// atrás de um proxy (Fly.io, Render…) o IP real vem em cabeçalhos
const TRUST_PROXY = process.env.TRUST_PROXY === '1' || process.env.NODE_ENV === 'production';
// identificador da versão publicada: muda sempre que um arquivo do app muda,
// e faz os aparelhos baixarem a atualização (service worker)
const BUILD_ID = buildId(PUBLIC);

// abre o banco (Supabase pela DATABASE_URL, ou Postgres embutido) e cria as tabelas
try {
  const kind = await initDb();
  console.log(kind === 'postgres' ? '✓ Banco de dados online conectado (Postgres/Supabase)' : '✓ Banco de dados local (Postgres embutido em DATA_DIR/pgdata)');
} catch (e) {
  console.error(`\n✖  Não foi possível conectar ao banco de dados: ${e.message}\n   Confira a variável DATABASE_URL (connection string do Supabase).\n`);
  process.exit(1);
}
await migrateLegacy();
await syncUser();
await syncPlatformAdmin();
startBackups();
if (process.env.WHATSAPP !== '0') startWhatsApp().catch((e) => console.error('WhatsApp:', e.message));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.xml': 'application/xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':
    "default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  ...(SECURE ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}),
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return await serveStatic(req, res, url);
  } catch (e) {
    console.error(e);
    send(res, 500, { error: 'Erro interno.' });
  }
});

async function handleApi(req, res, url) {
  const r = matchRoute(req.method, url.pathname);
  if (!r) return send(res, 404, { error: 'Rota não encontrada.' });
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[COOKIE];
  const user = await getSessionUser(token);
  if (r.auth && !user) return send(res, 401, { error: 'Sessão expirada. Entre novamente.' });
  // perfis: rotas do painel do proprietário só para "platform"; rotas de dados só para usuárias de uma empresa
  if (r.auth && r.platform && user.role !== 'platform') return send(res, 403, { error: 'Acesso restrito ao proprietário da plataforma.' });
  if (r.auth && !r.platform && !r.anyRole && !user.company_id) return send(res, 403, { error: 'Esta conta não pertence a uma empresa.' });
  // assinatura vencida/suspensa: consulta e cópia de segurança liberadas, alterações bloqueadas (validado no servidor)
  if (r.auth && user.company_id && !r.platform && !r.always && req.method !== 'GET') {
    const acc = companyAccess(await getCompany(user.company_id));
    if (!acc.can_write)
      return send(res, 402, {
        error: acc.state === 'expired'
          ? 'Seu período de acesso terminou. Fale com a Lola no WhatsApp para continuar — seus dados estão guardados.'
          : 'Acesso suspenso. Fale com a Lola no WhatsApp.',
        code: 'subscription_inactive', state: acc.state, whatsapp: SALES_WHATSAPP,
      });
  }

  // proteção CSRF básica: requisições de escrita precisam vir da mesma origem
  if (req.method !== 'GET' && req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)
    return send(res, 403, { error: 'Origem não permitida.' });

  let body = {};
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const raw = await readBody(req);
    if (raw) {
      try { body = JSON.parse(raw); } catch { return send(res, 400, { error: 'JSON inválido.' }); }
    }
  }
  const cookiesOut = [];
  const ctx = {
    params: r.params, query: Object.fromEntries(url.searchParams), body, user, token, cid: user?.company_id ?? null,
    ip: clientIp(req),
    setCookie: (name, value, maxAge) =>
      cookiesOut.push(`${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${SECURE ? '; Secure' : ''}`),
  };
  try {
    const result = await r.handler(ctx);
    if (cookiesOut.length) res.setHeader('Set-Cookie', cookiesOut);
    if (result && result.__raw != null) {
      res.writeHead(200, {
        ...SECURITY_HEADERS, 'Content-Type': result.__type, 'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="${result.__filename}"`,
      });
      return res.end(result.__raw);
    }
    send(res, 200, result ?? { ok: true });
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message, ...e.extra });
    throw e;
  }
}

function send(res, status, data) {
  const json = JSON.stringify(data);
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(json);
}

// páginas públicas do site (cada uma é uma pasta com index.html)
const PAGES = ['app', 'admin', 'cadastro', 'entrar', 'esqueci-senha', 'redefinir-senha', 'privacidade', 'termos', 'tutorial'];

async function serveStatic(req, res, url) {
  let p;
  try { p = decodeURIComponent(url.pathname); } catch { return send(res, 400, { error: 'Endereço inválido.' }); }
  // quem já está logado e abre o endereço principal (ou o app instalado antigo, "/#/agenda") vai direto para o sistema
  if (p === '/' && !url.search) {
    const user = await getSessionUser(parseCookies(req.headers.cookie)[COOKIE]).catch(() => null);
    if (user) { res.writeHead(302, { ...SECURITY_HEADERS, Location: user.role === 'platform' ? '/admin/' : '/app/', 'Cache-Control': 'no-store' }); return res.end(); }
  }
  const first = p.split('/')[1];
  if (PAGES.includes(first) && !p.slice(first.length + 1).includes('.') && !p.endsWith('/') && p.split('/').length === 2) {
    res.writeHead(301, { ...SECURITY_HEADERS, Location: p + '/' + url.search }); return res.end();
  }
  if (p.endsWith('/')) p += 'index.html';
  if (p === '/sw.js') {
    const js = fs.readFileSync(path.join(PUBLIC, 'sw.js'), 'utf8').replace(/const VERSION = '[^']*'/, `const VERSION = 'ae-${BUILD_ID}'`);
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': MIME['.js'], 'Cache-Control': 'no-cache' });
    return res.end(js);
  }
  const file = path.normalize(path.join(PUBLIC, p));
  if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) return send(res, 403, { error: 'Proibido' });
  fs.stat(file, (err, st) => {
    let target = !err && st.isFile() ? file : null;
    let status = 200;
    // rotas internas do sistema (/app/…) e do painel (/admin/…) devolvem a página do app
    if (!target && (first === 'app' || first === 'admin') && !path.extname(p)) target = path.join(PUBLIC, first, 'index.html');
    if (!target) { target = path.join(PUBLIC, '404.html'); status = 404; }
    if (target !== file) st = fs.statSync(target);
    const ext = path.extname(target);
    const headers = {
      ...SECURITY_HEADERS,
      'Content-Type': MIME[ext] || 'application/octet-stream',
      // código do app sempre revalidado (atualizações chegam na hora); ícones podem ficar em cache
      'Cache-Control': ['.png', '.jpg', '.webp', '.svg', '.ico', '.woff2', '.mp4'].includes(ext) ? 'public, max-age=86400' : 'no-cache',
      'Last-Modified': st?.mtime?.toUTCString?.() || new Date().toUTCString(),
    };
    // vídeos e imagens: entrega em partes (Range), para o player poder avançar/voltar
    if (target === file && ['.mp4', '.jpg', '.png', '.webp'].includes(ext)) {
      headers['Accept-Ranges'] = 'bytes';
      const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      if (m) {
        const size = st.size;
        let start = m[1] === '' ? Math.max(0, size - Number(m[2])) : Number(m[1]);
        let end = m[1] !== '' && m[2] !== '' ? Math.min(Number(m[2]), size - 1) : size - 1;
        if (start >= size || start > end) { res.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}` }); return res.end(); }
        res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
        return fs.createReadStream(target, { start, end }).pipe(res);
      }
      headers['Content-Length'] = st.size;
    }
    const gzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '') && ['.html', '.js', '.css', '.svg', '.json', '.webmanifest'].includes(ext);
    if (gzip) headers['Content-Encoding'] = 'gzip';
    res.writeHead(status, headers);
    const stream = fs.createReadStream(target);
    (gzip ? stream.pipe(zlib.createGzip()) : stream).pipe(res);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 1e6) { reject(new Error('Body muito grande')); req.destroy(); }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseCookies(h = '') {
  return Object.fromEntries(
    h.split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))])
  );
}

function clientIp(req) {
  if (TRUST_PROXY) {
    const h = req.headers['fly-client-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (h) return h;
  }
  return req.socket.remoteAddress;
}

function buildId(dir) {
  const h = crypto.createHash('sha1');
  const walk = (d) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(d, f.name);
      if (f.isDirectory()) walk(full);
      else if (f.name !== 'sw.js') h.update(f.name).update(fs.readFileSync(full));
    }
  };
  walk(dir);
  return h.digest('hex').slice(0, 10);
}

function loadEnv(file) {
  if (process.env.NO_DOTENV === '1') return; // testes automáticos não usam o .env
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// Acesso por variáveis de ambiente (compatível com o Agenda Expert):
//  • ADMIN_EMAIL / ADMIN_PASSWORD  → dona da empresa nº 1 (o estúdio original). Mudou a variável e reiniciou: troca o acesso.
//  • PLATFORM_EMAIL / PLATFORM_PASSWORD → proprietário da plataforma Lola (painel /admin).
// Em produção é obrigatório ter ao menos um dos dois pares válido.
const prod = process.env.NODE_ENV === 'production';
function fatal(msg) {
  console.error(`\n✖  ${msg}\n`);
  if (prod) process.exit(1);
}
function checkPair(email, pw, names) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.includes('coloque-o-email')) return `${names[0]} inválido.`;
  if (pw.length < 8 || pw.includes('coloque-a-senha')) return `${names[1]} precisa ter pelo menos 8 caracteres.`;
  return null;
}
async function syncUser() {
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const pw = String(process.env.ADMIN_PASSWORD || '');
  const platformSet = !!(process.env.PLATFORM_EMAIL && process.env.PLATFORM_PASSWORD);
  if (!email && !pw) {
    if (!platformSet) fatal('Defina ADMIN_EMAIL e ADMIN_PASSWORD (empresa principal) e/ou PLATFORM_EMAIL e PLATFORM_PASSWORD (painel do proprietário).');
    return;
  }
  if (!email || !pw) return fatal('Defina ADMIN_EMAIL e ADMIN_PASSWORD (arquivo .env ou variáveis do servidor).');
  const err = checkPair(email, pw, ['ADMIN_EMAIL', 'ADMIN_PASSWORD']);
  if (err) return fatal(err);
  const name = process.env.ADMIN_NAME || null;
  let user = await db.prepare("SELECT * FROM users WHERE env_managed = 1 AND role = 'owner' ORDER BY id LIMIT 1").get();
  if (!user) {
    const same = await db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (same && same.role === 'owner') {
      await db.prepare('UPDATE users SET env_managed = 1 WHERE id = ?').run(same.id);
      user = { ...same, env_managed: 1 };
    } else if (same) return fatal('ADMIN_EMAIL não pode ser o mesmo e-mail do PLATFORM_EMAIL.');
  }
  if (!user) {
    const company = process.env.ADMIN_COMPANY || 'Esther Lino Bio Estética';
    await createCompany({ company, owner_name: name || 'Esther Lino', email, password: pw }, { legacy: true, status: 'active', envManaged: true });
    console.log(`✓ Acesso criado para ${email} (empresa “${company}”)`);
    return;
  }
  if (!user.company_id) {
    // usuária antiga sem empresa (não deveria ocorrer após a migração): cria a empresa e liga
    const r = await db.prepare("INSERT INTO companies (name, status, created_at, updated_at) VALUES (?, 'active', ?, ?)").run(process.env.ADMIN_COMPANY || 'Minha empresa', nowIso(), nowIso());
    await db.prepare('UPDATE users SET company_id = ? WHERE id = ?').run(r.lastInsertRowid, user.id);
    await seedCompany(r.lastInsertRowid, { legacy: true });
  }
  if (user.email !== email || !verifyPassword(pw, user.password_hash) || (name && name !== user.name)) {
    const clash = await db.prepare('SELECT id FROM users WHERE email = ? AND id <> ?').get(email, user.id);
    if (clash) return fatal(`ADMIN_EMAIL (${email}) já é usado por outra conta.`);
    await db.prepare('UPDATE users SET email = ?, password_hash = ?, name = COALESCE(?, name), updated_at = ? WHERE id = ?').run(email, hashPassword(pw), name, nowIso(), user.id);
    await destroyUserSessions(user.id);
    console.log(`✓ Acesso atualizado pelas variáveis de ambiente (${email}). Sessões anteriores encerradas.`);
  }
}

async function syncPlatformAdmin() {
  const email = String(process.env.PLATFORM_EMAIL || '').trim().toLowerCase();
  const pw = String(process.env.PLATFORM_PASSWORD || '');
  if (!email && !pw) {
    console.log('ℹ  Painel do proprietário (/admin) desligado: defina PLATFORM_EMAIL e PLATFORM_PASSWORD para usá-lo.');
    return;
  }
  const err = checkPair(email, pw, ['PLATFORM_EMAIL', 'PLATFORM_PASSWORD']);
  if (err) return fatal(err);
  const t = nowIso();
  const user = await db.prepare("SELECT * FROM users WHERE role = 'platform' ORDER BY id LIMIT 1").get();
  const clash = await db.prepare('SELECT id, role FROM users WHERE email = ?').get(email);
  if (clash && clash.role !== 'platform') return fatal('PLATFORM_EMAIL não pode ser o e-mail de uma empresa cliente.');
  if (!user) {
    await db.prepare("INSERT INTO users (email, name, password_hash, company_id, role, env_managed, created_at, updated_at) VALUES (?, 'Proprietária Lola', ?, NULL, 'platform', 1, ?, ?)").run(email, hashPassword(pw), t, t);
    console.log(`✓ Painel do proprietário liberado para ${email} (/admin)`);
  } else if (user.email !== email || !verifyPassword(pw, user.password_hash)) {
    await db.prepare('UPDATE users SET email = ?, password_hash = ?, updated_at = ? WHERE id = ?').run(email, hashPassword(pw), t, user.id);
    await destroyUserSessions(user.id);
    console.log('✓ Acesso do proprietário atualizado pelas variáveis de ambiente.');
  }
}

server.listen(PORT, process.env.HOST || '0.0.0.0', () => console.log(`✓ Pronto: Lola rodando na porta ${PORT} (versão ${BUILD_ID})`));

// um erro inesperado (ex.: dentro da conexão do WhatsApp) não pode derrubar o app inteiro
process.on('unhandledRejection', (e) => console.error('Erro não tratado:', e?.message || e));
process.on('uncaughtException', (e) => console.error('Exceção não tratada:', e?.stack || e));

// encerramento limpo: fecha a conexão com o banco antes de desligar (deploys/reinícios)
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => {
    server.close();
    await Promise.race([db.close(), new Promise((r) => setTimeout(r, 5000))]).catch(() => {});
    process.exit(0);
  });
}
