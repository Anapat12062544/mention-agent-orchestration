// Loads the active domain (DOMAIN env) and the tool registry: one file per tool,
// generic tools in server/tools, domain tools in domains/<domain>/tools.
const fs = require('fs');
const path = require('path');

const DOMAIN = process.env.DOMAIN || 'shop';
if (!/^[a-z0-9_-]+$/.test(DOMAIN)) throw new Error(`bad DOMAIN "${DOMAIN}"`);
const domainDir = path.join(__dirname, '..', 'domains', DOMAIN);

const config = require(path.join(domainDir, 'domain.config.js'));
config.id = DOMAIN;
// non-global copy so .test() is stateless
config.hiddenColumns = new RegExp(config.hiddenColumns.source, config.hiddenColumns.flags.replace('g', ''));

const loadDir = dir => (fs.existsSync(dir) ? fs.readdirSync(dir) : [])
  .filter(f => f.endsWith('.js'))
  .map(f => require(path.join(dir, f)));

const tools = {};
for (const t of [...loadDir(path.join(__dirname, 'tools')), ...loadDir(path.join(domainDir, 'tools'))]) {
  if (!['read', 'write'].includes(t.type)) throw new Error(`tool ${t.name}: type must be read|write`);
  tools[t.name] = t;
}

const isHiddenTable = name => config.hiddenTables.some(h => (h instanceof RegExp ? h.test(name) : h === name));

module.exports = { config, tools, isHiddenTable };
