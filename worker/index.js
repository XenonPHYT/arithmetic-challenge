/**
 * Arithmetic Challenge - Cloudflare Worker backend.
 *
 * Bindings (wrangler.jsonc): DB (D1), SESSIONS (KV), ASSETS (static files).
 * Secrets: AUTH_SECRET (signs game sessions + CSRF tokens), PIN_KEY (base64, 32 bytes; encrypts recovery PINs).
 *
 * Storage split:
 *  - D1  : accounts, security counters, verified perfect wins (permanent).
 *  - KV  : one short-lived "active game" marker per player. Written when a game starts, deleted when it finishes.
 *          Nothing is written per answer or per second.
 */

const ENC = new TextEncoder();
const DEC = new TextDecoder();

// ---------- Game rules (the score formula and BANDS mirror python/difficulty_regulator.py) ----------
const DIFFICULTY = { easy: { count: 10 }, normal: { count: 15 }, hard: { count: 20 } };
const OPS = ['add', 'sub', 'mul', 'div'];
const MAX_OPERAND = 99;
const OP_BASE = { add: 4, sub: 8, mul: 16, div: 20 };
const BANDS = {
  easy:   { add: [0, 22],  sub: [0, 24],  mul: [0, 25],  div: [0, 34] },
  normal: { add: [23, 36], sub: [25, 36], mul: [26, 44], div: [35, 44] },
  hard:   { add: [37, 99], sub: [37, 99], mul: [45, 99], div: [45, 99] },
};
const MIN_MS_PER_QUESTION = 500;      // faster than this per question is not humanly plausible
const GAME_TTL_SECONDS = 3 * 60 * 60; // an unfinished game expires after 3 hours
const LOGIN_DAYS = 365;
const PBKDF2_ITERATIONS = 100000;     // Cloudflare Workers caps PBKDF2 at 100,000

function solve(a, op, b) {
  if (op === 'add') return a + b;
  if (op === 'sub') return a >= b ? a - b : null;
  if (op === 'mul') return a * b;
  if (op === 'div') return b !== 0 && a % b === 0 ? a / b : null;
  return null;
}
const sizeTier = (n) => (n < 10 ? 0 : n < 20 ? 3 : n < 50 ? 6 : 9);
const answerTier = (n) => 4 * [10, 50, 100, 500, 1000, 5000].filter((t) => n >= t).length;
function complexity(a, op, b, ans) {
  if (op === 'add') {
    if (a === 0 || b === 0) return -6;
    let c = 0;
    const carry = (a % 10) + (b % 10) >= 10 ? 1 : 0;
    if (carry) c += 5;
    if (Math.floor(a / 10) % 10 + Math.floor(b / 10) % 10 + carry >= 10) c += 5;
    return c;
  }
  if (op === 'sub') {
    if (b === 0 || ans === 0) return -6;
    return a % 10 < b % 10 ? 6 : 0;
  }
  if (op === 'mul') {
    if (a <= 1 || b <= 1) return -8;
    if (a >= 10 && b >= 10) return 12;
    return Math.min(a, b) >= 6 ? 4 : 0;
  }
  if (a === 0 || b === 1 || ans === 1) return -8;
  let c = 0;
  if (b >= 10) c += 8;
  if (ans >= 10) c += 4;
  return c;
}
function isTrivial(a, op, b, ans) {
  if (op === 'add') return a === 0 || b === 0;
  if (op === 'sub') return b === 0 || ans === 0;
  if (op === 'mul') return a <= 1 || b <= 1;
  return a === 0 || b === 1 || ans === 1;
}
function scoreCandidate(a, op, b, ans) {
  const magnitude = (String(a).length + String(b).length - 2) * 6;
  return Math.max(0, OP_BASE[op] + magnitude + sizeTier(Math.max(a, b)) + answerTier(ans) + complexity(a, op, b, ans));
}

/** Server-side check of a whole question list. Returns an error code or null. */
function checkQuestionSet(difficulty, questions) {
  const seen = new Set();
  const opCount = { add: 0, sub: 0, mul: 0, div: 0 };
  for (const q of questions) {
    if (!Array.isArray(q) || q.length !== 3) return 'BAD_QUESTION';
    const [a, op, b] = q;
    if (!Number.isInteger(a) || !Number.isInteger(b) || !OPS.includes(op)) return 'BAD_QUESTION';
    if (a < 0 || b < 0 || a > MAX_OPERAND || b > MAX_OPERAND) return 'BAD_QUESTION';
    const ans = solve(a, op, b);
    if (ans === null) return 'BAD_QUESTION';
    if (isTrivial(a, op, b, ans)) return 'WRONG_DIFFICULTY';
    const [lo, hi] = BANDS[difficulty][op];
    const s = scoreCandidate(a, op, b, ans);
    if (s < lo || s > hi) return 'WRONG_DIFFICULTY';
    const key = (op === 'add' || op === 'mul') && a > b ? `${op}:${b}:${a}` : `${op}:${a}:${b}`;
    if (seen.has(key)) return 'DUPLICATE_QUESTION';
    seen.add(key);
    opCount[op]++;
  }
  const minPerOp = Math.floor(questions.length / 4);
  for (const op of OPS) if (opCount[op] < minPerOp) return 'OPERATIONS_NOT_MIXED';
  return null;
}

// ---------- Small helpers ----------
class ApiError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra || {};
  }
}
const b64 = (buf) => { let s = ''; for (const x of new Uint8Array(buf)) s += String.fromCharCode(x); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64url = (buf) => b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => unb64(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));
const nowSec = () => Math.floor(Date.now() / 1000);

async function sha256Hex(text) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', ENC.encode(text)))].map((x) => x.toString(16).padStart(2, '0')).join('');
}
function safeEqual(a, b) {
  const x = ENC.encode(String(a));
  const y = ENC.encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}
async function hmacKey(env, usage) {
  return crypto.subtle.importKey('raw', ENC.encode(env.AUTH_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, usage);
}
async function hmacSign(env, text) {
  return b64url(await crypto.subtle.sign('HMAC', await hmacKey(env, ['sign']), ENC.encode(text)));
}
function requireSecrets(env) {
  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 24 || !env.PIN_KEY) {
    console.error('Missing or too-short AUTH_SECRET / PIN_KEY');
    throw new ApiError(500, 'SERVER_NOT_CONFIGURED', 'The server is not fully set up yet.');
  }
}

// ---------- Passwords and recovery PIN ----------
async function pbkdf2(password, saltBytes, iterations) {
  const key = await crypto.subtle.importKey('raw', ENC.encode(password), 'PBKDF2', false, ['deriveBits']);
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations }, key, 256));
}
async function hashPassword(password) {
  const salt = randomBytes(16);
  return { hash: await pbkdf2(password, salt, PBKDF2_ITERATIONS), salt: b64(salt), iterations: PBKDF2_ITERATIONS };
}
async function verifyPassword(password, player) {
  const hash = await pbkdf2(password, unb64(player.pw_salt), player.pw_iterations);
  return safeEqual(hash, player.pw_hash);
}
const DUMMY_SALT = new Uint8Array(16);
async function dummyPasswordWork(password) { await pbkdf2(password, DUMMY_SALT, PBKDF2_ITERATIONS); }

function generatePin() {
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < 4294000000) return String(buf[0] % 1000000).padStart(6, '0'); // rejection sampling: uniform
  }
}
async function pinKey(env) {
  const raw = unb64(env.PIN_KEY);
  if (raw.length !== 32) throw new ApiError(500, 'SERVER_NOT_CONFIGURED', 'The server is not fully set up yet.');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function encryptPin(env, playerId, pin) {
  const iv = randomBytes(12);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: ENC.encode('pin:' + playerId) }, await pinKey(env), ENC.encode(pin));
  return { cipher: b64(cipher), iv: b64(iv) };
}
async function decryptPin(env, player) {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: unb64(player.pin_iv), additionalData: ENC.encode('pin:' + player.player_id) },
    await pinKey(env), unb64(player.pin_cipher));
  return DEC.decode(plain);
}

// ---------- Response helpers ----------
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
  });
}
const sessionCookie = (value, maxAge) => `ac_session=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

async function readJson(request) {
  const type = request.headers.get('Content-Type') || '';
  if (!type.includes('application/json')) throw new ApiError(415, 'BAD_REQUEST', 'Unsupported request.');
  const text = await request.text();
  if (text.length > 20000) throw new ApiError(413, 'BAD_REQUEST', 'Request too large.');
  try {
    const body = JSON.parse(text);
    if (body === null || typeof body !== 'object' || Array.isArray(body)) throw 0;
    return body;
  } catch {
    throw new ApiError(400, 'BAD_REQUEST', 'Invalid request.');
  }
}
function requireSameOrigin(request) {
  const origin = request.headers.get('Origin');
  const site = request.headers.get('Sec-Fetch-Site');
  if (origin ? origin === new URL(request.url).origin : site === 'same-origin') return;
  throw new ApiError(403, 'FORBIDDEN', 'Request not allowed.');
}

// ---------- Validation ----------
function cleanUsername(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return /^[A-Za-z0-9_]{3,20}$/.test(s) ? s : null;
}
function cleanDisplayName(v) {
  if (typeof v !== 'string') return null;
  const s = v.normalize('NFC').trim().replace(/\s+/g, ' ');
  return /^[\p{L}\p{N}_.\- ]{3,20}$/u.test(s) ? s : null;
}
function cleanPassword(v) { return typeof v === 'string' && v.length >= 8 && v.length <= 128 ? v : null; }
function cleanPin(v) { return typeof v === 'string' && /^\d{6}$/.test(v) ? v : null; }

// ---------- Rate limiting (D1; only failures write) ----------
async function ipKey(request) {
  return (await sha256Hex(request.headers.get('CF-Connecting-IP') || 'unknown')).slice(0, 16);
}
async function rlAssert(env, key) {
  const row = await env.DB.prepare('SELECT locked_until FROM rate_limits WHERE rl_key = ?').bind(key).first();
  const now = nowSec();
  if (row && row.locked_until > now) {
    const retryAfter = row.locked_until - now;
    throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Please wait before trying again.', { retryAfter });
  }
}
async function rlFail(env, ctx, key, max, windowSec, lockSec) {
  const now = nowSec();
  await env.DB.prepare(
    `INSERT INTO rate_limits (rl_key, fail_count, window_start, locked_until) VALUES (?1, 1, ?2, CASE WHEN 1 >= ?4 THEN ?2 + ?5 ELSE 0 END)
     ON CONFLICT(rl_key) DO UPDATE SET
       fail_count = CASE WHEN window_start + ?3 <= ?2 THEN 1 ELSE fail_count + 1 END,
       window_start = CASE WHEN window_start + ?3 <= ?2 THEN ?2 ELSE window_start END,
       locked_until = CASE WHEN (CASE WHEN window_start + ?3 <= ?2 THEN 1 ELSE fail_count + 1 END) >= ?4 THEN ?2 + ?5 ELSE locked_until END`
  ).bind(key, now, windowSec, max, lockSec).run();
  if (Math.random() < 0.02) {
    ctx.waitUntil(env.DB.prepare('DELETE FROM rate_limits WHERE window_start < ? AND locked_until < ?').bind(now - 86400, now).run().catch(() => {}));
  }
}
const rlClear = (env, key) => env.DB.prepare('DELETE FROM rate_limits WHERE rl_key = ?').bind(key).run();

// ---------- Sessions (single active login per account) ----------
async function newLogin(env, playerId) {
  const token = b64url(randomBytes(32));
  const tokenHash = await sha256Hex(token);
  await env.DB.prepare('UPDATE players SET login_token_hash = ?, login_expires_at = ? WHERE player_id = ?')
    .bind(tokenHash, nowSec() + LOGIN_DAYS * 86400, playerId).run();
  return { cookie: sessionCookie(`${playerId}.${token}`, LOGIN_DAYS * 86400), tokenHash };
}
async function csrfFor(env, tokenHash) { return hmacSign(env, 'csrf:' + tokenHash); }

function readCookie(request, name) {
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}
async function authenticate(request, env) {
  const raw = readCookie(request, 'ac_session');
  const dot = raw ? raw.indexOf('.') : -1;
  if (dot < 1) throw new ApiError(401, 'NOT_AUTHENTICATED', 'Please log in.');
  const playerId = raw.slice(0, dot);
  const token = raw.slice(dot + 1);
  const player = await env.DB.prepare('SELECT * FROM players WHERE player_id = ?').bind(playerId).first();
  if (!player || !player.login_token_hash) throw new ApiError(401, 'NOT_AUTHENTICATED', 'Please log in.');
  if (!safeEqual(await sha256Hex(token), player.login_token_hash)) {
    throw new ApiError(401, 'SESSION_REPLACED', 'You were signed out because this account was logged in somewhere else.');
  }
  if (player.login_expires_at < nowSec()) throw new ApiError(401, 'SESSION_EXPIRED', 'Your login expired. Please log in again.');
  return { player, tokenHash: player.login_token_hash };
}
async function authenticateWrite(request, env) {
  requireSameOrigin(request);
  const auth = await authenticate(request, env);
  const sent = request.headers.get('X-CSRF-Token') || '';
  if (!safeEqual(sent, await csrfFor(env, auth.tokenHash))) throw new ApiError(403, 'FORBIDDEN', 'Request not allowed.');
  return auth;
}
const publicPlayer = (p) => ({ playerId: p.player_id, username: p.username, displayName: p.display_name });

// ---------- Account routes ----------
async function register(request, env, ctx) {
  requireSameOrigin(request);
  const body = await readJson(request);
  const username = cleanUsername(body.username);
  const displayName = cleanDisplayName(body.displayName);
  const password = cleanPassword(body.password);
  if (!username) throw new ApiError(400, 'INVALID_USERNAME', 'Username must be 3-20 letters, numbers or underscores.');
  if (!displayName) throw new ApiError(400, 'INVALID_DISPLAY_NAME', 'Display name must be 3-20 characters (letters, numbers, spaces, . _ -).');
  if (!password) throw new ApiError(400, 'INVALID_PASSWORD', 'Password must be 8-128 characters.');

  const ipk = 'reg:ip:' + (await ipKey(request));
  await rlAssert(env, ipk);
  await rlFail(env, ctx, ipk, 8, 3600, 3600); // counts every signup attempt from this network

  const usernameLower = username.toLowerCase();
  const displayLower = displayName.toLowerCase();
  const taken = await env.DB.prepare('SELECT username_lower, display_lower FROM players WHERE username_lower = ? OR display_lower = ?').bind(usernameLower, displayLower).all();
  for (const row of taken.results) {
    if (row.username_lower === usernameLower) throw new ApiError(409, 'USERNAME_TAKEN', 'That username is already taken.');
    if (row.display_lower === displayLower) throw new ApiError(409, 'DISPLAY_NAME_TAKEN', 'That display name is already taken. Please choose another.');
  }

  const playerId = crypto.randomUUID();
  const pw = await hashPassword(password);
  const pin = generatePin();
  const enc = await encryptPin(env, playerId, pin);
  const token = b64url(randomBytes(32));
  const tokenHash = await sha256Hex(token);
  try {
    await env.DB.prepare(
      `INSERT INTO players (player_id, username, username_lower, display_name, display_lower, pw_hash, pw_salt, pw_iterations,
        pin_cipher, pin_iv, pin_version, login_token_hash, login_expires_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?,?)`
    ).bind(playerId, username, usernameLower, displayName, displayLower, pw.hash, pw.salt, pw.iterations, enc.cipher, enc.iv,
      tokenHash, nowSec() + LOGIN_DAYS * 86400, nowSec()).run();
  } catch (e) {
    const msg = String(e && e.message);
    if (msg.includes('username_lower')) throw new ApiError(409, 'USERNAME_TAKEN', 'That username is already taken.');
    if (msg.includes('display_lower')) throw new ApiError(409, 'DISPLAY_NAME_TAKEN', 'That display name is already taken. Please choose another.');
    throw e;
  }
  return json(
    { player: { playerId, username, displayName }, csrf: await csrfFor(env, tokenHash), recoveryPin: pin },
    201, { 'Set-Cookie': sessionCookie(`${playerId}.${token}`, LOGIN_DAYS * 86400) });
}

async function login(request, env, ctx) {
  requireSameOrigin(request);
  const body = await readJson(request);
  const username = typeof body.username === 'string' ? body.username.trim().toLowerCase().slice(0, 40) : '';
  const password = typeof body.password === 'string' ? body.password.slice(0, 200) : '';
  if (!username || !password) throw new ApiError(400, 'BAD_REQUEST', 'Enter your username and password.');

  const uk = 'login:user:' + username;
  const ik = 'login:ip:' + (await ipKey(request));
  await rlAssert(env, uk);
  await rlAssert(env, ik);

  const player = await env.DB.prepare('SELECT * FROM players WHERE username_lower = ?').bind(username).first();
  let ok = false;
  if (player) ok = await verifyPassword(password, player); else await dummyPasswordWork(password);
  if (!ok) {
    await rlFail(env, ctx, uk, 6, 900, 900);
    await rlFail(env, ctx, ik, 25, 900, 900);
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Username or password is incorrect.');
  }
  await rlClear(env, uk);
  const { cookie, tokenHash } = await newLogin(env, player.player_id); // replaces any login on another device
  return json({ player: publicPlayer(player), csrf: await csrfFor(env, tokenHash) }, 200, { 'Set-Cookie': cookie });
}

async function logout(request, env) {
  requireSameOrigin(request);
  try {
    const { player } = await authenticate(request, env);
    await env.DB.prepare('UPDATE players SET login_token_hash = NULL WHERE player_id = ?').bind(player.player_id).run();
  } catch { /* already logged out */ }
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });
}

async function me(request, env) {
  const { player, tokenHash } = await authenticate(request, env);
  return json({ player: publicPlayer(player), csrf: await csrfFor(env, tokenHash) });
}

async function profile(request, env) {
  const { player } = await authenticate(request, env);
  const rows = await env.DB.prepare('SELECT difficulty, COUNT(*) AS wins, MIN(elapsed_ms) AS best FROM completions WHERE player_id = ? GROUP BY difficulty').bind(player.player_id).all();
  const stats = { easy: { wins: 0, bestMs: null }, normal: { wins: 0, bestMs: null }, hard: { wins: 0, bestMs: null } };
  for (const r of rows.results) stats[r.difficulty] = { wins: r.wins, bestMs: r.best };
  return json({ player: publicPlayer(player), createdAt: player.created_at, stats });
}

async function changeDisplayName(request, env) {
  const { player } = await authenticateWrite(request, env);
  const body = await readJson(request);
  const displayName = cleanDisplayName(body.displayName);
  if (!displayName) throw new ApiError(400, 'INVALID_DISPLAY_NAME', 'Display name must be 3-20 characters (letters, numbers, spaces, . _ -).');
  const lower = displayName.toLowerCase();
  const clash = await env.DB.prepare('SELECT player_id FROM players WHERE display_lower = ? AND player_id != ?').bind(lower, player.player_id).first();
  if (clash) throw new ApiError(409, 'DISPLAY_NAME_TAKEN', 'That display name is already taken. Please choose another.');
  try {
    await env.DB.prepare('UPDATE players SET display_name = ?, display_lower = ? WHERE player_id = ?').bind(displayName, lower, player.player_id).run();
  } catch (e) {
    if (String(e && e.message).includes('display_lower')) throw new ApiError(409, 'DISPLAY_NAME_TAKEN', 'That display name is already taken. Please choose another.');
    throw e;
  }
  return json({ displayName });
}

async function confirmPassword(env, ctx, player, password) {
  const key = 'pw:player:' + player.player_id;
  await rlAssert(env, key);
  if (!(await verifyPassword(password, player))) {
    await rlFail(env, ctx, key, 5, 900, 900);
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Password is incorrect.');
  }
  await rlClear(env, key);
}
async function pinReveal(request, env, ctx) {
  const { player } = await authenticateWrite(request, env);
  const body = await readJson(request);
  if (typeof body.password !== 'string') throw new ApiError(400, 'BAD_REQUEST', 'Enter your password.');
  await confirmPassword(env, ctx, player, body.password.slice(0, 200));
  return json({ recoveryPin: await decryptPin(env, player) });
}
async function pinRegenerate(request, env, ctx) {
  const { player } = await authenticateWrite(request, env);
  const body = await readJson(request);
  if (typeof body.password !== 'string') throw new ApiError(400, 'BAD_REQUEST', 'Enter your password.');
  await confirmPassword(env, ctx, player, body.password.slice(0, 200));
  const pin = generatePin();
  const enc = await encryptPin(env, player.player_id, pin);
  await env.DB.prepare('UPDATE players SET pin_cipher = ?, pin_iv = ?, pin_version = pin_version + 1 WHERE player_id = ?').bind(enc.cipher, enc.iv, player.player_id).run();
  return json({ recoveryPin: pin });
}

async function recoverGeneric(request, env, ctx, kind) {
  requireSameOrigin(request);
  const body = await readJson(request);
  const pin = cleanPin(body.pin);
  const label = kind === 'password' ? body.username : body.displayName;
  if (typeof label !== 'string' || !label.trim() || !pin) throw new ApiError(400, 'BAD_REQUEST', 'Please fill in every field (the PIN is 6 digits).');
  let newPassword = null;
  if (kind === 'password') {
    newPassword = cleanPassword(body.newPassword);
    if (!newPassword) throw new ApiError(400, 'INVALID_PASSWORD', 'Password must be 8-128 characters.');
  }
  const target = label.trim().normalize('NFC').toLowerCase().slice(0, 60);
  const tk = `rec:${kind}:` + target;
  const ik = 'rec:ip:' + (await ipKey(request));
  await rlAssert(env, tk);
  await rlAssert(env, ik);

  const col = kind === 'password' ? 'username_lower' : 'display_lower';
  const player = await env.DB.prepare(`SELECT * FROM players WHERE ${col} = ?`).bind(target).first();
  let ok = false;
  if (player) ok = safeEqual(await decryptPin(env, player), pin);
  if (!ok) {
    await rlFail(env, ctx, tk, 5, 3600, 3600);
    await rlFail(env, ctx, ik, 15, 3600, 3600);
    throw new ApiError(401, 'RECOVERY_FAILED', 'The details did not match. Check them and try again.');
  }
  await rlClear(env, tk);
  if (kind === 'username') return json({ username: player.username });
  const pw = await hashPassword(newPassword);
  await env.DB.prepare('UPDATE players SET pw_hash = ?, pw_salt = ?, pw_iterations = ?, login_token_hash = NULL WHERE player_id = ?')
    .bind(pw.hash, pw.salt, pw.iterations, player.player_id).run();
  return json({ ok: true });
}

// ---------- Leaderboard ----------
async function leaderboard(request, env) {
  const difficulty = new URL(request.url).searchParams.get('difficulty');
  if (!DIFFICULTY[difficulty]) throw new ApiError(400, 'BAD_REQUEST', 'Unknown difficulty.');
  const wins = await env.DB.prepare(
    `SELECT p.display_name AS name, COUNT(*) AS wins, MIN(c.elapsed_ms) AS best
     FROM completions c JOIN players p ON p.player_id = c.player_id WHERE c.difficulty = ?
     GROUP BY c.player_id ORDER BY wins DESC, best ASC, name ASC LIMIT 20`).bind(difficulty).all();
  const fastest = await env.DB.prepare(
    `SELECT p.display_name AS name, MIN(c.elapsed_ms) AS best
     FROM completions c JOIN players p ON p.player_id = c.player_id WHERE c.difficulty = ?
     GROUP BY c.player_id ORDER BY best ASC, name ASC LIMIT 20`).bind(difficulty).all();
  return json({
    difficulty,
    mostWins: wins.results.map((r, i) => ({ rank: i + 1, name: r.name, wins: r.wins })),
    fastest: fastest.results.map((r, i) => ({ rank: i + 1, name: r.name, elapsedMs: r.best })),
  }, 200, { 'Cache-Control': 'private, max-age=15' });
}

// ---------- Game sessions ----------
async function gameStart(request, env) {
  const { player } = await authenticateWrite(request, env);
  const body = await readJson(request);
  const cfg = DIFFICULTY[body.difficulty];
  if (!cfg) throw new ApiError(400, 'BAD_REQUEST', 'Choose a difficulty.');
  const startedAt = Date.now();
  const sid = b64url(randomBytes(16));
  const payload = b64url(ENC.encode(JSON.stringify({ sid, pid: player.player_id, d: body.difficulty, t: startedAt })));
  const token = payload + '.' + (await hmacSign(env, 'game:' + payload));
  // One active game per player: starting a new game replaces any unfinished one.
  await env.SESSIONS.put('active:' + player.player_id, sid, { expirationTtl: GAME_TTL_SECONDS });
  return json({ token, difficulty: body.difficulty, total: cfg.count, startedAt, serverNow: Date.now() });
}

async function parseGameToken(env, token, playerId) {
  if (typeof token !== 'string' || token.length > 600 || !token.includes('.')) throw new ApiError(400, 'INVALID_SESSION', 'This game session is not valid.');
  const [payload, sig] = token.split('.');
  let valid = false;
  try { valid = await crypto.subtle.verify('HMAC', await hmacKey(env, ['verify']), unb64url(sig), ENC.encode('game:' + payload)); } catch { /* invalid */ }
  if (!valid) throw new ApiError(400, 'INVALID_SESSION', 'This game session is not valid.');
  const data = JSON.parse(DEC.decode(unb64url(payload)));
  if (data.pid !== playerId) throw new ApiError(403, 'INVALID_SESSION', 'This game session is not valid.');
  return data;
}

async function gameFinish(request, env, ctx) {
  const { player } = await authenticateWrite(request, env);
  const body = await readJson(request);
  const sess = await parseGameToken(env, body.token, player.player_id);
  const cfg = DIFFICULTY[sess.d];
  const finishedAt = Date.now();

  // Already recorded (retry after a lost response)? Return the stored result.
  const existing = await env.DB.prepare('SELECT elapsed_ms FROM completions WHERE session_id = ?').bind(sess.sid).first();
  const active = await env.SESSIONS.get('active:' + player.player_id);
  if (!existing && active !== sess.sid) throw new ApiError(409, 'SESSION_NOT_ACTIVE', 'This game is no longer active (it was replaced, finished or expired).');
  if (finishedAt - sess.t > GAME_TTL_SECONDS * 1000) throw new ApiError(409, 'SESSION_NOT_ACTIVE', 'This game expired.');

  if (!Array.isArray(body.questions) || !Array.isArray(body.answers) || body.questions.length !== cfg.count || body.answers.length !== cfg.count) {
    throw new ApiError(400, 'INVALID_SESSION_DATA', 'The submitted game is incomplete.');
  }
  const bad = checkQuestionSet(sess.d, body.questions);
  if (bad) throw new ApiError(400, 'INVALID_SESSION_DATA', 'The submitted game could not be verified.');
  if (!body.answers.every((v) => Number.isInteger(v) && v >= -999999 && v <= 999999)) throw new ApiError(400, 'INVALID_SESSION_DATA', 'The submitted game could not be verified.');

  const results = body.questions.map(([a, op, b], i) => solve(a, op, b) === body.answers[i]);
  const correct = results.filter(Boolean).length;
  const perfect = correct === cfg.count;
  let elapsedMs = finishedAt - sess.t;
  const summary = { ok: true, perfect, correct, total: cfg.count, results, difficulty: sess.d, recorded: false };

  if (existing) {
    return json({ ...summary, elapsedMs: existing.elapsed_ms, recorded: true, alreadyRecorded: true });
  }
  if (perfect) {
    const pending = await env.SESSIONS.get('pending:' + sess.sid);
    if (pending) elapsedMs = Number(pending) || elapsedMs; // fair retry after a failed write
    if (elapsedMs < cfg.count * MIN_MS_PER_QUESTION) {
      await env.SESSIONS.delete('active:' + player.player_id);
      return json({ ...summary, perfect: false, elapsedMs, rejected: 'TOO_FAST' });
    }
    try {
      await env.DB.prepare('INSERT OR IGNORE INTO completions (session_id, player_id, difficulty, elapsed_ms, completed_at) VALUES (?,?,?,?,?)')
        .bind(sess.sid, player.player_id, sess.d, elapsedMs, nowSec()).run();
    } catch (e) {
      console.error('completion write failed', String(e && e.message));
      await env.SESSIONS.put('pending:' + sess.sid, String(elapsedMs), { expirationTtl: 86400 });
      throw new ApiError(503, 'TEMPORARY_FAILURE', 'Your result is verified but could not be saved yet. It will be retried.');
    }
    summary.recorded = true;
  }
  await env.SESSIONS.delete('active:' + player.player_id);
  return json({ ...summary, elapsedMs });
}

// ---------- Router ----------
const ROUTES = {
  'POST /api/register': register,
  'POST /api/login': login,
  'POST /api/logout': logout,
  'GET /api/me': me,
  'GET /api/profile': profile,
  'POST /api/profile/display-name': changeDisplayName,
  'POST /api/account/pin/reveal': pinReveal,
  'POST /api/account/pin/regenerate': pinRegenerate,
  'POST /api/recovery/password': (r, e, c) => recoverGeneric(r, e, c, 'password'),
  'POST /api/recovery/username': (r, e, c) => recoverGeneric(r, e, c, 'username'),
  'GET /api/leaderboard': leaderboard,
  'POST /api/game/start': gameStart,
  'POST /api/game/finish': gameFinish,
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
    try {
      requireSecrets(env);
      const handler = ROUTES[`${request.method} ${url.pathname}`];
      if (!handler) throw new ApiError(404, 'NOT_FOUND', 'Not found.');
      return await handler(request, env, ctx);
    } catch (e) {
      if (e instanceof ApiError) {
        return json({ error: { code: e.code, message: e.message, ...e.extra } }, e.status, e.extra.retryAfter ? { 'Retry-After': String(e.extra.retryAfter) } : {});
      }
      console.error('Unhandled error', String(e && e.message));
      return json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' } }, 500);
    }
  },
};
