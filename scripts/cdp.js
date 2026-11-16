// Controle mínimo do Chrome/Edge invisível pelo protocolo DevTools (sem dependências).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BROWSERS = [
  process.env.CHROME_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ port = 9340 + Math.floor(Math.random() * 200) } = {}) {
  const exe = BROWSERS.find((p) => fs.existsSync(p));
  if (!exe) throw new Error('Edge ou Chrome não encontrado (defina CHROME_PATH).');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lola-cdp-'));
  const proc = spawn(exe, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-sandbox',
    '--hide-scrollbars', '--disable-gpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', 'about:blank'], { stdio: 'ignore' });
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch {}
    if (!target) await sleep(250);
  }
  if (!target) throw new Error('O navegador não abriu.');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0;
  const pending = new Map();
  const handlers = {};
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
    else if (m.method) (handlers[m.method] || []).forEach((h) => h(m.params));
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  const on = (ev, fn) => (handlers[ev] ||= []).push(fn);
  await send('Page.enable');
  await send('Runtime.enable');
  const page = {
    send, on,
    async viewport(width, height, scale = 2, mobile = false) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile });
      await send('Emulation.setTouchEmulationEnabled', { enabled: mobile });
      if (mobile) await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
    },
    async goto(url, wait = 900) {
      const loaded = new Promise((r) => on('Page.loadEventFired', r));
      await send('Page.navigate', { url });
      await Promise.race([loaded, sleep(8000)]);
      await sleep(wait);
    },
    async eval(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    async shot(file, { full = false, format = 'jpeg', quality = 88 } = {}) {
      let clip;
      if (full) {
        const m = await send('Page.getLayoutMetrics');
        const { width, height } = m.cssContentSize || m.contentSize;
        clip = { x: 0, y: 0, width, height: Math.min(height, 12000), scale: 1 };
      }
      const r = await send('Page.captureScreenshot', { format, quality: format === 'png' ? undefined : quality, captureBeyondViewport: full, ...(clip ? { clip } : {}) });
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
      return file;
    },
    async close() { try { ws.close(); } catch {} proc.kill(); },
  };
  return page;
}
