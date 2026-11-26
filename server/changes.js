// Write safety: agents only PROPOSE. A human applies; undo works only if nobody changed the value since.
// The table/key/field come from the tool file (trusted), never from the model.
const { app, quoteIdent: q } = require('./db');
const { config, tools } = require('./config');

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

const targetSql = t => ({
  read: `SELECT ${q(t.field)}::text AS v FROM ${q(config.schema)}.${q(t.table)} WHERE ${q(t.key)}::text = $1`,
  lock: `SELECT ${q(t.field)}::text AS v FROM ${q(config.schema)}.${q(t.table)} WHERE ${q(t.key)}::text = $1 FOR UPDATE`,
  write: `UPDATE ${q(config.schema)}.${q(t.table)} SET ${q(t.field)} = $1 WHERE ${q(t.key)}::text = $2`,
});

async function propose(tool, input, ctx) {
  if (!tool.roles.includes(ctx.user.role)) throw new Error('this user is not allowed to propose this change');
  if (ctx.proposals.filter(p => p.tool === tool.name).length >= (tool.maxPerQuestion || 10)) {
    throw new Error('proposal limit for this question reached');
  }
  const t = tool.target;
  const key = String(input[t.key] ?? '');
  const after = input[`new_${t.field}`];
  if (!key || after == null) throw new Error(`need ${t.key} and new_${t.field}`);
  const cur = await app.query(targetSql(t).read, [key]);
  if (cur.rows.length !== 1) throw new Error(`${t.key} "${key}" not found`);
  const before = cur.rows[0].v;
  const invalid = tool.validate?.(input, before);
  if (invalid) throw new Error(invalid);
  const { rows } = await app.query(
    `INSERT INTO ai_change_log (domain, user_id, conversation_id, tool, target_table, target_key, field, before_value, after_value, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [config.id, ctx.user.id, ctx.conversationId, tool.name, t.table, key, t.field, before, String(after), String(input.reason || '').slice(0, 500)]);
  ctx.proposals.push({ id: rows[0].id, tool: tool.name, key, field: t.field, before, after: String(after), reason: input.reason, status: 'proposed' });
  return `Proposal #${rows[0].id} created: ${t.field} of ${key} ${before} → ${after}. NOT applied — a human must click Apply.`;
}

// Shared apply/undo transaction. mode: 'apply' | 'undo'
async function transition(id, user, mode) {
  const c = await app.connect();
  try {
    await c.query('BEGIN');
    const ch = (await c.query('SELECT * FROM ai_change_log WHERE id = $1 AND domain = $2 FOR UPDATE', [id, config.id])).rows[0];
    if (!ch) throw new HttpError(404, 'change not found');
    const tool = tools[ch.tool];
    if (!tool || tool.type !== 'write' || !tool.roles.includes(user.role)) throw new HttpError(403, 'not allowed');
    if (ch.user_id !== user.id && user.role !== 'admin') throw new HttpError(403, 'only the requester or an admin can do this');
    if (tool.target.table !== ch.target_table || tool.target.field !== ch.field) throw new HttpError(409, 'tool target changed');
    const need = mode === 'apply' ? 'proposed' : 'applied';
    if (ch.status !== need) throw new HttpError(409, `change is ${ch.status}`);

    const sql = targetSql(tool.target);
    const cur = (await c.query(sql.lock, [ch.target_key])).rows[0]?.v;
    const expected = mode === 'apply' ? ch.before_value : ch.after_value;
    if (cur !== expected) {
      if (mode === 'apply') {
        await c.query(`UPDATE ai_change_log SET status = 'rejected', status_note = $2 WHERE id = $1`, [id, `value changed since proposal (now ${cur})`]);
        await c.query('COMMIT');
      }
      throw new HttpError(409, mode === 'apply'
        ? `value changed since proposal (was ${expected}, now ${cur}) — proposal rejected`
        : `value was modified after apply (expected ${expected}, now ${cur}) — cannot undo`);
    }
    const w = await c.query(sql.write, [mode === 'apply' ? ch.after_value : ch.before_value, ch.target_key]);
    if (w.rowCount !== 1) throw new HttpError(409, `expected 1 row, got ${w.rowCount}`);
    const now = (await c.query(sql.read, [ch.target_key])).rows[0].v; // normalised text, e.g. 149 -> 149.00
    const row = mode === 'apply'
      ? await c.query(`UPDATE ai_change_log SET status='applied', after_value=$2, applied_at=now(), applied_by=$3 WHERE id=$1 RETURNING *`, [id, now, user.id])
      : await c.query(`UPDATE ai_change_log SET status='undone', undone_at=now() WHERE id=$1 RETURNING *`, [id]);
    await c.query('COMMIT');
    return row.rows[0];
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

module.exports = { propose, apply: (id, u) => transition(id, u, 'apply'), undo: (id, u) => transition(id, u, 'undo'), HttpError };
