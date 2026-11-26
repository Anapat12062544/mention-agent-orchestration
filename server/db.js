const pg = require('pg');

pg.types.setTypeParser(1082, v => v); // DATE stays 'YYYY-MM-DD' (no timezone shift)

// App pool: owns ai_* tables and performs human-approved writes.
const app = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
// Reader pool: the only connection AI-written SQL ever touches. Read-only DB role, tiny pool,
// so a burst of AI queries can never starve the app.
const reader = new pg.Pool({ connectionString: process.env.READER_DATABASE_URL, max: 3 });

const quoteIdent = s => '"' + String(s).replace(/"/g, '""') + '"';

// Run trusted (config/server-authored) SQL as the reader, inside a read-only tx on the domain schema.
async function readerQuery(schema, text, values = []) {
  const c = await reader.connect();
  try {
    await c.query('BEGIN READ ONLY');
    await c.query(`SET LOCAL search_path = ${quoteIdent(schema)}`);
    return await c.query(text, values);
  } finally {
    await c.query('ROLLBACK').catch(() => {});
    c.release();
  }
}

module.exports = { app, reader, quoteIdent, readerQuery };
