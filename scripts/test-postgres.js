// Roda os testes da API e do SaaS conectando por DATABASE_URL (protocolo de rede do Postgres),
// exatamente como o app conecta no Supabase — usando um Postgres local temporário (um banco novo por arquivo).
// Uso: npm run test:postgres
import { spawn } from 'node:child_process';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const PORT = 55432;
let code = 0;
for (const file of ['test/api.test.js', 'test/saas.test.js']) {
  const pg = await PGlite.create();
  const server = new PGLiteSocketServer({ db: pg, port: PORT, host: '127.0.0.1', maxConnections: 20 });
  await server.start();
  console.log(`\nPostgres de teste em 127.0.0.1:${PORT} → ${file}`);
  const url = `postgres://postgres:postgres@127.0.0.1:${PORT}/postgres?sslmode=disable`;
  code ||= await new Promise((resolve) => {
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--test', '--test-concurrency=1', file], {
      stdio: 'inherit', env: { ...process.env, DATABASE_URL: url, SAAS_DATABASE_URL: url },
    });
    child.on('exit', (c) => resolve(c ?? 1));
  });
  await server.stop().catch(() => {});
  await pg.close().catch(() => {});
}
process.exit(code);
