/* Arithmetic Challenge - behavior for account, profile and leaderboard screens (calls the backend API). */
(function () {
  'use strict';
  const AC = (window.AC = window.AC || {});
  const $ = (sel, root) => (root || document).querySelector(sel);

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* fall through */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) { return false; }
  }
  AC.copyText = copyText;

  function setError(id, msg) { const el = $('#' + id); if (el) el.textContent = msg || ''; }
  function busy(form, on) { form.querySelectorAll('button').forEach((b) => { b.disabled = on; }); }
  function rateMsg(res) {
    if (res.code === 'RATE_LIMITED' && res.retryAfter) {
      const m = Math.ceil(res.retryAfter / 60);
      return `Too many attempts. Please wait about ${m} minute${m === 1 ? '' : 's'} and try again.`;
    }
    return res.message;
  }

  function showPinModal(pin, title, intro, onDone) {
    const holder = document.getElementById('modal-root');
    holder.innerHTML = AC.web.render.pinModal(pin, title, intro);
    const saved = $('#pin-saved', holder);
    const done = $('#pin-done', holder);
    saved.addEventListener('change', () => { done.disabled = !saved.checked; });
    $('#pin-copy', holder).addEventListener('click', async (e) => {
      e.target.textContent = (await copyText(pin)) ? 'Copied!' : 'Select the PIN above to copy';
    });
    done.addEventListener('click', () => { holder.innerHTML = ''; if (onDone) onDone(); });
    done.focus && $('#pin-copy', holder).focus();
  }

  function openLogin() {
    AC.web.mount(AC.web.render.login());
    const form = $('#login-form');
    $('#l-user').focus();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      setError('l-err', '');
      const username = $('#l-user').value.trim();
      const password = $('#l-pass').value;
      if (!username || !password) return setError('l-err', 'Enter your username and password.');
      busy(form, true);
      const res = await AC.api('/login', { method: 'POST', body: { username, password } });
      busy(form, false);
      if (!res.ok) return setError('l-err', rateMsg(res));
      $('#l-pass').value = '';
      AC.setUser(res.data.player, res.data.csrf);
      AC.toast('Logged in as ' + res.data.player.displayName);
      AC.navigate('#/play');
    });
  }

  function openRegister() {
    AC.web.mount(AC.web.render.register());
    const form = $('#reg-form');
    $('#r-user').focus();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      setError('r-err', '');
      const username = $('#r-user').value.trim();
      const displayName = $('#r-display').value.trim();
      const password = $('#r-pass').value;
      if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return setError('r-err', 'Username must be 3\u201320 letters, numbers or underscores.');
      if (displayName.length < 3 || displayName.length > 20) return setError('r-err', 'Display name must be 3\u201320 characters.');
      if (password.length < 8) return setError('r-err', 'Password must be at least 8 characters.');
      if (password !== $('#r-pass2').value) return setError('r-err', 'The two passwords do not match.');
      busy(form, true);
      const res = await AC.api('/register', { method: 'POST', body: { username, displayName, password } });
      busy(form, false);
      if (!res.ok) return setError('r-err', rateMsg(res));
      $('#r-pass').value = ''; $('#r-pass2').value = '';
      AC.setUser(res.data.player, res.data.csrf);
      showPinModal(res.data.recoveryPin, 'Save your recovery PIN',
        'This 6-digit PIN is the only way to reset your password or find your username if you forget them. You can copy it again later from your Profile.',
        () => AC.navigate('#/play'));
    });
  }

  async function openProfile() {
    if (!AC.state.user) { AC.navigate('#/login'); return; }
    AC.web.mount('<section class="panel"><p class="muted">Loading…</p></section>');
    const res = await AC.api('/profile');
    if (!res.ok) { if (res.status === 401) return AC.sessionLost(res.code); return AC.web.mount(AC.web.render.message('Could not load profile', res.message)); }
    AC.web.mount(AC.web.render.profile(res.data));

    $('#name-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = $('#n-name').value.trim();
      const out = $('#n-msg');
      out.className = 'form-error';
      const r = await AC.api('/profile/display-name', { method: 'POST', body: { displayName: name } });
      if (!r.ok) { out.textContent = r.message; return; }
      AC.state.user.displayName = r.data.displayName;
      out.className = 'form-ok'; out.textContent = 'Display name updated.';
      $('h1').textContent = r.data.displayName;
      AC.renderNav();
    });

    const pinMsg = (t, ok) => { const el = $('#p-msg'); el.className = ok ? 'form-ok' : 'form-error'; el.textContent = t; };
    $('#pin-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const password = $('#p-pass').value;
      if (!password) return pinMsg('Enter your password first.');
      const r = await AC.api('/account/pin/reveal', { method: 'POST', body: { password } });
      if (!r.ok) return pinMsg(rateMsg(r));
      $('#p-pass').value = '';
      if (await copyText(r.data.recoveryPin)) return pinMsg('Recovery PIN copied to your clipboard.', true);
      showPinModal(r.data.recoveryPin, 'Your recovery PIN', 'Copying was blocked by your browser, so here it is.', null);
    });
    $('#pin-regen').addEventListener('click', async () => {
      const password = $('#p-pass').value;
      if (!password) return pinMsg('Enter your password first.');
      if (!confirm('Generate a new PIN? The old PIN will stop working.')) return;
      const r = await AC.api('/account/pin/regenerate', { method: 'POST', body: { password } });
      if (!r.ok) return pinMsg(rateMsg(r));
      $('#p-pass').value = '';
      showPinModal(r.data.recoveryPin, 'Your new recovery PIN', 'Your old PIN no longer works. Save this one.', null);
    });
    $('#logout').addEventListener('click', async () => {
      await AC.api('/logout', { method: 'POST', body: {} });
      AC.clearUser();
      AC.toast('Logged out.');
      AC.navigate('#/');
    });
  }

  async function openLeaderboard(level) {
    level = ['easy', 'normal', 'hard'].includes(level) ? level : 'normal';
    AC.web.mount(AC.web.render.leaderboard(null, level));
    const bind = () => document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => openLeaderboard(t.dataset.level)));
    bind();
    const res = await AC.api('/leaderboard?difficulty=' + level);
    if (!document.querySelector('.tab.active') || document.querySelector('.tab.active').dataset.level !== level) return; // user switched tabs meanwhile
    if (!res.ok) { const el = $('#lb-loading'); if (el) el.textContent = res.message; return; }
    AC.web.mount(AC.web.render.leaderboard(res.data, level));
    bind();
  }

  AC.webLogic = { openLogin, openRegister, openProfile, openLeaderboard, showPinModal };
})();
