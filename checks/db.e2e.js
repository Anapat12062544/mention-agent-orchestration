// End-to-end against the real Postgres from docker compose, with a FAKE Claude client (no API key, no cost).
//   docker compose up -d db && node checks/db.e2e.js
process.env.DATABASE_URL ||= 'postgres://app:app_dev_pw@localhost:5433/aiconsole';
process.env.READER_DATABASE_URL ||= 'postgres://ai_reader:reader_dev_pw@localhost:5433/aiconsole';
process.env.CLAUDE_FALLBACKS = 'off';
delete process.env.OPENAI_API_KEY;

const assert = require('assert/strict');
const { app, reader } = require('../server/db');
const { config, isHiddenTable } = require('../server/config');
const { runGuarded } = require('../server/tools/run_sql');
const { newBudget } = require('../server/agent');
const chat = require('../server/chat');
const changes = require('../server/changes');

const ctx = () => ({ config, isHiddenTable, budget: newBudget() });
const blocked = async (sql, re) => {
  await assert.rejects(runGuarded(sql, ctx()), re, sql);
};

(async () => {
  // ---- guarded SQL on the real read-only role
  const ok = await runGuarded(`SELECT platform, sum(gmv) AS gmv FROM orders WHERE status <> 'cancelled' GROUP BY 1 ORDER BY 2 DESC`, ctx());
  assert.deepEqual(ok.columns, ['platform', 'gmv']);
  assert.equal(ok.rows.length, 3);
  await blocked('SELECT sku, cost_price FROM products', /cost_price/);
  await blocked('SELECT * FROM products', /cost_price/);                       // * expands to the hidden column
  await blocked('SELECT name FROM api_keys', /api_keys|permission denied/);
  await blocked('SELECT username FROM public.app_users', /schema "public"|permission denied/);
  await blocked('SELECT to_jsonb(p) FROM products p', /whole-row/);
  await blocked(`SELECT nextval('order_seq')`, /read-only|permission denied/); // even "harmless" writes fail
  await blocked('SELECT 1; SELECT 2', /one statement/);
  const t0 = Date.now();
  await blocked('SELECT count(*) FROM generate_series(1, 100000000000) g', /timeout|canceling/);
  assert.ok(Date.now() - t0 < 12_000, 'statement_timeout should stop it');
  const capped = await runGuarded('SELECT order_id FROM orders', { ...ctx(), budget: newBudget({ rows: 50 }) });
  assert.equal(capped.rows.length, 50);
  assert.equal(capped.truncated, true);
  console.log('  guarded SQL ok');

  // ---- full question with fake Claude: explore → query (+1 blocked) → propose a price change → answer
  const user = (await app.query(`SELECT id, username, display_name, role FROM app_users WHERE username = 'manager'`)).rows[0];
  const use = (id, name, input) => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }], usage: { input_tokens: 900, output_tokens: 80 } });
  const script = [
    () => use('a', 'describe_table', { table: 'products' }),
    p => { assert.doesNotMatch(JSON.stringify(p.messages), /cost_price/); return use('b', 'run_sql', { sql: 'SELECT cost_price FROM products', purpose: 'margin' }); },
    () => use('c', 'run_sql', { sql: `SELECT sku, price FROM products WHERE sku = 'KMB-001'`, purpose: 'current price' }),
    () => use('d', 'propose_price_change', { sku: 'KMB-001', new_price: 149, reason: 'e2e test' }),
    p => {
      assert.match(JSON.stringify(p.messages), /Proposal #\d+ created/);
      return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'เสนอปรับราคา KMB-001 เป็น 149 บาท รอกด Apply' }], usage: { input_tokens: 1200, output_tokens: 40 } };
    },
  ];
  const client = { messages: { create: async p => script.shift()(p) } };
  const out = await chat.answer({ user, text: '@pricing [e2e] ลดราคา KMB-001 ได้ไหม', tags: [{ type: 'brand', value: 'Kiss My Body', label: 'Kiss My Body' }], client });
  const meta = out.message.meta;
  assert.equal(out.message.agent_handle, 'pricing');
  assert.equal(meta.router.by, 'agent');                       // @pricing locks Sonnet
  assert.deepEqual(meta.queries.map(q => q.status), ['rejected', 'ok']);
  assert.equal(meta.notes.length, 1);
  assert.equal(meta.proposals.length, 1);
  const usageRows = (await app.query('SELECT count(*)::int AS n FROM ai_usage WHERE conversation_id = $1', [out.conversationId])).rows[0].n;
  assert.equal(usageRows, 5);
  console.log('  chat + persistence ok');

  // ---- write safety: apply → undo → stale proposal rejected
  const price = async () => (await app.query(`SELECT price::text AS p FROM shop.products WHERE sku = 'KMB-001'`)).rows[0].p;
  const original = await price();
  const id = meta.proposals[0].id;
  await assert.rejects(changes.apply(id, { id: 1, role: 'staff' }), /not allowed/);
  await changes.apply(id, user);
  assert.equal(await price(), '149.00');
  await assert.rejects(changes.apply(id, user), /applied/);
  await changes.undo(id, user);
  assert.equal(await price(), original);

  const stale = (await app.query(
    `INSERT INTO ai_change_log (domain, user_id, tool, target_table, target_key, field, before_value, after_value)
     VALUES ('shop', $1, 'propose_price_change', 'products', 'KMB-001', 'price', '1.00', '2.00') RETURNING id`, [user.id])).rows[0].id;
  await assert.rejects(changes.apply(stale, user), /changed since proposal/);
  assert.equal((await app.query('SELECT status FROM ai_change_log WHERE id = $1', [stale])).rows[0].status, 'rejected');
  assert.equal(await price(), original);
  console.log('  apply / undo / stale ok');

  // clean up test data so the demo usage page starts at zero
  await app.query(`DELETE FROM ai_usage WHERE conversation_id IN (SELECT id FROM ai_conversations WHERE title LIKE '@pricing [e2e]%')`);
  await app.query(`UPDATE ai_conversations SET deleted_at = now() WHERE title LIKE '@pricing [e2e]%'`);
  console.log('db.e2e.js ok');
  await app.end(); await reader.end();
})().catch(async e => { console.error(e); process.exit(1); });
