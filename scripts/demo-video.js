// Grava o vídeo de demonstração vertical (9:16, 720x1280) da Lola REAL, com a empresa de demonstração.
// Uso (com o app rodando e `node scripts/demo-seed.js` já executado; precisa do ffmpeg instalado):
//   node scripts/demo-video.js http://localhost:5173 public/site/lola-demonstracao.mp4
import { launch, sleep } from './cdp.js';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.argv[2] || 'http://localhost:5173';
const OUT = path.resolve(process.argv[3] || 'public/site/lola-demonstracao.mp4');
const EMAIL = process.env.DEMO_EMAIL || 'demo@lola.test', PASSWORD = process.env.DEMO_PASSWORD || 'LolaDemo2026';
const W = 390, H = 693; // 9:16
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lola-video-'));
const frames = [];
const p = await launch();
await p.viewport(W, H, 2, true);

// ---------- ferramentas de cena
const js = (s) => p.eval(s);
const CAPTION_CSS = `position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 84px);transform:translateX(-50%);z-index:9999;pointer-events:none;
  background:rgba(59,38,48,.92);color:#fbeff0;font:600 15px Manrope,sans-serif;padding:9px 16px;border-radius:999px;white-space:nowrap;box-shadow:0 8px 20px -8px rgba(0,0,0,.4)`;
async function caption(text) {
  await js(`(()=>{let c=document.getElementById('__cap');if(!c){c=document.createElement('div');c.id='__cap';c.style.cssText=${JSON.stringify(CAPTION_CSS)};document.body.appendChild(c)}c.textContent=${JSON.stringify(text)}})()`);
}
async function tap(selector, { wait = 700 } = {}) {
  await js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw new Error('não achei ${selector.replace(/'/g, '')}');el.scrollIntoView({block:'center',behavior:'instant'});
    const r=el.getBoundingClientRect();const d=document.createElement('div');d.style.cssText='position:fixed;z-index:9998;pointer-events:none;width:44px;height:44px;border-radius:50%;background:rgba(160,80,95,.35);border:2px solid rgba(160,80,95,.8);left:'+(r.left+r.width/2-22)+'px;top:'+(r.top+r.height/2-22)+'px;transition:transform .45s,opacity .45s';document.body.appendChild(d);
    requestAnimationFrame(()=>{d.style.transform='scale(1.6)';d.style.opacity='0'});setTimeout(()=>d.remove(),600);setTimeout(()=>el.click(),180)})()`);
  await sleep(wait);
}
async function type(selector, text, delay = 85) {
  await js(`document.querySelector(${JSON.stringify(selector)}).focus()`);
  for (const ch of text) {
    await js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.value+=${JSON.stringify(ch)};el.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await sleep(delay);
  }
}
async function setValue(selector, value) {
  await js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))})()`);
}
async function scroll(to, ms = 1600) {
  await js(`new Promise(res=>{const y0=scrollY,y1=${to},t0=performance.now();const f=t=>{const k=Math.min(1,(t-t0)/${ms});const e=k<.5?2*k*k:1-Math.pow(-2*k+2,2)/2;scrollTo(0,y0+(y1-y0)*e);k<1?requestAnimationFrame(f):res()};requestAnimationFrame(f)})`);
}
const go = async (url, wait = 1300) => {
  // dentro do app só muda o "#": navega sem recarregar a página
  const cur = await js('location.origin + location.pathname');
  const u = new URL(url);
  if (u.hash && cur === u.origin + u.pathname) { await js(`location.hash = ${JSON.stringify(u.hash)}`); await sleep(wait); }
  else await p.goto(url, wait);
};

// ---------- gravação (screencast do Chrome)
let recording = false;
p.on('Page.screencastFrame', async (f) => {
  p.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  if (!recording) return;
  const file = path.join(dir, `f${String(frames.length).padStart(5, '0')}.jpg`);
  fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
  frames.push({ file, t: f.metadata.timestamp });
});
await p.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: W * 2, maxHeight: H * 2, everyNthFrame: 1 });

// login + horário livre para o agendamento de demonstração
await go(BASE + '/entrar/', 400);
await js(`fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:${JSON.stringify(EMAIL)},password:${JSON.stringify(PASSWORD)}})}).then(r=>r.status)`);
const plan = await js(`(async()=>{const me=await (await fetch('/api/me')).json();const procs=await (await fetch('/api/procedures')).json();const cl=await (await fetch('/api/clients?q=L%C3%ADvia')).json();
  const proc=procs.find(p=>p.name==='Design de sobrancelha')||procs[0];const d=me.today;const nd=new Date(d+'T12:00:00Z');nd.setUTCDate(nd.getUTCDate()+(nd.getUTCDay()===6?2:1));const nx=nd.toISOString().slice(0,10);
  for(const date of [d]){for(const s of ['17:00','17:30','18:00','16:30','18:15','11:00','08:30']){const r=await (await fetch('/api/appointments/check',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_id:cl[0].id,procedure_ids:[proc.id],date,start:s})})).json();if(!r.conflict)return {date,start:s,proc:proc.id,client:cl[0].name,next:nx}}}
  return {date:d,start:'18:30',proc:proc.id,client:cl[0].name,next:nx}})()`);

recording = true;
// 1. página inicial
await go(BASE + '/?site=1', 900);
await caption('1 · A página inicial');
await sleep(1800);
await scroll(700, 2600); await sleep(600);
await scroll(1400, 2400); await sleep(900);
// 2. painel
await go(BASE + '/app/#/painel', 1200);
await caption('2 · O painel do dia');
await js(`document.querySelectorAll('.plan-bar').forEach(e=>e.remove())`);
await sleep(1600);
await scroll(520, 2200); await sleep(1300);
await scroll(0, 1000);
// 3. agendar
await go(BASE + '/app/#/agenda?v=dia', 1200);
await caption('3 · Agendar um atendimento');
await js(`document.querySelectorAll('.plan-bar').forEach(e=>e.remove())`);
await sleep(1000);
await tap('.fab', { wait: 1100 });
await type('.sheet [data-q]', 'Lívia', 110); await sleep(900);
await tap('.sheet [data-results] [data-id]', { wait: 800 });
await tap(`.sheet [data-proc="${plan.proc}"]`, { wait: 700 });
await setValue('.sheet input[name=start]', plan.start); await sleep(1400);
await tap('.sheet [data-save]', { wait: 1800 });
// 4. cadastrar cliente
await go(BASE + '/app/#/clientes', 1100);
await caption('4 · Cadastrar uma cliente');
await js(`document.querySelectorAll('.plan-bar').forEach(e=>e.remove())`);
await sleep(900);
await tap('.icon-btn--solid[data-new]', { wait: 1000 });
await type('.sheet input[name=name]', 'Júlia Andrade', 75);
const tail = String(Date.now()).slice(-4);
await type('.sheet input[name=phone]', `1197654${tail}`, 60); await sleep(500);
await tap('.sheet [data-save]', { wait: 1400 });
await js(`document.querySelectorAll('.sheet [data-later], .sheet [data-close]').forEach(b=>b.click())`).catch(() => {});
await sleep(1600);
// 5. agenda
await go(BASE + '/app/#/agenda?v=mes', 1100);
await caption('5 · Consultar a agenda');
await js(`document.querySelectorAll('.plan-bar').forEach(e=>e.remove())`);
await sleep(1300);
await tap(`[data-day="${plan.next}"]`, { wait: 1200 });
await scroll(420, 1500); await sleep(800);
await scroll(0, 600);
await tap('.seg [data-go*="v=semana"]', { wait: 1500 });
await scroll(500, 1600); await sleep(700);
// 6. financeiro
await go(BASE + '/app/#/financeiro', 1200);
await caption('6 · Controlar o financeiro');
await js(`document.querySelectorAll('.plan-bar').forEach(e=>e.remove())`);
await sleep(1500);
await scroll(560, 2000); await sleep(1000);
await tap('.fab', { wait: 900 });
await tap('.sheet [data-type="out"]', { wait: 500 });
await type('.sheet input[name=amount]', '89,90', 120);
await type('.sheet input[name=description]', 'Esmaltes novos', 60); await sleep(500);
await tap('.sheet [data-save]', { wait: 1600 });
// 7. relatórios
await go(BASE + '/app/#/relatorios', 1400);
await caption('7 · Ver os relatórios');
await js(`document.querySelectorAll('.plan-bar').forEach(e=>e.remove())`);
await sleep(1500);
await scroll(480, 2000); await sleep(1100);
await scroll(1100, 2000); await sleep(1000);
// 8. celular
await go(BASE + '/app/#/mais', 1100);
await caption('8 · Use pelo celular, como um app');
await js(`document.querySelectorAll('.plan-bar').forEach(e=>e.remove())`);
await sleep(1000);
await tap('[data-install]', { wait: 2600 });
// encerramento
await js(`(()=>{document.getElementById('__cap')?.remove();const d=document.createElement('div');d.style.cssText='position:fixed;inset:0;z-index:10000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;text-align:center;background:linear-gradient(170deg,#f6dfda,#f2e5cf);color:#3b2630;font-family:Manrope,sans-serif;padding:30px;opacity:0;transition:opacity .6s';
  d.innerHTML='<div style="font:500 60px \\'Bodoni Moda\\',serif;display:flex;align-items:center;gap:16px"><span style="display:inline-flex;align-items:center;justify-content:center;width:44px;height:60px;box-sizing:border-box;padding-top:8px;border:2px solid #b48a4c;border-radius:22px 22px 3px 3px;font-size:36px;line-height:1">L</span>Lola</div><div style="font:500 26px/1.15 \\'Bodoni Moda\\',serif;max-width:12em">Agenda cheia, clientes fiéis e o caixa em dia.</div><div style="font-weight:700;font-size:17px">15 dias grátis · depois R$ 49,90/mês</div><div style="background:#1f8a4c;color:#fff;font-weight:700;padding:14px 22px;border-radius:999px">WhatsApp (11) 96282-2060</div>';
  document.body.appendChild(d);requestAnimationFrame(()=>d.style.opacity='1')})()`);
await sleep(900);
recording = false;
await p.send('Page.stopScreencast');
// cartão final: quadro fixo garantido (o screencast nem sempre envia quadros de telas paradas)
const endFile = path.join(dir, 'end.jpg');
fs.writeFileSync(endFile, Buffer.from((await p.send('Page.captureScreenshot', { format: 'jpeg', quality: 90 })).data, 'base64'));
frames.push({ file: endFile, t: frames.at(-1).t + 0.6 });
await p.close();

// ---------- monta o MP4 (duração de cada quadro = tempo até o próximo)
const list = frames.map((f, i) => `file '${f.file}'\nduration ${Math.max(0.02, ((frames[i + 1]?.t ?? f.t + 4) - f.t)).toFixed(3)}`).join('\n') + `\nfile '${frames.at(-1).file}'\n`;
fs.writeFileSync(path.join(dir, 'list.txt'), list);
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'list.txt'),
  '-vf', 'scale=720:1280:flags=lanczos,fps=30,format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-movflags', '+faststart', OUT]);
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-ss', '1.2', '-i', OUT, '-frames:v', '1', '-vf', 'scale=720:1280', '-c:v', 'libwebp', '-quality', '80', path.join(path.dirname(OUT), 'img', 'video-capa.webp')]);
fs.rmSync(dir, { recursive: true, force: true });
const secs = frames.at(-1).t - frames[0].t;
console.log(`✓ Vídeo gravado: ${OUT} (${secs.toFixed(0)} s, ${frames.length} quadros)`);
process.exit(0);
