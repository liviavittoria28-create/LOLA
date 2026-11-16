// Utilitários de linha de comando
//   npm run backups                          → lista as cópias diárias (JSON)
//   npm run restaurar -- arquivo.json        → importa uma cópia para o banco
//
// Tipos de cópia aceitos:
//   • cópia diária do servidor (Lola, todas as empresas)  → substitui TODOS os dados da plataforma
//   • cópia baixada no app (Lola, uma empresa)            → substitui só os dados DAQUELA empresa
//   • cópia do antigo Agenda Expert                         → substitui os dados e liga tudo à empresa nº 1
// E-mail e senha: ADMIN_EMAIL/ADMIN_PASSWORD e PLATFORM_EMAIL/PLATFORM_PASSWORD (ver README).
import fs from 'node:fs';
import path from 'node:path';

const [cmd, ...args] = process.argv.slice(2);

const CHILD_ORDER = ['clients', 'anamneses', 'procedures', 'appointments', 'appointment_procedures', 'blocks', 'transactions', 'stock_items', 'stock_moves'];
const NO_ID = new Set(['settings', 'anamneses', 'company_settings']);

async function insertRows(t, name, rows) {
  for (const row of rows || []) {
    const cols = Object.keys(row);
    await t.prepare(`INSERT INTO ${name} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map((c) => row[c]));
  }
}
async function fixSeq(t, name) {
  if (NO_ID.has(name)) return;
  await t.prepare(`SELECT setval(pg_get_serial_sequence('${name}', 'id'), COALESCE((SELECT MAX(id) FROM ${name}), 0) + 1, false)`).get();
}

if (cmd === 'backups') {
  const { BACKUP_DIR } = await import('./backup.js');
  const files = fs.existsSync(BACKUP_DIR) ? fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.json')).sort() : [];
  console.log(files.length ? files.map((f) => '  ' + path.join(BACKUP_DIR, f)).join('\n') : 'Nenhuma cópia encontrada.');
} else if (cmd === 'restaurar') {
  const src = args[0];
  if (!src || !fs.existsSync(src)) {
    console.error('Uso: npm run restaurar -- caminho/para/lola-backup.json');
    process.exit(1);
  }
  const dump = JSON.parse(fs.readFileSync(src, 'utf8'));
  if (!dump?.tables) { console.error('Arquivo inválido: não é uma cópia da Lola/Agenda Expert.'); process.exit(1); }
  const { initDb, tx, migrateLegacy } = await import('./db.js');
  await initDb();
  const T = dump.tables;
  if (['Lola', 'BELORA'].includes(dump.app) && dump.scope === 'platform') {
    const order = ['companies', 'payments', ...CHILD_ORDER, 'company_settings', 'settings'];
    await tx(async (t) => {
      // usuárias e sessões não estão na cópia: desliga-as das empresas antes de recriar
      for (const name of [...order].reverse()) if (name !== 'companies') await t.prepare(`DELETE FROM ${name}`).run();
      await t.prepare('DELETE FROM wa_sessions').run();
      await t.prepare('DELETE FROM password_resets').run();
      await t.prepare('UPDATE users SET company_id = NULL WHERE company_id IS NOT NULL AND company_id NOT IN (' + ((T.companies || []).map((c) => Number(c.id)).join(',') || '0') + ')').run();
      await t.prepare('DELETE FROM companies WHERE id NOT IN (' + ((T.companies || []).map((c) => Number(c.id)).join(',') || '0') + ')').run();
      for (const c of T.companies || []) {
        const cols = Object.keys(c);
        await t.prepare(`INSERT INTO companies (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) ON CONFLICT (id) DO UPDATE SET ${cols.filter((k) => k !== 'id').map((k) => `${k} = EXCLUDED.${k}`).join(', ')}`).run(...cols.map((k) => c[k]));
      }
      for (const name of order.slice(1)) { await insertRows(t, name, T[name]); await fixSeq(t, name); }
      await fixSeq(t, 'companies');
    });
    console.log(`✓ Cópia da plataforma de ${dump.exported_at} restaurada (${(T.companies || []).length} empresas).`);
  } else if (['Lola', 'BELORA'].includes(dump.app) && dump.company?.id) {
    const cid = Number(dump.company.id);
    await tx(async (t) => {
      if (!(await t.prepare('SELECT 1 AS x FROM companies WHERE id = ?').get(cid))) throw new Error(`A empresa nº ${cid} não existe neste banco.`);
      // apaga os dados atuais da empresa (na ordem inversa das ligações)
      await t.prepare('DELETE FROM stock_moves WHERE item_id IN (SELECT id FROM stock_items WHERE company_id = ?)').run(cid);
      await t.prepare('DELETE FROM wa_messages WHERE company_id = ?').run(cid);
      await t.prepare('DELETE FROM transactions WHERE company_id = ?').run(cid);
      await t.prepare('DELETE FROM appointment_procedures WHERE appointment_id IN (SELECT id FROM appointments WHERE company_id = ?)').run(cid);
      await t.prepare('DELETE FROM appointments WHERE company_id = ?').run(cid);
      await t.prepare('DELETE FROM anamneses WHERE client_id IN (SELECT id FROM clients WHERE company_id = ?)').run(cid);
      for (const name of ['blocks', 'stock_items', 'procedures', 'clients', 'company_settings']) await t.prepare(`DELETE FROM ${name} WHERE company_id = ?`).run(cid);
      for (const name of CHILD_ORDER) { await insertRows(t, name, T[name]); await fixSeq(t, name); }
      await insertRows(t, 'company_settings', (T.settings || []).map((r) => ({ company_id: cid, key: r.key, value: r.value })));
    });
    console.log(`✓ Cópia da empresa “${dump.company.name}” de ${dump.exported_at} restaurada.`);
  } else {
    // cópia do Agenda Expert (antes da Lola): mesmo comportamento de antes + ligação à empresa nº 1
    const order = ['settings', ...CHILD_ORDER];
    await tx(async (t) => {
      for (const name of [...order].reverse()) await t.prepare(`DELETE FROM ${name}`).run();
      for (const name of order) { await insertRows(t, name, T[name]); await fixSeq(t, name); }
      const first = await t.prepare('SELECT id FROM companies ORDER BY id LIMIT 1').get();
      if (first) {
        for (const name of ['clients', 'procedures', 'appointments', 'blocks', 'transactions', 'stock_items']) await t.prepare(`UPDATE ${name} SET company_id = ? WHERE company_id IS NULL`).run(first.id);
        for (const r of T.settings || []) await t.prepare('INSERT INTO company_settings (company_id, key, value) VALUES (?,?,?) ON CONFLICT (company_id, key) DO UPDATE SET value = EXCLUDED.value').run(first.id, r.key, r.value);
      }
    });
    await migrateLegacy();
    console.log(`✓ Cópia do Agenda Expert de ${dump.exported_at} restaurada (${(T.clients || []).length} clientes, ${(T.appointments || []).length} atendimentos).`);
  }
  process.exit(0);
} else {
  console.log('Comandos: backups, restaurar');
}
