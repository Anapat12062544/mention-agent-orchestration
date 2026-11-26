// Everything domain-specific lives here. The engine never says "brand" or "Shopee".
// To build a new domain: copy this folder, change schema/tags/agents/context, add seed SQL.

const BKK_TODAY = "(now() AT TIME ZONE 'Asia/Bangkok')::date";
const periods = {
  today: `order_date = ${BKK_TODAY}`,
  yesterday: `order_date = ${BKK_TODAY} - 1`,
  this_week: `order_date >= date_trunc('week', ${BKK_TODAY})::date`,
  this_month: `order_date >= date_trunc('month', ${BKK_TODAY})::date`,
  last_month: `order_date >= (date_trunc('month', ${BKK_TODAY}) - interval '1 month')::date AND order_date < date_trunc('month', ${BKK_TODAY})::date`,
};

module.exports = {
  name: 'Shop Performance',
  schema: 'shop',
  hiddenTables: ['users', 'api_keys', /^ai_/],
  hiddenColumns: /(password|token|secret|cost_price)/i,

  // Data tags. `values`/`search` SQL runs as the read-only role; first column = value, second = label.
  // `hint` turns the picked value into a filter hint for the agent (text only — the agent still writes SQL).
  tags: {
    platform: { label: 'Platform', values: { sql: 'SELECT DISTINCT platform FROM orders ORDER BY 1' }, hint: t => `platform = '${t.value}'` },
    brand:    { label: 'Brand',    values: { sql: 'SELECT name FROM brands ORDER BY 1' },             hint: t => `brand_name = '${t.value}'` },
    shop:     { label: 'Shop',     values: { sql: 'SELECT id, name FROM shops ORDER BY 2' },          hint: t => `shop_id = '${t.value}' (${t.label})` },
    sku:      { label: 'SKU',      search: { sql: "SELECT sku, sku || ' · ' || title FROM products WHERE sku ILIKE '%'||$1||'%' OR title ILIKE '%'||$1||'%' ORDER BY 1 LIMIT 20" }, hint: t => `sku = '${t.value}'` },
    period:   { label: 'Period',   static: Object.keys(periods), hint: t => `${t.value}: ${periods[t.value]} (use the matching date column of each table)` },
  },

  // Shared knowledge appended to every agent of this domain.
  context: `Domain: online shop performance across marketplaces (Shopee, Lazada, TikTok Shop).
Key tables (schema "shop"):
- orders(order_id, platform, shop_id, brand_name, sku, qty, gmv, status, order_date) — one row per order line
- ads_spend(spend_date, platform, shop_id, brand_name, campaign, spend, impressions, clicks, ads_orders, ads_gmv)
- stock(sku, warehouse, on_hand, reserved, reorder_point) — current snapshot
- products(sku, title, brand_id, category, price), brands(id, code, name), shops(id, name, platform, brand_id)
Definitions:
- GMV = sum(gmv) where status <> 'cancelled' (returns are included in GMV, report them separately if relevant).
- Orders = count(*) of non-cancelled lines. AOV = GMV / orders. ROAS = sum(ads_gmv) / sum(spend).
- All dates are Asia/Bangkok calendar dates. "Today" = ${BKK_TODAY}. Data ends yesterday.
- Money is THB. Format numbers with thousands separators.`,

  agents: [
    {
      handle: 'analyst', name: 'Sales Analyst', isDefault: true, model: 'auto',
      description: 'ภาพรวมยอดขาย GMV, orders, เทียบช่วงเวลา, หาว่าตกตรงไหน',
      tools: ['table_list', 'describe_table', 'run_sql', 'ask_agent'],
      instructions: `You answer questions about shop performance. Break changes down by platform, shop, brand and SKU to find where a change comes from.
When a drop could be explained by ads or stock, ask @ads or @stock with ask_agent instead of guessing.`,
    },
    {
      handle: 'ads', name: 'Ads Analyst', model: 'auto',
      description: 'ค่าโฆษณา, ROAS, CTR, เทียบงบกับยอดขาย',
      tools: ['table_list', 'describe_table', 'run_sql'],
      instructions: 'You analyse advertising: spend, ROAS, CTR (clicks/impressions), CPC (spend/clicks). Always compare spend changes with GMV changes for the same shop and period.',
    },
    {
      handle: 'stock', name: 'Stock Planner', model: 'haiku',
      description: 'สต็อกคงเหลือ, ของขาด, ต่ำกว่า reorder point',
      tools: ['table_list', 'describe_table', 'run_sql'],
      instructions: 'You check stock: available = on_hand - reserved. Flag SKUs at zero or below reorder_point, and estimate days of cover from the last 14 days of sales.',
    },
    {
      handle: 'pricing', name: 'Pricing Assistant', model: 'sonnet',
      description: 'วิเคราะห์ราคาและเสนอปรับราคา SKU (ต้องให้คนกด Apply)',
      tools: ['table_list', 'describe_table', 'run_sql', 'propose_price_change'],
      instructions: `You analyse price and discount levels (gmv / qty vs list price).
You may PROPOSE price changes with propose_price_change. A human must click Apply; never claim a price was changed.`,
    },
  ],

  // Home cards. `group` = filter tab, `icon` = pie|repeat|box|tag, `en` = English override.
  starterCards: [
    { group: 'Sales', icon: 'pie', roles: ['admin', 'manager', 'staff'], title: 'ยอดขายเมื่อวาน', text: '@analyst สรุป GMV เมื่อวานแยกตามแพลตฟอร์ม เทียบกับวันเดียวกันสัปดาห์ก่อน',
      en: { title: 'Yesterday’s sales', text: '@analyst Yesterday’s GMV by platform vs the same day last week' } },
    { group: 'Sales', icon: 'pie', roles: ['admin', 'manager'], title: 'หาจุดที่ยอดตก', text: '@analyst ยอดขายเดือนนี้เทียบเดือนก่อน แบรนด์ไหน แพลตฟอร์มไหนตกมากสุด เพราะอะไร', tags: [{ type: 'period', value: 'this_month', label: 'this_month' }],
      en: { title: 'Find the drop', text: '@analyst This month vs last month: which brand and platform dropped most, and why?' } },
    { group: 'Ads', icon: 'tag', roles: ['admin', 'manager'], title: 'ROAS รายแพลตฟอร์ม', text: '@ads ROAS 30 วันล่าสุดแยกตามแพลตฟอร์มและแบรนด์ อันไหนคุ้มสุด',
      en: { title: 'ROAS by platform', text: '@ads ROAS for the last 30 days by platform and brand. Which pays off best?' } },
    { group: 'Stock', icon: 'box', roles: ['admin', 'manager', 'staff'], title: 'ของใกล้หมด', text: '@stock SKU ไหนของหมดหรือต่ำกว่า reorder point และพอขายอีกกี่วัน',
      en: { title: 'Running low', text: '@stock Which SKUs are out of stock or below reorder point, and how many days of cover are left?' } },
  ],

  roles: { canUse: ['admin', 'manager'], canManageAgents: ['admin', 'manager'], canSeeUsage: ['admin'] },
};
