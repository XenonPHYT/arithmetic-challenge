/* Arithmetic Challenge - Learn section.
 * Short lessons plus story practice. Nothing here is saved or sent to the server.
 * Every step of a story is a normal two-number question that goes through the same
 * Python regulator as the real game (mode "learn"), so numbers stay clean and on level.
 * Falls back to simple local checks if the regulator cannot load. */
(function () {
  'use strict';
  const AC = typeof window !== 'undefined' ? (window.AC = window.AC || {}) : {};

  const LEVELS = ['easy', 'normal', 'hard'];
  const LEVEL_LABEL = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };
  const SYM = { add: '+', sub: '\u2212', mul: '\u00d7', div: '\u00f7' };
  const GUIDED_STORIES = 3;
  const CHALLENGE_STORIES = 3;
  const MAX_ATTEMPTS = 120;

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const range = (lo, hi) => { const out = []; for (let i = lo; i <= hi; i++) out.push(i); return out; };
  function shuffled(list) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  const solveLocal = (a, op, b) => (op === 'add' ? a + b : op === 'sub' ? a - b : op === 'mul' ? a * b : a / b);
  const eq = (s) => `${s.a} ${SYM[s.op]} ${s.b} = ${s.answer}`;

  // ---------- Lessons ----------
  const LESSONS = {
    add: {
      op: 'add', focus: 'carry', symbol: '+', title: 'Addition',
      blurb: 'Putting amounts together, with and without carrying.',
      tip: 'Add the ones first. If they make 10 or more, write the ones digit and carry 1 to the tens.',
      teach: `
        <h2>What addition does</h2>
        <p>Addition puts amounts together. Words like <b>in all</b>, <b>altogether</b>, <b>total</b> and <b>more</b> usually mean add.</p>
        <h2>Add the ones, then the tens</h2>
        <div class="example"><b>23 + 14</b><br>Ones: 3 + 4 = 7<br>Tens: 2 + 1 = 3<br>Answer: <b>37</b></div>
        <h2>Carrying</h2>
        <p>When the ones add up to 10 or more, write the ones digit and carry 1 over to the tens.</p>
        <div class="example"><b>47 + 38</b><br>Ones: 7 + 8 = 15 (write 5, carry 1)<br>Tens: 4 + 3 + 1 = 8<br>Answer: <b>85</b></div>
        <h2>Two shortcuts</h2>
        <div class="example"><b>Make a ten:</b> 8 + 7 = 8 + 2 + 5 = 10 + 5 = 15</div>
        <div class="example"><b>Add the tens first:</b> 47 + 38 = 47 + 30 + 8 = 77 + 8 = 85</div>
        <p>The order does not matter: 38 + 47 gives the same answer as 47 + 38.</p>`,
    },
    sub: {
      op: 'sub', focus: 'borrow', symbol: '\u2212', title: 'Subtraction',
      blurb: 'Taking away, finding what is left, and borrowing.',
      tip: 'Subtract the ones first. If the top ones digit is smaller, borrow 10 from the tens.',
      teach: `
        <h2>What subtraction does</h2>
        <p>Subtraction takes an amount away or finds the difference. Words like <b>left</b>, <b>remain</b>, <b>change</b>, <b>fewer</b> and <b>how many more</b> usually mean subtract.</p>
        <h2>Subtract the ones, then the tens</h2>
        <div class="example"><b>68 \u2212 25</b><br>Ones: 8 \u2212 5 = 3<br>Tens: 6 \u2212 2 = 4<br>Answer: <b>43</b></div>
        <h2>Borrowing</h2>
        <p>When the top ones digit is smaller than the bottom one, borrow 10 from the tens.</p>
        <div class="example"><b>52 \u2212 27</b><br>Ones: 2 is smaller than 7, so borrow: 12 \u2212 7 = 5<br>Tens: 5 became 4, so 4 \u2212 2 = 2<br>Answer: <b>25</b></div>
        <h2>Two shortcuts</h2>
        <div class="example"><b>Count up:</b> for 52 \u2212 27, start at 27. Add 3 to reach 30, then 22 to reach 52. 3 + 22 = <b>25</b></div>
        <div class="example"><b>Check by adding:</b> 25 + 27 = 52, so the answer is right.</div>
        <p>Unlike addition, order matters: 52 \u2212 27 is not the same as 27 \u2212 52.</p>`,
    },
    mul: {
      op: 'mul', focus: 'tables', noFocusAt: ['hard'], symbol: '\u00d7', title: 'Multiplication',
      blurb: 'Equal groups and times tables.',
      tip: 'Think of equal groups, or break one number apart: 12 \u00d7 4 = (10 \u00d7 4) + (2 \u00d7 4).',
      teach: `
        <h2>What multiplication does</h2>
        <p>Multiplication is a fast way to add equal groups. Words like <b>each</b>, <b>every</b>, <b>rows of</b> and <b>times</b> usually mean multiply.</p>
        <div class="example"><b>4 \u00d7 6</b> means 4 groups of 6<br>6 + 6 + 6 + 6 = <b>24</b></div>
        <h2>Times table tricks</h2>
        <div class="example"><b>\u00d7 10:</b> put a zero at the end. 7 \u00d7 10 = 70</div>
        <div class="example"><b>\u00d7 5:</b> take half of \u00d7 10. 6 \u00d7 5 is half of 60 = 30</div>
        <div class="example"><b>\u00d7 9:</b> take \u00d7 10 and subtract one group. 7 \u00d7 9 = 70 \u2212 7 = 63</div>
        <h2>Break a number apart</h2>
        <div class="example"><b>12 \u00d7 4</b><br>(10 \u00d7 4) + (2 \u00d7 4) = 40 + 8 = <b>48</b></div>
        <p>Order does not matter: 4 \u00d7 6 gives the same answer as 6 \u00d7 4.</p>`,
    },
    div: {
      op: 'div', focus: 'division_facts', noFocusAt: ['hard'], symbol: '\u00f7', title: 'Division',
      blurb: 'Sharing equally and grouping.',
      tip: 'Ask: what number times the divisor makes this number? Use the times table backward.',
      teach: `
        <h2>What division does</h2>
        <p>Division shares an amount equally or finds how many groups fit. Words like <b>shared equally</b>, <b>each</b>, <b>per</b> and <b>how many groups</b> usually mean divide.</p>
        <div class="example"><b>24 \u00f7 6</b><br>Share 24 equally among 6 groups: each group gets <b>4</b></div>
        <h2>Division is multiplication backward</h2>
        <p>Every multiplication fact has division facts that go with it.</p>
        <div class="example"><b>6 \u00d7 4 = 24</b><br>so 24 \u00f7 6 = 4 and 24 \u00f7 4 = 6</div>
        <h2>Finding the answer</h2>
        <div class="example"><b>56 \u00f7 7</b><br>Ask: 7 times what is 56? 7 \u00d7 8 = 56, so the answer is <b>8</b></div>
        <h2>Check by multiplying</h2>
        <div class="example">8 \u00d7 7 = 56, so 56 \u00f7 7 = 8 is right.</div>
        <p>In this game every division comes out exactly, with nothing left over. You cannot divide by 0.</p>`,
    },
  };

  // ---------- Story templates ----------
  // chain: operations in order (1 or 2 steps). link: where step 1's answer goes in step 2.
  // v.a, v.b are step 1's numbers; v.c is step 2's extra number. Wording is tied to the operation.
  const TEMPLATES = [
    { id: 'marbles', chain: ['add'],
      story: (v) => `You have ${v.a} marbles and win ${v.b} more. How many marbles do you have now?`,
      prompts: [() => 'How many marbles do you have in all?'] },
    { id: 'pandesal', chain: ['add'],
      story: (v) => `Aling Rosa sold ${v.a} pan de sal in the morning and ${v.b} in the afternoon. How many did she sell in all?`,
      prompts: [() => 'How many pan de sal did she sell in all?'] },
    { id: 'jeep-trips', chain: ['add'],
      story: (v) => `A jeepney carried ${v.a} passengers on its first trip and ${v.b} on its second trip. How many passengers did it carry in total?`,
      prompts: [() => 'How many passengers did it carry in total?'] },
    { id: 'stickers', chain: ['add', 'sub'], link: 'first',
      story: (v) => `Mia had ${v.a} stickers. A friend gave her ${v.b} more. Then she gave ${v.c} to her sister. How many stickers does Mia have left?`,
      prompts: [() => 'First, how many stickers does Mia have after her friend\u2019s gift?', () => 'Then, how many are left after she gives some to her sister?'] },
    { id: 'store', chain: ['add', 'add'], link: 'first',
      story: (v) => `At the sari-sari store you buy rice for ${v.a} pesos and eggs for ${v.b} pesos. You also buy a drink for ${v.c} pesos. How many pesos do you spend in all?`,
      prompts: [() => 'First, how much do the rice and eggs cost together?', () => 'Then add the drink. How much is the total?'] },
    { id: 'pencils', chain: ['mul', 'add'], link: 'first',
      story: (v) => `A box holds ${v.a} pencils. You buy ${v.b} boxes and you already have ${v.c} pencils. How many pencils do you have altogether?`,
      prompts: [() => 'First, how many pencils are in the boxes you bought?', () => 'Then add the pencils you already have. How many altogether?'] },
    { id: 'jeep-stops', chain: ['sub', 'add'], link: 'first',
      story: (v) => `A jeepney has ${v.a} passengers. ${v.b} get off at the market, then ${v.c} more get on. How many passengers are on the jeepney now?`,
      prompts: [() => 'First, how many passengers are left after some get off?', () => 'Then add the new passengers. How many are on the jeepney now?'] },
    // subtraction
    { id: 'canteen', chain: ['sub'],
      story: (v) => `You have ${v.a} pesos and spend ${v.b} pesos at the canteen. How many pesos are left?`,
      prompts: [() => 'How many pesos are left?'] },
    { id: 'seats', chain: ['sub'],
      story: (v) => `A bus has ${v.a} seats and ${v.b} of them are taken. How many seats are free?`,
      prompts: [() => 'How many seats are free?'] },
    { id: 'mangoes', chain: ['sub'],
      story: (v) => `Aling Nena had ${v.a} mangoes and sold ${v.b} of them. How many mangoes does she have left?`,
      prompts: [() => 'How many mangoes are left?'] },
    { id: 'pan-gift', chain: ['sub', 'sub'], link: 'first',
      story: (v) => `Lola baked ${v.a} pan de sal. She gave away ${v.b}, then sold ${v.c}. How many pan de sal are left?`,
      prompts: [() => 'First, how many are left after she gives some away?', () => 'Then take away the ones she sold. How many are left?'] },
    { id: 'notebooks', chain: ['mul', 'sub'], link: 'second',
      story: (v) => `You buy ${v.a} notebooks at ${v.b} pesos each and pay with ${v.c} pesos. How much change do you get?`,
      prompts: [() => 'First, how much do the notebooks cost in all?', () => 'Then subtract the cost from what you paid. How much is the change?'] },
    // multiplication
    { id: 'trays', chain: ['mul'],
      story: (v) => `A tray holds ${v.a} pan de sal. How many pan de sal are on ${v.b} trays?`,
      prompts: [() => 'How many pan de sal in all?'] },
    { id: 'chairs', chain: ['mul'],
      story: (v) => `The hall has ${v.a} rows of chairs with ${v.b} chairs in each row. How many chairs are there?`,
      prompts: [() => 'How many chairs are there?'] },
    { id: 'rides', chain: ['mul'],
      story: (v) => `Each jeepney ride costs ${v.a} pesos. How many pesos do ${v.b} rides cost?`,
      prompts: [() => 'How many pesos do the rides cost?'] },
    { id: 'bundles', chain: ['mul', 'mul'], link: 'first',
      story: (v) => `A box holds ${v.a} pencils and a bundle has ${v.b} boxes. You buy ${v.c} bundles. How many pencils do you get?`,
      prompts: [() => 'First, how many pencils are in one bundle?', () => 'Then multiply by the number of bundles. How many pencils in all?'] },
    // division
    { id: 'share-pencils', chain: ['div'],
      story: (v) => `${v.a} pencils are shared equally among ${v.b} students. How many pencils does each student get?`,
      prompts: [() => 'How many pencils does each student get?'] },
    { id: 'mango-bags', chain: ['div'],
      story: (v) => `${v.a} mangoes are packed ${v.b} to a bag. How many bags can be filled?`,
      prompts: [() => 'How many bags can be filled?'] },
    { id: 'ribbon', chain: ['div'],
      story: (v) => `A ribbon ${v.a} cm long is cut into equal pieces that are ${v.b} cm long. How many pieces are there?`,
      prompts: [() => 'How many pieces are there?'] },
    { id: 'cupcakes', chain: ['mul', 'div'], link: 'first',
      story: (v) => `Ana bakes ${v.b} trays of ${v.a} cupcakes. She shares them equally among ${v.c} friends. How many cupcakes does each friend get?`,
      prompts: [() => 'First, how many cupcakes does she bake in all?', () => 'Then share them equally. How many does each friend get?'] },
    { id: 'marble-share', chain: ['add', 'div'], link: 'first',
      story: (v) => `Tomas has ${v.a} marbles and wins ${v.b} more. He shares all of them equally among ${v.c} friends. How many marbles does each friend get?`,
      prompts: [() => 'First, how many marbles does Tomas have now?', () => 'Then share them equally. How many does each friend get?'] },
    { id: 'bag-count', chain: ['div', 'add'], link: 'first',
      story: (v) => `${v.a} pan de sal are packed ${v.b} to a bag. You already have ${v.c} bags. How many bags do you have in all?`,
      prompts: [() => 'First, how many bags can be filled?', () => 'Then add the bags you already have. How many bags in all?'] },
  ];

  /** The lesson's skill focus applies only to its own operation, and not on levels listed in noFocusAt. */
  function focusFor(lesson, op, level) {
    return op === lesson.op && lesson.focus && !(lesson.noFocusAt || []).includes(level) ? lesson.focus : null;
  }

  /** Numbers allowed for the extra operand of step 2, given step 1's answer. */
  function extraChoices(op, link, r1) {
    if (op === 'add') return r1 < 99 ? range(1, 99 - r1) : [];
    if (op === 'sub') return link === 'first' ? (r1 > 1 ? range(1, r1 - 1) : []) : (r1 < 99 ? range(r1 + 1, 99) : []);
    if (op === 'mul') return r1 >= 2 ? range(2, Math.min(12, Math.floor(99 / r1))) : [];
    return range(2, 12).filter((d) => r1 % d === 0 && r1 / d > 1); // div, step 1's answer is the dividend
  }

  // ---------- Local fallback when the regulator is unavailable ----------
  function localEvaluate(c) {
    const { a, op, b, answer, recent } = c;
    const ok = Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b >= 0 && a <= 99 && b <= 99;
    const bad = (reason) => ({ approved: false, reason });
    if (!ok) return bad('OPERAND_OUT_OF_RANGE');
    if (op === 'sub' && a < b) return bad('NEGATIVE_RESULT');
    if (op === 'div' && (b === 0 || a % b !== 0)) return bad('NOT_WHOLE_DIVISION');
    if (solveLocal(a, op, b) !== answer) return bad('WRONG_ANSWER');
    const trivial = op === 'add' ? (a === 0 || b === 0) : op === 'sub' ? (b === 0 || answer === 0)
      : op === 'mul' ? (a <= 1 || b <= 1) : (a === 0 || b === 1 || answer === 1);
    if (trivial) return bad('TRIVIAL_QUESTION');
    if (c.focus === 'carry' && !(a % 10 + b % 10 >= 10 || (Math.floor(a / 10) % 10) + (Math.floor(b / 10) % 10) >= 10)) return bad('FOCUS_MISMATCH');
    if (c.focus === 'borrow' && !(a % 10 < b % 10)) return bad('FOCUS_MISMATCH');
    if (c.focus === 'tables' && !(a >= 2 && a <= 12 && b >= 2 && b <= 12)) return bad('FOCUS_MISMATCH');
    if (c.focus === 'division_facts' && !(b >= 2 && b <= 12)) return bad('FOCUS_MISMATCH');
    if ((recent || []).some((r) => r.op === op && ((r.a === a && r.b === b) || (op !== 'sub' && op !== 'div' && r.a === b && r.b === a)))) return bad('REPEATED_QUESTION');
    return { approved: true, reason: 'OK', score: 0, answer };
  }

  // ---------- Story generation ----------
  /**
   * deps: { engine, evaluate } - engine.buildCandidate(level, op) and evaluate(obj) -> regulator result.
   * state: { recent: [], usedIds: [], offline: false }
   */
  function createGenerator(deps) {
    async function check(state, cand, level, focus) {
      const payload = { a: cand.a, op: cand.op, b: cand.b, answer: cand.answer, difficulty: level, mode: 'learn', recent: state.recent.slice(-8) };
      if (focus) payload.focus = focus;
      if (!state.offline) {
        try { return await deps.evaluate(payload); } catch (e) { state.offline = true; }
      }
      return localEvaluate(payload);
    }

    async function attempt(lesson, template, level, state) {
      const op1 = template.chain[0];
      const c1 = deps.engine.buildCandidate(level, op1);
      const r1 = await check(state, c1, level, focusFor(lesson, op1, level));
      if (!r1.approved) return null;
      const steps = [{ op: op1, a: c1.a, b: c1.b, answer: c1.answer, score: r1.score || 0 }];
      const v = { a: c1.a, b: c1.b };
      if (template.chain.length === 2) {
        const op2 = template.chain[1];
        const options = extraChoices(op2, template.link, c1.answer);
        if (!options.length) return null;
        // Prefer an extra number sized for the level (the same ranges the real game starts from).
        const hint = deps.engine.HINTS && deps.engine.HINTS[level] && deps.engine.HINTS[level][op2];
        const span = hint ? (template.link === 'first' ? hint.b : hint.a) : null;
        const near = span ? options.filter((n) => n >= span[0] && n <= span[1]) : [];
        const c = pick(near.length ? near : options);
        const [a2, b2] = template.link === 'first' ? [c1.answer, c] : [c, c1.answer];
        const c2 = { a: a2, op: op2, b: b2, answer: solveLocal(a2, op2, b2) };
        const r2 = await check(state, c2, level, focusFor(lesson, op2, level));
        if (!r2.approved) return null;
        steps.push({ op: op2, a: a2, b: b2, answer: c2.answer, score: r2.score || 0 });
        v.c = c;
      }
      steps.forEach((s, i) => { s.prompt = template.prompts[i](v); });
      return { id: template.id, level, text: template.story(v), steps, answer: steps[steps.length - 1].answer };
    }

    /** Tries the given templates at one level; a template that keeps failing there is dropped. */
    async function tryTemplates(lesson, list, level, state) {
      let live = shuffled(list);
      const fails = new Map();
      for (let i = 0; i < MAX_ATTEMPTS && live.length; i++) {
        const t = pick(live);
        const story = await attempt(lesson, t, level, state);
        if (story) return story;
        const n = (fails.get(t.id) || 0) + 1;
        fails.set(t.id, n);
        if (n >= 30 && live.length > 1) live = live.filter((x) => x !== t);
      }
      return null;
    }

    /** Returns a story for the lesson at, or as near as possible to, the requested level. Throws if none can be built. */
    async function makeStory(lesson, level, state) {
      const pool = TEMPLATES.filter((t) => t.chain.includes(lesson.op));
      let fresh = pool.filter((t) => !state.usedIds.includes(t.id));
      if (!fresh.length) { state.usedIds.length = 0; fresh = pool; }
      const dist = (l) => Math.abs(LEVELS.indexOf(l) - LEVELS.indexOf(level));
      const tries = LEVELS.slice().sort((x, y) => dist(x) - dist(y));
      const lists = fresh.length === pool.length ? [fresh] : [fresh, pool];
      for (const list of lists) {
        for (const lv of tries) {
          const story = await tryTemplates(lesson, list, lv, state);
          if (story) {
            state.usedIds.push(story.id);
            story.steps.forEach((x) => state.recent.push({ a: x.a, op: x.op, b: x.b, score: x.score }));
            if (state.recent.length > 12) state.recent.splice(0, state.recent.length - 12);
            return story;
          }
        }
      }
      throw new Error('STORY_FAILED');
    }
    return { makeStory };
  }

  /** Moves the practice level up after two perfect stories in a row, down after two misses. */
  function adapt(session, perfect) {
    const i = LEVELS.indexOf(session.level);
    if (perfect) {
      session.streak++; session.misses = 0;
      if (session.streak >= 2 && i < LEVELS.length - 1) { session.level = LEVELS[i + 1]; session.streak = 0; }
    } else {
      session.streak = 0; session.misses++;
      if (session.misses >= 2 && i > 0) { session.level = LEVELS[i - 1]; session.misses = 0; }
    }
  }

  const api = { LESSONS, TEMPLATES, createGenerator, localEvaluate, adapt, extraChoices, focusFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window === 'undefined') return;

  // ---------- Page ----------
  let token = 0; // bumps whenever the page changes, so late async work is ignored
  let session = null;
  const root = () => document.getElementById('view-dynamic');
  const mount = (html) => AC.web.mount(html);
  const $ = (sel) => root().querySelector(sel);
  const alive = (t) => t === token;

  const generator = createGenerator({
    get engine() { return AC.engine; },
    evaluate: (o) => AC.regulator.evaluate(o),
  });

  function renderList() {
    const cards = Object.keys(LESSONS).map((id) => {
      const l = LESSONS[id];
      return l.soon
        ? `<div class="level-card lesson-card soon" aria-disabled="true"><span class="lesson-sym">${l.symbol}</span><span class="level-name">${esc(l.title)}</span><span class="level-blurb">${esc(l.blurb)}</span><span class="level-count">Coming soon</span></div>`
        : `<a class="level-card lesson-card" href="#/learn/${id}"><span class="lesson-sym">${l.symbol}</span><span class="level-name">${esc(l.title)}</span><span class="level-blurb">${esc(l.blurb)}</span><span class="level-go">Start learning \u2192</span></a>`;
    }).join('');
    mount(`
      <section class="panel learn">
        <h1>Learn</h1>
        <p class="muted">Short lessons on the four operations, then story practice. Practice here is not timed and is never saved to the leaderboard.</p>
        <div class="level-grid">${cards}</div>
        <p class="muted small">Ready for the real thing? <a href="#/play">Take on a challenge</a>.</p>
      </section>`);
  }

  function renderTeach(lesson) {
    mount(`
      <section class="panel learn teach">
        <p class="small"><a href="#/learn">\u2190 All lessons</a></p>
        <h1>${esc(lesson.title)}</h1>
        ${lesson.teach}
        <div class="actions"><button class="btn primary big" id="l-start">Start guided practice</button></div>
      </section>`);
    $('#l-start').addEventListener('click', () => startPractice(lesson, 'guided'));
  }

  function loading(msg) {
    mount(`<section class="panel center learn"><div class="spinner" aria-hidden="true"></div><h2>${esc(msg)}</h2><p class="muted" id="l-note">The first time on this device takes a few seconds while the math engine loads.</p></section>`);
  }

  function failure(lesson) {
    mount(`
      <section class="panel center learn">
        <h2>We could not prepare a story</h2>
        <p class="muted">Please check your connection and try again.</p>
        <div class="actions"><button class="btn primary" id="l-retry">Try again</button><a class="btn" href="#/learn">Back to lessons</a></div>
      </section>`);
    $('#l-retry').addEventListener('click', () => startPractice(lesson, session ? session.stage : 'guided'));
  }

  async function startPractice(lesson, stage) {
    const my = ++token;
    if (AC.game && AC.game.warmUp) AC.game.warmUp();
    session = { lesson, stage, level: (session && session.lesson === lesson && session.level) || 'easy', streak: 0, misses: 0, state: { recent: [], usedIds: [], offline: false }, index: 0, perfect: 0, total: stage === 'guided' ? GUIDED_STORIES : CHALLENGE_STORIES };
    nextStory(my);
  }

  async function nextStory(my) {
    const s = session;
    loading('Getting your story ready\u2026');
    let story;
    try { story = await generator.makeStory(s.lesson, s.level, s.state); } catch (e) { if (alive(my)) failure(s.lesson); return; }
    if (!alive(my)) return;
    s.story = story; s.stepIndex = 0; s.mistakes = 0; s.worked = [];
    s.stage === 'guided' ? renderGuided() : renderChallenge();
  }

  const header = (s) => {
    const lv = (s.story && s.story.level) || s.level;
    return `
    <div class="game-top">
      <span class="chip ${lv === 'hard' ? 'chip-hard' : ''}">${s.stage === 'guided' ? 'Guided' : 'Challenge'} \u00b7 ${LEVEL_LABEL[lv]}</span>
      <span class="progress">Story ${s.index + 1} of ${s.total}</span>
    </div>
    <div class="bar" aria-hidden="true"><i style="width:${Math.round((s.index / s.total) * 100)}%"></i></div>`;
  };

  function answerForm(label) {
    return `
      <form class="answer-form" id="l-form" novalidate>
        <input id="l-answer" inputmode="numeric" autocomplete="off" aria-label="${esc(label)}" maxlength="5">
        <button class="btn primary" type="submit">Check</button>
      </form>
      <p class="feedback" id="l-fb" role="status" aria-live="polite"></p>`;
  }

  const parseAnswer = (raw) => (/^-?\d{1,5}$/.test(raw.trim()) ? Number(raw.trim()) : null);

  function renderGuided() {
    const s = session; const st = s.story; const step = st.steps[s.stepIndex];
    const worked = s.worked.map((w) => `<li class="good">${esc(w)}</li>`).join('');
    mount(`
      <section class="panel learn game">
        ${header(s)}
        <p class="story">${esc(st.text)}</p>
        ${worked ? `<ul class="review worked">${worked}</ul>` : ''}
        <p class="step-prompt">Step ${s.stepIndex + 1} of ${st.steps.length}: ${esc(step.prompt)}</p>
        ${answerForm('Your answer')}
      </section>`);
    const input = $('#l-answer'); input.focus();
    $('#l-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const fb = $('#l-fb');
      const n = parseAnswer(input.value);
      if (n === null) { fb.className = 'feedback bad'; fb.textContent = 'Type a whole number.'; return; }
      if (n === step.answer) {
        s.worked.push(eq(step) + ' \u2713');
        if (s.stepIndex + 1 < st.steps.length) { s.stepIndex++; renderGuided(); return; }
        finishStory(s.mistakes === 0, true);
      } else {
        s.mistakes++;
        fb.className = 'feedback bad';
        fb.textContent = `Not quite. ${s.lesson.tip} Try ${step.a} ${SYM[step.op]} ${step.b}.`;
        input.select();
      }
    });
  }

  function renderChallenge() {
    const s = session; const st = s.story;
    mount(`
      <section class="panel learn game">
        ${header(s)}
        <p class="story">${esc(st.text)}</p>
        <p class="step-prompt">Work it out and type the final answer.</p>
        ${answerForm('Final answer')}
      </section>`);
    const input = $('#l-answer'); input.focus();
    $('#l-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const n = parseAnswer(input.value);
      if (n === null) { const fb = $('#l-fb'); fb.className = 'feedback bad'; fb.textContent = 'Type a whole number.'; return; }
      showChallengeResult(n === st.answer, n);
    });
  }

  function showChallengeResult(correct, given) {
    const s = session; const st = s.story;
    const steps = st.steps.map((x) => `<li>${esc(eq(x))}</li>`).join('');
    mount(`
      <section class="panel learn game">
        ${header(s)}
        <p class="story">${esc(st.text)}</p>
        <p class="feedback ${correct ? 'good' : 'bad'}">${correct ? 'Correct!' : `Not this time. You answered ${esc(given)}; the answer is ${esc(st.answer)}.`}</p>
        <details ${correct ? '' : 'open'}><summary>Show the steps</summary><ol class="review">${steps}</ol></details>
        <div class="actions"><button class="btn primary" id="l-next">${s.index + 1 < s.total ? 'Next story' : 'See how you did'}</button></div>
      </section>`);
    $('#l-next').focus();
    $('#l-next').addEventListener('click', () => finishStory(correct, false));
  }

  function finishStory(perfect, showSteps) {
    const s = session; const my = token;
    if (perfect) s.perfect++;
    adapt(s, perfect);
    const advance = () => {
      s.index++;
      if (s.index >= s.total) return renderSummary();
      nextStory(my);
    };
    if (!showSteps) return advance();
    mount(`
      <section class="panel learn game">
        ${header(s)}
        <p class="story">${esc(s.story.text)}</p>
        <ul class="review worked">${s.worked.map((w) => `<li class="good">${esc(w)}</li>`).join('')}</ul>
        <p class="feedback good">${perfect ? 'Nice work, no slips!' : 'You got there. Keep going!'}</p>
        <div class="actions"><button class="btn primary" id="l-next">${s.index + 1 < s.total ? 'Next story' : 'Continue'}</button></div>
      </section>`);
    $('#l-next').focus();
    $('#l-next').addEventListener('click', advance);
  }

  function renderSummary() {
    const s = session; const lesson = s.lesson;
    const guided = s.stage === 'guided';
    mount(`
      <section class="panel learn results ${s.perfect === s.total ? 'perfect' : ''}">
        <div class="result-badge">${s.perfect}/${s.total}</div>
        <h1>${guided ? 'Guided practice done' : 'Challenge round done'}</h1>
        <p class="muted">${guided
          ? `You got ${s.perfect} of ${s.total} stories with no slips. Now try them with only the final answer.`
          : `You solved ${s.perfect} of ${s.total} stories correctly.${s.perfect === s.total ? ' Excellent!' : ' Practice makes it easier.'}`}</p>
        <div class="actions">
          ${guided ? '<button class="btn primary big" id="l-challenge">Try the challenge</button>' : '<button class="btn primary big" id="l-more">Practice more</button>'}
          <a class="btn big" href="#/play">Test what you learned</a>
        </div>
        <p class="small"><button class="link-btn" id="l-review" type="button">Review the lesson</button> \u00b7 <a href="#/learn">All lessons</a></p>
      </section>`);
    const ch = $('#l-challenge'); const more = $('#l-more');
    if (ch) ch.addEventListener('click', () => startPractice(lesson, 'challenge'));
    if (more) more.addEventListener('click', () => startPractice(lesson, 'challenge'));
    // A link to the page's own address does nothing (the hash is unchanged), so this is a button.
    $('#l-review').addEventListener('click', () => AC.learn.open(lesson.op));
  }

  AC.learn = {
    open(id) {
      token++;
      const lesson = id && LESSONS[id];
      if (!id) return renderList();
      if (!lesson || lesson.soon) return AC.navigate('#/learn');
      if (AC.game && AC.game.warmUp) AC.game.warmUp();
      renderTeach(lesson);
    },
    leave() { token++; },
  };
})();
