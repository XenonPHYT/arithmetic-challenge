/* Arithmetic Challenge - game engine and gameplay interface.
 * JavaScript owns: raw-number retrieval, candidate construction, exact-duplicate control, the retry loop,
 * the session timer display, the question queue and local recovery.
 * Python (python/difficulty_regulator.py) decides whether each candidate suits the difficulty.
 */
(function () {
  'use strict';
  const AC = typeof window !== 'undefined' ? (window.AC = window.AC || {}) : {};

  // ---------- Raw numerical dataset (integers only) ----------
  const RAW_NUMBERS = Object.freeze([
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
    20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39,
    40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59,
    60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79,
    80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99,
  ]);
  const OPS = ['add', 'sub', 'mul', 'div'];
  const SYMBOL = { add: '+', sub: '\u2212', mul: '\u00d7', div: '\u00f7' };
  const LEVELS = {
    easy:   { label: 'Easy',   count: 10, blurb: 'Small numbers, friendly sums, simple times tables.' },
    normal: { label: 'Normal', count: 15, blurb: 'Two-digit numbers, carrying and borrowing, bigger tables.' },
    hard:   { label: 'Hard',   count: 20, blurb: 'Large numbers, two-digit multipliers and divisors.' },
  };
  // Where JavaScript looks for raw numbers. These are pre-selection hints only: Python makes the final call.
  const HINTS = {
    easy:   { add: { a: [0, 30], b: [0, 20] },  sub: { a: [1, 30], b: [0, 20] },  mul: { a: [0, 9], b: [0, 9] },    div: { a: [0, 50], b: [1, 9] } },
    normal: { add: { a: [10, 99], b: [10, 99] }, sub: { a: [10, 99], b: [10, 99] }, mul: { a: [2, 12], b: [2, 12] },  div: { a: [20, 99], b: [2, 12] } },
    hard:   { add: { a: [30, 99], b: [30, 99] }, sub: { a: [30, 99], b: [30, 99] }, mul: { a: [10, 99], b: [2, 99] }, div: { a: [40, 99], b: [10, 99] } },
  };
  const MAX_ATTEMPTS = 120;

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const rawBetween = (lo, hi) => pick(RAW_NUMBERS.filter((n) => n >= lo && n <= hi));
  function shuffled(list) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function solveLocal(a, op, b) {
    if (op === 'add') return a + b;
    if (op === 'sub') return a - b;
    if (op === 'mul') return a * b;
    return a / b;
  }
  const exactKey = (c) => `${c.op}:${c.a}:${c.b}`;

  /** Build one candidate equation from raw numbers. Does not judge difficulty. */
  function buildCandidate(difficulty, op) {
    const h = HINTS[difficulty][op];
    let a;
    let b;
    if (op === 'div') {
      a = rawBetween(h.a[0], h.a[1]);
      const divisors = RAW_NUMBERS.filter((d) => d >= 1 && a % d === 0);
      const preferred = divisors.filter((d) => d >= h.b[0] && d <= h.b[1]);
      b = pick(preferred.length ? preferred : divisors);
    } else {
      a = rawBetween(h.a[0], h.a[1]);
      b = rawBetween(h.b[0], h.b[1]);
      if (op === 'sub' && b > a) [a, b] = [b, a];
    }
    return { a, op, b, answer: solveLocal(a, op, b) };
  }

  /** Produces approved questions one at a time. `evaluate(obj)` must resolve to the regulator's result object. */
  class QuestionFactory {
    constructor(difficulty, existing, evaluate) {
      this.difficulty = difficulty;
      this.evaluate = evaluate;
      this.recent = [];
      this.keys = new Set();
      for (const q of existing || []) this.remember(q);
      // Rebuild the operation rotation: operations already used in the current block of four are not offered again.
      const used = this.recent.slice(this.recent.length - (this.recent.length % 4)).map((r) => r.op);
      this.bag = shuffled(OPS.filter((o) => !used.includes(o)));
    }
    remember(q) {
      this.recent.push({ a: q.a, op: q.op, b: q.b, score: q.score });
      this.keys.add(exactKey(q));
    }
    nextOp() {
      if (!this.bag.length) this.bag = shuffled(OPS); // every operation appears in every block of four
      const tail = this.recent.slice(-2);
      const blocked = tail.length === 2 && tail[0].op === tail[1].op ? tail[0].op : null; // regulator forbids 3 in a row
      let i = this.bag.length - 1;
      if (this.bag[i] === blocked && this.bag.length > 1) i = this.bag.length - 2;
      return this.bag.splice(i, 1)[0];
    }
    async next() {
      const op = this.nextOp();
      let regulatorFailures = 0;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const c = buildCandidate(this.difficulty, op);
        if (this.keys.has(exactKey(c))) continue; // exact duplicates are JavaScript's job
        let res;
        try {
          res = await this.evaluate({ a: c.a, op: c.op, b: c.b, answer: c.answer, difficulty: this.difficulty, recent: this.recent });
        } catch (e) {
          if (++regulatorFailures >= 3) throw new Error('REGULATOR_UNAVAILABLE');
          continue;
        }
        if (res && res.reason === 'REGULATOR_ERROR') {
          if (++regulatorFailures >= 3) throw new Error('REGULATOR_UNAVAILABLE');
          continue;
        }
        const valid = res && res.approved === true && res.answer === c.answer && Number.isInteger(res.score) && res.difficulty === this.difficulty;
        if (!valid) continue; // rejected (or malformed): never accepted, try another candidate
        const q = { a: c.a, op: c.op, b: c.b, answer: c.answer, score: res.score };
        this.remember(q);
        return q;
      }
      throw new Error('QUESTION_PREP_FAILED');
    }
  }

  AC.engine = { RAW_NUMBERS, OPS, SYMBOL, LEVELS, HINTS, buildCandidate, QuestionFactory };
  if (typeof module !== 'undefined' && module.exports) module.exports = AC.engine;
  if (typeof window === 'undefined') return;

  // ---------- Regulator client (talks to the Pyodide Web Worker) ----------
  const version = () => (document.querySelector('meta[name="ac-version"]') || {}).content || '';
  const regulator = {
    worker: null, seq: 0, pending: new Map(), ready: null,
    start() {
      if (this.worker) return;
      this.worker = new Worker('js/regulator-worker.js?v=' + encodeURIComponent(version()));
      this.worker.onmessage = (e) => {
        const p = this.pending.get(e.data.id);
        if (!p) return;
        this.pending.delete(e.data.id);
        clearTimeout(p.timer);
        e.data.ok ? p.resolve(e.data) : p.reject(new Error(e.data.error || 'worker error'));
      };
      this.worker.onerror = () => this.fail(new Error('worker crashed'));
    },
    fail(err) {
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(err); }
      this.pending.clear();
      if (this.worker) this.worker.terminate();
      this.worker = null;
      this.ready = null;
    },
    send(msg, timeoutMs) {
      this.start();
      return new Promise((resolve, reject) => {
        const id = ++this.seq;
        const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('timeout')); }, timeoutMs);
        this.pending.set(id, { resolve, reject, timer });
        this.worker.postMessage({ id, ...msg });
      });
    },
    init() {
      if (!this.ready) this.ready = this.send({ cmd: 'init', version: version() }, 90000).catch((e) => { this.ready = null; throw e; });
      return this.ready;
    },
    async evaluate(obj) {
      await this.init();
      const out = await this.send({ cmd: 'evaluate', payload: JSON.stringify(obj) }, 8000);
      return JSON.parse(out.result);
    },
  };
  AC.regulator = regulator;

  // ---------- Local recovery storage (IndexedDB, falls back to memory) ----------
  const store = {
    mem: new Map(), db: null,
    open() {
      if (this.db) return this.db;
      this.db = new Promise((resolve) => {
        try {
          const req = indexedDB.open('arithmetic-challenge', 1);
          req.onupgradeneeded = () => req.result.createObjectStore('kv');
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } catch (e) { resolve(null); }
      });
      return this.db;
    },
    async get(key) {
      const db = await this.open();
      if (!db) return this.mem.get(key) || null;
      return new Promise((resolve) => {
        try { const r = db.transaction('kv').objectStore('kv').get(key); r.onsuccess = () => resolve(r.result || null); r.onerror = () => resolve(null); } catch (e) { resolve(null); }
      });
    },
    async set(key, value) {
      this.mem.set(key, value);
      const db = await this.open();
      if (!db) return;
      return new Promise((resolve) => {
        try { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(value, key); tx.oncomplete = tx.onerror = tx.onabort = () => resolve(); } catch (e) { resolve(); }
      });
    },
    async del(key) {
      this.mem.delete(key);
      const db = await this.open();
      if (!db) return;
      return new Promise((resolve) => {
        try { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').delete(key); tx.oncomplete = tx.onerror = tx.onabort = () => resolve(); } catch (e) { resolve(); }
      });
    },
  };

  // ---------- Gameplay interface ----------
  const G = { state: null, factory: null, fillPromise: null, timer: null, locked: false, retryTimer: null };
  const $ = (sel) => document.querySelector(sel);
  const root = () => document.getElementById('view-dynamic');
  const esc = (s) => AC.util.esc(s);
  const storeKey = () => 'game:' + AC.state.user.playerId;
  const persist = () => store.set(storeKey(), G.state);
  const clock = () => Date.now() + G.state.offset - G.state.startedAt;
  const question = (q) => `${q.a} ${SYMBOL[q.op]} ${q.b} = ?`;

  function stopTimers() { clearInterval(G.timer); G.timer = null; clearInterval(G.retryTimer); G.retryTimer = null; }
  function leave() { stopTimers(); }

  async function open() {
    stopTimers();
    if (!AC.state.user) { AC.toast('Please log in to play.'); AC.navigate('#/login'); return; }
    const saved = await store.get(storeKey());
    if (saved && saved.playerId === AC.state.user.playerId) {
      G.state = saved;
      G.factory = new QuestionFactory(saved.difficulty, saved.questions, (o) => regulator.evaluate(o));
      regulator.init().catch(() => {});
      if (saved.pending) return finish();
      return showGame();
    }
    G.state = null;
    showSelect();
  }
  AC.hasActiveGame = async () => {
    if (!AC.state.user) return false;
    const s = await store.get(storeKey());
    return !!(s && s.playerId === AC.state.user.playerId);
  };

  function showSelect(error) {
    root().innerHTML = `
      <section class="panel">
        <h1>Choose your challenge</h1>
        <p class="muted">Answer every question correctly to earn a place on the leaderboard. The clock starts when the first question appears.</p>
        ${error ? `<p class="form-error" role="alert">${esc(error)}</p>` : ''}
        <div class="level-grid">
          ${Object.entries(LEVELS).map(([id, l]) => `
            <button class="level-card level-${id}" data-level="${id}">
              <span class="level-name">${l.label}</span>
              <span class="level-count">${l.count} questions</span>
              <span class="level-blurb">${l.blurb}</span>
              <span class="level-go">Start &rarr;</span>
            </button>`).join('')}
        </div>
        <p class="muted small">All four operations are mixed into every level. Wrong answers can't be retried.</p>
      </section>`;
    root().querySelectorAll('[data-level]').forEach((btn) => btn.addEventListener('click', () => startGame(btn.dataset.level)));
    regulator.init().catch(() => {}); // warm up while the player reads
  }

  async function startGame(difficulty) {
    root().innerHTML = `<section class="panel center"><div class="spinner" aria-hidden="true"></div><h2>Getting your questions ready…</h2><p class="muted" id="prep-note">The first game on this device takes a few seconds while the math engine loads.</p></section>`;
    try {
      const factory = new QuestionFactory(difficulty, [], (o) => regulator.evaluate(o));
      const first = await factory.next();
      const res = await AC.api('/game/start', { method: 'POST', body: { difficulty } });
      if (!res.ok) {
        if (res.status === 401) { AC.sessionLost(res.code); return; }
        return showSelect(res.message);
      }
      G.factory = factory;
      G.state = {
        v: 1, playerId: AC.state.user.playerId, token: res.data.token, difficulty, total: res.data.total,
        startedAt: res.data.startedAt, offset: res.data.serverNow - Date.now(), questions: [first], answers: [], pending: false,
      };
      await persist();
      showGame();
    } catch (e) {
      showSelect('We could not prepare your questions. Please check your connection and try again.');
    }
  }

  function showGame() {
    const s = G.state;
    root().innerHTML = `
      <section class="panel game" aria-label="Game in progress">
        <div class="game-top">
          <span class="chip chip-${s.difficulty}">${LEVELS[s.difficulty].label}</span>
          <span class="progress">Question <b id="g-num">1</b> of ${s.total}</span>
          <span class="timer" id="g-time" aria-label="Elapsed time">0:00.0</span>
        </div>
        <div class="bar" aria-hidden="true"><i id="g-bar"></i></div>
        <div class="q-stage"><div class="q" id="g-q" aria-live="polite"></div></div>
        <form id="g-form" class="answer-form" autocomplete="off" novalidate>
          <input id="g-in" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" autocorrect="off" spellcheck="false" aria-label="Your answer" placeholder="Answer">
          <button class="btn primary" type="submit" id="g-submit">Submit</button>
        </form>
        <p class="feedback" id="g-fb" aria-live="assertive"></p>
        <button class="link-btn" id="g-quit" type="button">Quit this game</button>
      </section>`;
    $('#g-form').addEventListener('submit', (e) => { e.preventDefault(); submitAnswer(); });
    $('#g-quit').addEventListener('click', quitGame);
    clearInterval(G.timer);
    const tick = () => { const el = $('#g-time'); if (el) el.textContent = AC.util.fmtTime(Math.max(0, clock())); };
    tick();
    G.timer = setInterval(tick, 100);
    G.locked = false;
    ensureQueue();
    showCurrent(false);
  }

  function ensureQueue() {
    if (G.fillPromise) return G.fillPromise;
    const s = G.state;
    const p = (async () => {
      try {
        while (s.questions.length < Math.min(s.total, s.answers.length + 3)) {
          const q = await G.factory.next();
          s.questions.push(q);
          await persist();
        }
        G.fillError = null;
      } catch (e) { G.fillError = e; console.error('question preparation failed:', e && e.message); }
    })();
    G.fillPromise = p;
    // Clear the flag only after the promise is stored (the body can finish synchronously when nothing is needed).
    p.then(() => { if (G.fillPromise === p) G.fillPromise = null; });
    return p;
  }

  async function showCurrent(animate) {
    const s = G.state;
    const idx = s.answers.length;
    const qEl = $('#g-q');
    if (!qEl) return;
    $('#g-num').textContent = idx + 1;
    $('#g-bar').style.width = Math.round((idx / s.total) * 100) + '%';
    $('#g-fb').textContent = '';
    $('#g-fb').className = 'feedback';
    if (!s.questions[idx]) {
      qEl.textContent = 'Preparing next question…';
      qEl.classList.add('waiting');
      await ensureQueue();
      if (!s.questions[idx]) {
        $('#g-fb').innerHTML = 'We could not prepare the next question. <button class="link-btn" id="g-retry" type="button">Try again</button>';
        $('#g-retry').addEventListener('click', () => showCurrent(false));
        return;
      }
    }
    qEl.classList.remove('waiting');
    qEl.textContent = question(s.questions[idx]);
    qEl.classList.remove('enter'); void qEl.offsetWidth; if (animate) qEl.classList.add('enter');
    const input = $('#g-in');
    input.value = '';
    input.disabled = false;
    $('#g-submit').disabled = false;
    G.locked = false;
    input.focus();
    ensureQueue();
  }

  function submitAnswer() {
    if (G.locked) return;
    const s = G.state;
    const input = $('#g-in');
    const raw = input.value.trim();
    if (!/^\d{1,6}$/.test(raw)) {
      $('#g-fb').textContent = 'Enter your answer as a whole number.';
      $('#g-fb').className = 'feedback bad';
      input.focus();
      return;
    }
    const q = s.questions[s.answers.length];
    if (!q) return;
    G.locked = true;
    input.disabled = true;
    $('#g-submit').disabled = true;
    const value = Number(raw);
    s.answers.push(value);
    persist();
    const right = value === q.answer;
    const fb = $('#g-fb');
    fb.className = 'feedback ' + (right ? 'good' : 'bad');
    fb.textContent = right ? 'Correct!' : `Not quite \u2014 the answer was ${q.answer}.`;
    $('#g-bar').style.width = Math.round((s.answers.length / s.total) * 100) + '%';
    ensureQueue();
    setTimeout(() => {
      if (!$('#g-q')) return; // player navigated away; state is saved
      if (s.answers.length >= s.total) finish(); else showCurrent(true);
    }, right ? 600 : 1100);
  }

  async function quitGame() {
    if (!confirm('Quit this game? Your progress will be discarded.')) return;
    stopTimers();
    await store.del(storeKey());
    G.state = null;
    showSelect();
  }

  // ---------- Finish, verification and results ----------
  async function finish() {
    stopTimers();
    const s = G.state;
    s.pending = true;
    await persist();
    root().innerHTML = `<section class="panel center"><div class="spinner" aria-hidden="true"></div><h2>Verifying your result…</h2></section>`;
    const res = await AC.api('/game/finish', {
      method: 'POST',
      body: { token: s.token, questions: s.questions.slice(0, s.total).map((q) => [q.a, q.op, q.b]), answers: s.answers },
    });
    if (res.ok) {
      await store.del(storeKey());
      G.state = null;
      return showResults(res.data, s);
    }
    if (res.status === 401) return showPending('You were signed out. Log in again on this device to submit your finished game.', true);
    if (res.status === 409) {
      await store.del(storeKey());
      G.state = null;
      return showResults(null, s, 'This game was replaced or expired before it could be verified, so it was not recorded.');
    }
    if (res.status === 400) {
      await store.del(storeKey());
      G.state = null;
      return showResults(null, s, 'This game could not be verified, so it was not recorded.');
    }
    showPending('We could not reach the server. Your finished game is saved on this device and will be submitted automatically.', false);
  }

  function showPending(message, needsLogin) {
    root().innerHTML = `
      <section class="panel center">
        <h2>Result saved</h2>
        <p>${esc(message)}</p>
        ${needsLogin ? '<a class="btn primary" href="#/login">Log in</a>' : '<button class="btn primary" id="retry-submit">Try again now</button>'}
      </section>`;
    const btn = $('#retry-submit');
    if (btn) btn.addEventListener('click', finish);
    if (!needsLogin) {
      let tries = 0;
      G.retryTimer = setInterval(() => { if (navigator.onLine && ++tries <= 8) finish(); else if (tries > 8) clearInterval(G.retryTimer); }, 15000);
    }
  }

  function showResults(server, s, note) {
    const total = s.total;
    const localCorrect = s.answers.filter((v, i) => s.questions[i] && v === s.questions[i].answer).length;
    const correct = server ? server.correct : localCorrect;
    const perfect = server ? server.perfect : false;
    const elapsed = server ? AC.util.fmtTime(server.elapsedMs) : null;
    let headline = 'Good effort!';
    let detail = `You answered ${correct} of ${total} correctly. Only perfect runs are recorded on the leaderboard.`;
    if (perfect && server.recorded) { headline = 'Perfect run!'; detail = `Every answer was correct. Your time of ${elapsed} was recorded.`; }
    else if (server && server.rejected === 'TOO_FAST') { headline = 'Not recorded'; detail = 'That run was faster than a person can answer, so it was not recorded.'; }
    else if (perfect) { headline = 'Perfect run!'; detail = 'Every answer was correct.'; }
    const review = s.questions.slice(0, total).map((q, i) => {
      const ok = s.answers[i] === q.answer;
      return `<li class="${ok ? 'good' : 'bad'}"><span>${esc(question(q).replace('?', q.answer))}</span><span>${ok ? '\u2713' : 'You said ' + esc(s.answers[i])}</span></li>`;
    }).join('');
    root().innerHTML = `
      <section class="panel results ${perfect ? 'perfect' : ''}">
        <div class="result-badge" aria-hidden="true">${perfect ? '\u2605' : correct + '/' + total}</div>
        <h1>${headline}</h1>
        <p>${esc(detail)}</p>
        ${note ? `<p class="form-error" role="alert">${esc(note)}</p>` : ''}
        <dl class="result-stats">
          <div><dt>Level</dt><dd>${LEVELS[s.difficulty].label}</dd></div>
          <div><dt>Correct</dt><dd>${correct} / ${total}</dd></div>
          ${elapsed ? `<div><dt>Time</dt><dd>${elapsed}</dd></div>` : ''}
        </dl>
        <div class="actions">
          <button class="btn primary" id="again">Play again</button>
          <a class="btn" href="#/leaderboard">Leaderboard</a>
        </div>
        <details><summary>Review your answers</summary><ul class="review">${review}</ul></details>
      </section>`;
    $('#again').addEventListener('click', showSelect);
  }

  AC.game = { open, leave, warmUp: () => regulator.init().catch(() => {}) };
})();
