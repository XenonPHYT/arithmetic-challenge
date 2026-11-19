/* Arithmetic Challenge - application shell: API helper, session state, routing, navigation. Loaded last. */
(function () {
  'use strict';
  const AC = (window.AC = window.AC || {});
  AC.state = { user: null, csrf: null };

  const $ = (s) => document.querySelector(s);

  AC.api = async function (path, opts) {
    const o = opts || {};
    const method = o.method || 'GET';
    const headers = { Accept: 'application/json' };
    if (method !== 'GET') {
      headers['Content-Type'] = 'application/json';
      if (AC.state.csrf) headers['X-CSRF-Token'] = AC.state.csrf;
    }
    let res;
    try {
      res = await fetch('/api' + path, { method, headers, body: o.body !== undefined ? JSON.stringify(o.body) : undefined, credentials: 'same-origin', cache: 'no-store' });
    } catch (e) {
      return { ok: false, status: 0, code: 'NETWORK', message: 'Network problem. Please check your connection and try again.' };
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* not JSON */ }
    if (res.ok) return { ok: true, status: res.status, data };
    const err = (data && data.error) || {};
    return { ok: false, status: res.status, code: err.code, message: err.message || 'Something went wrong. Please try again.', retryAfter: err.retryAfter };
  };

  AC.toast = function (msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(AC.toast.timer);
    AC.toast.timer = setTimeout(() => t.classList.remove('show'), 3500);
  };
  AC.navigate = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };

  AC.setUser = (player, csrf) => { AC.state.user = player; AC.state.csrf = csrf; AC.renderNav(); };
  AC.clearUser = () => { AC.state.user = null; AC.state.csrf = null; AC.renderNav(); };
  AC.sessionLost = (code) => {
    AC.clearUser();
    AC.toast(code === 'SESSION_REPLACED' ? 'You were signed out because your account logged in on another device.' : 'Please log in again.');
    AC.navigate('#/login');
  };

  AC.renderNav = async function () {
    const u = AC.state.user;
    const resume = u && (await AC.hasActiveGame());
    $('#nav').innerHTML = u
      ? `<a href="#/play">${resume ? 'Resume game' : 'Play'}</a><a href="#/leaderboard">Leaderboard</a><a href="#/profile" class="nav-user">${AC.util.esc(u.displayName)}</a>`
      : `<a href="#/leaderboard">Leaderboard</a><a href="#/login">Log in</a><a href="#/register" class="nav-cta">Sign up</a>`;
    const hero = $('#hero-actions');
    hero.innerHTML = u
      ? '<a class="btn primary big" href="#/play">Play now</a><a class="btn big" href="#/leaderboard">Leaderboard</a>'
      : '<a class="btn primary big" href="#/register">Get started</a><a class="btn big" href="#/login">Log in</a>';
  };

  function route() {
    const hash = location.hash || '#/';
    const [path, query] = hash.slice(1).split('?');
    const landing = $('#view-landing');
    const dyn = $('#view-dynamic');
    AC.game.leave();
    const isHome = path === '/' || path === '';
    landing.hidden = !isHome;
    dyn.hidden = isHome;
    window.scrollTo(0, 0);
    if (isHome) return AC.renderNav();
    if (path === '/login') return AC.state.user ? AC.navigate('#/play') : AC.webLogic.openLogin();
    if (path === '/register') return AC.state.user ? AC.navigate('#/play') : AC.webLogic.openRegister();
    if (path === '/profile') return AC.webLogic.openProfile();
    if (path === '/leaderboard') return AC.webLogic.openLeaderboard(new URLSearchParams(query || '').get('level'));
    if (path === '/play') return AC.game.open();
    AC.navigate('#/');
  }

  async function checkSession(quiet) {
    const res = await AC.api('/me');
    if (res.ok) { AC.setUser(res.data.player, res.data.csrf); return; }
    if (res.status === 401) {
      const had = !!AC.state.user;
      AC.clearUser();
      if (had && !quiet) AC.sessionLost(res.code);
      else if (had) AC.sessionLost(res.code);
    }
  }

  async function init() {
    AC.assistant.init();
    await checkSession(true);
    window.addEventListener('hashchange', route);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && AC.state.user) checkSession(); });
    setInterval(() => { if (!document.hidden && AC.state.user) checkSession(); }, 60000);
    route();
    if (AC.state.user) setTimeout(() => AC.game.warmUp(), 1500); // preload the math engine for signed-in players only
  }
  document.addEventListener('DOMContentLoaded', init);
})();
