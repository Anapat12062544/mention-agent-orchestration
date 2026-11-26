// Scheduled questions. Every PM2 worker ticks; a row is claimed with locked_until + SKIP LOCKED,
// so exactly one worker runs each due routine.
const { app } = require('./db');
const { config } = require('./config');

const BKK = 7 * 3600e3; // ponytail: Asia/Bangkok is fixed UTC+7 (no DST); use a tz lib for DST zones

// Next run strictly after `from`, at HH:MM Bangkok on an allowed ISO weekday (1 = Mon).
function nextRun(timeOfDay, days, from = new Date()) {
  const [h, m] = timeOfDay.split(':').map(Number);
  const local = new Date(from.getTime() + BKK);
  for (let i = 0; i <= 7; i++) {
    const at = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + i, h, m) - BKK);
    const isoDow = ((new Date(at.getTime() + BKK).getUTCDay() + 6) % 7) + 1;
    if (at > from && days.includes(isoDow)) return at;
  }
  return null;
}

async function deliver(url, name, text) {
  if (!url) return false;
  // Generic incoming-webhook payload ({text}) — works with Teams (Workflows/connector) and Slack-style hooks.
  // For LINE Messaging API, replace with a push call using a channel token.
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: `**${name}**\n\n${text}` }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`webhook ${res.status}`);
  return true;
}

async function runRoutine(r, { manual = false } = {}) {
  const { answer } = require('./chat'); // lazy: avoid require cycle
  const run = (await app.query(`INSERT INTO ai_routine_runs (routine_id, status) VALUES ($1, 'running') RETURNING id`, [r.id])).rows[0];
  try {
    const user = (await app.query('SELECT id, username, display_name, role FROM app_users WHERE id = $1', [r.user_id])).rows[0];
    const date = new Date(Date.now() + BKK).toISOString().slice(0, 10);
    const out = await answer({ user, text: r.text, tags: r.tags, source: 'routine', title: `⏰ ${r.name} · ${date}` });
    let delivered = false, error = null;
    try { delivered = await deliver(r.webhook_url, r.name, out.message.content); } catch (e) { error = e.message; }
    await app.query(`UPDATE ai_routine_runs SET status='ok', conversation_id=$2, delivered=$3, error=$4, finished_at=now() WHERE id=$1`,
      [run.id, out.conversationId, delivered, error]);
    return out;
  } catch (e) {
    await app.query(`UPDATE ai_routine_runs SET status='error', error=$2, finished_at=now() WHERE id=$1`, [run.id, e.message]);
    throw e;
  } finally {
    if (!manual) {
      await app.query('UPDATE ai_routines SET next_run_at = $2, locked_until = NULL WHERE id = $1',
        [r.id, nextRun(r.time_of_day, r.days)]);
    }
  }
}

async function tick() {
  for (;;) {
    const { rows } = await app.query(`
      UPDATE ai_routines SET locked_until = now() + interval '10 minutes'
      WHERE id = (
        SELECT id FROM ai_routines
        WHERE domain = $1 AND enabled AND deleted_at IS NULL AND next_run_at <= now()
          AND (locked_until IS NULL OR locked_until < now())
        ORDER BY next_run_at LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING *`, [config.id]);
    if (!rows[0]) return;
    await runRoutine(rows[0]).catch(e => console.error(`routine ${rows[0].id} failed:`, e.message));
  }
}

function start() {
  if (process.env.ROUTINES_ENABLED === 'false') return;
  setInterval(() => tick().catch(e => console.error('routine tick:', e.message)), 30_000).unref();
}

module.exports = { nextRun, runRoutine, start };
