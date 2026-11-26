// Agent loop: Claude + tools, shared budget across the whole question (including ask_agent hops).
// No DB access here — everything stateful comes through ctx, so checks can run with fakes.
const { tools } = require('./config');
const { GUARD_RULES, redactText } = require('./guard');
const { MODELS, fromAnthropic } = require('./usage');

const MAX_DEPTH = 2;      // ask_agent may hand off at most 2 levels deep
const MAX_TURNS = 20;     // hard stop independent of budget

const newBudget = (o = {}) => ({
  toolCalls: 12, sql: 8, rows: 2000, ms: 75_000, rejections: 0, maxRejections: 3, started: Date.now(), ...o,
});

// First @mention that is an agent answers; the remaining mentioned agents may be consulted.
function pickAgent(text, agents) {
  const byHandle = new Map(agents.map(a => [a.handle, a]));
  const mentioned = [...new Set([...String(text).matchAll(/@([a-z][a-z0-9_]*)/gi)].map(m => m[1].toLowerCase()))]
    .filter(h => byHandle.has(h)).map(h => byHandle.get(h));
  const responder = mentioned[0] || agents.find(a => a.is_default) || agents[0];
  return { responder, others: mentioned.slice(1) };
}

function systemPrompt(agent, ctx) {
  const peers = ctx.agents.filter(a => a.handle !== agent.handle)
    .map(a => `- @${a.handle}: ${a.name}${a.description ? ' — ' + a.description : ''}`).join('\n');
  return `You are @${agent.handle} (${agent.name}), an AI data agent in the "${ctx.config.name}" console.

${agent.instructions}

${ctx.config.context}

How to work:
- Use table_list / describe_table only when you need them. Prefer one focused, aggregated SQL per part of the question.
- Answer in the user's language (Thai if they write Thai). Lead with the answer, then key numbers (a small markdown table is fine), then a short explanation.
- Always state the period and filters you used.
${peers && agent.tools.includes('ask_agent') ? `\nOther agents you can consult with ask_agent:\n${peers}\n` : ''}
${GUARD_RULES}`;
}

const toApiTool = t => ({ name: t.name, description: t.description, input_schema: t.input_schema });

async function execTool(use, available, ctx) {
  const tool = available.find(t => t.name === use.name);
  ctx.budget.toolCalls--;
  const fail = msg => ({ type: 'tool_result', tool_use_id: use.id, content: `Error: ${msg}`, is_error: true });
  if (!tool) return fail(`unknown tool "${use.name}"`);
  if (ctx.budget.toolCalls < 0) return fail('tool budget for this question is used up. Answer now with what you have.');
  if (Date.now() - ctx.budget.started > ctx.budget.ms) return fail('time budget is used up. Answer now with what you have.');
  try {
    const out = tool.type === 'write' ? await ctx.propose(tool, use.input || {}, ctx) : await tool.run(use.input || {}, ctx);
    return { type: 'tool_result', tool_use_id: use.id, content: String(out) };
  } catch (e) {
    return fail(e.message);
  }
}

async function callClaude(client, modelKey, params) {
  // Server-side refusal fallback (beta) for Sonnet/Opus; Haiku has none. CLAUDE_FALLBACKS=off disables.
  if (modelKey !== 'haiku' && process.env.CLAUDE_FALLBACKS !== 'off') {
    return client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
  }
  return client.messages.create(params);
}

/**
 * Run one agent until it answers. Returns the final text.
 * ctx: { config, agents, budget, user, agentHandle, depth, queries, notes, proposals, delegations,
 *        askAgent(handle, q), propose(tool, input, ctx), record(usageRow), anthropic }
 */
async function runAgent({ agent, modelKey, text, history = [], tagHints = [], ctx }) {
  const available = agent.tools.map(n => tools[n]).filter(Boolean)
    .filter(t => t.type === 'read' || t.roles?.includes(ctx.user.role))
    .filter(t => t.name !== 'ask_agent' || ctx.depth < MAX_DEPTH);
  const system = [{ type: 'text', text: systemPrompt(agent, ctx), cache_control: { type: 'ephemeral' } }];
  const filters = tagHints.length ? `\n\n<selected_filters>\n${tagHints.join('\n')}\n</selected_filters>` : '';
  const messages = [...history, { role: 'user', content: String(text) + filters }];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const elapsed = Date.now() - ctx.budget.started;
    const exhausted = ctx.budget.toolCalls <= 0 || elapsed > ctx.budget.ms || turn === MAX_TURNS - 1;
    const params = { model: MODELS[modelKey], max_tokens: 16000, system, messages };
    if (available.length) {
      params.tools = available.map(toApiTool);
      if (exhausted) params.tool_choice = { type: 'none' }; // force a final answer
    }
    const res = await callClaude(ctx.anthropic, modelKey, params);
    await ctx.record({ ...fromAnthropic(res.model || MODELS[modelKey], res.usage), purpose: 'agent', agent_handle: agent.handle });

    if (res.stop_reason === 'refusal') return 'ขออภัย คำถามนี้โมเดลปฏิเสธที่จะตอบตามนโยบายความปลอดภัย';
    messages.push({ role: 'assistant', content: res.content }); // keep thinking blocks as-is
    if (res.stop_reason === 'pause_turn') continue;

    const uses = res.content.filter(b => b.type === 'tool_use');
    if (res.stop_reason !== 'tool_use' || !uses.length) {
      return redactText(res.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim());
    }
    const results = [];
    for (const u of uses) results.push(await execTool(u, available, ctx)); // sequential: budget is shared
    messages.push({ role: 'user', content: results });

    if (ctx.budget.rejections >= ctx.budget.maxRejections) {
      ctx.notes.push(`Stopped: ${ctx.budget.rejections} queries were rejected by the guard.`);
      return 'หยุดการทำงาน: query ถูกระบบความปลอดภัยปฏิเสธครบ 3 ครั้ง ลองถามใหม่ให้เจาะจงขึ้น หรือดูรายละเอียดใน "Ran queries"';
    }
  }
  return 'หยุดการทำงาน: เกินจำนวนรอบที่กำหนด';
}

module.exports = { runAgent, pickAgent, newBudget, systemPrompt, MAX_DEPTH };
