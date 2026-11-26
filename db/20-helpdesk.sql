-- Domain 2: Helpdesk (mock). Customer-support tickets. Proves the engine is domain-agnostic:
-- switch with DOMAIN=helpdesk, nothing else changes.
-- Story: LINE channel backlog grows in the last 14 days; team "Billing" misses SLA most.

CREATE SCHEMA helpdesk;
SET search_path = helpdesk;
SELECT setseed(0.7);

CREATE TABLE teams (id int PRIMARY KEY, name text UNIQUE NOT NULL);
INSERT INTO teams VALUES (1, 'Orders'), (2, 'Billing'), (3, 'Product');

CREATE TABLE support_agents (
  id      int PRIMARY KEY,
  name    text NOT NULL,
  team_id int NOT NULL REFERENCES teams(id),
  email   text NOT NULL
);
INSERT INTO support_agents VALUES
 (1, 'Nok', 1, 'nok@example.com'), (2, 'Ploy', 1, 'ploy@example.com'), (3, 'Beam', 2, 'beam@example.com'),
 (4, 'Mint', 2, 'mint@example.com'), (5, 'Ton', 3, 'ton@example.com'), (6, 'Fah', 3, 'fah@example.com');

CREATE TABLE customers (
  id         int PRIMARY KEY,
  name       text NOT NULL,
  tier       text NOT NULL CHECK (tier IN ('standard', 'vip')),
  phone      text NOT NULL            -- PII: hidden by domain.config
);
INSERT INTO customers
SELECT g, 'Customer ' || g, CASE WHEN random() < 0.1 THEN 'vip' ELSE 'standard' END,
       '08' || lpad(floor(random() * 1e8)::text, 8, '0')
FROM generate_series(1, 800) g;

CREATE TABLE tickets (
  id                bigserial PRIMARY KEY,
  customer_id       int NOT NULL REFERENCES customers(id),
  channel           text NOT NULL CHECK (channel IN ('LINE', 'Email', 'Phone', 'Facebook')),
  team_id           int NOT NULL REFERENCES teams(id),
  agent_id          int REFERENCES support_agents(id),
  category          text NOT NULL,
  priority          text NOT NULL CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status            text NOT NULL CHECK (status IN ('open', 'pending', 'resolved', 'closed')),
  created_at        timestamptz NOT NULL,
  first_response_at timestamptz,
  resolved_at       timestamptz,
  csat              int CHECK (csat BETWEEN 1 AND 5),
  sla_hours         int NOT NULL       -- SLA target for resolution
);
COMMENT ON TABLE tickets IS 'Support tickets. SLA met when resolved_at - created_at <= sla_hours';

WITH base AS (
  SELECT now() - (random() * 120) * interval '1 day' AS created_at,
         (ARRAY['LINE', 'Email', 'Phone', 'Facebook'])[1 + floor(random() * 4)::int] AS channel,
         1 + floor(random() * 3)::int AS team_id,
         (ARRAY['low', 'normal', 'normal', 'high', 'urgent'])[1 + floor(random() * 5)::int] AS priority,
         random() AS r1, random() AS r2, random() AS r3
  FROM generate_series(1, 6000)
  UNION ALL  -- LINE backlog spike in last 14 days
  SELECT now() - (random() * 14) * interval '1 day', 'LINE', 2, 'normal', random(), random(), random()
  FROM generate_series(1, 900)
)
INSERT INTO tickets (customer_id, channel, team_id, agent_id, category, priority, status, created_at,
                     first_response_at, resolved_at, csat, sla_hours)
SELECT 1 + floor(r1 * 800)::int, channel, team_id, team_id * 2 - floor(r2 * 2)::int,
       (ARRAY['Delivery', 'Refund', 'Payment', 'Product question', 'Account'])[1 + floor(r3 * 5)::int],
       priority,
       CASE WHEN created_at > now() - interval '3 days' AND r2 < 0.6 THEN 'open'
            WHEN created_at > now() - interval '14 days' AND channel = 'LINE' AND r2 < 0.5 THEN 'pending'
            WHEN r3 < 0.7 THEN 'closed' ELSE 'resolved' END,
       created_at,
       created_at + (r1 * (CASE team_id WHEN 2 THEN 10 ELSE 4 END)) * interval '1 hour',
       created_at + (r2 * (CASE team_id WHEN 2 THEN 90 ELSE 40 END)) * interval '1 hour',
       CASE WHEN r3 < 0.6 THEN 1 + floor(power(r1, 0.4) * 5)::int END,
       CASE priority WHEN 'urgent' THEN 8 WHEN 'high' THEN 24 ELSE 48 END
FROM base;
UPDATE tickets SET resolved_at = NULL, csat = NULL WHERE status IN ('open', 'pending');

GRANT USAGE ON SCHEMA helpdesk TO ai_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA helpdesk TO ai_reader;
ANALYZE;
