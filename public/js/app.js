// Lola — inicialização, sessão e rotas do sistema interno
import { api, setUnauthorizedHandler, setPaymentRequiredHandler } from './api.js';
import { I } from './icons.js';
import { state, parseHash, closeAllSheets, esc, planInfo, salesLink, subscriptionSheet } from './ui.js';
import { renderLogin } from './views/login.js';
import { renderDashboard } from './views/dashboard.js';
import { renderAgenda } from './views/agenda.js';
import { renderClients, renderClient } from './views/clients.js';
import { renderProcedures } from './views/procedures.js';
import { renderFinance } from './views/finance.js';
import { renderReports } from './views/reports.js';
import { renderMore, renderBlocks, renderStock, renderSettings, renderAccount } from './views/more.js';
import { renderWhatsApp } from './views/whatsapp.js';

const root = document.getElementById('root');

// celular: 5 abas na barra inferior · computador: menu lateral completo
const NAV = [
  { id: 'painel', label: 'Painel', icon: I.home },
  { id: 'agenda', label: 'Agenda', icon: I.calendar },
  { id: 'clientes', label: 'Clientes', icon: I.users },
  { id: 'financeiro', label: 'Financeiro', icon: I.wallet },
  { id: 'mais', label: 'Mais', icon: I.more, mobileOnly: true },
  { group: 'Gestão' },
  { id: 'procedimentos', label: 'Serviços', icon: I.sparkle, desktopOnly: true },
  { id: 'relatorios', label: 'Relatórios', icon: I.chart, desktopOnly: true },
  { id: 'mais/estoque', label: 'Estoque', icon: I.box, desktopOnly: true },
  { id: 'mais/bloqueios', label: 'Bloqueios', icon: I.lock, desktopOnly: true },
  { group: 'Conta' },
  { id: 'mais/whatsapp', label: 'WhatsApp', icon: I.whatsapp, desktopOnly: true },
  { id: 'mais/ajustes', label: 'Ajustes', icon: I.settings, desktopOnly: true },
  { id: 'mais', label: 'Mais opções', icon: I.more, desktopOnly: true, alias: true },
];

setUnauthorizedHandler(() => {
  if (!state.user) return;
  state.user = null;
  closeAllSheets();
  showLogin();
});
setPaymentRequiredHandler((data) => {
  if (state.subscription) Object.assign(state.subscription, { state: data?.state || 'expired', can_write: false });
  setTimeout(() => subscriptionSheet(data?.error), 50);
});

function applyMe(me) {
  Object.assign(state, { user: me.user, settings: me.settings, today: me.today, storage: me.storage, company: me.company, subscription: me.subscription });
}

async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  try {
    const me = await api.get('/api/me');
    if (me.platform) return location.replace('/admin/');
    applyMe(me);
    showApp();
  } catch {
    showLogin();
  }
}

function showLogin() {
  renderLogin(root, async (me) => {
    if (me.platform) return location.replace('/admin/');
    applyMe(me);
    if (!location.hash || location.hash === '#/') location.hash = '#/painel';
    showApp();
  });
}

function navLink(t) {
  const cls = t.mobileOnly ? 'nav__mob' : t.desktopOnly ? 'nav__desk' : '';
  return `<a href="#/${t.id}" data-tab="${t.id}" class="${cls}" ${t.alias ? 'data-alias' : ''}>${t.icon}<span>${t.label}</span></a>`;
}

function planBox() {
  const p = planInfo(state.subscription);
  if (!p) return '';
  return `<div class="nav__plan"><b>${p.active ? 'Plano Lola' : state.subscription.state === 'trial' ? 'Teste grátis' : 'Plano vencido'}</b>${esc(p.label)}
    ${p.active ? '' : `<br><a href="${esc(salesLink(`Olá! Quero contratar a Lola para ${state.company?.name || 'meu espaço'}.`))}" target="_blank" rel="noopener">Contratar pelo WhatsApp</a>`}</div>`;
}

function showApp() {
  root.innerHTML = `
    <div class="app">
      <nav class="nav" aria-label="Navegação principal">
        <div class="nav__brand"><span class="wordmark">Lola<i></i></span><span>${esc(state.settings.studio_name || state.company?.name || '')}</span></div>
        ${NAV.map((t) => (t.group ? `<div class="nav__group">${t.group}</div>` : navLink(t))).join('')}
        ${planBox()}
      </nav>
      <main class="main" id="main"></main>
    </div>`;
  route();
}

function planBar() {
  const p = planInfo(state.subscription);
  if (!p || p.active || !(p.late || state.subscription.state === 'trial')) return '';
  const s = state.subscription;
  const msg = s.state === 'trial' ? `Olá! Estou no teste grátis da Lola (${state.company?.name || ''}) e quero contratar o plano.` : `Olá! Quero renovar a Lola para ${state.company?.name || 'meu espaço'}.`;
  return `<div class="plan-bar ${p.late ? 'plan-bar--late' : ''}"><span><b>${esc(p.label)}</b>${s.state === 'trial' ? '<span class="plan-bar__extra"> · depois, R$ 49,90/mês</span>' : ''}</span>
    <a class="btn btn--sm ${s.state === 'trial' ? 'btn--ghost' : 'btn--wa'}" target="_blank" rel="noopener" href="${esc(salesLink(msg))}">${s.state === 'trial' ? 'Contratar' : 'Renovar'}</a></div>`;
}

let renderSeq = 0;
let storageCheckedAt = 0;
async function route() {
  if (!state.user) return;
  if (Date.now() - storageCheckedAt > 60e3) { storageCheckedAt = Date.now(); api.get('/api/storage').then((s) => (state.storage = s)).catch(() => {}); }
  const main = document.getElementById('main');
  if (!main) return;
  const { parts, query } = parseHash();
  const tab = parts[0] || 'painel';
  const full = parts.slice(0, 2).join('/');
  document.querySelectorAll('.nav a[data-tab]').forEach((a) => {
    const id = a.dataset.tab;
    const on = id.includes('/') ? full === id : a.classList.contains('nav__mob') ? tab === 'mais' : a.hasAttribute('data-alias') ? tab === 'mais' && !parts[1] : id === tab;
    a.classList.toggle('is-active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const seq = ++renderSeq;
  const ctx = { parts, query, isCurrent: () => seq === renderSeq };
  try {
    if (tab === 'painel') await renderDashboard(main, ctx);
    else if (tab === 'agenda') await renderAgenda(main, ctx);
    else if (tab === 'clientes' && parts[1]) await renderClient(main, ctx);
    else if (tab === 'clientes') await renderClients(main, ctx);
    else if (tab === 'procedimentos') await renderProcedures(main, ctx);
    else if (tab === 'financeiro') await renderFinance(main, ctx);
    else if (tab === 'relatorios') await renderReports(main, ctx);
    else if (tab === 'mais' && parts[1] === 'bloqueios') await renderBlocks(main, ctx);
    else if (tab === 'mais' && parts[1] === 'estoque') await renderStock(main, ctx);
    else if (tab === 'mais' && parts[1] === 'ajustes') await renderSettings(main, ctx);
    else if (tab === 'mais' && parts[1] === 'conta') await renderAccount(main, ctx);
    else if (tab === 'mais' && parts[1] === 'whatsapp') await renderWhatsApp(main, ctx);
    else if (tab === 'mais') await renderMore(main, ctx);
    else location.hash = '#/painel';
    if (!ctx.isCurrent()) return;
    const page = main.querySelector('.page');
    // topo do celular com a marca + faixa da assinatura
    page?.insertAdjacentHTML('afterbegin', `<div class="mtop"><span class="wordmark">Lola<i></i></span><span class="mtop__co">${esc(state.settings.studio_name || '')}</span></div>${planBar()}`);
    if (state.storage?.mode === 'temporary') {
      page?.insertAdjacentHTML('afterbegin', `<div class="alert alert--danger" style="margin-top:12px">${I.alert}<div><b>Atenção: os dados não estão sendo guardados de forma permanente.</b><br>Este servidor apaga os arquivos quando reinicia. Conecte o banco de dados Supabase (variável DATABASE_URL — veja o guia DEPLOY.md) antes de cadastrar clientes.</div></div>`);
    }
  } catch (e) {
    if (e?.status === 401) return;
    console.error(e);
    main.innerHTML = `<div class="page"><div class="empty">${I.alert}<b>Não foi possível carregar</b><p>${esc(e.message || '')}</p></div></div>`;
  }
}

let lastPath = '';
window.addEventListener('hashchange', () => {
  closeAllSheets();
  const path = location.hash.split('?')[0];
  if (path !== lastPath) window.scrollTo(0, 0);
  lastPath = path;
  route();
});
window.addEventListener('ae:render', route);
boot();
