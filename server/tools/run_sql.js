const { reader, quoteIdent } = require('../db');
const { GuardError, checkSql, checkPlan, redactRows, wrapUntrusted } = require('../guard');

const MAX_ROWS_PER_QUERY = 200;
const STATEMENT_TIMEOUT_MS = 8000;

// Guarded execution: text guard → read-only tx on the reader role → EXPLAIN plan guard → run with LIMIT.
// Extended query protocol (queryMode) makes Postgres itself refuse multi-statement strings.
async function runGuarded(sql, ctx) {
  const clean = checkSql(sql);
  const limit = Math.min(MAX_ROWS_PER_QUERY, ctx.budget.rows);
  if (limit <= 0) throw new GuardError('row budget for this question is used up');
  const c = await reader.connect();
  try {
    await c.query('BEGIN READ ONLY');
    await c.query(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
    await c.query(`SET LOCAL search_path = ${quoteIdent(ctx.config.schema)}`);
    const plan = await c.query({ text: `EXPLAIN (VERBOSE, FORMAT JSON) ${clean}`, values: [], queryMode: 'extended' });
    checkPlan(plan.rows[0]['QUERY PLAN'], ctx);
    const res = await c.query({ text: `SELECT * FROM (${clean}) AS _q LIMIT ${limit + 1}`, values: [], queryMode: 'extended' });
    const truncated = res.rows.length > limit;
    const rows = res.rows.slice(0, limit);
    ctx.budget.rows -= rows.length;
    return { ...redactRows(res.fields, rows, ctx.config.hiddenColumns), truncated };
  } finally {
    await c.query('ROLLBACK').catch(() => {});
    c.release();
  }
}

module.exports = {
  name: 'run_sql',
  type: 'read',
  description: `Run ONE read-only PostgreSQL SELECT (or WITH ... SELECT) on the domain schema. Max ${MAX_ROWS_PER_QUERY} rows returned.
Aggregate in SQL (GROUP BY) instead of fetching raw rows. Select explicit columns, no "*". No comments, no $ or backslash.`,
  input_schema: {
    type: 'object',
    properties: {
      sql: { type: 'string', description: 'A single SELECT/WITH statement' },
      purpose: { type: 'string', description: 'One short line: what this query answers' },
    },
    required: ['sql', 'purpose'],
    additionalProperties: false,
  },
  runGuarded,
  async run({ sql, purpose }, ctx) {
    if (ctx.budget.sql <= 0) throw new Error('SQL budget for this question is used up. Answer with what you have.');
    ctx.budget.sql--;
    const entry = { agent: ctx.agentHandle, purpose: String(purpose || ''), sql: String(sql || ''), status: 'ok' };
    ctx.queries.push(entry);
    try {
      const r = await (ctx.runGuarded || runGuarded)(sql, ctx);
      Object.assign(entry, { rowCount: r.rows.length, truncated: r.truncated, columns: r.columns, sample: r.rows.slice(0, 20) });
      return wrapUntrusted('run_sql', JSON.stringify({ columns: r.columns, rows: r.rows, rowCount: r.rows.length, truncated: r.truncated }).slice(0, 30000));
    } catch (e) {
      entry.error = e.message;
      if (e instanceof GuardError) {
        entry.status = 'rejected';
        ctx.budget.rejections++;
        ctx.notes.push(`Guard blocked a query from @${ctx.agentHandle}: ${e.message}`);
      } else entry.status = 'error';
      throw e;
    }
  },
};
