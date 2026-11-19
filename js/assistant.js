/* Arithmetic Challenge - rule-based Assistant. No AI service: fixed guided flows.
 * Sensitive values (PIN, passwords) go only into protected form fields and straight to the backend;
 * they are never added to the transcript, stored, or logged. */
(function () {
  'use strict';
  const AC = (window.AC = window.AC || {});
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => AC.util.esc(s);

  const MENU = [
    ['Forgot password', 'forgot-password'],
    ['Forgot username', 'forgot-username'],
    ['Recovery PIN help', 'pin-help'],
    ['Login on another device', 'other-device'],
    ['Account & security', 'account'],
    ['Other questions', 'other'],
  ];

  const NODES = {
    root: { text: "Hi! I'm the Arithmetic Challenge Assistant. What can I help you with?", options: MENU },
    'forgot-password': {
      text: 'I can reset your password using your username and your 6-digit recovery PIN (shown when you created your account). What you type into the form goes straight to the server and never appears in this chat.',
      options: [['Reset my password', 'form:password'], ["I don't have my PIN", 'pin-help'], ['Back', 'root']],
    },
    'forgot-username': {
      text: 'I can look up your username using your display name (the name shown on the leaderboard) and your recovery PIN.',
      options: [['Find my username', 'form:username'], ["I don't have my PIN", 'pin-help'], ['Back', 'root']],
    },
    'pin-help': {
      text: () => (AC.state.user
        ? 'Open your Profile, go to Account & Security, enter your password and tap "Copy my recovery PIN". You can also generate a new PIN there (the old one stops working).'
        : 'If you can still log in, open your Profile > Account & Security to copy your PIN. If you have lost both your password and your PIN, the account cannot be recovered automatically.'),
      options: () => (AC.state.user ? [['Go to Profile', 'go:#/profile'], ['Back', 'root']] : [['Log in', 'go:#/login'], ['Back', 'root']]),
    },
    'other-device': {
      text: 'An account can be logged in on one device at a time. Logging in on a new device signs the old one out automatically, so just log in again. A game in progress keeps its timer running, but it can only be finished on the device where it was played. Starting a new game elsewhere replaces the unfinished one.',
      options: [['Back', 'root']],
    },
    account: {
      text: 'In your Profile you can: change your display name (your wins stay with you), copy or regenerate your recovery PIN, see your record, and log out. Your password is never shown to anyone.',
      options: () => (AC.state.user ? [['Go to Profile', 'go:#/profile'], ['Back', 'root']] : [['Log in', 'go:#/login'], ['Back', 'root']]),
    },
    other: {
      text: 'What would you like to know?',
      options: [['Game rules', 'rules'], ['Difficulty levels', 'levels'], ['Game sessions', 'session'], ['Accuracy requirements', 'accuracy'], ['Leaderboard categories', 'boards'], ['Troubleshooting', 'trouble'], ['Back', 'root']],
    },
    rules: { text: 'Each game is a set of arithmetic questions (add, subtract, multiply, divide) with whole-number answers. You get one try per question. The timer starts when the first question appears and stops when you answer the last one.', options: [['Back', 'other']] },
    levels: { text: 'Easy has 10 questions, Normal 15 and Hard 20. All four operations are mixed into every level. Higher levels use bigger numbers and trickier steps such as carrying, borrowing, two-digit multipliers and divisors.', options: [['Back', 'other']] },
    session: { text: 'Refreshing the page does not reset your game or timer. The timer runs on the server clock. You can have one active game per account, and an unfinished game expires after 3 hours.', options: [['Back', 'other']] },
    accuracy: { text: 'Only a perfect run (every answer correct) is recorded. A wrong answer cannot be retried, and the game continues so you can see your score. The server re-checks every answer itself.', options: [['Back', 'other']] },
    boards: { text: 'Each level has two boards: Most perfect wins (how many perfect runs a player has) and Fastest time (a player\'s single best perfect run). Times are measured by the server.', options: [['Back', 'other']] },
    trouble: { text: 'If questions do not appear, wait a few seconds: the first game downloads the math engine. Check your connection and refresh if needed. If you were signed out, log in again. A finished game that could not be sent is kept on your device and retried automatically.', options: [['Back', 'other']] },
  };

  let panel, log, opts, formBox, history = [];

  function say(text, who) {
    const d = document.createElement('div');
    d.className = 'msg ' + who;
    d.textContent = text;
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
  }
  function clearForm() { formBox.innerHTML = ''; }

  function go(id) {
    clearForm();
    const n = NODES[id];
    say(typeof n.text === 'function' ? n.text() : n.text, 'bot');
    const o = typeof n.options === 'function' ? n.options() : n.options;
    opts.innerHTML = '';
    for (const [label, target] of o) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'opt'; b.textContent = label;
      b.addEventListener('click', () => choose(label, target));
      opts.appendChild(b);
    }
  }
  function choose(label, target) {
    say(label, 'me');
    if (target.startsWith('go:')) { AC.navigate(target.slice(3)); close(); return; }
    if (target.startsWith('form:')) return showForm(target.slice(5));
    go(target);
  }

  function showForm(kind) {
    opts.innerHTML = '';
    const isPw = kind === 'password';
    formBox.innerHTML = `
      <form class="a-form" autocomplete="off" novalidate>
        ${isPw
          ? '<label>Username<input name="who" autocomplete="username" autocapitalize="none" maxlength="20"></label>'
          : '<label>Display name<input name="who" autocomplete="off" maxlength="20"></label>'}
        <label>Recovery PIN (6 digits)<input name="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off"></label>
        ${isPw ? '<label>New password<input name="pw" type="password" autocomplete="new-password" maxlength="128"></label>' : ''}
        <p class="form-error" role="alert"></p>
        <div class="actions"><button class="btn primary" type="submit">${isPw ? 'Reset password' : 'Find username'}</button><button class="btn" type="button" data-cancel>Cancel</button></div>
      </form>`;
    const form = $('form', formBox);
    const err = $('.form-error', form);
    $('[data-cancel]', form).addEventListener('click', () => go(isPw ? 'forgot-password' : 'forgot-username'));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.textContent = '';
      const who = form.who.value.trim();
      const pin = form.pin.value.trim();
      const pw = isPw ? form.pw.value : null;
      if (!who || !/^\d{6}$/.test(pin)) { err.textContent = 'Fill in every field. The PIN is exactly 6 digits.'; return; }
      if (isPw && (!pw || pw.length < 8)) { err.textContent = 'The new password needs at least 8 characters.'; return; }
      form.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      const res = await AC.api(isPw ? '/recovery/password' : '/recovery/username', {
        method: 'POST', body: isPw ? { username: who, pin, newPassword: pw } : { displayName: who, pin },
      });
      form.pin.value = ''; if (isPw) form.pw.value = '';
      form.querySelectorAll('button').forEach((b) => { b.disabled = false; });
      if (!res.ok) {
        err.textContent = res.code === 'RATE_LIMITED' ? 'Too many attempts. Please wait a while before trying again.' : res.message;
        return;
      }
      clearForm();
      say('Details submitted securely.', 'me');
      if (isPw) {
        say('Your password has been reset and any logged-in devices were signed out. You can log in now.', 'bot');
        opts.innerHTML = '';
        const b = document.createElement('button'); b.className = 'opt'; b.type = 'button'; b.textContent = 'Go to log in';
        b.addEventListener('click', () => { AC.navigate('#/login'); close(); });
        opts.appendChild(b);
      } else {
        say('Your username is: ' + res.data.username, 'bot');
        go('root');
      }
    });
    $('input', form).focus();
  }

  function open() {
    panel.hidden = false;
    $('#assistant-toggle').setAttribute('aria-expanded', 'true');
    if (!log.childElementCount) go('root');
  }
  function close() {
    panel.hidden = true;
    clearForm();
    $('#assistant-toggle').setAttribute('aria-expanded', 'false');
  }

  function init() {
    const host = document.getElementById('assistant-root');
    host.innerHTML = `
      <button id="assistant-toggle" class="assistant-fab" type="button" aria-expanded="false" aria-controls="assistant-panel">Assistant</button>
      <section id="assistant-panel" class="assistant-panel" role="dialog" aria-label="Assistant" hidden>
        <header><b>Assistant</b><button type="button" class="icon-btn" id="assistant-close" aria-label="Close assistant">&times;</button></header>
        <div class="a-log" id="a-log" aria-live="polite"></div>
        <div class="a-form-box" id="a-form-box"></div>
        <div class="a-opts" id="a-opts"></div>
      </section>`;
    panel = $('#assistant-panel'); log = $('#a-log'); opts = $('#a-opts'); formBox = $('#a-form-box');
    $('#assistant-toggle').addEventListener('click', () => (panel.hidden ? open() : close()));
    $('#assistant-close').addEventListener('click', close);
  }
  AC.assistant = { init, open, close };
})();
