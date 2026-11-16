// Painel — visão do dia: atendimentos, caixa do mês, próximos dias, avisos e primeiros passos
import { api } from '../api.js';
import { I } from '../icons.js';
import { state, esc, money, fmtDayLong, fmtDayShort, statusBadge, go, empty, parseD, MONTHS } from '../ui.js';
import { openAppointmentForm, openAppointmentDetail } from './appointment.js';
import { openClientForm } from './clients.js';
import { openTxForm } from './finance.js';

const ACTIVE = (a) => a.status !== 'cancelada' && a.status !== 'faltou';

function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }).format(new Date()));
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

export async function renderDashboard(main, ctx) {
  const d = await api.get('/api/dashboard');
  if (!ctx.isCurrent()) return;
  const first = (state.user?.name || '').trim().split(/\s+/)[0];
  const today = d.appointments.filter(ACTIVE);
  const forecast = today.reduce((s, a) => s + a.total_cents, 0);
  const nextUp = today.filter((a) => a.status !== 'concluida');
  const setup = [
    { done: d.procedures > 0, text: 'Cadastre seus serviços com valor e duração', go: '#/procedimentos', btn: 'Cadastrar' },
    { done: d.clients > 0, text: 'Cadastre sua primeira cliente', act: 'client', btn: 'Cadastrar' },
    { done: d.upcoming.length + d.appointments.length > 0, text: 'Faça o primeiro agendamento', act: 'appt', btn: 'Agendar' },
    { done: false, text: 'Instale a Lola no celular', go: '#/mais', btn: 'Ver como' },
  ];
  const showSetup = d.procedures === 0 || d.clients === 0;
  const byDay = {};
  for (const a of d.upcoming) (byDay[a.date] ||= []).push(a);
  const m = parseD(d.today).getUTCMonth();

  main.innerHTML = `
    <div class="page">
      <section class="hello">
        <h1>${greeting()}${first ? `, ${esc(first)}` : ''}.</h1>
        <p>${fmtDayLong(d.today)} · ${today.length ? `${today.length} atendimento${today.length > 1 ? 's' : ''} hoje` : 'nenhum atendimento hoje'}</p>
      </section>

      <div class="kpis">
        <div class="kpi kpi--dark"><small>Previsto hoje</small><b>${money(forecast)}</b><span>${today.length} atendimento${today.length === 1 ? '' : 's'}</span></div>
        <div class="kpi"><small>Saldo de ${MONTHS[m]}</small><b style="color:${d.month_balance_cents < 0 ? 'var(--out)' : 'inherit'}">${money(d.month_balance_cents)}</b><span>entradas ${money(d.month_income_cents)}</span></div>
        <div class="kpi"><small>Próximos 7 dias</small><b>${d.upcoming.length}</b><span>agendamento${d.upcoming.length === 1 ? '' : 's'}</span></div>
        <div class="kpi"><small>Clientes ativas</small><b>${d.clients}</b><span>${d.pending_anamnese ? `${d.pending_anamnese} sem anamnese` : 'anamneses em dia'}</span></div>
      </div>

      <div class="qa">
        <button data-act="appt">${I.calendar}Agendar</button>
        <button data-act="client">${I.user}Nova cliente</button>
        <button data-act="tx">${I.wallet}Lançar valor</button>
        <a href="#/agenda?v=dia">${I.clock}Agenda do dia</a>
      </div>

      <div class="dash">
        <div style="display:grid;gap:18px">
          ${showSetup ? `<section class="panel"><div class="panel__head"><h2>Primeiros passos</h2></div>
            <ol class="steps">${setup.map((s, i) => `<li class="${s.done ? 'is-done' : ''}"><span>${s.text}</span>${s.done ? '' : `<button class="btn btn--ghost btn--sm" data-step="${i}">${s.btn}</button>`}</li>`).join('')}</ol></section>` : ''}
          <section class="panel">
            <div class="panel__head"><h2>Hoje</h2><a href="#/agenda?v=dia">Abrir agenda</a></div>
            ${d.appointments.length ? d.appointments.map((a) => `
              <button class="mini" data-appt="${a.id}">
                <span class="mini__t">${a.start}<small>${a.end}</small></span>
                <span class="mini__m"><b>${esc(a.client_name)}</b><span>${esc(a.procedures.map((p) => p.name).join(' + '))}</span></span>
                ${statusBadge(a.status)}
              </button>`).join('') : empty(I.calendar, 'Dia livre', 'Nenhum atendimento marcado para hoje.')}
          </section>
          <section class="panel">
            <div class="panel__head"><h2>Próximos dias</h2><a href="#/agenda?v=semana">Semana</a></div>
            ${Object.keys(byDay).length ? Object.entries(byDay).map(([day, list]) => `
              <div class="small muted" style="font-weight:700;margin:12px 0 2px">${fmtDayShort(day)} · ${list.length} atendimento${list.length > 1 ? 's' : ''}</div>
              ${list.map((a) => `<button class="mini" data-up="${a.id}"><span class="mini__t">${a.start}</span><span class="mini__m"><b>${esc(a.client_name)}</b><span>${esc(a.procedures.map((p) => p.name).join(' + '))}</span></span>${a.status === 'confirmada' ? statusBadge(a.status) : ''}</button>`).join('')}`).join('')
              : `<p class="small muted" style="margin:0">Nada marcado nos próximos 7 dias.</p>`}
          </section>
        </div>
        <div style="display:grid;gap:18px">
          <section class="panel">
            <div class="panel__head"><h2>Avisos</h2></div>
            ${notices(d, nextUp) || '<p class="small muted" style="margin:0">Tudo em ordem por aqui.</p>'}
          </section>
          ${d.birthdays.length ? `<section class="panel"><div class="panel__head"><h2>Aniversariantes de ${MONTHS[m]}</h2></div>
            ${d.birthdays.slice(0, 8).map((c) => `<a class="notice" href="#/clientes/${c.id}">${I.gift}<span class="grow">${esc(c.name)}</span><span class="small muted">${c.birth_date.slice(8)}/${c.birth_date.slice(5, 7)}</span></a>`).join('')}</section>` : ''}
        </div>
      </div>
    </div>`;

  const act = { appt: () => openAppointmentForm({ date: state.today }), client: () => openClientForm({ afterSave: (c) => go(`#/clientes/${c.id}`) }), tx: () => openTxForm({ prefill: { date: state.today } }) };
  main.querySelectorAll('[data-act]').forEach((b) => (b.onclick = act[b.dataset.act]));
  main.querySelectorAll('[data-step]').forEach((b) => (b.onclick = () => { const s = setup[Number(b.dataset.step)]; s.go ? go(s.go) : act[s.act](); }));
  main.querySelectorAll('[data-appt]').forEach((b) => (b.onclick = () => openAppointmentDetail(d.appointments.find((a) => a.id === Number(b.dataset.appt)))));
  main.querySelectorAll('[data-up]').forEach((b) => (b.onclick = () => openAppointmentDetail(d.upcoming.find((a) => a.id === Number(b.dataset.up)))));
}

function notices(d, nextUp) {
  const n = [];
  const resched = [...d.appointments, ...d.upcoming].filter((a) => a.wa?.reply === 'reschedule' && ACTIVE(a));
  if (resched.length) n.push(`<a class="notice" href="#/mais/whatsapp">${I.whatsapp}<span>${resched.length} cliente${resched.length > 1 ? 's pediram' : ' pediu'} para remarcar pelo WhatsApp</span></a>`);
  const noAnam = nextUp.filter((a) => a.anamnese !== 'ok');
  if (noAnam.length) n.push(`<a class="notice" href="#/clientes/${noAnam[0].client_id}">${I.clipboard}<span>${noAnam.length} atendimento${noAnam.length > 1 ? 's' : ''} de hoje sem anamnese completa</span></a>`);
  if (d.low_stock) n.push(`<a class="notice" href="#/mais/estoque">${I.box}<span>${d.low_stock} ${d.low_stock > 1 ? 'itens' : 'item'} do estoque abaixo do mínimo</span></a>`);
  const toConfirm = d.upcoming.filter((a) => a.status === 'agendada' && a.date === d.upcoming[0]?.date);
  if (toConfirm.length) n.push(`<a class="notice" href="#/mais/whatsapp">${I.check}<span>${toConfirm.length} atendimento${toConfirm.length > 1 ? 's' : ''} de ${fmtDayShort(toConfirm[0].date)} ainda sem confirmação</span></a>`);
  return n.join('');
}
