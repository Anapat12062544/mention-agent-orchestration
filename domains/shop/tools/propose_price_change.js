// Write tool: never writes. It records a proposal; a human clicks Apply (server/changes.js does the write).
module.exports = {
  name: 'propose_price_change',
  type: 'write',
  roles: ['admin', 'manager'],
  target: { table: 'products', key: 'sku', field: 'price' },  // the only thing Apply may touch
  maxPerQuestion: 10,
  description: 'Propose a new list price for one SKU. Creates a pending proposal that a human must Apply. Does NOT change data.',
  input_schema: {
    type: 'object',
    properties: {
      sku: { type: 'string', description: 'Product SKU, e.g. KMB-001' },
      new_price: { type: 'number', description: 'New list price in THB' },
      reason: { type: 'string', description: 'Short justification shown to the approver' },
    },
    required: ['sku', 'new_price', 'reason'],
    additionalProperties: false,
  },
  validate({ new_price }, before) {
    const p = Number(new_price), b = Number(before);
    if (!(p > 0)) return 'new_price must be > 0';
    if (Math.abs(p - b) / b > 0.5) return 'change larger than 50% is not allowed';
    return null;
  },
};
