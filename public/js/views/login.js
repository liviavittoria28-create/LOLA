// Tela de acesso dentro do app (Lola) — CSU01
import { api } from '../api.js';
import { I } from '../icons.js';

export function renderLogin(root, onSuccess) {
  root.innerHTML = `
    <div class="login">
      <form class="login__box" novalidate>
        <div class="login__brand">
          <h1 class="wordmark">Lola<i></i></h1>
          <p>Entre para ver sua agenda, suas clientes e seu caixa.</p>
        </div>
        <label class="field"><span>E-mail</span>
          <input class="input" type="email" name="email" autocomplete="username" inputmode="email" required autofocus placeholder="seu@email.com"></label>
        <label class="field"><span>Senha</span>
          <input class="input" type="password" name="password" autocomplete="current-password" required placeholder="••••••••"></label>
        <div class="login__err" role="alert"></div>
        <button class="btn btn--block" type="submit">Entrar</button>
        <div class="login__links"><a href="/esqueci-senha/">Esqueci minha senha</a><a href="/cadastro/">Testar grátis por 15 dias</a></div>
        <p class="login__foot">${I.lock.replace('<svg', '<svg style="width:12px;height:12px;display:inline;vertical-align:-1px;margin-right:4px"')}Conexão protegida. Seus dados ficam só com você.</p>
      </form>
    </div>`;
  const form = root.querySelector('form');
  const err = root.querySelector('.login__err');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = form.email.value.trim();
    const password = form.password.value;
    if (!email || !password) { err.textContent = 'Informe e-mail e senha.'; return; }
    const btn = form.querySelector('button');
    btn.disabled = true;
    err.textContent = '';
    try {
      await api.post('/api/login', { email, password });
      const me = await api.get('/api/me');
      onSuccess(me);
    } catch (ex) {
      err.textContent = ex.message;
      form.password.select();
    } finally {
      btn.disabled = false;
    }
  });
}
