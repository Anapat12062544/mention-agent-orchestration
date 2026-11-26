// Minimal session auth: scrypt passwords + HMAC-signed cookie. Swap for your SSO in real deployments.
const crypto = require('crypto');
const { app } = require('./db');
const { HttpError } = require('./changes');

const SECRET = process.env.SESSION_SECRET || 'dev-insecure-secret-change-me';
if (!process.env.SESSION_SECRET) console.warn('SESSION_SECRET not set — using an insecure dev default');
const MAX_AGE_S = 7 * 24 * 3600;

const hmac = s => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');

function verifyPassword(password, stored) {
  const [algo, salt, hash] = String(stored).split('$');
  if (algo !== 'scrypt') return false;
  const got = crypto.scryptSync(String(password), salt, 64);
  const want = Buffer.from(hash, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

const hashPassword = p => {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt$${salt}$${crypto.scryptSync(p, salt, 64).toString('hex')}`;
};

function setSession(res, userId) {
  const body = Buffer.from(JSON.stringify({ u: userId, e: Date.now() + MAX_AGE_S * 1000 })).toString('base64url');
  const secure = process.env.COOKIE_SECURE === 'true' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sid=${body}.${hmac(body)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${MAX_AGE_S}${secure}`);
}

const clearSession = res => res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');

async function loadUser(req, _res, next) {
  try {
    const sid = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie || '')?.[1];
    if (!sid) return next();
    const [body, sig] = sid.split('.');
    const want = hmac(body);
    if (!sig || sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return next();
    const { u, e } = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (e < Date.now()) return next();
    req.user = (await app.query('SELECT id, username, display_name, role FROM app_users WHERE id = $1', [u])).rows[0];
    next();
  } catch (e) { next(e); }
}

const requireRole = roles => (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, 'login required'));
  if (roles && !roles.includes(req.user.role)) return next(new HttpError(403, 'your role cannot do this'));
  next();
};

// ponytail: per-process limiter; with N PM2 workers the effective limit is N×. Use Redis if it matters.
function rateLimit({ perMinute }) {
  const hits = new Map();
  return (req, _res, next) => {
    const key = req.user?.id ?? req.ip;
    const now = Date.now();
    const list = (hits.get(key) || []).filter(t => now - t < 60_000);
    if (list.length >= perMinute) return next(new HttpError(429, 'ถามถี่เกินไป รอสักครู่'));
    list.push(now);
    hits.set(key, list);
    next();
  };
}

module.exports = { verifyPassword, hashPassword, setSession, clearSession, loadUser, requireRole, rateLimit };
