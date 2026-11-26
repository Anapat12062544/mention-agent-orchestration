module.exports = {
  name: 'ask_agent',
  type: 'read',
  description: 'Ask another agent (by handle) a focused sub-question and get its answer. Use when the question needs that agent\'s specialty.',
  input_schema: {
    type: 'object',
    properties: {
      handle: { type: 'string', description: 'Agent handle without @, e.g. "ads"' },
      question: { type: 'string', description: 'Self-contained question including the period and filters' },
    },
    required: ['handle', 'question'],
    additionalProperties: false,
  },
  run: ({ handle, question }, ctx) => ctx.askAgent(handle, question),
};
