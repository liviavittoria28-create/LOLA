// Conexão com o WhatsApp (via QR code, como o WhatsApp Web) e robô de confirmação.
// Usa a biblioteca Baileys (não oficial). Gratuito, mas o WhatsApp pode restringir
// números que enviam mensagens em massa — por isso há pausas e limites.
// Lola: cada empresa conecta o PRÓPRIO WhatsApp. Tudo aqui recebe o id da empresa (cid).
import QRCode from 'qrcode';
import { db, getSettings, nowIso } from './db.js';
import { todayBR, toMin, stampTime } from './time.js';
import { fullNumber, phoneKey, jidNumber, parseReply, fillTemplate, confirmationMessage, dueAppointments, targetDate, humanDelay } from './wa-logic.js';

const MAX_PER_RUN = 40;

// uma conexão por empresa
const conns = new Map();
function C(cid) {
  if (!cid) throw new Error('WhatsApp: empresa não informada.');
  if (!conns.has(cid)) conns.set(cid, { st: { status: 'disconnected', qr: null, pairing: null, me: null, error: null, sending: false }, sock: null, want: false, retry: 0 });
  return conns.get(cid);
}

// logger silencioso exigido pela biblioteca
const noop = () => {};
const logger = { level: 'silent', child: () => logger, trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop };

export const waState = (cid) => { const { st } = C(cid); return { status: st.status, qr: st.qr, pairing: st.pairing, me: st.me, error: st.error, sending: st.sending }; };

// ---------------------------------------------------------------- Sessão guardada no banco (Supabase)
// Assim a conexão sobrevive a reinícios do servidor, mesmo em hospedagem que apaga o disco.
async function useDbAuthState(B, cid) {
  const enc = (v) => JSON.stringify(v, B.BufferJSON.replacer);
  const dec = (s) => JSON.parse(s, B.BufferJSON.reviver);
  const write = (key, value) => db.prepare('INSERT INTO wa_sessions (company_id, key, value) VALUES (?, ?, ?) ON CONFLICT (company_id, key) DO UPDATE SET value = EXCLUDED.value').run(cid, key, enc(value));
  const row = await db.prepare("SELECT value FROM wa_sessions WHERE company_id = ? AND key = 'creds'").get(cid);
  const creds = row ? dec(row.value) : B.initAuthCreds();
  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          if (!ids.length) return data;
          const rows = await db.prepare('SELECT key, value FROM wa_sessions WHERE company_id = ? AND key = ANY(?)').all(cid, ids.map((id) => `${type}-${id}`));
          const map = new Map(rows.map((r) => [r.key, r.value]));
          for (const id of ids) {
            const raw = map.get(`${type}-${id}`);
            let value = raw ? dec(raw) : null;
            if (type === 'app-state-sync-key' && value) value = B.proto.Message.AppStateSyncKeyData.fromObject(value);
            data[id] = value;
          }
          return data;
        },
        set: async (data) => {
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const key = `${category}-${id}`;
              if (value) await write(key, value);
              else await db.prepare('DELETE FROM wa_sessions WHERE company_id = ? AND key = ?').run(cid, key);
            }
          }
        },
      },
    },
    saveCreds: () => write('creds', creds),
  };
}
const clearSession = (cid) => db.prepare('DELETE FROM wa_sessions WHERE company_id = ?').run(cid);

// ---------------------------------------------------------------- Conexão
/**
 * Conecta. Sem telefone: gera QR code (escanear de outro aparelho).
 * Com telefone: gera um código de 8 caracteres para digitar no próprio celular
 * (WhatsApp → Aparelhos conectados → Conectar com número de telefone).
 */
export async function connect(cid, { phone } = {}) {
  const c = C(cid);
  const { st } = c;
  if (phone && c.sock && st.status === 'qr' && !c.sock.authState?.creds?.registered) {
    st.pairing = formatCode(await c.sock.requestPairingCode(fullNumber(phone)));
    return waState(cid);
  }
  if (c.sock && ['connecting', 'qr', 'connected'].includes(st.status)) return waState(cid);
  st.pairing = null;
  c.want = true;
  st.status = 'connecting';
  st.error = null;
  const B = await import('@whiskeysockets/baileys');
  const makeWASocket = B.default?.default || B.default || B.makeWASocket;
  const { state: auth, saveCreds } = await useDbAuthState(B, cid);
  const version = await waVersion(B);
  const sock = (c.sock = makeWASocket({
    auth, version, logger,
    // identificação padrão de navegador (nomes personalizados podem ser recusados no pareamento)
    browser: B.Browsers.macOS('Chrome'),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    shouldSyncHistoryMessage: () => false,
  }));
  const current = sock;
  sock.ev.on('creds.update', () => saveCreds().catch((e) => console.error('WhatsApp (sessão):', e.message)));
  if (phone && !auth.creds.registered) {
    await new Promise((r) => setTimeout(r, 2500)); // a conexão precisa estar aberta antes de pedir o código
    st.pairing = formatCode(await sock.requestPairingCode(fullNumber(phone)));
    st.status = 'qr';
  }
  sock.ev.on('connection.update', async (u) => {
    if (current !== c.sock) return;
    if (u.qr) {
      st.status = 'qr';
      st.qr = await QRCode.toString(u.qr, { type: 'svg', margin: 1, color: { dark: '#3b2630', light: '#ffffff' } });
    }
    if (u.connection === 'open') {
      c.retry = 0;
      st.status = 'connected';
      st.qr = null;
      st.pairing = null;
      st.error = null;
      const id = sock.user?.id || '';
      st.me = { number: jidNumber(id.replace(/:\d+@/, '@')) || id.split(/[:@]/)[0], name: sock.user?.name || sock.user?.verifiedName || '' };
      console.log(`✓ WhatsApp conectado (empresa ${cid})`);
      setTimeout(() => runScheduler(cid).catch(() => {}), 5000);
    }
    if (u.connection === 'close') {
      const code = u.lastDisconnect?.error?.output?.statusCode;
      const wasQr = st.status === 'qr';
      console.log(`WhatsApp (empresa ${cid}): conexão encerrada (código ${code ?? '?'}: ${u.lastDisconnect?.error?.message || 'sem detalhes'})`);
      if (code === 405 || code === 426) cachedVersion = null; // versão recusada: busca de novo na próxima tentativa
      c.sock = null;
      if (code === B.DisconnectReason.loggedOut || code === B.DisconnectReason.forbidden) {
        await clearSession(cid).catch(() => {});
        Object.assign(st, { status: 'disconnected', qr: null, pairing: null, me: null, error: 'O WhatsApp foi desconectado pelo celular. Conecte de novo.' });
        c.want = false;
        return;
      }
      if (wasQr && code === B.DisconnectReason.timedOut) {
        Object.assign(st, { status: 'disconnected', qr: null, pairing: null, error: 'O código expirou. Toque em “Conectar” para gerar outro.' });
        c.want = false;
        return;
      }
      if (!c.want) { Object.assign(st, { status: 'disconnected', qr: null }); return; }
      st.status = 'connecting';
      const wait = Math.min(60000, 2000 * 2 ** c.retry++);
      setTimeout(() => connect(cid).catch((e) => onError(cid, e)), wait);
    }
  });
  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const m of messages) handleIncoming(cid, m).catch((e) => console.error('WhatsApp (resposta):', e.message));
  });
  return waState(cid);
}

const formatCode = (c) => String(c || '').replace(/(.{4})(?=.)/, '$1-');

// Versão do WhatsApp Web: o WhatsApp recusa clientes desatualizados ("sem conexão" no celular).
// Busca a versão atual direto do web.whatsapp.com; se falhar, usa a da biblioteca.
let cachedVersion = null;
async function waVersion(B) {
  if (cachedVersion && Date.now() - cachedVersion.at < 3600e3) return cachedVersion.version;
  const tries = [B.fetchLatestWaWebVersion, B.fetchLatestBaileysVersion];
  for (const fn of tries) {
    try {
      const r = await fn?.({});
      if (r?.version?.length === 3) {
        cachedVersion = { version: r.version, at: Date.now() };
        console.log(`WhatsApp: usando versão ${r.version.join('.')}`);
        return r.version;
      }
    } catch {}
  }
  return undefined; // padrão embutido na biblioteca
}

function onError(cid, e) {
  console.error(`WhatsApp (empresa ${cid}):`, e.message);
  Object.assign(C(cid).st, { status: 'disconnected', qr: null, error: 'Não foi possível conectar. Tente de novo em instantes.' });
}

export async function logout(cid) {
  const c = C(cid);
  c.want = false;
  try { await c.sock?.logout(); } catch {}
  try { c.sock?.end?.(); } catch {}
  c.sock = null;
  await clearSession(cid);
  Object.assign(c.st, { status: 'disconnected', qr: null, pairing: null, me: null, error: null });
  return waState(cid);
}

/** Reconecta sozinho ao ligar o servidor as empresas que já tinham WhatsApp conectado */
export async function autoStart() {
  const rows = await db.prepare("SELECT company_id FROM wa_sessions WHERE key = 'creds'").all().catch(() => []);
  for (const r of rows) connect(r.company_id).catch((e) => onError(r.company_id, e));
  setInterval(() => {
    for (const [cid, c] of conns) if (c.st.status === 'connected') runScheduler(cid).catch((e) => console.error('WhatsApp (agenda):', e.message));
  }, 60_000).unref();
}

// ---------------------------------------------------------------- Dados
export async function appointmentsOn(cid, date) {
  const rows = await db
    .prepare(
      `SELECT a.*, c.name AS client_name, c.phone AS client_phone, w.status AS wa_status, w.reply AS wa_reply, w.sent_at AS wa_sent_at, w.error AS wa_error
       FROM appointments a JOIN clients c ON c.id = a.client_id LEFT JOIN wa_messages w ON w.appointment_id = a.id
       WHERE a.company_id = ? AND a.date = ? ORDER BY a.start_at`
    )
    .all(cid, date);
  const ids = rows.map((r) => r.id);
  const procs = ids.length ? await db.prepare('SELECT appointment_id, name FROM appointment_procedures WHERE appointment_id = ANY(?) ORDER BY id').all(ids) : [];
  return rows.map((r) => ({
    id: r.id, client_id: r.client_id, client_name: r.client_name, client_phone: r.client_phone, date: r.date,
    start: stampTime(r.start_at), end: stampTime(r.end_at), status: r.status, total_cents: r.total_cents, created_at: r.created_at,
    procedures: procs.filter((p) => p.appointment_id === r.id).map((p) => ({ name: p.name })),
    wa: r.wa_status ? { status: r.wa_status, reply: r.wa_reply, sent_at: r.wa_sent_at, error: r.wa_error } : null,
  }));
}

// ---------------------------------------------------------------- Envio
// WA_NO_DELAY=1 tira as pausas (usado nos testes automáticos)
const sleep = (ms) => new Promise((r) => setTimeout(r, process.env.WA_NO_DELAY ? 0 : ms));

async function sendText(cid, phone, text) {
  const { sock, st } = C(cid);
  if (!sock || st.status !== 'connected') throw new Error('WhatsApp não está conectado.');
  const number = fullNumber(phone);
  const found = (await sock.onWhatsApp(number))?.[0];
  if (!found?.exists) throw new Error('Este número não tem WhatsApp.');
  try {
    await sock.presenceSubscribe(found.jid);
    await sock.sendPresenceUpdate('composing', found.jid);
    await sleep(1200 + Math.random() * 1500);
    await sock.sendPresenceUpdate('paused', found.jid);
  } catch {}
  const sent = await sock.sendMessage(found.jid, { text });
  return sent?.key?.remoteJid || found.jid;
}

function record(cid, a, fields) {
  return db.prepare(
    `INSERT INTO wa_messages (company_id, appointment_id, phone, jid, status, error, sent_at) VALUES (?,?,?,?,?,?,?)
     ON CONFLICT (appointment_id) DO UPDATE SET phone = EXCLUDED.phone, jid = EXCLUDED.jid, status = EXCLUDED.status,
       error = EXCLUDED.error, sent_at = EXCLUDED.sent_at, reply = NULL, reply_text = NULL, replied_at = NULL`
  ).run(cid, a.id, fullNumber(a.client_phone), fields.jid || null, fields.status, fields.error || null, nowIso());
}

/** Envia a confirmação de um atendimento agora */
export async function sendConfirmation(cid, appointmentId) {
  const a = await db.prepare('SELECT date FROM appointments WHERE id = ? AND company_id = ?').get(appointmentId, cid);
  if (!a) throw new Error('Atendimento não encontrado.');
  const appt = (await appointmentsOn(cid, a.date)).find((x) => x.id === appointmentId);
  if (['cancelada', 'faltou', 'concluida'].includes(appt.status)) throw new Error('Este atendimento não precisa de confirmação.');
  try {
    const jid = await sendText(cid, appt.client_phone, confirmationMessage(await getSettings(cid), appt));
    await record(cid, appt, { status: 'sent', jid });
    return { ok: true };
  } catch (e) {
    await record(cid, appt, { status: 'failed', error: e.message });
    throw e;
  }
}

/** Envia, com pausas, todas as confirmações pendentes (automático ou "Enviar todas") */
export async function sendBatch(cid, list) {
  const { st } = C(cid);
  if (st.sending) return { queued: 0 };
  st.sending = true;
  let sent = 0;
  (async () => {
    try {
      for (const a of list.slice(0, MAX_PER_RUN)) {
        if (st.status !== 'connected') break;
        try { await sendConfirmation(cid, a.id); sent++; } catch {}
        await sleep(humanDelay());
      }
    } finally {
      st.sending = false;
      if (sent) console.log(`✓ WhatsApp: ${sent} confirmação(ões) enviada(s)`);
    }
  })();
  return { queued: Math.min(list.length, MAX_PER_RUN) };
}

/** Pendentes da data-alvo, sem considerar horário (para o botão "Enviar todas") */
export async function pendingFor(cid, date) {
  return (await appointmentsOn(cid, date)).filter((a) => a.status === 'agendada' && (!a.wa || a.wa.status === 'failed'));
}

export async function runScheduler(cid) {
  const { st } = C(cid);
  if (st.status !== 'connected' || st.sending) return;
  const settings = await getSettings(cid);
  const today = todayBR();
  const date = targetDate(settings, today);
  const appointments = await appointmentsOn(cid, date);
  const sentIds = new Set(appointments.filter((a) => a.wa).map((a) => a.id)); // não reenvia nem quem falhou
  const now = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  const due = dueAppointments({ settings, today, nowMin: toMin(now), nowIso: nowIso(), appointments, sentIds });
  if (due.length) await sendBatch(cid, due);
}

// ---------------------------------------------------------------- Respostas (mini chatbot)
function messageText(m) {
  const msg = m.message?.ephemeralMessage?.message || m.message?.viewOnceMessage?.message || m.message || {};
  return msg.conversation || msg.extendedTextMessage?.text || msg.buttonsResponseMessage?.selectedDisplayText || msg.listResponseMessage?.title || '';
}

async function handleIncoming(cid, m) {
  const { sock } = C(cid);
  if (m.key?.fromMe) return;
  const jids = [m.key?.remoteJid, m.key?.remoteJidAlt, m.key?.senderPn].filter(Boolean);
  if (!jids.length || jids.some((j) => j.endsWith('@g.us') || j === 'status@broadcast')) return;
  const text = messageText(m);
  const intent = parseReply(text);
  if (!intent) return; // não entendeu: fica em silêncio para a Esther responder

  // procura a confirmação pendente desta cliente (enviada, sem resposta, atendimento futuro)
  const keys = new Set(jids.map(jidNumber).filter(Boolean).map(phoneKey));
  const pending = (await db
    .prepare(
      `SELECT w.*, a.status AS appt_status, a.date FROM wa_messages w JOIN appointments a ON a.id = w.appointment_id
       WHERE w.company_id = ? AND a.company_id = ? AND w.status = 'sent' AND w.reply IS NULL AND a.date >= ? AND a.status IN ('agendada','confirmada')
       ORDER BY a.start_at`
    )
    .all(cid, cid, todayBR()))
    .find((w) => jids.includes(w.jid) || keys.has(phoneKey(w.phone)));
  if (!pending) return;

  const appt = (await appointmentsOn(cid, pending.date)).find((a) => a.id === pending.appointment_id);
  const settings = await getSettings(cid);
  await db.prepare('UPDATE wa_messages SET reply = ?, reply_text = ?, replied_at = ? WHERE id = ?').run(intent, String(text).slice(0, 500), nowIso(), pending.id);
  if (intent === 'confirm' && appt.status === 'agendada') {
    await db.prepare("UPDATE appointments SET status = 'confirmada', updated_at = ? WHERE id = ? AND company_id = ?").run(nowIso(), appt.id, cid);
  }
  const reply = fillTemplate(intent === 'confirm' ? settings.wa_reply_confirm : settings.wa_reply_reschedule, appt).trim();
  if (reply && sock) {
    await sleep(2000 + Math.random() * 3000);
    await sock.sendMessage(m.key.remoteJid, { text: reply });
  }
}

// exportado para testes
export const _test = { handleIncoming, conn: C, setSock: (cid, s) => { C(cid).sock = s; }, useDbAuthState };
