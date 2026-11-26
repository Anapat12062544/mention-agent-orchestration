// Model ids, display labels, prices and usage recording.
const MODELS = {
  haiku: process.env.MODEL_HAIKU || 'claude-haiku-5-5',
  sonnet: process.env.MODEL_SONNET || 'claude-sonnet-5-5',
  opus: process.env.MODEL_OPUS || 'claude-opus-5-5',
};

// USD per 1M tokens: [input, output, cache read, cache write(5m)].
// ponytail: static table; update when prices change. Haiku >100K-token prompts bill higher — ignored here.
const PRICES = {
  'claude-haiku-5-5': [0.10, 0.50, 0.01, 0.125],
  'claude-sonnet-5-5': [2, 10, 0.10, 2.5],
  'claude-opus-5-5': [4, 20, 0.20, 5],
  'gpt-5-mini': [0.25, 2, 0.025, 0],
  'gpt-5-nano': [0.05, 0.40, 0.005, 0],
  'gpt-4.1-mini': [0.40, 1.60, 0.10, 0],
};

function cost(model, u) {
  const p = PRICES[model] || PRICES[Object.keys(PRICES).find(k => model.startsWith(k))] || [0, 0, 0, 0];
  return (u.input_tokens * p[0] + u.output_tokens * p[1] + u.cache_read_tokens * p[2] + u.cache_write_tokens * p[3]) / 1e6;
}

// 'claude-sonnet-5-5' -> 'Sonnet 5.5'
const label = id => {
  const m = /claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(id || '');
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? '.' + m[3] : ''}` : id;
};

// Normalise Anthropic / OpenAI usage objects.
function fromAnthropic(model, u = {}) {
  const row = {
    provider: 'anthropic', model,
    input_tokens: u.input_tokens || 0, output_tokens: u.output_tokens || 0,
    cache_read_tokens: u.cache_read_input_tokens || 0, cache_write_tokens: u.cache_creation_input_tokens || 0,
  };
  return { ...row, cost_usd: cost(model, row) };
}
function fromOpenAI(model, u = {}) {
  const cached = u.prompt_tokens_details?.cached_tokens || 0;
  const row = {
    provider: 'openai', model,
    input_tokens: (u.prompt_tokens || 0) - cached, output_tokens: u.completion_tokens || 0,
    cache_read_tokens: cached, cache_write_tokens: 0,
  };
  return { ...row, cost_usd: cost(model, row) };
}

async function record(row) {
  const { app } = require('./db');
  await app.query(
    `INSERT INTO ai_usage (user_id, conversation_id, agent_handle, purpose, provider, model,
       input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [row.user_id, row.conversation_id, row.agent_handle, row.purpose, row.provider, row.model,
      row.input_tokens, row.output_tokens, row.cache_read_tokens, row.cache_write_tokens, row.cost_usd]);
}

module.exports = { MODELS, PRICES, cost, label, fromAnthropic, fromOpenAI, record };
