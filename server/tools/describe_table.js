const { readerQuery, quoteIdent } = require('../db');
const { wrapUntrusted, redactRows } = require('../guard');

module.exports = {
  name: 'describe_table',
  type: 'read',
  description: 'Show columns (name, type, description) and 3 sample rows of one table.',
  input_schema: {
    type: 'object',
    properties: { table: { type: 'string', description: 'Table name from table_list' } },
    required: ['table'],
    additionalProperties: false,
  },
  async run({ table }, ctx) {
    const { config, isHiddenTable } = ctx;
    if (!/^[a-z_][a-z0-9_]*$/i.test(table || '') || isHiddenTable(table)) throw new Error(`table "${table}" is not available`);
    const cols = (await readerQuery(config.schema, `
      SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type, col_description(a.attrelid, a.attnum) AS description
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
        AND has_table_privilege(c.oid, 'SELECT')
      ORDER BY a.attnum`, [config.schema, table])).rows.filter(c => !config.hiddenColumns.test(c.name));
    if (!cols.length) throw new Error(`table "${table}" not found`);
    const sample = await readerQuery(config.schema,
      `SELECT ${cols.map(c => quoteIdent(c.name)).join(', ')} FROM ${quoteIdent(table)} LIMIT 3`);
    const s = redactRows(sample.fields, sample.rows, config.hiddenColumns);
    return wrapUntrusted('describe_table', JSON.stringify({ table, columns: cols, sample: s }));
  },
};
