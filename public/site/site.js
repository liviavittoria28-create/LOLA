// Lola — scripts do site comercial: menu, cabeçalho e formulários de conta
const $ = (s, r = document) => r.querySelector(s);
const hdr = $('.hdr');
if (hdr) {
  const onScroll = () => hdr.classList.toggle('is-scrolled', scrollY > 8);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  $('.menu-btn')?.addEventListener('click', () => {
    const open = hdr.classList.toggle('is-open');
    $('.menu-btn').setAttribute('aria-expanded', String(open));
  });
  hdr.querySelectorAll('nav a').forEach((a) => a.addEventListener('click', () => hdr.classList.remove('is-open')));
}
// o app instalado antigo abria "/#/agenda": manda para o sistema
if (/^#\/(agenda|clientes|financeiro|procedimentos|mais|painel)/.test(location.hash)) location.replace('/app/' + location.hash);

async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) });
  let data = {};
  try { data = await r.json(); } catch {}
  if (!r.ok) throw Object.assign(new Error(data.error || 'Não foi possível concluir. Tente novamente.'), { data, status: r.status });
  return data;
}
const mark = (form, fields = []) => {
  form.querySelectorAll('.is-invalid').forEach((e) => e.classList.remove('is-invalid'));
  for (const f of fields) form.querySelector(`[name="${f}"]`)?.closest('.f, .chk')?.classList.add('is-invalid');
};
const maskPhone = (v) => {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
};
document.querySelectorAll('input[type=tel]').forEach((i) => i.addEventListener('input', () => (i.value = maskPhone(i.value))));

function handle(form, fn) {
  if (!form) return;
  const err = $('.err', form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    err.textContent = '';
    try { await fn(Object.fromEntries(new FormData(form)), form); }
    catch (ex) { err.textContent = ex.message; mark(form, ex.data?.fields); }
    finally { btn.disabled = false; }
  });
}

handle($('#signup'), async (v) => {
  const r = await post('/api/signup', { ...v, accept_terms: !!v.accept_terms });
  location.href = r.redirect || '/app/';
});
handle($('#login'), async (v) => {
  const r = await post('/api/login', v);
  const next = new URLSearchParams(location.search).get('next');
  location.href = next && next.startsWith('/app/') ? next : r.redirect || '/app/';
});
handle($('#forgot'), async (v, form) => {
  const r = await post('/api/password/forgot', v);
  form.innerHTML = r.email_enabled
    ? `<div class="ok-box">Se este e-mail tiver uma conta, enviamos um link para criar uma nova senha. Confira também a caixa de spam.</div><a class="btn btn--line" href="/entrar/">Voltar para entrar</a>`
    : `<div class="ok-box">A recuperação de senha é feita pelo nosso atendimento. Chame a Lola no WhatsApp e enviamos um link seguro para você criar uma nova senha.</div>
       <a class="btn btn--wa" target="_blank" rel="noopener" href="https://wa.me/5511962822060?text=${encodeURIComponent(`Olá! Esqueci a senha da Lola. Meu e-mail de acesso é ${v.email}.`)}">Recuperar pelo WhatsApp</a>`;
});
const resetForm = $('#reset');
if (resetForm) {
  const token = new URLSearchParams(location.search).get('token');
  if ((new URLSearchParams(location.search).get('novo')) === '1') {
    $('h1').textContent = 'Crie sua senha';
    $('.form > p').textContent = 'Bem-vinda à Lola! Escolha a senha que você vai usar para entrar.';
  }
  fetch(`/api/password/reset?token=${encodeURIComponent(token || '')}`).then((r) => r.json()).then((r) => {
    if (!r.valid) resetForm.innerHTML = `<div class="err" style="margin-bottom:18px">Este link expirou ou já foi usado.</div><a class="btn btn--line" href="/esqueci-senha/">Pedir um novo link</a>`;
  }).catch(() => {});
  handle(resetForm, async (v, form) => {
    if (v.password !== v.password2) throw Object.assign(new Error('As senhas não são iguais.'), { data: { fields: ['password2'] } });
    await post('/api/password/reset', { token, password: v.password });
    form.innerHTML = `<div class="ok-box">Senha criada! Agora é só entrar com seu e-mail e a nova senha.</div><a class="btn btn--rose" href="/entrar/">Entrar na Lola</a>`;
  });
}
