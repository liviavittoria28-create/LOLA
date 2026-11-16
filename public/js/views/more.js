// Mais: bloqueios, estoque, ajustes, conta, instalação e backup
import { api } from '../api.js';
import { I } from '../icons.js';
import { state, esc, waMessage, fmtDate, openSheet, confirmDialog, toast, toastError, markInvalid, busy, rerender, go, empty, DOW_SHORT, dataTable, planInfo, salesLink } from '../ui.js';
import { openBlockForm } from './appointment.js';
import { waLabel } from './whatsapp.js';

export async function renderMore(main) {
  const [dash, wa, storage] = await Promise.all([api.get('/api/dashboard').catch(() => ({})), api.get('/api/whatsapp').catch(() => null), api.get('/api/storage').catch(() => null)]);
  if (storage) state.storage = storage;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const plan = planInfo(state.subscription);
  const mi = (icon, title, sub, attrs) => `<button ${attrs}><span class="mi">${icon}</span><span class="grow">${title}${sub ? `<small>${sub}</small>` : ''}</span><span class="item__chev">${I.right}</span></button>`;
  main.innerHTML = `
    <div class="page page--narrow">
      <header class="top"><div><div class="top__eyebrow">${esc(state.user?.name || '')}</div><h1>Mais</h1></div></header>
      ${plan ? `<div class="card" style="padding:16px 18px;display:flex;gap:14px;align-items:center;flex-wrap:wrap">
        <div class="grow"><b style="font-size:15px">${plan.active ? 'Plano Lola' : state.subscription.state === 'trial' ? 'Teste grátis' : 'Plano vencido'}</b><div class="small muted">${esc(plan.label)}${plan.active ? '' : ' · R$ 49,90/mês'}</div></div>
        <a class="btn btn--sm ${plan.active ? 'btn--ghost' : 'btn--wa'}" target="_blank" rel="noopener" href="${esc(salesLink(plan.active ? `Olá, Lola! Sou cliente (${state.company?.name || ''}) e preciso de ajuda.` : `Olá! Quero contratar a Lola para ${state.company?.name || 'meu espaço'}.`))}">${plan.active ? 'Falar com o suporte' : 'Contratar pelo WhatsApp'}</a></div>` : ''}
      <div class="section-title">Gestão</div>
      <div class="card menu">
        ${mi(I.sparkle, 'Serviços', 'Catálogo com valores e duração', 'data-go="#/procedimentos"')}
        ${mi(I.chart, 'Relatórios', 'Faturamento, serviços e clientes do ano', 'data-go="#/relatorios"')}
        ${mi(I.box, 'Estoque de materiais', dash.low_stock ? `${dash.low_stock} item(ns) abaixo do mínimo` : 'Entradas, saídas e quantidade mínima', 'data-go="#/mais/estoque"')}
        ${mi(I.lock, 'Bloqueios de agenda', 'Folgas, viagens e horários indisponíveis', 'data-go="#/mais/bloqueios"')}
      </div>
      <div class="section-title">Configurações</div>
      <div class="card menu">
        ${mi(I.whatsapp, 'WhatsApp', waLabel(wa), 'data-go="#/mais/whatsapp"')}
        ${mi(I.settings, 'Ajustes do espaço', 'Nome, endereço, horários e termo', 'data-go="#/mais/ajustes"')}
        ${mi(I.key, 'Minha conta', 'Nome e senha de acesso', 'data-go="#/mais/conta"')}
      </div>
      ${storageCard(storage)}
      <div class="section-title">Aplicativo</div>
      <div class="card menu">
        ${standalone ? '' : mi(I.install, 'Instalar no celular', 'iPhone e Android, sem loja de aplicativos', 'data-install')}
        ${mi(I.download, 'Baixar cópia de segurança', 'Arquivo com todos os seus dados', 'data-backup')}
        ${mi(I.logout, 'Sair', state.user?.email || '', 'data-logout')}
      </div>
      <p class="small muted mt-lg" style="text-align:center">${esc(state.settings.studio_name || '')}${state.settings.studio_address ? `<br>${esc(state.settings.studio_address)}` : ''}<br><span style="opacity:.7">Lola · v2.0</span></p>
    </div>`;
  main.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => go(b.dataset.go)));
  main.querySelector('[data-install]')?.addEventListener('click', showInstall);
  main.querySelector('[data-backup]').onclick = () => { location.href = '/api/backup'; };
  main.querySelector('[data-logout]').onclick = async () => {
    if (!(await confirmDialog({ title: 'Sair da Lola?', ok: 'Sair' }))) return;
    await api.post('/api/logout').catch(() => {});
    navigator.serviceWorker?.controller?.postMessage('logout');
    location.replace('/entrar/');
  };
}

function storageCard(s) {
  if (!s) return '';
  if (s.mode === 'online') {
    return `<div class="card mt" style="padding:14px 16px;display:flex;gap:12px;align-items:center">
      <span class="wa-dot is-on"></span>
      <div class="grow"><b style="font-size:14.5px">Dados salvos online ✓</b>
      <div class="small muted">Banco de dados ${esc(s.provider || 'online')} — clientes, agenda e financeiro ficam guardados mesmo se o servidor reiniciar.</div></div></div>`;
  }
  if (s.mode === 'disk') return `<p class="small muted mt" style="text-align:center">Dados guardados neste computador.</p>`;
  return '';
}

// Android/Chrome oferece o prompt de instalação; guardamos para usar no botão
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; });

function showInstall() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const sheet = openSheet({
    title: 'Instalar no celular',
    body: `
      ${installPrompt ? `<button class="btn btn--gold btn--block" data-prompt>${I.install}Instalar agora</button><p class="small muted" style="text-align:center">ou siga os passos abaixo</p>` : ''}
      <div class="section-title" style="margin-top:6px"><b>iPhone (Safari)</b></div>
      <ol style="padding-left:20px;line-height:1.9;margin:0">
        <li>Abra este endereço no <b>Safari</b>.</li>
        <li>Toque em <b>Compartilhar</b> (quadrado com seta para cima).</li>
        <li>Escolha <b>Adicionar à Tela de Início</b> e confirme.</li>
      </ol>
      <div class="section-title"><b>Android (Chrome)</b></div>
      <ol style="padding-left:20px;line-height:1.9;margin:0">
        <li>Abra este endereço no <b>Chrome</b>.</li>
        <li>Toque no menu <b>⋮</b> no canto de cima.</li>
        <li>Escolha <b>Instalar aplicativo</b> (ou <b>Adicionar à tela inicial</b>).</li>
      </ol>
      <p class="muted small mt">A Lola ganha ícone próprio e abre em tela cheia, como um aplicativo — sem loja e sem custo extra.${ios ? '' : ''}</p>`,
  });
  sheet.el.querySelector('[data-prompt]')?.addEventListener('click', async () => {
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => {});
    installPrompt = null;
    sheet.close();
  });
}

// ---------------------------------------------------------------- Bloqueios
export async function renderBlocks(main, ctx) {
  const past = ctx.query.passados === '1';
  const list = await api.get(`/api/blocks${past ? '?from=2000-01-01' : ''}`);
  if (!ctx.isCurrent()) return;
  main.innerHTML = `
    <div class="page page--narrow">
      <header class="top hide-d" style="padding-bottom:0"><a class="back" href="#/mais">${I.left}Mais</a></header>
      <header class="top"><div><div class="top__eyebrow">Agenda</div><h1>Bloqueios</h1></div>
        <div class="top__actions"><button class="icon-btn icon-btn--solid" data-new aria-label="Novo bloqueio">${I.plus}</button></div></header>
      <div class="seg" style="margin-bottom:16px"><button class="${past ? '' : 'is-on'}" data-go="#/mais/bloqueios">Próximos</button><button class="${past ? 'is-on' : ''}" data-go="#/mais/bloqueios?passados=1">Todos</button></div>
      ${list.length ? `<div class="list">${list.slice().sort((a, b) => (past ? b.start_date.localeCompare(a.start_date) : a.start_date.localeCompare(b.start_date))).map((b) => `
        <button class="block-card hatch" data-id="${b.id}">${I.lock}<div class="grow"><b>${esc(b.reason)}</b>
          <span>${fmtDate(b.start_date)}${b.end_date !== b.start_date ? ` a ${fmtDate(b.end_date)}` : ''} · ${b.all_day ? 'dia inteiro' : `${b.start_time}–${b.end_time}`}</span></div><span class="item__chev">${I.right}</span></button>`).join('')}</div>`
        : `<div class="card">${empty(I.lock, 'Nenhum bloqueio', 'Bloqueie dias de folga, viagens ou horários indisponíveis.')}</div>`}
    </div>`;
  main.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => go(b.dataset.go)));
  main.querySelector('[data-new]').onclick = () => openBlockForm();
  main.querySelectorAll('[data-id]').forEach((b) => (b.onclick = () => openBlockForm({ block: list.find((x) => x.id === Number(b.dataset.id)) })));
}

// ---------------------------------------------------------------- Estoque (RF28 — desejável)
const qty = (n) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
export async function renderStock(main, ctx) {
  const items = await api.get('/api/stock');
  if (!ctx.isCurrent()) return;
  const lowOnly = ctx.query.baixo === '1';
  const isLow = (it) => it.min_quantity > 0 && it.quantity <= it.min_quantity;
  const lows = items.filter(isLow).length;
  const actions = (it) => `<span class="act" data-stop>
      <button class="icon-btn" data-move="out" data-id="${it.id}" aria-label="Saída de ${esc(it.name)}" title="Saída">${I.arrowUp}</button>
      <button class="icon-btn" data-move="in" data-id="${it.id}" aria-label="Entrada de ${esc(it.name)}" title="Entrada">${I.arrowDown}</button>
      <button class="icon-btn icon-btn--plain" data-edit="${it.id}" aria-label="Editar ${esc(it.name)}" title="Editar">${I.edit}</button></span>`;
  main.innerHTML = `
    <div class="page">
      <header class="top hide-d" style="padding-bottom:0"><a class="back" href="#/mais">${I.left}Mais</a></header>
      <header class="top"><div><div class="top__eyebrow">Materiais e produtos</div><h1>Estoque</h1></div>
        <div class="top__actions"><button class="btn btn--gold btn--sm hide-m" data-new>${I.plus}Novo item</button><button class="icon-btn icon-btn--solid hide-d" data-new aria-label="Novo item">${I.plus}</button></div></header>
      <div class="toolbar">
        <div class="search">${I.search}<input class="input" type="search" placeholder="Buscar item" data-q aria-label="Buscar item"></div>
        <div class="seg"><button class="${lowOnly ? '' : 'is-on'}" data-go="#/mais/estoque">Todos (${items.length})</button><button class="${lowOnly ? 'is-on' : ''}" data-go="#/mais/estoque?baixo=1">Abaixo do mínimo (${lows})</button></div>
      </div>
      <div data-list></div>
    </div>`;
  const listEl = main.querySelector('[data-list]');
  const draw = (term = '') => {
    const t = term.toLowerCase();
    const rows = items.filter((it) => (!lowOnly || isLow(it)) && (!t || it.name.toLowerCase().includes(t)));
    dataTable(listEl, {
      rows, pageSize: 25,
      empty: `<div class="card">${empty(I.box, items.length ? 'Nada por aqui' : 'Nenhum item', items.length ? 'Ajuste a busca ou o filtro.' : 'Cadastre materiais como esmaltes, cola, pigmentos e descartáveis.')}</div>`,
      cols: [
        { label: 'Item', cell: (it) => `<b>${esc(it.name)}</b>` },
        { label: 'Situação', cell: (it) => (isLow(it) ? '<span class="badge badge--warn"><span class="dot"></span>Abaixo do mínimo</span>' : '<span class="badge badge--ok"><span class="dot"></span>Ok</span>') },
        { label: 'Mínimo', cls: 'num', cell: (it) => `<span class="muted-cell">${qty(it.min_quantity)} ${esc(it.unit)}</span>` },
        { label: 'Quantidade', cls: 'num', cell: (it) => `<b class="stock-qty" style="font-size:20px">${qty(it.quantity)}</b> <span class="small muted">${esc(it.unit)}</span>` },
        { label: '', cls: 'num', cell: actions },
      ],
      card: (it) => `<div class="item">
          <div class="item__main"><div class="item__title">${esc(it.name)}</div>
            <div class="item__sub">${isLow(it) ? '<span class="badge badge--warn">Abaixo do mínimo</span> ' : ''}mín. ${qty(it.min_quantity)} ${esc(it.unit)}</div></div>
          <div class="item__end"><div class="stock-qty">${qty(it.quantity)}</div><div class="small muted">${esc(it.unit)}</div></div>
          ${actions(it)}</div>`,
      afterDraw: (h) => {
        h.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => itemForm(items.find((x) => x.id === Number(b.dataset.edit)))));
        h.querySelectorAll('[data-move]').forEach((b) => (b.onclick = () => moveForm(items.find((x) => x.id === Number(b.dataset.id)), b.dataset.move)));
      },
    });
  };
  draw();
  const q = main.querySelector('[data-q]');
  q.oninput = () => draw(q.value);
  main.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => go(b.dataset.go)));
  main.querySelectorAll('[data-new]').forEach((b) => (b.onclick = () => itemForm()));
}

function itemForm(it) {
  const editing = !!it;
  const v = it || { name: '', unit: 'un', quantity: 0, min_quantity: 0 };
  const { el, close } = openSheet({
    title: editing ? 'Editar item' : 'Novo item',
    body: `<form novalidate>
      <label class="field" data-field="name"><span>Nome</span><input class="input" name="name" value="${esc(v.name)}" autofocus></label>
      <div class="grid-2">
        <label class="field"><span>Unidade</span><input class="input" name="unit" value="${esc(v.unit)}" placeholder="un, ml, caixa"></label>
        <label class="field" data-field="min_quantity"><span>Qtd. mínima</span><input class="input" name="min_quantity" inputmode="decimal" value="${qty(v.min_quantity)}"></label>
      </div>
      ${editing ? '' : `<label class="field"><span>Quantidade inicial</span><input class="input" name="quantity" inputmode="decimal" value="0"></label>`}
      ${editing ? `<button type="button" class="btn btn--danger btn--block btn--sm" data-archive>Remover item</button>` : ''}
    </form>`,
    foot: `<button class="btn btn--ghost" data-cancel>Cancelar</button><button class="btn btn--gold" data-save>Salvar</button>`,
  });
  const form = el.querySelector('form');
  el.querySelector('[data-cancel]').onclick = () => close();
  el.querySelector('[data-archive]')?.addEventListener('click', async () => {
    if (!(await confirmDialog({ title: 'Remover item?', ok: 'Remover', danger: true }))) return;
    try { await api.put(`/api/stock/${it.id}`, { ...it, active: false }); close(); rerender(); } catch (e) { toastError(e); }
  });
  el.querySelector('[data-save]').onclick = (ev) => busy(ev.currentTarget, async () => {
    const body = { name: form.name.value, unit: form.unit.value, min_quantity: form.min_quantity.value, quantity: form.quantity?.value };
    try { editing ? await api.put(`/api/stock/${it.id}`, body) : await api.post('/api/stock', body); close(); toast('Item salvo'); rerender(); }
    catch (e) { if (e.data?.fields) markInvalid(form, e.data.fields); toastError(e); }
  });
}

function moveForm(it, type) {
  const { el, close } = openSheet({
    title: type === 'in' ? 'Entrada de material' : 'Saída de material',
    body: `<form novalidate>
      <p class="muted" style="margin-top:0"><b style="color:var(--ink)">${esc(it.name)}</b> · atual: ${qty(it.quantity)} ${esc(it.unit)}</p>
      <label class="field" data-field="quantity"><span>Quantidade (${esc(it.unit)})</span><input class="input" name="quantity" inputmode="decimal" autofocus></label>
      <label class="field"><span>Observação</span><input class="input" name="note" placeholder="Opcional"></label>
    </form>`,
    foot: `<button class="btn btn--gold btn--block" data-save>Registrar ${type === 'in' ? 'entrada' : 'saída'}</button>`,
  });
  const form = el.querySelector('form');
  el.querySelector('[data-save]').onclick = (ev) => busy(ev.currentTarget, async () => {
    try { await api.post(`/api/stock/${it.id}/move`, { type, quantity: form.quantity.value, note: form.note.value }); close(); toast('Estoque atualizado'); rerender(); }
    catch (e) { if (e.data?.fields) markInvalid(form, e.data.fields); toastError(e); }
  });
}

// ---------------------------------------------------------------- Ajustes
export async function renderSettings(main, ctx) {
  const s = await api.get('/api/settings');
  if (!ctx.isCurrent()) return;
  const days = String(s.work_days || '').split(',').filter(Boolean).map(Number);
  main.innerHTML = `
    <div class="page page--narrow">
      <header class="top hide-d" style="padding-bottom:0"><a class="back" href="#/mais">${I.left}Mais</a></header>
      <header class="top"><div><div class="top__eyebrow">Configurações</div><h1>Ajustes do espaço</h1></div></header>
      <form data-hours novalidate>
        <div class="section-title" style="margin-top:4px">Seu espaço</div>
        <label class="field" data-field="studio_name"><span>Nome do estabelecimento</span><input class="input" name="studio_name" value="${esc(s.studio_name || '')}" required></label>
        <label class="field"><span>Endereço</span><input class="input" name="studio_address" value="${esc(s.studio_address || '')}" placeholder="Rua, número e bairro"><small>Aparece em Mais e pode ir na mensagem de confirmação.</small></label>
        <div class="section-title">Atendimento</div>
        <div class="grid-2">
          <label class="field"><span>Abre às</span><input class="input" type="time" name="open_time" value="${esc(s.open_time)}"></label>
          <label class="field"><span>Fecha às</span><input class="input" type="time" name="close_time" value="${esc(s.close_time)}"></label>
        </div>
        <div class="label">Dias de atendimento</div>
        <div class="chips" style="margin-bottom:16px">${DOW_SHORT.map((d, i) => `<button type="button" class="chip ${days.includes(i) ? 'is-on' : ''}" data-dow="${i}">${d}</button>`).join('')}</div>
        <label class="field"><span>Intervalo entre atendimentos (min)</span><input class="input" type="number" min="0" step="5" name="gap_min" value="${esc(s.gap_min)}">
          <small>Tempo reservado entre um atendimento e outro (limpeza, preparo).</small></label>
        <label class="field"><span>Texto do termo de consentimento</span><textarea class="textarea" name="consent_text" style="min-height:160px">${esc(s.consent_text)}</textarea></label>
        <button class="btn btn--gold btn--block" type="submit">Salvar ajustes</button>
      </form>
      <div class="section-title">Acesso</div>
      <a class="card menu" href="#/mais/conta" style="display:block"><button type="button"><span class="mi">${I.key}</span><span class="grow">Minha conta<small>${esc(state.user.email)}</small></span><span class="item__chev">${I.right}</span></button></a>
    </div>`;
  const hours = main.querySelector('[data-hours]');
  hours.querySelectorAll('[data-dow]').forEach((b) => (b.onclick = () => b.classList.toggle('is-on')));
  hours.onsubmit = async (e) => {
    e.preventDefault();
    const btn = hours.querySelector('[type=submit]');
    await busy(btn, async () => {
      const work_days = [...hours.querySelectorAll('[data-dow].is-on')].map((b) => b.dataset.dow).join(',');
      try {
        state.settings = await api.put('/api/settings', {
          studio_name: hours.studio_name.value, studio_address: hours.studio_address.value,
          open_time: hours.open_time.value, close_time: hours.close_time.value, gap_min: hours.gap_min.value || '0',
          consent_text: hours.consent_text.value, work_days,
        });
        toast('Ajustes salvos');
      } catch (err) { toastError(err); }
    });
  };
}

// ---------------------------------------------------------------- Minha conta (nome e senha)
export async function renderAccount(main, ctx) {
  const u = state.user;
  main.innerHTML = `
    <div class="page page--narrow">
      <header class="top" style="padding-bottom:0"><a class="back" href="#/mais">${I.left}Mais</a></header>
      <header class="top"><div><div class="top__eyebrow">Acesso</div><h1>Minha conta</h1></div></header>
      <div class="card kv"><dt>E-mail</dt><dd>${esc(u.email)}</dd><dt>Espaço</dt><dd>${esc(state.company?.name || '')}</dd></div>
      ${u.env_managed ? `<p class="small muted mt">O e-mail e a senha deste acesso são definidos nas variáveis do servidor (<b>ADMIN_EMAIL</b> e <b>ADMIN_PASSWORD</b>). Para trocar, altere-as na hospedagem e reinicie o app.</p>` : `
      <form data-acc novalidate class="mt">
        <label class="field" data-field="name"><span>Seu nome</span><input class="input" name="name" value="${esc(u.name || '')}" autocomplete="name"></label>
        <label class="field" data-field="new_password"><span>Nova senha</span><input class="input" type="password" name="new_password" autocomplete="new-password" placeholder="Deixe em branco para manter"><small>Pelo menos 8 caracteres. As outras sessões abertas serão encerradas.</small></label>
        <label class="field" data-field="current_password"><span>Senha atual</span><input class="input" type="password" name="current_password" autocomplete="current-password" required></label>
        <button class="btn btn--gold btn--block" type="submit">Salvar conta</button>
      </form>`}
    </div>`;
  const f = main.querySelector('[data-acc]');
  if (!f) return;
  f.onsubmit = (e) => {
    e.preventDefault();
    busy(f.querySelector('[type=submit]'), async () => {
      try {
        await api.put('/api/account', { name: f.name.value, new_password: f.new_password.value || undefined, current_password: f.current_password.value });
        state.user.name = f.name.value || state.user.name;
        f.current_password.value = ''; f.new_password.value = '';
        toast('Conta salva');
      } catch (err) { if (err.data?.fields) markInvalid(f, err.data.fields); toastError(err); }
    });
  };
}
