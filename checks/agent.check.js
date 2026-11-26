// Agent loop with a fake Claude client and fake SQL runner. No DB, no API key.
process.env.CLAUDE_FALLBACKS = 'off';
const assert = require('assert/strict');
const { runAgent, pickAgent, newBudget } = require('../server/agent');
const { GuardError } = require('../server/guard');
const { config } = require('../server/config');
const { route } = require('../server/router');
const { nextRun } = require('../server/routines');

const agents = [
  { handle: 'analyst', name: 'Analyst', is_default: true, model: 'auto', tools: ['run_sql', 'ask_agent'], instructions: 'x' },
  { handle: 'ads', name: 'Ads', model: 'auto', tools: ['run_sql'], instructions: 'y' },
];

// pickAgent
assert.equal(pickAgent('ยอดขาย @platform Shopee', agents).responder.handle, 'analyst');
const p = pickAgent('@ads แล้วถาม @analyst ด้วย @nobody', agents);
assert.equal(p.responder.handle, 'ads');
assert.deepEqual(p.others.map(a => a.handle), ['analyst']);

const usage = { input_tokens: 10, output_tokens: 5 };
const text = t => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: t }], usage });
const sqlCall = (id, sql) => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name: 'run_sql', input: { sql, purpose: 'p' } }], usage });

function fakeClient(script) {
  const calls = [];
  const create = async params => { calls.push(JSON.parse(JSON.stringify(params))); return script.shift()(params); };
  return { calls, messages: { create }, beta: { messages: { create } } };
}
function makeCtx(client, over = {}) {
  const records = [];
  return {
    config, agents, budget: newBudget(), user: { id: 1, role: 'admin' }, depth: 0, agentHandle: 'analyst',
    queries: [], notes: [], proposals: [], delegations: [], records,
    record: async r => records.push(r), anthropic: client,
    runGuarded: async sql => {
      if (/cost_price/.test(sql)) throw new GuardError('column "cost_price" is not available');
      return { columns: ['platform', 'gmv'], rows: [['Shopee', 1000]], truncated: false };
    },
    ...over,
  };
}

(async () => {
  // 1. happy path: one query, then answer; secrets redacted from final text
  {
    const c = fakeClient([() => sqlCall('t1', 'SELECT platform, sum(gmv) FROM orders GROUP BY 1'), () => text('GMV 1,000 sk-ant-api03-aaaaaaaaaaaaaaaaaaaa')]);
    const ctx = makeCtx(c);
    const out = await runAgent({ agent: agents[0], modelKey: 'sonnet', text: 'q', tagHints: ['@platform Shopee → platform = \'Shopee\''], ctx });
    assert.equal(out, 'GMV 1,000 [redacted]');
    assert.equal(ctx.queries.length, 1);
    assert.equal(ctx.queries[0].status, 'ok');
    assert.equal(ctx.records.length, 2);
    assert.match(c.calls[0].messages[0].content, /<selected_filters>/);
    assert.match(c.calls[0].system[0].text, /<guard_rules>[\s\S]*<\/guard_rules>$/); // guard rules always last
    assert.match(c.calls[1].messages[2].content[0].content, /<untrusted_data source="run_sql">/);
  }
  // 2. three guard rejections → stop immediately
  {
    const c = fakeClient([1, 2, 3].map(i => () => sqlCall('r' + i, 'SELECT cost_price FROM products')));
    const ctx = makeCtx(c);
    const out = await runAgent({ agent: agents[0], modelKey: 'sonnet', text: 'q', ctx });
    assert.match(out, /ปฏิเสธครบ 3 ครั้ง/);
    assert.equal(ctx.queries.filter(q => q.status === 'rejected').length, 3);
    assert.equal(c.calls.length, 3);
  }
  // 3. tool budget exhausted → final call forced with tool_choice none
  {
    const c = fakeClient([() => sqlCall('b1', 'SELECT 1'), () => text('done')]);
    const ctx = makeCtx(c, { budget: newBudget({ toolCalls: 1 }) });
    await runAgent({ agent: agents[0], modelKey: 'haiku', text: 'q', ctx });
    assert.equal(c.calls[1].tool_choice.type, 'none');
  }
  // 4. depth limit: at depth 2, ask_agent is not offered
  {
    const c = fakeClient([() => text('ok')]);
    await runAgent({ agent: agents[0], modelKey: 'sonnet', text: 'q', ctx: makeCtx(c, { depth: 2 }) });
    assert.deepEqual(c.calls[0].tools.map(t => t.name), ['run_sql']);
  }
  // 5. write tools only for allowed roles; write goes through ctx.propose, never tool.run
  {
    const pricing = { handle: 'pricing', name: 'P', model: 'sonnet', tools: ['run_sql', 'propose_price_change'], instructions: 'z' };
    const c1 = fakeClient([() => text('ok')]);
    await runAgent({ agent: pricing, modelKey: 'sonnet', text: 'q', ctx: makeCtx(c1, { user: { id: 3, role: 'staff' } }) });
    assert.deepEqual(c1.calls[0].tools.map(t => t.name), ['run_sql']);
    let proposed;
    const c2 = fakeClient([
      () => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'w1', name: 'propose_price_change', input: { sku: 'KMB-001', new_price: 149, reason: 'r' } }], usage }),
      () => text('proposed'),
    ]);
    await runAgent({ agent: pricing, modelKey: 'sonnet', text: 'q', ctx: makeCtx(c2, { propose: async (t, i) => { proposed = [t.name, i.sku]; return 'Proposal #1'; } }) });
    assert.deepEqual(proposed, ['propose_price_change', 'KMB-001']);
  }
  // 6. refusal is handled, not crashed
  {
    const c = fakeClient([() => ({ stop_reason: 'refusal', content: [], usage })]);
    assert.match(await runAgent({ agent: agents[0], modelKey: 'opus', text: 'q', ctx: makeCtx(c) }), /ปฏิเสธ/);
  }

  // router: parses JSON, falls back to sonnet on garbage / error / timeout
  const fakeOpenAI = reply => ({ chat: { completions: { create: async () => reply() } } });
  const oa = c => ({ choices: [{ message: { content: c } }], usage: { prompt_tokens: 50, completion_tokens: 10 } });
  assert.equal((await route('ทำไมยอดตก', { deps: { openai: fakeOpenAI(() => oa('{"model":"opus","reason":"root cause"}')) } })).model, 'opus');
  assert.equal((await route('x', { deps: { openai: fakeOpenAI(() => oa('{"model":"gpt"}')) } })).model, 'sonnet');
  assert.equal((await route('x', { deps: { openai: fakeOpenAI(() => { throw new Error('down'); }) } })).by, 'fallback');
  const slow = await route('x', { deps: { openai: fakeOpenAI(() => new Promise(r => setTimeout(() => r(oa('{"model":"haiku"}')), 3500))) } });
  assert.equal(slow.model, 'sonnet');
  assert.match(slow.reason, /timeout/);

  // routines: next run in Asia/Bangkok, weekdays only
  const fri = new Date('2026-11-27T02:00:00Z');                    // Fri 09:00 BKK
  assert.equal(nextRun('08:00', [1, 2, 3, 4, 5], fri).toISOString(), '2026-11-30T01:00:00.000Z'); // Mon 08:00 BKK
  assert.equal(nextRun('10:00', [5], fri).toISOString(), '2026-11-27T03:00:00.000Z');             // same day later

  console.log('agent.check.js ok');
})().catch(e => { console.error(e); process.exit(1); });
