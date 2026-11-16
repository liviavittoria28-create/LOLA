// Relatórios — calculados a partir dos dados reais (financeiro e agenda)
import { api } from '../api.js';
import { I } from '../icons.js';
import { state, esc, money, moneyShort, MONTHS_SHORT, go, empty, STATUS } from '../ui.js';

export async function renderReports(main, ctx) {
  const year = /^\d{4}$/.test(ctx.query.ano || '') ? ctx.query.ano : state.today.slice(0, 4);
  const r = await api.get(`/api/reports?year=${year}`);
  if (!ctx.isCurrent()) return;
  const inc = r.months.reduce((s, m) => s + m.income_cents, 0);
  const out = r.months.reduce((s, m) => s + m.expense_cents, 0);
  const appts = r.months.reduce((s, m) => s + m.appointments, 0);
  const ticket = appts ? Math.round(inc / appts) : 0;
  const totalStatus = r.by_status.reduce((s, x) => s + x.n, 0);
  const st = Object.fromEntries(r.by_status.map((x) => [x.status, x.n]));
  const pct = (n) => (totalStatus ? Math.round((n / totalStatus) * 100) : 0);
  const has = inc || out || appts;

  main.innerHTML = `
    <div class="page">
      <header class="top">
        <div><div class="top__eyebrow">Resultados do ano</div><h1>Relatórios ${year}</h1></div>
        <div class="top__actions no-print">
          <button class="icon-btn" data-go="#/relatorios?ano=${Number(year) - 1}" aria-label="Ano anterior">${I.left}</button>
          <button class="icon-btn" data-go="#/relatorios?ano=${Number(year) + 1}" aria-label="Próximo ano">${I.right}</button>
          <button class="btn btn--ghost btn--sm hide-m" data-print>${I.print}Imprimir / PDF</button>
        </div>
      </header>
      <div class="kpis">
        <div class="kpi kpi--dark"><small>Faturamento</small><b>${money(inc)}</b><span>entradas do ano</span></div>
        <div class="kpi"><small>Resultado</small><b style="color:${inc - out < 0 ? 'var(--out)' : 'inherit'}">${money(inc - out)}</b><span>saídas ${money(out)}</span></div>
        <div class="kpi"><small>Atendimentos</small><b>${appts}</b><span>sem cancelados e faltas</span></div>
        <div class="kpi"><small>Ticket médio</small><b>${money(ticket)}</b><span>${r.new_clients} cliente${r.new_clients === 1 ? '' : 's'} nova${r.new_clients === 1 ? '' : 's'}</span></div>
      </div>
      ${has ? `
      <div class="rep-grid">
        <section class="panel panel--wide">
          <div class="panel__head"><h2>Entradas e saídas por mês</h2></div>
          ${barChart(r.months)}
          <div class="legend-row"><span><i style="background:var(--gold)"></i>Entradas</span><span><i style="background:var(--nude)"></i>Saídas</span><span><i style="background:var(--leaf);height:2px;vertical-align:3px"></i>Atendimentos</span></div>
        </section>
        <section class="panel">
          <div class="panel__head"><h2>Serviços mais feitos</h2></div>
          ${hbars(r.top_procedures.map((p) => ({ label: p.name, value: p.n, right: `${p.n}× · ${moneyShort(p.total_cents)}` })))}
        </section>
        <section class="panel">
          <div class="panel__head"><h2>Clientes que mais investiram</h2></div>
          ${r.top_clients.length ? hbars(r.top_clients.map((c) => ({ label: c.name, value: c.total_cents, right: `${moneyShort(c.total_cents)} · ${c.visits} visita${c.visits > 1 ? 's' : ''}`, href: `#/clientes/${c.id}` }))) : '<p class="small muted">Aparece quando houver atendimentos concluídos.</p>'}
        </section>
        <section class="panel">
          <div class="panel__head"><h2>Situação dos atendimentos</h2></div>
          ${Object.keys(STATUS).map((k) => `<div class="hbar"><div class="hbar__l"><b><span class="dot st-${k}" style="margin-right:8px;background:var(--c)"></span>${STATUS[k].label}</b><span>${st[k] || 0} · ${pct(st[k] || 0)}%</span></div><div class="hbar__t"><i class="st-${k}" style="width:${pct(st[k] || 0)}%;background:var(--c)"></i></div></div>`).join('')}
        </section>
        <section class="panel">
          <div class="panel__head"><h2>Formas de pagamento</h2></div>
          ${hbars(r.methods.map((m) => ({ label: m.method, value: m.total_cents, right: moneyShort(m.total_cents) })))}
        </section>
      </div>` : `<div class="card mt">${empty(I.chart, 'Ainda sem dados em ' + year, 'Os relatórios aparecem conforme você agenda atendimentos e lança entradas e saídas no financeiro.')}</div>`}
      <p class="small muted mt-lg" style="text-align:center">Para a planilha detalhada de cada mês, use Financeiro → Planilha.</p>
    </div>`;
  main.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => go(b.dataset.go)));
  main.querySelector('[data-print]').onclick = () => window.print();
}

function hbars(items) {
  if (!items.length) return '<p class="small muted" style="margin:0">Sem dados no período.</p>';
  const max = Math.max(1, ...items.map((i) => i.value));
  return items.map((i) => `
    <${i.href ? `a href="${i.href}"` : 'div'} class="hbar" style="display:block;color:inherit">
      <div class="hbar__l"><b>${esc(i.label)}</b><span>${esc(i.right)}</span></div>
      <div class="hbar__t"><i style="width:${(i.value / max) * 100}%"></i></div>
    </${i.href ? 'a' : 'div'}>`).join('');
}

// barras agrupadas (entradas x saídas) + linha de atendimentos
function barChart(months) {
  const W = 720, H = 240, L = 46, R = 30, T = 14, B = 26;
  const iw = W - L - R, ih = H - T - B;
  const max = Math.max(1, ...months.flatMap((m) => [m.income_cents, m.expense_cents]));
  const nice = niceMax(max);
  const maxA = Math.max(1, ...months.map((m) => m.appointments));
  const bw = iw / 12;
  const y = (v) => T + ih - (v / nice) * ih;
  const ya = (v) => T + ih - (v / maxA) * ih * 0.9;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * nice);
  const pts = months.map((m, i) => [L + bw * i + bw / 2, ya(m.appointments)]);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Entradas e saídas por mês">
    ${ticks.map((t) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${t >= 100000 ? `${Math.round(t / 100000)}k` : Math.round(t / 100)}</text>`).join('')}
    ${months.map((m, i) => {
      const x = L + bw * i + bw * 0.18, w = bw * 0.3;
      return `<rect class="bar-in" x="${x}" y="${y(m.income_cents)}" width="${w}" height="${Math.max(0, T + ih - y(m.income_cents))}" rx="3"><title>${MONTHS_SHORT[i]}: entradas ${money(m.income_cents)}</title></rect>
        <rect class="bar-out" x="${x + w + 2}" y="${y(m.expense_cents)}" width="${w}" height="${Math.max(0, T + ih - y(m.expense_cents))}" rx="3"><title>${MONTHS_SHORT[i]}: saídas ${money(m.expense_cents)}</title></rect>
        <text x="${L + bw * i + bw / 2}" y="${H - 6}" text-anchor="middle">${MONTHS_SHORT[i]}</text>`;
    }).join('')}
    <polyline class="line" points="${pts.map((p) => p.join(',')).join(' ')}"/>
    ${pts.map((p, i) => `<circle class="pt" cx="${p[0]}" cy="${p[1]}" r="3.5"><title>${MONTHS_SHORT[i]}: ${months[i].appointments} atendimentos</title></circle>`).join('')}
  </svg>`;
}
function niceMax(v) {
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
