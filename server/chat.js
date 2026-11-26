// One question in → one answer out. Server owns history; client only sends text + tags.
const Anthropic = require('@anthropic-ai/sdk');
const { app } = require('./db');
const { config } = require('./config');
const { isHiddenTable } = require('./config');
const { runAgent, pickAgent, newBudget, MAX_DEPTH } = require('./agent');
const { route } = require('./router');
const usage = require('./usage');
const changes = require('./changes');
const { HttpError } = changes;

let anthropic;
const claude = () => (anthropic ||= new Anthropic());

const listAgents = async () => (await app.query(
  'SELECT * FROM ai_agents WHERE domain = $1 AND deleted_at IS NULL ORDER BY is_default DESC, handle', [config.id])).rows;

function tagHints(tags) {
  if (!Array.isArray(tags) || tags.length > 10) throw new HttpError(400, 'tags must be an array (max 10)');
  return tags.map(t => {
    const def = config.tags[t?.type];
    if (!def) throw new HttpError(400, `unknown tag type "${t?.type}"`);
    if (def.static && !def.static.includes(t.value)) throw new HttpError(400, `bad value for @${t.type}`);
    const safe = { value: String(t.value).replace(/'/g, "''").slice(0, 200), label: String(t.label ?? t.value).slice(0, 200) };
    return `@${t.type} ${safe.label} → ${def.hint ? def.hint(safe) : `${t.type} = '${safe.value}'`}`;
  });
}

const chooseModel = (agent, text, record) => (agent.model !== 'auto'
  ? Promise.resolve({ model: agent.model, reason: 'locked by agent settings', by: 'agent' })
  : route(text, { record }));

async function answer({ user, conversationId, text, tags = [], source = 'chat', title, client }) {
  text = String(text || '').trim();
  if (!text || text.length > 4000) throw new HttpError(400, 'text is required (max 4000 chars)');
  const hints = tagHints(tags);
  if (!client && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    throw new HttpError(503, 'ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY ใน .env');
  }

  let conv;
  if (conversationId) {
    conv = (await app.query('SELECT * FROM ai_conversations WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [conversationId, user.id])).rows[0];
    if (!conv) throw new HttpError(404, 'conversation not found');
  } else {
    conv = (await app.query('INSERT INTO ai_conversations (domain, user_id, title, source) VALUES ($1,$2,$3,$4) RETURNING *',
      [config.id, user.id, title || text.slice(0, 80), source])).rows[0];
  }
  const history = (await app.query(
    `SELECT role, content FROM (SELECT * FROM ai_messages WHERE conversation_id = $1 ORDER BY id DESC LIMIT 20) m ORDER BY id`,
    [conv.id])).rows;

  const agents = await listAgents();
  if (!agents.length) throw new HttpError(500, 'no agents configured');
  const { responder, others } = pickAgent(text, agents);
  const allowed = others.map(a => a.handle); // empty = any agent may be consulted

  const budget = newBudget();
  const shared = { queries: [], notes: [], proposals: [], delegations: [] };
  const record = row => usage.record({ ...row, user_id: user.id, conversation_id: conv.id });

  const makeCtx = (agent, depth) => ({
    ...shared, config, isHiddenTable, agents, budget, user, depth, record,
    conversationId: conv.id, agentHandle: agent.handle, anthropic: client || claude(), propose: changes.propose,
    async askAgent(handle, question) {
      handle = String(handle || '').replace(/^@/, '').toLowerCase();
      const target = agents.find(a => a.handle === handle);
      if (!target) throw new Error(`unknown agent @${handle}. Available: ${agents.map(a => '@' + a.handle).join(', ')}`);
      if (target.handle === agent.handle) throw new Error('an agent cannot ask itself');
      if (depth + 1 > MAX_DEPTH) throw new Error('delegation depth limit reached');
      if (allowed.length && !allowed.includes(handle)) throw new Error(`only ${allowed.map(h => '@' + h).join(', ')} may be consulted for this question`);
      const sel = await chooseModel(target, question, r => record({ ...r, agent_handle: handle }));
      const d = { from: agent.handle, to: handle, question: String(question).slice(0, 1000), model: usage.MODELS[sel.model] };
      shared.delegations.push(d);
      const ans = await runAgent({ agent: target, modelKey: sel.model, text: question, tagHints: hints, ctx: makeCtx(target, depth + 1) });
      d.answer = ans.slice(0, 3000);
      return `<agent_answer from="@${handle}">\n${ans}\n</agent_answer>`;
    },
  });

  const router = await chooseModel(responder, text, r => record({ ...r, agent_handle: responder.handle }));
  let content;
  try {
    content = await runAgent({ agent: responder, modelKey: router.model, text, history, tagHints: hints, ctx: makeCtx(responder, 0) });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new HttpError(503, 'ANTHROPIC_API_KEY ไม่ถูกต้อง');
    if (e instanceof Anthropic.RateLimitError) throw new HttpError(429, 'Claude API rate limit — ลองใหม่อีกครั้ง');
    if (e instanceof Anthropic.APIError) throw new HttpError(502, `Claude API error: ${e.message}`);
    throw e;
  }

  const meta = {
    ...shared, tags,
    router: { ...router, model_id: usage.MODELS[router.model] },
    budget: { toolCallsLeft: Math.max(0, budget.toolCalls), sqlLeft: budget.sql, rowsLeft: budget.rows, ms: Date.now() - budget.started },
  };
  await app.query('INSERT INTO ai_messages (conversation_id, role, content, meta) VALUES ($1, $2, $3, $4)',
    [conv.id, 'user', text, { tags }]);
  const msg = (await app.query(
    `INSERT INTO ai_messages (conversation_id, role, content, agent_handle, model, meta) VALUES ($1,'assistant',$2,$3,$4,$5) RETURNING *`,
    [conv.id, content || '(no answer)', responder.handle, usage.MODELS[router.model], meta])).rows[0];
  await app.query('UPDATE ai_conversations SET updated_at = now() WHERE id = $1', [conv.id]);
  return { conversationId: conv.id, message: msg };
}

module.exports = { answer, listAgents, tagHints };
