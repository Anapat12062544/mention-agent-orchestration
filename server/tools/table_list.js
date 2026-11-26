const { readerQuery } = require('../db');
const { wrapUntrusted } = require('../guard');

module.exports = {
  name: 'table_list',
  type: 'read',
  description: 'List the tables you can query, with approximate row counts and descriptions.',
  input_schema: { type: 'object', properties: {}, additionalProperties: false },
  async run(_input, ctx) {
    const { rows } = await readerQuery(ctx.config.schema, `
      SELECT c.relname AS name, greatest(c.reltuples, 0)::bigint AS approx_rows, obj_description(c.oid) AS description
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relkind IN ('r', 'v', 'm') AND has_table_privilege(c.oid, 'SELECT')
      ORDER BY 1`, [ctx.config.schema]);
    const visible = rows.filter(r => !ctx.isHiddenTable(r.name));
    return wrapUntrusted('table_list', JSON.stringify(visible));
  },
};
