// Lola — painel do proprietário da plataforma: empresas, testes, assinaturas, pagamentos e receita
import { api, setUnauthorizedHandler } from './api.js';
import { I } from './icons.js';
import {
  state, esc, money, fmtDate, fmtMonth, openSheet, toast, toastError, markInvalid, busy, confirmDialog, empty, dataTable,
  parseHash, closeAllSheets, centsToInput, parseMoney, waLink, MONTHS_SHORT,
} from './ui.js';
import { renderLogin } from './views/login.js';

const root = document.getElementById('root');
const STATE = {
  trial: ['Em teste', 'st-agendada'], active: ['Ativa', 'st-confirmada'], expired: ['Vencida', 'st-cancelada'],
  suspended: ['Suspensa', 'st-faltou'], canceled: ['Cancelada', 'st-faltou'],
};
const badge = (c) => `<span class="badge ${STATE[c.state]?.[1] || ''}"><span class="dot"></span>${STATE[c.state]?.[0] || c.state}${c.state === 'active' && !c.paid_until ? ' (sem vencimento)' : ''}</span>`;
const due = (c) => (c.state === 'trial' ? `teste até ${fmtDate(c.trial_ends_at)}` : c.state === 'active' && !c.paid_until ? 'sem vencimento' : c.paid_until ? `pago até ${fmtDate(c.paid_until)}` : c.trial_ends_at ? `teste terminou ${fmtDate(c.trial_ends_at)}` : '—');
const NAV = [['visao', 'Visão geral', I.home], ['empresas', 'Empresas', I.users], ['pagamentos', 'Pagamentos', I.wallet]];

setUnauthorizedHandler(() => { closeAllSheets(); showLogin(); });

async function boot() {
  try {
    const me = await api.get('/api/me');
    if (!me.platform) return location.replace('/app/');
    state.user = me.user; state.today = me.today;
    shell();
  } catch { showLogin(); }
}
function showLogin() {
  renderLogin(root, (me) => { if (!me.platform) return location.replace('/app/'); state.user = me.user; state.today = me.today; shell(); });
  root.querySelector('.login__brand p').textContent = 'Painel do proprietário da plataforma.';
  root.querySelector('.login__links')?.remove();
}
function shell() {
  root.innerHTML = `<div class="app">
    <nav class="nav" aria-label="Painel do proprietário">
      <div class="nav__brand"><span class="wordmark">Lola<i></i></span><span>Painel do proprietário</span></div>
      ${NAV.map(([id, l, ic]) => `<a href="#/${id}" data-tab="${id}">${ic}<span>${l}</span></a>`).join('')}
      <a href="/" data-tab="site" class="nav__desk" target="_blank">${I.sparkle}<span>Ver o site</span></a>
      <a href="#" data-tab="sair">${I.logout}<span>Sair</span></a>
    </nav>
    <main class="main" id="main"></main></div>`;
  root.querySelector('[data-tab="sair"]').onclick = async (e) => { e.preventDefault(); await api.post('/api/logout').catch(() => {}); location.replace('/entrar/'); };
  route();
}
let seq = 0;
async function route() {
  const main = document.getElementById('main');
  if (!main) return;
  const { parts, query } = parseHash();
  const tab = NAV.some(([id]) => id === parts[0]) ? parts[0] : 'visao';
  document.querySelectorAll('.nav a[data-tab]').forEach((a) => a.classList.toggle('is-active', a.dataset.tab === tab));
  const my = ++seq;
  const ctx = { query, isCurrent: () => my === seq };
  try {
    if (tab === 'empresas') await companies(main, ctx);
    else if (tab === 'pagamentos') await payments(main, ctx);
    else await overview(main, ctx);
    main.querySelector('.page')?.insertAdjacentHTML('afterbegin', `<div class="mtop"><span class="wordmark">Lola<i></i></span><span class="mtop__co">Proprietário</span></div>`);
  } catch (e) { if (e.status !== 401) main.innerHTML = `<div class="page">${empty(I.alert, 'Não foi possível carregar', esc(e.message))}</div>`; }
}
window.addEventListener('hashchange', () => { closeAllSheets(); route(); });
window.addEventListener('ae:render', route);

// ---------------------------------------------------------------- Visão geral
async function overview(main, ctx) {
  const o = await api.get('/api/admin/overview');
  if (!ctx.isCurrent()) return;
  const t = o.totals;
  const max = Math.max(1, ...o.revenue.map((r) => r.amount_cents));
  main.innerHTML = `<div class="page">
    <header class="top"><div><div class="top__eyebrow">${fmtDate(o.today)}</div><h1>Visão geral</h1></div>
      <div class="top__actions"><button class="btn btn--gold btn--sm" data-new>${I.plus}Nova empresa</button></div></header>
    <div class="kpis">
      <div class="kpi kpi--dark"><small>Receita recorrente (MRR)</small><b>${money(t.mrr_cents)}</b><span>${t.paying} assinatura${t.paying === 1 ? '' : 's'} paga${t.paying === 1 ? '' : 's'}</span></div>
      <div class="kpi"><small>Empresas cadastradas</small><b>${t.companies}</b><span>${t.signups_30d} nos últimos 30 dias</span></div>
      <div class="kpi"><small>Em teste grátis</small><b>${t.trial}</b><span>${t.trials_ending_3d} terminam em até 3 dias</span></div>
      <div class="kpi"><small>Vencidas</small><b style="color:${t.expired ? 'var(--out)' : 'inherit'}">${t.expired}</b><span>${t.renewals_7d} renovações em 7 dias</span></div>
    </div>
    <div class="dash" style="margin-top:18px">
      <section class="panel"><div class="panel__head"><h2>Pagamentos recebidos</h2><a href="#/pagamentos">Histórico</a></div>
        <svg class="chart" viewBox="0 0 720 220" role="img" aria-label="Pagamentos por mês">
          ${o.revenue.map((r, i) => { const h = (r.amount_cents / max) * 170; const x = 20 + i * 58; return `<rect class="bar-in" x="${x}" y="${190 - h}" width="34" height="${h}" rx="4"><title>${fmtMonth(r.month)}: ${money(r.amount_cents)} (${r.payments})</title></rect><text x="${x + 17}" y="210" text-anchor="middle">${MONTHS_SHORT[Number(r.month.slice(5)) - 1]}</text>`; }).join('')}
          <line class="grid" x1="10" x2="710" y1="190" y2="190"/></svg>
        <div class="legend-row"><span>Ativas sem vencimento (cortesia): ${t.courtesy}</span><span>Suspensas: ${t.suspended}</span><span>Canceladas: ${t.canceled}</span></div>
      </section>
      <section class="panel"><div class="panel__head"><h2>Atenção: vencimentos</h2><a href="#/empresas">Todas</a></div>
        ${o.expiring.length ? o.expiring.map((c) => `<button class="mini" data-co="${c.id}"><span class="mini__m"><b>${esc(c.name)}</b><span>${esc(due(c))}</span></span>${badge(c)}</button>`).join('') : '<p class="small muted" style="margin:0">Nenhum teste ou mensalidade vencendo nos próximos dias.</p>'}
      </section>
    </div>
    <section class="panel" style="margin-top:18px"><div class="panel__head"><h2>Cadastros recentes</h2></div>
      ${o.recent.length ? o.recent.map((c) => `<button class="mini" data-co="${c.id}"><span class="mini__m"><b>${esc(c.name)}</b><span>${esc(c.owner_name || '')} · ${esc(c.email || '')} · desde ${fmtDate(c.created_at.slice(0, 10))}</span></span>${badge(c)}</button>`).join('') : empty(I.users, 'Nenhuma empresa ainda', 'Os cadastros feitos pelo site aparecem aqui.')}
    </section></div>`;
  main.querySelector('[data-new]').onclick = newCompany;
  main.querySelectorAll('[data-co]').forEach((b) => (b.onclick = () => openCompany(Number(b.dataset.co))));
}

// ---------------------------------------------------------------- Empresas
async function companies(main, ctx) {
  const st = ctx.query.situacao || '';
  const list = await api.get(`/api/admin/companies${st ? `?state=${st}` : ''}`);
  if (!ctx.isCurrent()) return;
  main.innerHTML = `<div class="page">
    <header class="top"><div><div class="top__eyebrow">Clientes da plataforma</div><h1>Empresas</h1></div>
      <div class="top__actions"><button class="btn btn--gold btn--sm" data-new>${I.plus}Nova empresa</button></div></header>
    <div class="toolbar">
      <div class="search">${I.search}<input class="input" type="search" placeholder="Buscar por empresa, dona, e-mail ou telefone" data-q aria-label="Buscar empresa"></div>
      <select class="select" data-st aria-label="Situação"><option value="">Todas as situações</option>${Object.entries(STATE).map(([k, [l]]) => `<option value="${k}" ${k === st ? 'selected' : ''}>${l}</option>`).join('')}</select>
    </div>
    <p class="small muted" data-count></p>
    <div data-list></div></div>`;
  const draw = (term = '') => {
    const t = term.toLowerCase();
    const rows = list.filter((c) => !t || `${c.name} ${c.owner_name} ${c.email} ${c.phone} ${c.city}`.toLowerCase().includes(t));
    main.querySelector('[data-count]').textContent = `${rows.length} empresa${rows.length === 1 ? '' : 's'}`;
    dataTable(main.querySelector('[data-list]'), {
      rows, pageSize: 25, onRow: (c) => openCompany(c.id),
      empty: `<div class="card">${empty(I.users, 'Nenhuma empresa encontrada', 'Ajuste a busca ou o filtro.')}</div>`,
      cols: [
        { label: 'Empresa', cell: (c) => `<b>${esc(c.name)}</b><div class="small muted">${esc(c.owner_name || '')}${c.city ? ` · ${esc(c.city)}` : ''}</div>` },
        { label: 'Contato', cell: (c) => `<span class="muted-cell">${esc(c.email || '')}<br>${esc(c.phone || '')}</span>` },
        { label: 'Situação', cell: (c) => `${badge(c)}<div class="small muted" style="margin-top:4px">${esc(due(c))}</div>` },
        { label: 'Uso', cell: (c) => `<span class="muted-cell">${c.clients} clientes<br>${c.appointments} atendimentos</span>` },
        { label: 'Pago no total', cls: 'num', cell: (c) => `<b>${money(c.paid_total_cents)}</b>` },
      ],
      card: (c) => `<button class="item"><div class="item__main"><div class="item__title">${esc(c.name)}</div><div class="item__sub">${esc(due(c))}</div></div>${badge(c)}</button>`,
    });
  };
  draw();
  main.querySelector('[data-q]').oninput = (e) => draw(e.target.value);
  main.querySelector('[data-st]').onchange = (e) => (location.hash = `#/empresas${e.target.value ? `?situacao=${e.target.value}` : ''}`);
  main.querySelector('[data-new]').onclick = newCompany;
}

async function openCompany(id) {
  const c = await api.get(`/api/admin/companies/${id}`);
  const wa = c.phone ? waLink(c.phone, `Olá, ${(c.owner_name || '').split(' ')[0]}! Aqui é da Lola.`) : null;
  const sheet = openSheet({
    title: esc(c.name), wide: true,
    body: `
      <div class="row" style="gap:8px;flex-wrap:wrap">${badge(c)}<span class="small muted">${esc(due(c))}</span></div>
      <dl class="card kv mt">
        <dt>Responsável</dt><dd>${esc(c.owner_name || '—')}</dd><dt>E-mail</dt><dd>${esc(c.email || '—')}</dd><dt>Telefone</dt><dd>${esc(c.phone || '—')}</dd>
        <dt>Cadastro</dt><dd>${fmtDate(c.created_at.slice(0, 10))}</dd><dt>Último acesso</dt><dd>${c.last_login_at ? fmtDate(c.last_login_at.slice(0, 10)) : '—'}</dd>
        <dt>Uso</dt><dd>${c.clients} clientes · ${c.appointments} atendimentos</dd>
      </dl>
      <div class="quick">
        ${wa ? `<a href="${esc(wa)}" target="_blank" rel="noopener">${I.whatsapp}WhatsApp</a>` : ''}
        <button type="button" data-reset>${I.key}Link de senha</button>
        <button type="button" data-pay>${I.wallet}Registrar pagamento</button>
      </div>
      <form data-edit novalidate class="mt-lg">
        <div class="section-title" style="margin-top:0"><b>Assinatura</b></div>
        <div class="grid-2">
          <label class="field"><span>Situação</span><select class="select" name="status">${[['trial', 'Teste grátis'], ['active', 'Ativa'], ['suspended', 'Suspensa'], ['canceled', 'Cancelada']].map(([k, l]) => `<option value="${k}" ${k === c.status ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="field"><span>Mensalidade (R$)</span><input class="input" name="price" inputmode="decimal" value="${centsToInput(c.price_cents)}"></label>
          <label class="field"><span>Fim do teste</span><input class="input" type="date" name="trial_ends_at" value="${esc(c.trial_ends_at || '')}"></label>
          <label class="field"><span>Pago até</span><input class="input" type="date" name="paid_until" value="${esc(c.paid_until || '')}"></label>
        </div>
        <p class="small muted" style="margin-top:-6px">“Ativa” sem data em “Pago até” fica sem vencimento (cortesia).</p>
        <label class="field"><span>Observações internas</span><textarea class="textarea" name="notes">${esc(c.notes || '')}</textarea></label>
        <button class="btn btn--gold btn--block" type="submit">Salvar empresa</button>
      </form>
      <div class="section-title"><b>Pagamentos</b><span>${c.payments.length}</span></div>
      ${c.payments.length ? `<div class="list">${c.payments.map((p) => `<div class="item"><div class="item__main"><div class="item__title">${money(p.amount_cents)} · ${esc(p.method || '')}</div><div class="item__sub">pago em ${fmtDate(p.paid_at)} · período ${fmtDate(p.period_start)} a ${fmtDate(p.period_end)}</div></div><button class="icon-btn icon-btn--plain" data-delpay="${p.id}" aria-label="Excluir pagamento">${I.trash}</button></div>`).join('')}</div>` : '<p class="small muted">Nenhum pagamento registrado.</p>'}`,
  });
  const { el, close } = sheet;
  const f = el.querySelector('[data-edit]');
  f.onsubmit = (e) => {
    e.preventDefault();
    busy(f.querySelector('[type=submit]'), async () => {
      const price = parseMoney(f.price.value);
      try {
        await api.put(`/api/admin/companies/${c.id}`, { status: f.status.value, price_cents: price, trial_ends_at: f.trial_ends_at.value || null, paid_until: f.paid_until.value || null, notes: f.notes.value });
        toast('Empresa salva'); close(); window.dispatchEvent(new CustomEvent('ae:render'));
      } catch (err) { toastError(err); }
    });
  };
  el.querySelector('[data-pay]').onclick = () => payForm(c, close);
  el.querySelector('[data-reset]').onclick = async () => {
    try {
      const r = await api.post(`/api/admin/companies/${c.id}/reset-link`);
      const url = location.origin + r.link;
      showLink('Link para criar nova senha', url, c, `Olá! Aqui está o link para criar sua nova senha da Lola (vale por 24 horas): ${url}`);
    } catch (err) { toastError(err); }
  };
  el.querySelectorAll('[data-delpay]').forEach((b) => (b.onclick = async () => {
    if (!(await confirmDialog({ title: 'Excluir pagamento?', message: 'O vencimento volta para o último pagamento restante.', ok: 'Excluir', danger: true }))) return;
    try { await api.del(`/api/admin/payments/${b.dataset.delpay}`); toast('Pagamento excluído'); close(); openCompany(c.id); } catch (err) { toastError(err); }
  }));
}

function showLink(title, url, c, message) {
  openSheet({
    title,
    body: `<p class="muted" style="margin-top:0">Envie para ${esc(c.owner_name || c.name)}. O link é pessoal e de uso único.</p>
      <input class="input" readonly value="${esc(url)}" data-url>`,
    foot: `<button class="btn btn--ghost" data-copy>Copiar</button>${c.phone ? `<a class="btn btn--wa" target="_blank" rel="noopener" href="${esc(waLink(c.phone, message))}">Enviar pelo WhatsApp</a>` : ''}`,
    onMount: ({ el }) => { el.querySelector('[data-copy]').onclick = async () => { el.querySelector('[data-url]').select(); try { await navigator.clipboard.writeText(url); toast('Link copiado'); } catch { document.execCommand('copy'); } }; },
  });
}

function payForm(c, closeParent) {
  const { el, close } = openSheet({
    title: 'Registrar pagamento',
    body: `<form novalidate>
      <p class="muted" style="margin-top:0">${esc(c.name)} · ${esc(due(c))}</p>
      <div class="grid-2">
        <label class="field" data-field="amount"><span>Valor recebido (R$)</span><input class="input" name="amount" inputmode="decimal" value="${centsToInput(c.price_cents)}"></label>
        <label class="field"><span>Meses pagos</span><input class="input" type="number" name="months" min="1" max="24" value="1"></label>
        <label class="field"><span>Data do pagamento</span><input class="input" type="date" name="paid_at" value="${state.today}"></label>
        <label class="field"><span>Forma</span><select class="select" name="method">${['Pix', 'Cartão de crédito', 'Boleto', 'Transferência', 'Dinheiro'].map((m) => `<option>${m}</option>`).join('')}</select></label>
      </div>
      <label class="field"><span>Observação</span><input class="input" name="note" placeholder="Opcional"></label>
      <p class="small muted">A assinatura é estendida a partir do vencimento atual (ou do fim do teste, se ainda estiver no teste).</p></form>`,
    foot: `<button class="btn btn--gold btn--block" data-save>Registrar pagamento</button>`,
  });
  const f = el.querySelector('form');
  el.querySelector('[data-save]').onclick = (ev) => busy(ev.currentTarget, async () => {
    try {
      await api.post(`/api/admin/companies/${c.id}/payments`, { amount_cents: parseMoney(f.amount.value), months: Number(f.months.value), paid_at: f.paid_at.value, method: f.method.value, note: f.note.value });
      toast('Pagamento registrado'); close(); closeParent(); window.dispatchEvent(new CustomEvent('ae:render'));
    } catch (err) { if (err.data?.fields) markInvalid(f, err.data.fields); toastError(err); }
  });
}

function newCompany() {
  const { el, close } = openSheet({
    title: 'Nova empresa',
    body: `<form novalidate>
      <p class="muted" style="margin-top:0">Para quem contratou pelo WhatsApp. A empresa começa com 15 dias de teste e você recebe um link para a cliente criar a própria senha.</p>
      <label class="field" data-field="company"><span>Nome do estabelecimento</span><input class="input" name="company" autofocus></label>
      <div class="grid-2">
        <label class="field" data-field="name"><span>Nome da responsável</span><input class="input" name="name"></label>
        <label class="field" data-field="phone"><span>WhatsApp</span><input class="input" name="phone" type="tel" placeholder="(11) 99999-0000"></label>
      </div>
      <label class="field" data-field="email"><span>E-mail de acesso</span><input class="input" name="email" type="email"></label>
      <label class="field"><span>Cidade</span><input class="input" name="city"></label></form>`,
    foot: `<button class="btn btn--gold btn--block" data-save>Criar empresa</button>`,
  });
  const f = el.querySelector('form');
  el.querySelector('[data-save]').onclick = (ev) => busy(ev.currentTarget, async () => {
    try {
      const c = await api.post('/api/admin/companies', { company: f.company.value, name: f.name.value, phone: f.phone.value, email: f.email.value, city: f.city.value });
      close();
      const url = location.origin + c.setup_link;
      showLink('Empresa criada', url, c, `Olá, ${f.name.value.split(' ')[0]}! Sua Lola está pronta 🤍 Crie sua senha por este link (vale por 3 dias): ${url} — depois é só entrar com o e-mail ${c.email}.`);
      window.dispatchEvent(new CustomEvent('ae:render'));
    } catch (err) { if (err.data?.fields) markInvalid(f, err.data.fields); toastError(err); }
  });
}

// ---------------------------------------------------------------- Pagamentos
async function payments(main, ctx) {
  const month = /^\d{4}-\d{2}$/.test(ctx.query.mes || '') ? ctx.query.mes : '';
  const list = await api.get(`/api/admin/payments${month ? `?month=${month}` : ''}`);
  if (!ctx.isCurrent()) return;
  const total = list.reduce((s, p) => s + p.amount_cents, 0);
  main.innerHTML = `<div class="page">
    <header class="top"><div><div class="top__eyebrow">Histórico</div><h1>Pagamentos</h1></div></header>
    <div class="toolbar"><input class="input" type="month" data-m value="${month}" style="max-width:220px" aria-label="Mês"><span class="small muted">${list.length} pagamento${list.length === 1 ? '' : 's'} · total ${money(total)}</span></div>
    <div data-list></div>
    <p class="small muted mt">Os pagamentos são lançados aqui quando você recebe (Pix, cartão…). A Lola não cobra automaticamente — veja “Pagamentos recorrentes” na documentação para ligar um meio de pagamento no futuro.</p></div>`;
  dataTable(main.querySelector('[data-list]'), {
    rows: list, pageSize: 30, onRow: (p) => openCompany(p.company_id),
    empty: `<div class="card">${empty(I.wallet, 'Nenhum pagamento', 'Registre pagamentos na ficha de cada empresa.')}</div>`,
    cols: [
      { label: 'Data', cell: (p) => fmtDate(p.paid_at) },
      { label: 'Empresa', cell: (p) => `<b>${esc(p.company_name)}</b>` },
      { label: 'Período', cell: (p) => `<span class="muted-cell">${fmtDate(p.period_start)} a ${fmtDate(p.period_end)}</span>` },
      { label: 'Forma', cell: (p) => `<span class="muted-cell">${esc(p.method || '')}</span>` },
      { label: 'Valor', cls: 'num', cell: (p) => `<b>${money(p.amount_cents)}</b>` },
    ],
    card: (p) => `<button class="item"><div class="item__main"><div class="item__title">${esc(p.company_name)}</div><div class="item__sub">${fmtDate(p.paid_at)} · ${esc(p.method || '')}</div></div><b>${money(p.amount_cents)}</b></button>`,
  });
  main.querySelector('[data-m]').onchange = (e) => (location.hash = `#/pagamentos${e.target.value ? `?mes=${e.target.value}` : ''}`);
}

boot();
