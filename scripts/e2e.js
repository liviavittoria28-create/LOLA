// Teste de ponta a ponta no navegador (Chrome/Edge invisível), com o app rodando:
//   node scripts/e2e.js http://localhost:5173
// Cria uma conta pelo site, entra no sistema, abre todas as telas (celular e computador),
// confere erros de JavaScript, links do site, menu do celular e o fluxo de agendamento.
import { launch, sleep } from './cdp.js';

const BASE = process.argv[2] || 'http://localhost:5173';
const p = await launch();
const errors = [];
p.on('Runtime.exceptionThrown', (e) => errors.push(e.exceptionDetails.exception?.description || e.exceptionDetails.text));
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? '✓' : '✖'} ${msg}`); if (!cond) fails++; };
const js = (s) => p.eval(s);

// site
await p.viewport(390, 844, 2, true);
await p.goto(BASE + '/?site=1', 800);
const links = await js(`[...document.querySelectorAll('a')].map(a=>a.getAttribute('href'))`);
ok(links.every((h) => h && h !== '#'), `todos os ${links.length} links do site têm destino`);
ok(links.filter((h) => h.startsWith('https://wa.me/5511962822060?text=')).length >= 6, 'chamadas de WhatsApp com mensagem pronta');
await js(`document.querySelector('.menu-btn').click()`); await sleep(200);
ok(await js(`getComputedStyle(document.querySelector('.hdr nav')).display !== 'none'`), 'menu do celular abre');
for (const id of ['inicio', 'funcionalidades', 'planos', 'demonstracao', 'contato']) ok(await js(`!!document.getElementById('${id}')`), `seção #${id} existe para o menu`);

// cadastro pelo site
const email = `e2e${Date.now()}@lola.test`;
await p.goto(BASE + '/cadastro/', 600);
await js(`(()=>{const f=document.getElementById('signup');f.company.value='Studio Teste E2E';f.name.value='Paula Teste';f.phone.value='(11) 98888-0000';f.email.value=${JSON.stringify(email)};f.password.value='SenhaE2E1234';f.accept_terms.checked=true;f.requestSubmit()})()`);
await sleep(2500);
ok((await js('location.pathname')) === '/app/', 'cadastro leva para o sistema');
let steps = false;
for (let i = 0; i < 30 && !steps; i++) { steps = await js(`!!document.querySelector('.steps')`); if (!steps) await sleep(200); }
ok(steps, 'painel mostra os primeiros passos para conta nova');

// telas do sistema
const routes = ['painel', 'agenda?v=dia', 'agenda?v=semana', 'agenda?v=mes', 'agenda?v=ano', 'clientes', 'procedimentos', 'financeiro', 'relatorios', 'mais', 'mais/estoque', 'mais/bloqueios', 'mais/ajustes', 'mais/conta', 'mais/whatsapp'];
for (const [w, h, m] of [[390, 844, true], [1440, 900, false]]) {
  await p.viewport(w, h, 1, m);
  for (const r of routes) {
    errors.length = 0;
    await js(`location.hash = '#/${r}'`); await sleep(500);
    const t = await js(`document.querySelector('#main h1')?.textContent || ''`);
    ok(t && !errors.length, `${m ? 'celular' : 'computador'} · ${r} → “${t}”${errors.length ? ' ' + errors[0] : ''}`);
  }
  ok(await js(`document.documentElement.scrollWidth <= innerWidth + 1`), `${m ? 'celular' : 'computador'}: sem rolagem lateral`);
  await js(`location.hash = '#/painel'`); await sleep(700);
  ok(await js(`[...document.querySelectorAll('.panel, .kpi, .card')].every((e) => e.getBoundingClientRect().right <= innerWidth + 1)`), `${m ? 'celular' : 'computador'}: nenhum quadro do painel passa da tela`);
}

// fluxo: serviço → cliente → agendamento → concluir com entrada no financeiro
const today = await js(`fetch('/api/me').then(r=>r.json()).then(m=>m.today)`);
const r = await js(`(async()=>{const post=(u,b)=>fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).then(r=>r.json());
  const s=await post('/api/procedures',{name:'Manicure',price_cents:4000,duration_min:45});const c=await post('/api/clients',{name:'Cliente E2E',phone:'(11) 97777-1111'});
  const a=await post('/api/appointments',{client_id:c.id,procedure_ids:[s.id],date:'${today}',start:'08:00'});return {s,c,a}})()`);
ok(r.a?.id && r.a.end === '08:45', 'agendamento criado com término calculado');
await js(`location.hash = '#/agenda?v=dia'`); await sleep(700);
await js(`document.querySelector('[data-appt]').click()`); await sleep(600);
await js(`document.querySelector('.sheet [data-st="concluida"]').click()`); await sleep(200);
await js(`document.querySelector('.sheet [data-save]').click()`); await sleep(1500);
await js(`document.querySelectorAll('.sheet [data-save]').forEach(b=>b.click())`); await sleep(1200);
const fin = await js(`fetch('/api/transactions?month=${today.slice(0, 7)}').then(r=>r.json())`);
ok(fin.summary.income_cents === 4000, `entrada registrada no financeiro (${fin.summary.income_cents})`);

// sair e entrar de novo pela página de login
await js(`fetch('/api/logout',{method:'POST'})`);
await p.goto(BASE + '/entrar/', 500);
await js(`(()=>{const f=document.getElementById('login');f.email.value=${JSON.stringify(email)};f.password.value='SenhaE2E1234';f.requestSubmit()})()`);
await sleep(2000);
ok((await js('location.pathname')) === '/app/', 'login pela página Entrar');
await p.close();
console.log(fails ? `\n✖ ${fails} problema(s)` : '\n✓ Tudo certo');
process.exit(fails ? 1 : 0);
