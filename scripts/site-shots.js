// Gera as imagens do site (public/site/img) a partir do sistema real com a empresa de demonstração.
// Uso (com o app rodando e `node scripts/demo-seed.js` já executado):
//   node scripts/site-shots.js http://localhost:5173
import { launch, sleep } from './cdp.js';
import path from 'node:path';

const BASE = process.argv[2] || 'http://localhost:5173';
const OUT = path.resolve('public/site/img');
const EMAIL = process.env.DEMO_EMAIL || 'demo@lola.test', PASSWORD = process.env.DEMO_PASSWORD || 'LolaDemo2026';
const p = await launch();
await p.viewport(1440, 900, 1);
await p.goto(BASE + '/entrar/', 300);
const st = await p.eval(`fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:${JSON.stringify(EMAIL)},password:${JSON.stringify(PASSWORD)}})}).then(r=>r.status)`);
if (st !== 200) { console.error('Login da demonstração falhou. Rode antes: node scripts/demo-seed.js'); process.exit(1); }
const clientId = await p.eval(`fetch('/api/clients').then(r=>r.json()).then(l=>(l.find(c=>c.anamnese==='ok'&&c.name.startsWith('Gabriela'))||l[0]).id)`);

// sem a faixa do teste grátis nos prints
const hideBar = `document.querySelectorAll('.plan-bar').forEach(e=>e.remove())`;
const shots = [
  ['painel-desktop.webp', 'd', '#/painel'],
  ['financeiro-desktop.webp', 'd', '#/financeiro'],
  ['relatorios-desktop.webp', 'd', '#/relatorios'],
  ['clientes-desktop.webp', 'd', '#/clientes'],
  ['agenda-mobile.webp', 'm', '#/agenda?v=mes'],
  ['agenda-dia-mobile.webp', 'm', '#/agenda?v=dia'],
  ['painel-mobile.webp', 'm', '#/painel'],
  ['clientes-mobile.webp', 'm', '#/clientes'],
  ['cliente-mobile.webp', 'm', `#/clientes/${clientId}`],
  ['financeiro-mobile.webp', 'm', '#/financeiro'],
  ['relatorios-mobile.webp', 'm', '#/relatorios'],
  ['whatsapp-mobile.webp', 'm', '#/mais/whatsapp', 'window.scrollTo(0, 0)'],
];
for (const [file, kind, hash, extra] of shots) {
  if (kind === 'd') await p.viewport(1440, 900, 1);
  else await p.viewport(390, 844, 2, true);
  await p.goto(`${BASE}/app/${hash}`, 1400);
  await p.eval(hideBar);
  if (extra) await p.eval(extra);
  await sleep(250);
  await p.shot(path.join(OUT, file), { format: 'webp', quality: 82 });
  console.log('✓', file);
}
// imagem de compartilhamento (redes sociais) e capa do vídeo: o próprio site
await p.viewport(1200, 630, 1);
await p.goto(`${BASE}/?site=1`, 1200);
await p.shot(path.join(OUT, 'og.jpg'), { format: 'jpeg', quality: 85 });
console.log('✓ og.jpg');
await p.close();
process.exit(0);
