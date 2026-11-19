/* Arithmetic Challenge - rendering for account, profile and leaderboard screens.
 * Pure rendering: every function returns an HTML string. All dynamic values are escaped. Behavior lives in web_logic.js. */
(function () {
  'use strict';
  const AC = (window.AC = window.AC || {});

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function fmtTime(ms) {
    const t = Math.floor(ms / 100);
    const tenths = t % 10;
    const secs = Math.floor(t / 10) % 60;
    const mins = Math.floor(t / 600);
    return `${mins}:${String(secs).padStart(2, '0')}.${tenths}`;
  }
  AC.util = { esc, fmtTime };

  const LEVELS = ['easy', 'normal', 'hard'];
  const LABEL = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };

  const field = (id, label, attrs, hint) => `
    <div class="field"><label for="${id}">${label}</label><input id="${id}" ${attrs}>${hint ? `<small>${hint}</small>` : ''}</div>`;

  const render = {
    login() {
      return `
        <section class="panel narrow">
          <h1>Welcome back</h1>
          <form id="login-form" novalidate>
            ${field('l-user', 'Username', 'name="username" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="20" required')}
            ${field('l-pass', 'Password', 'name="password" type="password" autocomplete="current-password" maxlength="128" required')}
            <p class="form-error" id="l-err" role="alert"></p>
            <button class="btn primary wide" type="submit">Log in</button>
          </form>
          <p class="muted small">Forgot your password or username? Use the <b>Assistant</b> in the corner. New here? <a href="#/register">Create an account</a>.</p>
          <p class="muted small">Logging in here signs you out on any other device.</p>
        </section>`;
    },
    register() {
      return `
        <section class="panel narrow">
          <h1>Create your account</h1>
          <form id="reg-form" novalidate>
            ${field('r-user', 'Username', 'name="username" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="20" required', '3\u201320 letters, numbers or underscores. Used to log in.')}
            ${field('r-display', 'Display name', 'name="displayName" autocomplete="nickname" maxlength="20" required', 'Shown on the leaderboard. Must be unique. You can change it later.')}
            ${field('r-pass', 'Password', 'name="password" type="password" autocomplete="new-password" maxlength="128" required', 'At least 8 characters.')}
            ${field('r-pass2', 'Confirm password', 'name="password2" type="password" autocomplete="new-password" maxlength="128" required')}
            <p class="form-error" id="r-err" role="alert"></p>
            <button class="btn primary wide" type="submit">Create account</button>
          </form>
          <p class="muted small">Already registered? <a href="#/login">Log in</a>.</p>
        </section>`;
    },
    pinModal(pin, title, intro) {
      return `
        <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="pin-title">
          <div class="modal">
            <h2 id="pin-title">${esc(title)}</h2>
            <p>${esc(intro)}</p>
            <div class="pin" id="pin-value" aria-label="Recovery PIN">${esc(pin)}</div>
            <div class="actions"><button class="btn" id="pin-copy" type="button">Copy PIN</button></div>
            <label class="check"><input type="checkbox" id="pin-saved"> I have saved my recovery PIN</label>
            <button class="btn primary wide" id="pin-done" type="button" disabled>Continue</button>
          </div>
        </div>`;
    },
    profile(d) {
      const rows = LEVELS.map((l) => `<tr><th scope="row">${LABEL[l]}</th><td>${d.stats[l].wins}</td><td>${d.stats[l].bestMs ? fmtTime(d.stats[l].bestMs) : '\u2014'}</td></tr>`).join('');
      return `
        <section class="panel">
          <h1>${esc(d.player.displayName)}</h1>
          <p class="muted">Username: <b>${esc(d.player.username)}</b></p>
          <h2>Your record</h2>
          <div class="table-wrap"><table class="table"><thead><tr><th>Level</th><th>Perfect wins</th><th>Best time</th></tr></thead><tbody>${rows}</tbody></table></div>
          <h2>Display name</h2>
          <form id="name-form" class="inline-form" novalidate>
            <input id="n-name" aria-label="New display name" maxlength="20" value="${esc(d.player.displayName)}">
            <button class="btn" type="submit">Save</button>
          </form>
          <p class="form-error" id="n-msg" role="status"></p>
          <h2>Account &amp; Security</h2>
          <p class="muted">Your 6-digit recovery PIN lets you reset your password or find your username. Keep it somewhere safe.</p>
          <form id="pin-form" novalidate>
            ${field('p-pass', 'Confirm your password', 'type="password" autocomplete="current-password" maxlength="128"')}
            <div class="actions">
              <button class="btn" id="pin-reveal" type="submit">Copy my recovery PIN</button>
              <button class="btn" id="pin-regen" type="button">Generate a new PIN</button>
            </div>
            <p class="form-error" id="p-msg" role="status"></p>
          </form>
          <p class="muted small">Generating a new PIN stops the old one from working.</p>
          <div class="actions"><button class="btn danger" id="logout" type="button">Log out</button></div>
        </section>`;
    },
    leaderboard(d, level) {
      const tabs = LEVELS.map((l) => `<button class="tab ${l === level ? 'active' : ''}" role="tab" aria-selected="${l === level}" data-level="${l}">${LABEL[l]}</button>`).join('');
      const wins = d ? d.mostWins.map((r) => `<tr><td>${r.rank}</td><td>${esc(r.name)}</td><td>${r.wins}</td></tr>`).join('') : '';
      const fast = d ? d.fastest.map((r) => `<tr><td>${r.rank}</td><td>${esc(r.name)}</td><td>${fmtTime(r.elapsedMs)}</td></tr>`).join('') : '';
      const empty = '<tr><td colspan="3" class="muted">No perfect runs yet. Be the first!</td></tr>';
      return `
        <section class="panel">
          <h1>Leaderboard</h1>
          <div class="tabs" role="tablist" aria-label="Difficulty">${tabs}</div>
          ${d ? `<div class="board-grid">
            <div><h2>Most perfect wins</h2><div class="table-wrap"><table class="table"><thead><tr><th>#</th><th>Player</th><th>Wins</th></tr></thead><tbody>${wins || empty}</tbody></table></div></div>
            <div><h2>Fastest time</h2><div class="table-wrap"><table class="table"><thead><tr><th>#</th><th>Player</th><th>Time</th></tr></thead><tbody>${fast || empty}</tbody></table></div></div>
          </div>` : '<p class="muted" id="lb-loading">Loading…</p>'}
          <p class="muted small">Only perfect runs count. Times are measured by the server.</p>
        </section>`;
    },
    message(title, body) {
      return `<section class="panel narrow center"><h1>${esc(title)}</h1><p>${esc(body)}</p><a class="btn primary" href="#/">Back home</a></section>`;
    },
  };

  AC.web = { render, mount: (html) => { document.getElementById('view-dynamic').innerHTML = html; } };
})();
