// Second domain: same engine, different config + seed. Run with DOMAIN=helpdesk.
const periods = {
  today: "created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'Asia/Bangkok'",
  last_7_days: "created_at >= now() - interval '7 days'",
  last_30_days: "created_at >= now() - interval '30 days'",
};

module.exports = {
  name: 'Helpdesk',
  schema: 'helpdesk',
  hiddenTables: ['users', /^ai_/],
  hiddenColumns: /(password|token|secret|phone|email)/i,

  tags: {
    channel:  { label: 'Channel',  values: { sql: 'SELECT DISTINCT channel FROM tickets ORDER BY 1' }, hint: t => `channel = '${t.value}'` },
    team:     { label: 'Team',     values: { sql: 'SELECT id, name FROM teams ORDER BY 2' },          hint: t => `team_id = ${Number(t.value)} (${t.label})` },
    priority: { label: 'Priority', static: ['low', 'normal', 'high', 'urgent'],                     hint: t => `priority = '${t.value}'` },
    period:   { label: 'Period',   static: Object.keys(periods),                                    hint: t => periods[t.value] },
  },

  context: `Domain: customer support tickets.
Tables (schema "helpdesk"): tickets(id, customer_id, channel, team_id, agent_id, category, priority, status, created_at, first_response_at, resolved_at, csat, sla_hours), teams(id, name), support_agents(id, name, team_id), customers(id, name, tier).
Definitions: backlog = status in ('open','pending'). SLA met = resolved_at - created_at <= sla_hours * interval '1 hour'. CSAT = avg(csat). Times are timestamptz; report in Asia/Bangkok.`,

  agents: [
    { handle: 'support', name: 'Support Analyst', isDefault: true, model: 'auto', tools: ['table_list', 'describe_table', 'run_sql', 'ask_agent'],
      description: 'Backlog, volume, CSAT', instructions: 'You answer questions about ticket volume, backlog and CSAT. Ask @sla for SLA questions.' },
    { handle: 'sla', name: 'SLA Watcher', model: 'auto', tools: ['table_list', 'describe_table', 'run_sql'],
      description: 'SLA breach and response times', instructions: 'You measure SLA attainment and first-response time per team, channel and priority.' },
  ],

  starterCards: [
    { group: 'Operations', icon: 'box', roles: ['admin', 'manager', 'staff'], title: 'Backlog ตอนนี้', text: '@support backlog ตอนนี้แยกตาม channel และ team',
      en: { title: 'Backlog now', text: '@support Current backlog by channel and team' } },
    { group: 'Lenses', icon: 'pie', roles: ['admin', 'manager'], title: 'SLA รายทีม', text: '@sla SLA 30 วันล่าสุด ทีมไหนพลาดมากสุด',
      en: { title: 'SLA by team', text: '@sla SLA over the last 30 days. Which team misses most?' } },
    { group: 'Cadences', icon: 'repeat', roles: ['admin', 'manager'], title: 'แนวโน้ม CSAT', text: '@support CSAT รายสัปดาห์ 8 สัปดาห์ล่าสุด',
      en: { title: 'CSAT trend', text: '@support Weekly CSAT for the last 8 weeks' } },
    { group: 'Lenses', icon: 'pie', roles: ['admin', 'manager'], title: 'LINE พุ่ง', text: '@support ทำไม ticket จาก LINE เพิ่มขึ้นช่วงนี้',
      en: { title: 'LINE spike', text: '@support Why are LINE tickets rising lately?' } },
  ],

  roles: { canUse: ['admin', 'manager', 'staff'], canManageAgents: ['admin'], canSeeUsage: ['admin'] },
};
