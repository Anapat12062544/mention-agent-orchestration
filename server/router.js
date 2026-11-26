// Model router: a small, fast model grades the question and picks haiku | sonnet | opus.
// GPT (OPENAI_API_KEY) if set, else Claude Haiku. Any failure or >3s → sonnet.
const { MODELS, fromAnthropic, fromOpenAI } = require('./usage');

const ROUTER_PROMPT = `You route business-data questions to a model tier. Reply with JSON only:
{"model":"haiku|sonnet|opus","reason":"<at most 12 words>"}
haiku  = one number, one lookup, a simple list or filter.
sonnet = comparisons across periods/platforms/groups, rankings, several metrics, simple trends.
opus   = "why"/root-cause analysis, multi-step investigation, forecasting, recommendations with trade-offs.`;

const TIMEOUT_MS = 3000;

let openai, anthropic;
const clients = {
  openai: () => (openai ||= new (require('openai'))()),
  anthropic: () => (anthropic ||= new (require('@anthropic-ai/sdk'))()),
};

async function viaOpenAI(text, client) {
  const model = process.env.OPENAI_ROUTER_MODEL || 'gpt-5-mini';
  const res = await client.chat.completions.create({
    model,
    messages: [{ role: 'system', content: ROUTER_PROMPT }, { role: 'user', content: text }],
    response_format: { type: 'json_object' },
    ...(/^(gpt-5|o\d)/.test(model) ? { reasoning_effort: 'minimal' } : {}),
  }, { timeout: TIMEOUT_MS, maxRetries: 0 });
  return { raw: res.choices[0].message.content, usage: fromOpenAI(model, res.usage), by: model };
}

async function viaHaiku(text, client) {
  const res = await client.messages.create({
    model: MODELS.haiku,
    max_tokens: 200,
    thinking: { type: 'disabled' },
    system: ROUTER_PROMPT,
    messages: [{ role: 'user', content: text }],
  }, { timeout: TIMEOUT_MS, maxRetries: 0 });
  const raw = res.content.filter(b => b.type === 'text').map(b => b.text).join('');
  return { raw, usage: fromAnthropic(MODELS.haiku, res.usage), by: MODELS.haiku };
}

// deps lets checks inject fake clients.
async function route(text, { record = async () => {}, deps = {} } = {}) {
  const started = Date.now();
  let timer;
  try {
    const call = process.env.OPENAI_API_KEY || deps.openai
      ? viaOpenAI(text, deps.openai || clients.openai())
      : viaHaiku(text, deps.anthropic || clients.anthropic());
    const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('router timeout')), TIMEOUT_MS); });
    const out = await Promise.race([call, timeout]);
    await record({ ...out.usage, purpose: 'router' });
    const j = JSON.parse(/\{[\s\S]*\}/.exec(out.raw)[0]);
    if (!['haiku', 'sonnet', 'opus'].includes(j.model)) throw new Error(`bad model "${j.model}"`);
    return { model: j.model, reason: String(j.reason || '').slice(0, 120), by: out.by, ms: Date.now() - started };
  } catch (e) {
    return { model: 'sonnet', reason: `fallback (${e.message.slice(0, 80)})`, by: 'fallback', ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { route, ROUTER_PROMPT };
