// Utilitários de interface: formatação pt-BR, folhas (sheets), avisos
import { I } from './icons.js';

export const state = { user: null, settings: {}, today: null, procedures: null, financeMeta: null };

// ---------------------------------------------------------------- Formatação
export const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const money = (cents) => BRL.format((cents || 0) / 100);
export const moneyShort = (cents) => {
  const v = (cents || 0) / 100;
  return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
};
export const centsToInput = (c) => (c == null ? '' : ((c || 0) / 100).toFixed(2).replace('.', ','));
export const parseMoney = (s) => {
  const t = String(s ?? '').trim().replace(/[R$\s]/g, '');
  if (!t) return NaN;
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};

export const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const MONTHS_SHORT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
export const DOW = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
export const DOW_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// datas como 'AAAA-MM-DD' (sempre no calendário de Brasília, vindo do servidor)
export const parseD = (d) => { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd, 12)); };
export const ymd = (dt) => dt.toISOString().slice(0, 10);
export const addDays = (d, n) => { const x = parseD(d); x.setUTCDate(x.getUTCDate() + n); return ymd(x); };
export const addMonths = (d, n) => { const x = parseD(d); x.setUTCDate(1); x.setUTCMonth(x.getUTCMonth() + n); return ymd(x); };
export const dow = (d) => parseD(d).getUTCDay();
export const startOfWeek = (d) => addDays(d, -dow(d));
export const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const fmtDate = (d) => (d ? d.split('-').reverse().join('/') : '');
export const fmtDayLong = (d) => { const x = parseD(d); return `${cap(DOW[x.getUTCDay()])}, ${x.getUTCDate()} de ${MONTHS[x.getUTCMonth()]}`; };
export const fmtDayShort = (d) => { const x = parseD(d); return `${x.getUTCDate()} ${MONTHS_SHORT[x.getUTCMonth()].toLowerCase()}`; };
export const fmtMonth = (ym) => { const [y, m] = ym.split('-').map(Number); return `${cap(MONTHS[m - 1])} ${y}`; };
export const fmtDuration = (min) => { const h = Math.floor(min / 60), m = min % 60; return h ? `${h}h${m ? String(m).padStart(2, '0') : ''}` : `${m} min`; };
export const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
export const fromMin = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const nowMinBR = () => {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  return toMin(p);
};
export const todayBR = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
export const initials = (name) => (name || '?').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
// Link do WhatsApp (gratuito): abre a conversa com a mensagem já escrita; basta tocar em enviar
export const waLink = (phone, text = '') => {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.length <= 11) d = '55' + d;
  return `https://wa.me/${d}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
};
// Preenche a mensagem modelo com os dados do atendimento
export function waMessage(template, a) {
  if (!template) return '';
  const first = (a?.client_name || '').trim().split(/\s+/)[0] || '';
  const d = a?.date ? parseD(a.date) : null;
  const values = {
    nome: first,
    'nome completo': a?.client_name || '',
    data: d ? `${fmtDate(a.date)} (${DOW[d.getUTCDay()]}${d.getUTCDay() > 0 && d.getUTCDay() < 6 ? '-feira' : ''})` : '',
    horario: a?.start || '',
    hora: a?.start || '',
    termino: a?.end || '',
    procedimento: (a?.procedures || []).map((p) => p.name).join(' + '),
    valor: a ? money(a.total_cents) : '',
  };
  const key = (k) => k.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  return template.replace(/\[([^\]]+)\]/g, (m, k) => (key(k) in values ? values[key(k)] : m));
}
export const maskPhone = (v) => {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
};

export const STATUS = {
  agendada: { label: 'Agendada' },
  confirmada: { label: 'Confirmada' },
  concluida: { label: 'Concluída' },
  cancelada: { label: 'Cancelada' },
  faltou: { label: 'Cliente faltou' },
};
export const statusBadge = (s) => `<span class="badge st-${s}"><span class="dot"></span>${STATUS[s]?.label || s}</span>`;

// ---------------------------------------------------------------- Toast
export function toast(msg, { error = false } = {}) {
  const wrap = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast' + (error ? ' toast--err' : '');
  el.innerHTML = `${error ? I.alert : I.check}<span>${esc(msg)}</span>`;
  wrap.innerHTML = '';
  wrap.appendChild(el);
  setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; }, 2600);
  setTimeout(() => el.remove(), 3000);
}
export const toastError = (e) => toast(e?.message || 'Algo deu errado.', { error: true });

// ---------------------------------------------------------------- Sheets
const stack = [];
export function openSheet({ title, body = '', foot = '', onMount, onClose, wide = false }) {
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  const el = document.createElement('section');
  el.className = 'sheet';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  if (wide) el.style.width = 'min(680px, 94vw)';
  el.innerHTML = `
    <div class="sheet__grab"></div>
    <header class="sheet__head"><h2>${title}</h2><button class="icon-btn icon-btn--plain" data-close aria-label="Fechar">${I.close}</button></header>
    <div class="sheet__body">${body}</div>
    ${foot ? `<footer class="sheet__foot">${foot}</footer>` : ''}`;
  document.body.append(scrim, el);
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => { scrim.classList.add('is-open'); el.classList.add('is-open'); });

  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    scrim.classList.remove('is-open');
    el.classList.remove('is-open');
    const i = stack.indexOf(api);
    if (i >= 0) stack.splice(i, 1);
    if (!stack.length) document.body.style.overflow = '';
    setTimeout(() => { scrim.remove(); el.remove(); }, 380);
    onClose?.(result);
  };
  const api = { el, close, body: el.querySelector('.sheet__body'), foot: el.querySelector('.sheet__foot') };
  stack.push(api);
  scrim.addEventListener('click', () => close());
  el.querySelector('[data-close]').addEventListener('click', () => close());

  // arrastar para baixo fecha (mobile)
  let y0 = null;
  const grab = el.querySelector('.sheet__grab');
  const head = el.querySelector('.sheet__head');
  [grab, head].forEach((h) => {
    h.addEventListener('touchstart', (e) => { y0 = e.touches[0].clientY; el.style.transition = 'none'; }, { passive: true });
    h.addEventListener('touchmove', (e) => { if (y0 == null) return; const dy = Math.max(0, e.touches[0].clientY - y0); el.style.transform = `translateY(${dy}px)`; }, { passive: true });
    h.addEventListener('touchend', (e) => {
      if (y0 == null) return;
      const dy = e.changedTouches[0].clientY - y0;
      el.style.transition = ''; el.style.transform = '';
      y0 = null;
      if (dy > 90) close();
    });
  });
  onMount?.(api);
  setTimeout(() => el.querySelector('[autofocus]')?.focus(), 350);
  return api;
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && stack.length) stack[stack.length - 1].close(); });
export const closeAllSheets = () => [...stack].forEach((s) => s.close());

export function confirmDialog({ title = 'Tem certeza?', message = '', ok = 'Confirmar', cancel = 'Voltar', danger = false, extraHtml = '' }) {
  return new Promise((resolve) => {
    let result = false;
    openSheet({
      title: esc(title),
      body: `${message ? `<p class="muted" style="margin:0 0 8px">${message}</p>` : ''}${extraHtml}`,
      foot: `<button class="btn btn--ghost" data-no>${esc(cancel)}</button><button class="btn ${danger ? 'btn--danger' : ''}" data-yes>${esc(ok)}</button>`,
      onMount: ({ el, close }) => {
        el.querySelector('[data-yes]').onclick = () => { result = true; close(); };
        el.querySelector('[data-no]').onclick = () => close();
      },
      onClose: () => resolve(result),
    });
  });
}

// ---------------------------------------------------------------- Formulários
export function formData(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
    else o[el.name] = el.value;
  }
  return o;
}
export function markInvalid(root, fields = []) {
  root.querySelectorAll('.is-invalid').forEach((e) => e.classList.remove('is-invalid'));
  for (const f of fields) {
    const el = root.querySelector(`[data-field="${f}"]`) || root.querySelector(`[name="${f}"]`)?.closest('.field');
    el?.classList.add('is-invalid');
  }
  root.querySelector('.is-invalid')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
export async function busy(btn, fn) {
  if (btn.disabled) return;
  btn.disabled = true;
  try { return await fn(); } finally { btn.disabled = false; }
}

export const checkbox = (name, label, checked = false, attrs = '') =>
  `<label class="check"><span class="check__label">${label}</span><input type="checkbox" name="${name}" ${checked ? 'checked' : ''} ${attrs}><span class="box">${I.check}</span></label>`;
export const empty = (icon, title, text = '') => `<div class="empty">${icon}<b>${title}</b>${text ? `<p>${text}</p>` : ''}</div>`;

// ---------------------------------------------------------------- Navegação
export const go = (hash) => { if (location.hash === hash) rerender(); else location.hash = hash; };
export const rerender = () => window.dispatchEvent(new CustomEvent('ae:render'));
export function parseHash() {
  const h = location.hash.replace(/^#\/?/, '') || 'painel';
  const [path, qs = ''] = h.split('?');
  return { parts: path.split('/').filter(Boolean), query: Object.fromEntries(new URLSearchParams(qs)) };
}
export const qs = (o) => { const s = new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== '')).toString(); return s ? '?' + s : ''; };

// ---------------------------------------------------------------- Lola: tabelas, paginação e assinatura
/**
 * Tabela elegante no computador e cartões no celular, com paginação.
 * cols: [{ label, cell: (row) => html, cls? }]; card: (row) => html do cartão (celular); onRow(row)
 */
export function dataTable(host, { rows, cols, card, onRow, pageSize = 20, page = 0, empty: emptyHtml = '', afterDraw }) {
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  let p = Math.min(page, pages - 1);
  const draw = () => {
    if (!rows.length) { host.innerHTML = emptyHtml; afterDraw?.(host); return; }
    const slice = rows.slice(p * pageSize, (p + 1) * pageSize);
    const nums = [];
    for (let i = 0; i < pages; i++) if (i === 0 || i === pages - 1 || Math.abs(i - p) <= 1) nums.push(i); else if (nums[nums.length - 1] !== '…') nums.push('…');
    host.innerHTML = `
      <div class="dt"><table>
        <thead><tr>${cols.map((c) => `<th class="${c.cls || ''}">${c.label}</th>`).join('')}</tr></thead>
        <tbody>${slice.map((r, i) => `<tr data-i="${i}" tabindex="0">${cols.map((c) => `<td class="${c.cls || ''}">${c.cell(r)}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>
      <div class="dt-cards">${slice.map((r, i) => card(r).replace(/^(\s*<\w+)/, `$1 data-ci="${i}"`)).join('')}</div>
      ${pages > 1 ? `<div class="pager"><span>${p * pageSize + 1}–${Math.min(rows.length, (p + 1) * pageSize)} de ${rows.length}</span><div>
        <button data-pg="${p - 1}" ${p === 0 ? 'disabled' : ''} aria-label="Página anterior">‹</button>
        ${nums.map((n) => (n === '…' ? '<span style="align-self:center">…</span>' : `<button data-pg="${n}" class="${n === p ? 'is-on' : ''}">${n + 1}</button>`)).join('')}
        <button data-pg="${p + 1}" ${p >= pages - 1 ? 'disabled' : ''} aria-label="Próxima página">›</button></div></div>` : ''}`;
    host.querySelectorAll('[data-i]').forEach((tr) => {
      const row = slice[Number(tr.dataset.i)];
      tr.onclick = (e) => { if (!e.target.closest('button, a')) onRow?.(row, e); };
      tr.onkeydown = (e) => { if (e.key === 'Enter') onRow?.(row, e); };
    });
    host.querySelectorAll('[data-ci]').forEach((el) => {
      const row = slice[Number(el.dataset.ci)];
      if (el.tagName !== 'A') el.addEventListener('click', (e) => { if (!e.target.closest('[data-stop]')) onRow?.(row, e); });
    });
    host.querySelectorAll('[data-pg]').forEach((b) => (b.onclick = () => { p = Number(b.dataset.pg); draw(); host.scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
    afterDraw?.(host);
  };
  draw();
  return { redraw: draw };
}

export const SALES_WA = '5511962822060';
export const salesLink = (text) => `https://wa.me/${SALES_WA}?text=${encodeURIComponent(text)}`;

/** Situação da assinatura (vinda de /api/me) em texto curto */
export function planInfo(sub) {
  if (!sub) return null;
  const d = sub.days_left;
  if (sub.state === 'trial') return { label: d === 0 ? 'Último dia do teste grátis' : `Teste grátis: ${d + 1} dia${d === 0 ? '' : 's'} restante${d === 0 ? '' : 's'}`, late: d <= 2 };
  if (sub.state === 'active') return { label: sub.paid_until ? `Plano Lola ativo até ${fmtDate(sub.paid_until)}` : 'Plano Lola ativo', late: false, active: true };
  if (sub.state === 'expired') return { label: 'Seu acesso venceu. Consulta liberada; para alterar, renove o plano.', late: true };
  return { label: 'Acesso suspenso. Fale com a Lola.', late: true };
}

export function subscriptionSheet(message) {
  const s = state.subscription;
  openSheet({
    title: 'Continue com a Lola',
    body: `<p class="muted" style="margin-top:0">${esc(message || 'Seu período de acesso terminou.')}</p>
      <div class="card" style="padding:18px;margin-top:8px"><b style="font-size:15px">Plano Lola</b>
      <div style="font-family:var(--serif);font-size:34px;margin:6px 0">R$ 49,90<span class="small muted" style="font-family:var(--sans)"> /mês</span></div>
      <p class="small muted" style="margin:0">Seus dados continuam guardados. Ao contratar, tudo volta a funcionar na hora.</p></div>`,
    foot: `<a class="btn btn--wa btn--block" target="_blank" rel="noopener" href="${esc(salesLink(`Olá, Lola! Quero contratar o plano para ${state.company?.name || 'meu espaço'}${s?.state === 'expired' ? ' (meu teste terminou)' : ''}.`))}">Contratar pelo WhatsApp</a>`,
  });
}
