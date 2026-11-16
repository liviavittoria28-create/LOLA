// Cria uma empresa de DEMONSTRAÇÃO com dados fictícios, usando a própria API da Lola
// (é o sistema real funcionando — usado para os prints e o vídeo do site).
// Uso (com o app rodando):  node scripts/demo-seed.js http://localhost:5173
// Acesso criado: DEMO_EMAIL / DEMO_PASSWORD (padrão: demo@lola.test / LolaDemo2026)
const BASE = process.argv[2] || 'http://localhost:5173';
const EMAIL = process.env.DEMO_EMAIL || 'demo@lola.test';
const PASSWORD = process.env.DEMO_PASSWORD || 'LolaDemo2026';
let cookie = '';
async function call(method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
  const set = r.headers.getSetCookie?.() || [];
  if (set.length) cookie = set[0].split(';')[0];
  const data = await r.json().catch(() => null);
  if (!r.ok) throw Object.assign(new Error(`${method} ${path}: ${r.status} ${data?.error}`), { status: r.status, data });
  return data;
}
const post = (p, b) => call('POST', p, b), put = (p, b) => call('PUT', p, b), patch = (p, b) => call('PATCH', p, b), get = (p) => call('GET', p);

// gerador aleatório com semente (os dados saem sempre iguais)
let seed = 20261116;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const dow = (d) => new Date(d + 'T12:00:00Z').getUTCDay();

try {
  await post('/api/signup', { company: 'Studio Aurora Beauty', name: 'Camila Duarte', email: EMAIL, phone: '(11) 90000-0000', password: PASSWORD, accept_terms: true, city: 'São Paulo', segment: 'Estética e beleza' });
} catch (e) {
  if (e.data?.code !== 'email_taken') throw e;
  await post('/api/login', { email: EMAIL, password: PASSWORD });
  if ((await get('/api/clients')).length) { console.log('A empresa de demonstração já tem dados. Nada foi alterado.'); process.exit(0); }
}
await put('/api/settings', { studio_address: 'Rua das Camélias, 120 — Jardins, São Paulo', open_time: '09:00', close_time: '19:00', work_days: '1,2,3,4,5,6' });

const SERVICES = [
  ['Design de sobrancelha', 'Desenho personalizado respeitando o formato do rosto.', 6000, 40],
  ['Design com henna', 'Design de sobrancelha com aplicação de henna.', 7500, 50],
  ['Brow lamination', 'Alinhamento e volume para os fios naturais.', 15000, 60],
  ['Lash lifting', 'Curvatura dos cílios naturais com nutrição.', 16000, 60],
  ['Extensão de cílios fio a fio', 'Aplicação clássica, efeito natural.', 18000, 120],
  ['Manutenção de cílios', 'Reposição a partir de 15 dias.', 11000, 75],
  ['Manicure', 'Cutilagem e esmaltação.', 4000, 45],
  ['Pedicure', 'Cutilagem e esmaltação dos pés.', 4500, 50],
  ['Esmaltação em gel', 'Esmaltação com secagem em cabine, dura até 3 semanas.', 7000, 60],
  ['Limpeza de pele', 'Extração, esfoliação e máscara calmante.', 18000, 80],
  ['Escova modelada', 'Lavagem e escova.', 7000, 50],
  ['Hidratação capilar', 'Tratamento com máscara de reconstrução.', 9000, 60],
];
const procs = [];
for (const [name, description, price_cents, duration_min] of SERVICES) procs.push(await post('/api/procedures', { name, description, price_cents, duration_min }));

const NAMES = ['Ana Beatriz Rocha', 'Juliana Martins', 'Fernanda Lopes', 'Mariana Alves', 'Patrícia Gomes', 'Larissa Souza', 'Gabriela Nunes', 'Renata Carvalho', 'Bianca Ferreira', 'Camila Ribeiro',
  'Letícia Prado', 'Aline Moreira', 'Vanessa Teixeira', 'Daniela Pires', 'Priscila Castro', 'Natália Barros', 'Beatriz Lima', 'Carolina Mendes', 'Isabela Freitas', 'Luana Cardoso',
  'Sabrina Dias', 'Tatiane Araújo', 'Rafaela Monteiro', 'Débora Campos', 'Helena Duarte', 'Lívia Batista', 'Marcela Pinto', 'Paula Correia', 'Yasmin Rezende', 'Clara Fontes',
  'Eduarda Siqueira', 'Giovana Matos', 'Bruna Vieira', 'Elisa Moura', 'Lorena Azevedo', 'Manuela Pacheco'];
const clients = [];
for (const [i, name] of NAMES.entries()) {
  const phone = `(11) 9${String(8100 + i * 37).padStart(4, '0')}-${String(1000 + i * 211).slice(-4)}`;
  const m = 1 + Math.floor(rnd() * 12), d = 1 + Math.floor(rnd() * 27);
  const birth = `${1975 + Math.floor(rnd() * 28)}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const c = await post('/api/clients', { name, phone, birth_date: i % 4 === 0 ? `${birth.slice(0, 4)}-${today.slice(5, 7)}-${String(3 + (i % 24)).padStart(2, "0")}` : birth, email: `${name.split(' ')[0].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')}@exemplo.com`, notes: i % 5 === 0 ? 'Prefere horários pela manhã.' : '' });
  if (i % 6 !== 5) await put(`/api/clients/${c.id}/anamnese`, { consent: true, alergias: i % 7 === 0 ? 'Sim' : 'Não', gestante: 'Não', medicamentos: 'Não', obs: '' });
  clients.push(c);
}

// atendimentos: 5 meses para trás e 2 semanas para frente
const METHODS = ['Pix', 'Pix', 'Pix', 'Cartão de crédito', 'Cartão de débito', 'Dinheiro'];
let made = 0;
for (let off = -150; off <= 14; off++) {
  const date = addDays(today, off);
  if (dow(date) === 0) continue;
  const per = off === 0 ? 6 : off > 0 ? 3 + Math.floor(rnd() * 3) : 2 + Math.floor(rnd() * 4);
  let minute = 9 * 60;
  for (let k = 0; k < per && minute < 17 * 60; k++) {
    const p1 = pick(procs);
    const ids = [p1.id];
    if (rnd() < 0.2) { const p2 = pick(procs); if (p2.id !== p1.id) ids.push(p2.id); }
    const start = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    const c = pick(clients);
    let a;
    try { a = await post('/api/appointments', { client_id: c.id, procedure_ids: ids, date, start }); } catch { minute += 30; continue; }
    minute += a.duration_min + (rnd() < 0.5 ? 15 : 30);
    made++;
    if (off < 0 || (off === 0 && k < 2)) {
      const r = rnd();
      const status = r < 0.06 ? 'faltou' : r < 0.12 ? 'cancelada' : 'concluida';
      await patch(`/api/appointments/${a.id}/status`, { status, cancel_reason: status === 'cancelada' ? 'Imprevisto da cliente' : undefined });
      if (status === 'concluida') await post('/api/transactions', { type: 'in', amount_cents: a.total_cents, date, category: 'Atendimento', method: pick(METHODS), description: a.procedures.map((p) => p.name).join(' + '), client_id: c.id, appointment_id: a.id });
    } else if (rnd() < 0.45) await patch(`/api/appointments/${a.id}/status`, { status: 'confirmada' });
  }
}
// despesas mensais
for (let m = 5; m >= 0; m--) {
  const d = addDays(today.slice(0, 8) + '05', -30 * m);
  const day = (n) => d.slice(0, 8) + String(n).padStart(2, '0');
  if (day(5) > today) continue;
  await post('/api/transactions', { type: 'out', amount_cents: 180000, date: day(5), category: 'Aluguel', method: 'Transferência', description: 'Aluguel da sala' });
  if (day(10) <= today) await post('/api/transactions', { type: 'out', amount_cents: 32000 + Math.floor(rnd() * 20000), date: day(10), category: 'Materiais', method: 'Cartão de crédito', description: 'Reposição de materiais' });
  if (day(15) <= today) await post('/api/transactions', { type: 'out', amount_cents: 21000, date: day(15), category: 'Contas (água, luz, internet)', method: 'Pix', description: 'Luz e internet' });
  if (day(20) <= today) await post('/api/transactions', { type: 'out', amount_cents: 4990, date: day(20), category: 'Outras saídas', method: 'Pix', description: 'Sistema Lola' });
  if (day(22) <= today && m % 2 === 0) await post('/api/transactions', { type: 'in', amount_cents: 8900, date: day(22), category: 'Venda de produto', method: 'Pix', description: 'Sérum de cílios' });
}
// estoque
for (const [name, unit, quantity, min] of [['Esmalte (cores variadas)', 'un', 46, 20], ['Cola para cílios', 'frasco', 2, 3], ['Fios para extensão 0,07', 'caixa', 5, 2], ['Henna para sobrancelha', 'pote', 1, 2], ['Algodão', 'pacote', 12, 4], ['Lixas descartáveis', 'pacote', 9, 5], ['Luvas descartáveis', 'caixa', 4, 2], ['Máscara calmante facial', 'un', 7, 3]])
  await post('/api/stock', { name, unit, quantity, min_quantity: min });
await post('/api/blocks', { reason: 'Curso de atualização', start_date: addDays(today, 18), end_date: addDays(today, 19) });
console.log(`✓ Demonstração pronta: ${procs.length} serviços, ${clients.length} clientes, ${made} atendimentos.\n  Acesso: ${EMAIL} / ${PASSWORD}`);
