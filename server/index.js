const path = require('path');
const express = require('express');
const { app: db, readerQuery } = require('./db');
const { config, tools } = require('./config');
const auth = require('./auth');
const chat = require('./chat');
const changes = require('./changes');
const routines = require('./routines');
const { label, MODELS } = require('./usage');
const { HttpError } = changes;

const api = express.Router();
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).then(out => out !== undefined && res.json(out)).catch(next);
const R = config.roles;
const canUse = auth.requireRole(R.canUse);
const canManage = auth.requireRole(R.canManageAgents || R.canUse);

// CSRF: SameSite=Lax cookie + every write must be JSON (cross-site forms can't send JSON without CORS preflight).
api.use((req, _res, next) => (req.method !== 'GET' && !req.is('application/json') ? next(new HttpError(415, 'JSON only')) : next()));
api.use(express.json({ limit: '64kb' }));
api.use(auth.loadUser);

// ---------- session
api.post('/login', auth.rateLimit({ perMinute: 10 }), wrap(async (req, res) => {
  const u = (await db.query('SELECT * FROM app_users WHERE username = $1', [String(req.body.username || '')])).rows[0];
  if (!u || !auth.verifyPassword(req.body.password || '', u.password_hash)) throw new HttpError(401, 'username หรือ password ไม่ถูกต้อง');
  auth.setSession(res, u.id);
  return { ok: true };
}));
api.post('/logout', wrap(async (_req, res) => { auth.clearSession(res); return { ok: true }; }));

api.get('/me', auth.requireRole(), wrap(async req => {
  const role = req.user.role;
  return {
    user: req.user,
    domain: { id: config.id, name: config.name },
    can: { use: R.canUse.includes(role), manageAgents: (R.canManageAgents || R.canUse).includes(role), seeUsage: R.canSeeUsage.includes(role) },
    tagTypes: Object.entries(config.tags).map(([type, t]) => ({ type, label: t.label })),
    starterCards: (config.starterCards || []).filter(c => !c.roles || c.roles.includes(role)).slice(0, 4),
    tools: Object.values(tools).map(t => ({ name: t.name, type: t.type, description: t.description })),
    models: Object.fromEntries(Object.entries(MODELS).map(([k, id]) => [k, { id, label: label(id) }])),
  };
}));

// ---------- chat
api.post('/ai/chat', canUse, auth.rateLimit({ perMinute: 20 }), wrap(req =>
  chat.answer({ user: req.user, conversationId: req.body.conversationId, text: req.body.text, tags: req.body.tags || [] })));

// ---------- tags: values for the @ picker
api.get('/ai/tags', canUse, wrap(async req => {
  const type = String(req.query.type || '');
  const q = String(req.query.q || '').slice(0, 100);
  if (!type) {
    return {
      agents: (await chat.listAgents()).map(a => ({ handle: a.handle, name: a.name, description: a.description })),
      types: Object.entries(config.tags).map(([t, d]) => ({ type: t, label: d.label })),
    };
  }
  const def = config.tags[type];
  if (!def) throw new HttpError(404, 'unknown tag type');
  let items;
  if (def.static) items = def.static.map(v => ({ value: v, label: v }));
  else {
    const r = def.search ? await readerQuery(config.schema, def.search.sql, [q]) : await readerQuery(config.schema, def.values.sql);
    items = r.rows.map(row => { const v = Object.values(row); return { value: String(v[0]), label: String(v[1] ?? v[0]) }; });
  }
  const needle = q.toLowerCase();
  return { items: items.filter(i => !needle || i.label.toLowerCase().includes(needle) || i.value.toLowerCase().includes(needle)).slice(0, 50) };
}));

// ---------- conversations
api.get('/ai/conversations', canUse, wrap(async req => (await db.query(
  `SELECT id, title, source, updated_at FROM ai_conversations
   WHERE user_id = $1 AND domain = $2 AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 100`, [req.user.id, config.id])).rows));

const ownConv = async (req) => {
  const c = (await db.query('SELECT * FROM ai_conversations WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
    [req.params.id, req.user.id]).catch(() => ({ rows: [] }))).rows[0];
  if (!c) throw new HttpError(404, 'conversation not found');
  return c;
};
api.get('/ai/conversations/:id', canUse, wrap(async req => {
  const conv = await ownConv(req);
  const messages = (await db.query('SELECT * FROM ai_messages WHERE conversation_id = $1 ORDER BY id', [conv.id])).rows;
  const ids = messages.flatMap(m => (m.meta.proposals || []).map(p => p.id));
  const status = ids.length ? (await db.query('SELECT id, status, status_note, after_value FROM ai_change_log WHERE id = ANY($1)', [ids])).rows : [];
  return { conversation: conv, messages, changes: status };
}));
api.patch('/ai/conversations/:id', canUse, wrap(async req => {
  const conv = await ownConv(req);
  await db.query('UPDATE ai_conversations SET title = $2 WHERE id = $1', [conv.id, String(req.body.title || '').slice(0, 120) || conv.title]);
  return { ok: true };
}));
api.delete('/ai/conversations/:id', canUse, wrap(async req => {
  const conv = await ownConv(req);
  await db.query('UPDATE ai_conversations SET deleted_at = now() WHERE id = $1', [conv.id]);
  return { ok: true };
}));

// ---------- agents
function agentInput(b) {
  const handle = String(b.handle || '').toLowerCase().replace(/^@/, '');
  if (!/^[a-z][a-z0-9_]{1,30}$/.test(handle)) throw new HttpError(400, 'handle: a-z, 0-9, _ (2-31 chars)');
  if (config.tags[handle]) throw new HttpError(400, `"${handle}" is a tag type`);
  const model = ['auto', 'haiku', 'sonnet', 'opus'].includes(b.model) ? b.model : 'auto';
  const list = (Array.isArray(b.tools) ? b.tools : []).filter(t => tools[t]);
  if (!b.name || !b.instructions) throw new HttpError(400, 'name and instructions are required');
  return [handle, String(b.name).slice(0, 80), String(b.description || '').slice(0, 300), String(b.instructions).slice(0, 8000), model, list];
}
api.get('/ai/agents', canUse, wrap(() => chat.listAgents()));
api.post('/ai/agents', canManage, wrap(async req => (await db.query(
  `INSERT INTO ai_agents (domain, handle, name, description, instructions, model, tools, created_by)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [config.id, ...agentInput(req.body), req.user.id])
  .catch(e => { throw e.code === '23505' ? new HttpError(409, 'handle already exists') : e; })).rows[0]));
api.put('/ai/agents/:id', canManage, wrap(async req => {
  const r = await db.query(
    `UPDATE ai_agents SET handle=$3, name=$4, description=$5, instructions=$6, model=$7, tools=$8, updated_at=now()
     WHERE id = $1 AND domain = $2 AND deleted_at IS NULL RETURNING *`, [req.params.id, config.id, ...agentInput(req.body)])
    .catch(e => { throw e.code === '23505' ? new HttpError(409, 'handle already exists') : e; });
  if (!r.rows[0]) throw new HttpError(404, 'agent not found');
  return r.rows[0];
}));
api.delete('/ai/agents/:id', canManage, wrap(async req => {
  const r = await db.query('UPDATE ai_agents SET deleted_at = now() WHERE id = $1 AND domain = $2 AND NOT is_default RETURNING id', [req.params.id, config.id]);
  if (!r.rows[0]) throw new HttpError(400, 'cannot delete (not found or default agent)');
  return { ok: true };
}));

// ---------- routines
function routineInput(b) {
  const days = (Array.isArray(b.days) ? b.days : []).map(Number).filter(d => d >= 1 && d <= 7);
  if (!b.name || !b.text) throw new HttpError(400, 'name and text are required');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.time_of_day || '')) throw new HttpError(400, 'time_of_day must be HH:MM');
  if (!days.length) throw new HttpError(400, 'pick at least one day');
  if (b.webhook_url && !/^https:\/\//.test(b.webhook_url)) throw new HttpError(400, 'webhook_url must be https');
  chat.tagHints(b.tags || []);
  return [String(b.name).slice(0, 120), String(b.text).slice(0, 4000), JSON.stringify(b.tags || []), b.time_of_day, days,
    b.webhook_url || null, b.enabled !== false, routines.nextRun(b.time_of_day, days)];
}
const ROUTINE_COLS = `r.*, (SELECT row_to_json(x) FROM (SELECT status, delivered, error, conversation_id, started_at
  FROM ai_routine_runs WHERE routine_id = r.id ORDER BY id DESC LIMIT 1) x) AS last_run`;
api.get('/ai/routines', canUse, wrap(async req => (await db.query(
  `SELECT ${ROUTINE_COLS} FROM ai_routines r WHERE domain = $1 AND deleted_at IS NULL
     AND (user_id = $2 OR $3) ORDER BY id`, [config.id, req.user.id, req.user.role === 'admin'])).rows));
api.post('/ai/routines', canUse, wrap(async req => (await db.query(
  `INSERT INTO ai_routines (domain, user_id, name, text, tags, time_of_day, days, webhook_url, enabled, next_run_at)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [config.id, req.user.id, ...routineInput(req.body)])).rows[0]));
const ownRoutine = async req => {
  const r = (await db.query('SELECT * FROM ai_routines WHERE id = $1 AND domain = $2 AND deleted_at IS NULL', [req.params.id, config.id])).rows[0];
  if (!r || (r.user_id !== req.user.id && req.user.role !== 'admin')) throw new HttpError(404, 'routine not found');
  return r;
};
api.put('/ai/routines/:id', canUse, wrap(async req => {
  await ownRoutine(req);
  return (await db.query(
    `UPDATE ai_routines SET name=$2, text=$3, tags=$4, time_of_day=$5, days=$6, webhook_url=$7, enabled=$8, next_run_at=$9
     WHERE id=$1 RETURNING *`, [req.params.id, ...routineInput(req.body)])).rows[0];
}));
api.delete('/ai/routines/:id', canUse, wrap(async req => {
  await ownRoutine(req);
  await db.query('UPDATE ai_routines SET deleted_at = now() WHERE id = $1', [req.params.id]);
  return { ok: true };
}));
api.post('/ai/routines/:id/run', canUse, auth.rateLimit({ perMinute: 5 }), wrap(async req => routines.runRoutine(await ownRoutine(req), { manual: true })));

// ---------- usage (admin)
api.get('/ai/usage', auth.requireRole(R.canSeeUsage), wrap(async req => {
  const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
  const since = [days];
  const W = `created_at >= now() - $1 * interval '1 day'`;
  const [totals, daily, byModel, byUser, router] = await Promise.all([
    db.query(`SELECT count(*)::int AS calls, coalesce(sum(cost_usd),0)::float AS cost,
                coalesce(sum(input_tokens + cache_read_tokens + cache_write_tokens),0)::bigint AS input_tokens,
                coalesce(sum(output_tokens),0)::bigint AS output_tokens,
                count(DISTINCT conversation_id)::int AS conversations,
                coalesce(sum(cache_read_tokens),0)::bigint AS cache_read_tokens FROM ai_usage WHERE ${W}`, since),
    db.query(`SELECT to_char((created_at AT TIME ZONE 'Asia/Bangkok')::date, 'YYYY-MM-DD') AS day, sum(cost_usd)::float AS cost, count(*)::int AS calls
              FROM ai_usage WHERE ${W} GROUP BY 1 ORDER BY 1`, since),
    db.query(`SELECT model, provider, purpose, count(*)::int AS calls, sum(input_tokens)::bigint AS input_tokens,
                sum(output_tokens)::bigint AS output_tokens, sum(cache_read_tokens)::bigint AS cache_read_tokens, sum(cost_usd)::float AS cost
              FROM ai_usage WHERE ${W} GROUP BY 1, 2, 3 ORDER BY cost DESC`, since),
    db.query(`SELECT u.display_name AS name, u.role, count(*)::int AS calls, count(DISTINCT a.conversation_id)::int AS conversations, sum(a.cost_usd)::float AS cost
              FROM ai_usage a JOIN app_users u ON u.id = a.user_id WHERE a.${W} GROUP BY 1, 2 ORDER BY cost DESC`, since),
    db.query(`SELECT meta->'router'->>'model' AS model, meta->'router'->>'by' AS by, count(*)::int AS n
              FROM ai_messages WHERE role = 'assistant' AND ${W} GROUP BY 1, 2 ORDER BY 3 DESC`, since),
  ]);
  return { days, totals: totals.rows[0], daily: daily.rows, byModel: byModel.rows.map(r => ({ ...r, label: label(r.model) })), byUser: byUser.rows, router: router.rows };
}));

// ---------- write safety
api.post('/ai/changes/:id/apply', canUse, wrap(req => changes.apply(Number(req.params.id), req.user)));
api.post('/ai/changes/:id/undo', canUse, wrap(req => changes.undo(Number(req.params.id), req.user)));

api.use((req, _res, next) => next(new HttpError(404, 'not found')));
api.use((err, _req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 && !err.status ? 'internal error' : err.message });
});

// ---------- seed agents from domain.config on first boot (never re-adds ones a user deleted)
async function seedAgents() {
  for (const a of config.agents) {
    await db.query(
      `INSERT INTO ai_agents (domain, handle, name, description, instructions, model, tools, is_default)
       SELECT $1,$2,$3,$4,$5,$6,$7,$8 WHERE NOT EXISTS (SELECT 1 FROM ai_agents WHERE domain = $1 AND handle = $2)
       ON CONFLICT (domain, handle) WHERE deleted_at IS NULL DO NOTHING`,
      [config.id, a.handle, a.name, a.description || '', a.instructions, a.model || 'auto', a.tools, !!a.isDefault]);
  }
}

const server = express();
server.disable('x-powered-by');
server.set('trust proxy', 1);
server.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});
server.use('/api', api);
const dist = path.join(__dirname, '..', 'web', 'dist');
server.use(express.static(dist));
server.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));

const port = Number(process.env.PORT) || 3000;
seedAgents()
  .then(() => {
    routines.start();
    server.listen(port, () => console.log(`[${config.name}] listening on :${port}`));
  })
  .catch(e => { console.error('startup failed:', e.message); process.exit(1); });
