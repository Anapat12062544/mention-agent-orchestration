-- Domain-agnostic tables for the AI console. Lives in `public`; ai_reader has no access here.

CREATE TABLE app_users (
  id            serial PRIMARY KEY,
  username      text UNIQUE NOT NULL,
  display_name  text NOT NULL,
  role          text NOT NULL CHECK (role IN ('admin', 'manager', 'staff')),
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Demo users. Passwords: admin1234 / manager1234 / staff1234 (scrypt). Change before any real use.
INSERT INTO app_users (username, display_name, role, password_hash) VALUES
 ('admin',   'Admin',        'admin',   'scrypt$aa43f982f64be6117ded98c8145c2c61$99cef7c0ecb592bdeab3fa4d23568fd7f62815ff934d990f28953192b34cc911ec4de943ca229fac4233e3e4eced4695043d85c5c550d4ace40e305dc212c1c1'),
 ('manager', 'Brand Manager','manager', 'scrypt$b2bda209ac4448e8f561081c3326246e$07d8ed27e78cd4f16482a943a9dfb8c2165338e0f6a58ae5cd611356edc6f5c9da9ff091bd18a47426271330da3e2c2b5776e620dfe92b0165ca56c1501ffbe8'),
 ('staff',   'Staff',        'staff',   'scrypt$2700d91626adb5bb77e5707162395d35$ba9f177d8a9464cb2a2f01ca35976158595ed6d6130fa320d74d6fa36557eb23e164d23e8998a77d9e6c7ba48c5dc481d04264d206906f90a8772219bdbef453');

CREATE TABLE ai_agents (
  id           serial PRIMARY KEY,
  domain       text NOT NULL,
  handle       text NOT NULL CHECK (handle ~ '^[a-z][a-z0-9_]{1,30}$'),
  name         text NOT NULL,
  description  text NOT NULL DEFAULT '',
  instructions text NOT NULL,
  model        text NOT NULL DEFAULT 'auto' CHECK (model IN ('auto', 'haiku', 'sonnet', 'opus')),
  tools        text[] NOT NULL DEFAULT '{}',
  is_default   boolean NOT NULL DEFAULT false,
  created_by   int REFERENCES app_users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);
CREATE UNIQUE INDEX ai_agents_handle ON ai_agents (domain, handle) WHERE deleted_at IS NULL;

CREATE TABLE ai_conversations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain     text NOT NULL,
  user_id    int NOT NULL REFERENCES app_users(id),
  title      text NOT NULL,
  source     text NOT NULL DEFAULT 'chat' CHECK (source IN ('chat', 'routine')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX ai_conversations_user ON ai_conversations (user_id, updated_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE ai_messages (
  id              bigserial PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES ai_conversations(id),
  role            text NOT NULL CHECK (role IN ('user', 'assistant')),
  content         text NOT NULL,
  agent_handle    text,
  model           text,
  meta            jsonb NOT NULL DEFAULT '{}',  -- tags, queries, guard notes, proposals, delegations, router decision
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_messages_conv ON ai_messages (conversation_id, id);

CREATE TABLE ai_usage (
  id                 bigserial PRIMARY KEY,
  user_id            int REFERENCES app_users(id),
  conversation_id    uuid,
  agent_handle       text,
  purpose            text NOT NULL CHECK (purpose IN ('router', 'agent')),
  provider           text NOT NULL,
  model              text NOT NULL,
  input_tokens       int NOT NULL DEFAULT 0,
  output_tokens      int NOT NULL DEFAULT 0,
  cache_read_tokens  int NOT NULL DEFAULT 0,
  cache_write_tokens int NOT NULL DEFAULT 0,
  cost_usd           numeric(12, 6) NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_usage_created ON ai_usage (created_at);

CREATE TABLE ai_routines (
  id           serial PRIMARY KEY,
  domain       text NOT NULL,
  user_id      int NOT NULL REFERENCES app_users(id),  -- runs with this user's permissions
  name         text NOT NULL,
  text         text NOT NULL,
  tags         jsonb NOT NULL DEFAULT '[]',
  time_of_day  text NOT NULL CHECK (time_of_day ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),  -- Asia/Bangkok
  days         int[] NOT NULL DEFAULT '{1,2,3,4,5}',  -- ISO weekday, 1 = Monday
  webhook_url  text,                                  -- Teams / LINE / Slack-compatible incoming webhook
  enabled      boolean NOT NULL DEFAULT true,
  next_run_at  timestamptz,
  locked_until timestamptz,                           -- claim lock so N PM2 workers never double-run
  created_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);

CREATE TABLE ai_routine_runs (
  id              bigserial PRIMARY KEY,
  routine_id      int NOT NULL REFERENCES ai_routines(id),
  conversation_id uuid REFERENCES ai_conversations(id),
  status          text NOT NULL CHECK (status IN ('running', 'ok', 'error')),
  delivered       boolean NOT NULL DEFAULT false,
  error           text,
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz
);

CREATE TABLE ai_change_log (
  id              bigserial PRIMARY KEY,
  domain          text NOT NULL,
  user_id         int NOT NULL REFERENCES app_users(id),
  conversation_id uuid,
  tool            text NOT NULL,
  target_table    text NOT NULL,
  target_key      text NOT NULL,
  field           text NOT NULL,
  before_value    text,
  after_value     text,
  reason          text,
  status          text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'applied', 'undone', 'rejected')),
  status_note     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  applied_at      timestamptz,
  applied_by      int REFERENCES app_users(id),
  undone_at       timestamptz
);
