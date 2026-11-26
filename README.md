# Agent Orchestration Template

แม่แบบระบบแชท AI ที่ถามข้อมูลธุรกิจด้วยภาษาคน โดยใช้ `@` ชี้ว่า **ใครตอบ** (agent) และ **ถามเรื่องอะไร** (data tag)
สกัดแนวคิดจาก AI Console ของ NPD OS ให้ใช้กับข้อมูลชุดไหนก็ได้ ตัวอย่างใน repo นี้มี 2 โดเมน:

| โดเมน | schema | ข้อมูล mock |
|---|---|---|
| **Shop Performance** (ค่าเริ่มต้น) | `shop` | ยอดขาย ~59k order lines ย้อนหลัง 300 วัน บน Shopee / Lazada / TikTok Shop, ค่าโฆษณา, สต็อก |
| **Helpdesk** | `helpdesk` | ticket ซัพพอร์ต 6,900 ใบ, SLA, CSAT |

ทั้งสองโดเมนใช้ engine ตัวเดียวกัน ต่างกันแค่ `domains/<name>/domain.config.js` และไฟล์ seed SQL

```
@analyst ยอดขาย [@platform Shopee] ของ [@brand Kiss My Body] เดือนนี้ เทียบเดือนก่อน ตกตรงไหน
```

---

## Quick start (ต่อแค่ API key ก็ใช้ได้)

ต้องมี Docker Desktop

```bash
cp .env.example .env
```

เปิด `.env` แล้วใส่ `ANTHROPIC_API_KEY=sk-ant-...` (ใส่ `OPENAI_API_KEY` ด้วยก็ได้ ถ้าอยากให้ GPT เป็น router ถ้าไม่ใส่ Claude Haiku จะทำหน้าที่ router แทน)

```bash
docker compose up -d --build
```

เปิด <http://localhost:3000> แล้ว login

| user | password | role | ทำอะไรได้ |
|---|---|---|---|
| `admin` | `admin1234` | admin | ทุกอย่าง + หน้า AI usage |
| `manager` | `manager1234` | manager | แชท, สร้าง agent/routine, Apply ข้อเสนอเปลี่ยนราคา |
| `staff` | `staff1234` | staff | ดูได้ แต่ใช้ AI ในโดเมน shop ไม่ได้ (ตัวอย่าง `roles.canUse`) |

> รหัสผ่านเหล่านี้เป็น demo อยู่ใน `db/01-ai.sql` เปลี่ยนก่อนใช้จริง และตั้ง `SESSION_SECRET` ใหม่

สลับไปโดเมน Helpdesk: ตั้ง `DOMAIN=helpdesk` ใน `.env` แล้ว `docker compose up -d app`

ข้อมูล mock สร้างตาม "วันนี้" ตอนที่ DB ถูกสร้างครั้งแรก ถ้าเปิดทิ้งไว้หลายวันแล้วอยากให้ "เมื่อวาน" มีข้อมูล ให้สร้างใหม่ด้วย `docker compose down -v && docker compose up -d`

### คำถามที่ข้อมูล mock ตั้งใจซ่อนเรื่องไว้ให้หา

| ลองถาม | สิ่งที่ควรเจอ |
|---|---|
| `@analyst ยอดขายเดือนนี้เทียบเดือนก่อน แบรนด์ไหน แพลตฟอร์มไหนตกมากสุด เพราะอะไร` | Kiss My Body บน Shopee ตกแรง → analyst ถาม `@ads` ต่อ → งบโฆษณาร้านนั้นถูกตัดเหลือ 40% |
| `@stock SKU ไหนของหมดหรือต่ำกว่า reorder point` | KMB-003 หมดทุกคลัง (ขายไม่ได้มา 10 วัน), GLG-001 ที่ BKK-WH1 ต่ำกว่า reorder point |
| `@ads ROAS 30 วันล่าสุดแยกตามแพลตฟอร์ม` | ROAS ต่อร้าน, วัน double-day (11.11) spike |
| `@pricing ราคาขายจริงของ KMB-001 ต่ำกว่าราคาป้ายกี่ % ควรปรับไหม` | agent เสนอเปลี่ยนราคา → การ์ด **Apply / Undo** |
| `@analyst มีคอลัมน์ cost_price ไหม ขอ margin หน่อย` | guard บล็อก แสดงหมายเหตุ 🛡 ในคำตอบ |
| (helpdesk) `@support ทำไม ticket จาก LINE เพิ่มขึ้นช่วงนี้` | LINE backlog ของทีม Billing พุ่งช่วง 14 วัน |

---

## สถาปัตยกรรม

```mermaid
flowchart TB
  subgraph Browser["Browser · React 18 + Vite"]
    C["Composer<br/>@ picker → agent / tag type → ค้นหาค่า → chips"]
    V["คำตอบ: @agent · Model<br/>Ran N queries · guard notes · Apply/Undo"]
  end

  C -- "POST /api/ai/chat<br/>{conversationId?, text, tags}" --> MW

  subgraph API["Express API · PM2 cluster"]
    MW["auth → JSON-only CSRF → rate limit → role check"]
    PA["pickAgent<br/>@mention แรก = ผู้ตอบ<br/>ที่เหลือ = ถามต่อได้"]
    RT["Model router<br/>GPT หรือ Haiku → haiku / sonnet / opus<br/>ล่ม หรือ เกิน 3s = sonnet"]
    AG["runAgent · Claude tool loop<br/>งบร่วมกันทั้งคำถาม"]
    TL["Tool registry · 1 ไฟล์ = 1 tool<br/>read: table_list, describe_table, run_sql, ask_agent<br/>write: propose_* เท่านั้น"]
    GD["Guard<br/>SQL text → READ ONLY tx → EXPLAIN plan<br/>→ redaction → untrusted_data wrap"]
    PS["persist: ai_messages, ai_usage, ai_change_log"]
    SC["Routine scheduler<br/>locked_until + SKIP LOCKED"]
  end

  MW --> PA --> RT --> AG
  AG <--> TL
  TL --> GD
  AG -- "ask_agent ≤ 2 ชั้น" --> AG
  AG --> PS
  SC --> PA

  subgraph PG["PostgreSQL 16"]
    D[("domain schema<br/>shop / helpdesk")]
    A[("public.ai_*<br/>app_users")]
  end

  GD -- "role ai_reader<br/>pool 3 connections" --> D
  PS -- "role app" --> A
  PS -. "Apply / Undo<br/>(คนกด)" .-> D
  AG -- "Anthropic SDK" --> CL(["Claude<br/>Haiku / Sonnet / Opus 5.5"])
  RT -- "openai SDK" --> GPT(["GPT router<br/>(optional)"])
```

### เส้นทางของ 1 คำถาม

```mermaid
sequenceDiagram
  autonumber
  actor U as ผู้ใช้
  participant W as Web
  participant S as API
  participant R as Router
  participant A as @analyst
  participant B as @ads
  participant G as Guard + ai_reader
  participant DB as Postgres

  U->>W: "@analyst ยอด [@platform Shopee] เดือนนี้ ตกตรงไหน"
  W->>S: POST /api/ai/chat {text, tags}
  S->>DB: โหลดประวัติแชท 20 ข้อความล่าสุด (server เป็นเจ้าของประวัติ)
  S->>S: pickAgent → @analyst, tags → คำใบ้ selected_filters
  S->>R: ความยากของคำถาม?
  R-->>S: {model: opus, reason: "root cause"}
  loop tool loop (งบ 12 tool calls, 8 SQL, 2,000 แถว, 75 วินาที)
    S->>A: messages + tools
    A-->>S: tool_use run_sql
    S->>G: checkSql → BEGIN READ ONLY → EXPLAIN VERBOSE → checkPlan
    G->>DB: SELECT ... LIMIT n
    DB-->>G: rows
    G-->>S: redact → wrap untrusted_data
    S-->>A: tool_result
  end
  A-->>S: tool_use ask_agent(ads, "งบโฆษณา SHP-KMB เดือนนี้ลดไหม")
  S->>R: route คำถามย่อย
  S->>B: runAgent (depth 1, ใช้งบก้อนเดียวกัน)
  B-->>S: agent_answer
  S-->>A: tool_result
  A-->>S: คำตอบสุดท้าย
  S->>S: redactText (กรองค่าลับซ้ำ)
  S->>DB: INSERT ai_messages (meta: queries, notes, delegations, router) + ai_usage ทุก call
  S-->>W: message
  W-->>U: "@analyst · Opus 5.5" + Ran N queries
```

---

## เทคนิคที่ใช้

### 1. `@` mentions: agent กับ data tag แยกกัน

- **Agent** (`@analyst`) อยู่ในตาราง `ai_agents` สร้าง/แก้จากหน้า Agents ได้ แต่ละตัวมี instructions, ชุด tools และโมเดล (`auto` = ให้ router เลือก หรือล็อก haiku/sonnet/opus)
- **Data tag** (`@platform Shopee`) นิยามใน `domain.config.js` ค่าที่ให้เลือกมาจาก SQL (`values`), ค้นหาสด (`search` + `$1`) หรือรายการคงที่ (`static`)
- tag **ไม่ถูกแปลงเป็น SQL ตรง ๆ** แต่ส่งเป็นคำใบ้ `<selected_filters>` ให้ agent (เช่น `platform = 'Shopee'`) agent ยังต้องเขียน SQL เองและผ่าน guard ทุกชั้น
- `pickAgent`: @agent ตัวแรกในข้อความเป็นผู้ตอบ ตัวที่เหลือคือคนที่ผู้ตอบถามต่อได้ ถ้าไม่ระบุใครเพิ่ม ถามได้ทุก agent

### 2. Orchestration: `ask_agent` + งบร่วม

```mermaid
flowchart LR
  Q["คำถาม"] --> A0["@analyst<br/>depth 0"]
  A0 -- "ask_agent" --> A1["@ads<br/>depth 1"]
  A0 -- "ask_agent" --> A2["@stock<br/>depth 1"]
  A1 -- "ask_agent" --> A3["@pricing<br/>depth 2<br/>ไม่มี ask_agent แล้ว"]
  B[["Budget object เดียว<br/>toolCalls 12 · sql 8 · rows 2000 · 75s<br/>rejections หยุดที่ 3"]]
  A0 -.-> B
  A1 -.-> B
  A2 -.-> B
  A3 -.-> B
```

- ทุก agent ในคำถามเดียวกันใช้ `budget` object ตัวเดียว ส่งต่อกี่ทอดก็ไม่เกินงบ
- ลึกสุด 2 ชั้น: ที่ depth 2 ระบบไม่ส่ง tool `ask_agent` ให้โมเดลเลย
- งบหมด → รอบสุดท้ายส่ง `tool_choice: none` บังคับให้ตอบด้วยข้อมูลที่มี
- guard ปฏิเสธครบ 3 ครั้ง → หยุดทันที ไม่เรียกโมเดลต่อ
- คำตอบของ agent อื่นห่อด้วย `<agent_answer>` และถือเป็น data ไม่ใช่คำสั่ง

### 3. Model router

```mermaid
flowchart LR
  T["คำถาม"] --> L{"agent ล็อกโมเดล?"}
  L -- "ใช่" --> M["ใช้โมเดลนั้น"]
  L -- "auto" --> K{"มี OPENAI_API_KEY?"}
  K -- "มี" --> G["GPT (gpt-5-mini)<br/>JSON mode"]
  K -- "ไม่มี" --> H["Claude Haiku 5.5<br/>thinking off"]
  G --> P{"ตอบ JSON ถูก<br/>ภายใน 3 วินาที?"}
  H --> P
  P -- "ใช่" --> O["haiku / sonnet / opus + reason"]
  P -- "ไม่ / ล่ม / ช้า" --> F["sonnet (fallback)"]
```

- ถามตัวเลขเดียว → Haiku, เทียบหลายกลุ่ม → Sonnet, หาสาเหตุ/วิเคราะห์หลายขั้น → Opus
- เหตุผลของ router แสดงมุมขวาของคำตอบ และสัดส่วนดูได้ที่หน้า AI usage
- Sonnet/Opus เปิด server-side refusal fallback (beta) ไว้ ปิดได้ด้วย `CLAUDE_FALLBACKS=off`
- system prompt ใส่ `cache_control` (prompt caching) เพราะเหมือนเดิมทุก turn ในลูป

### 4. ชั้นความปลอดภัย (defense in depth)

```mermaid
flowchart TB
  S["SQL ที่ agent เขียน"] --> L1
  L1["1 · Text guard<br/>คำสั่งเดียว · SELECT/WITH เท่านั้น<br/>ห้าม write keywords, INTO, FOR UPDATE<br/>ห้าม backslash, $, U&, comments, quoted identifiers<br/>ห้าม pg_* lo_* dblink set_config information_schema"]
  L1 --> L2["2 · Execution sandbox<br/>role ai_reader: default_transaction_read_only<br/>BEGIN READ ONLY · statement_timeout 8s<br/>search_path = domain schema · pool 3 connections<br/>extended query protocol (multi-statement ใช้ไม่ได้)"]
  L2 --> L3["3 · Plan guard · EXPLAIN (VERBOSE, FORMAT JSON)<br/>ทุก relation ต้องอยู่ใน schema ของโดเมน<br/>ห้าม hiddenTables / hiddenColumns (หลัง * ถูกขยายแล้ว)<br/>ห้าม whole-row x.* / ROW()"]
  L3 --> L4["4 · Run with LIMIT<br/>SELECT * FROM (sql) _q LIMIT min(200, rows ที่เหลือ)"]
  L4 --> L5["5 · Redaction<br/>ตัดคอลัมน์ซ่อน · mask hash/token/key · ตัดค่าเกิน 300 ตัว · blob → [binary]"]
  L5 --> L6["6 · Prompt-injection<br/>ห่อด้วย untrusted_data · ข้อมูลหน้าตาเหมือนคำสั่ง → แนบ WARNING<br/>guard_rules ต่อท้าย system prompt เสมอ"]
  L6 --> M["โมเดล"]
  M --> L7["7 · Final answer<br/>redactText กรองค่าลับซ้ำอีกรอบ"]
```

ทำไม EXPLAIN สำคัญ: text guard ตรวจได้แค่ตัวอักษร แต่ `SELECT * FROM products` ไม่มีคำว่า `cost_price` ให้เห็น ต้องให้ Postgres วางแผนก่อน (ขยาย `*`, view, CTE) แล้วค่อยตรวจว่า query แตะอะไรจริง ส่วนตาราง `api_keys` ยัง `REVOKE` ที่ระดับ DB ซ้ำอีกชั้น

ส่วนอื่น: session cookie เซ็นด้วย HMAC (`HttpOnly`, `SameSite=Lax`), ทุก request ที่ไม่ใช่ GET ต้องเป็น JSON (กัน CSRF จากฟอร์มข้ามเว็บ), rate limit ต่อ user, รหัสผ่าน scrypt, server โหลดประวัติแชทเอง ไม่รับประวัติจาก client

### 5. Write safety: agent เสนอ คนกด Apply

```mermaid
stateDiagram-v2
  [*] --> proposed: agent เรียก propose_price_change<br/>(อ่านค่าปัจจุบันเก็บเป็น before)
  proposed --> applied: คนกด Apply<br/>ค่าตอนนี้ = before ✔ → UPDATE 1 แถว
  proposed --> rejected: คนกด Apply<br/>ค่าเปลี่ยนไปแล้ว ✘
  applied --> undone: คนกด Undo<br/>ค่าตอนนี้ = after ✔ → คืนค่า before
  applied --> applied: Undo ไม่ได้<br/>มีคนแก้ต่อแล้ว (409)
  undone --> [*]
  rejected --> [*]
```

- agent **ไม่มีทางเขียน SQL อิสระ** write tool ไม่มีฟังก์ชัน `run` มีแค่คำอธิบาย `target: {table, key, field}` engine เป็นคนสร้างข้อเสนอ
- ตรวจสิทธิ์ในนามของคนที่ถามทั้งตอนเสนอและตอน Apply (`roles` ในไฟล์ tool) และต้องเป็นเจ้าของคำถามหรือ admin
- ทุกครั้งบันทึก before/after ใน `ai_change_log`, `SELECT ... FOR UPDATE` กันชนกัน, จำกัด 1 แถวต่อข้อเสนอและ 10 ข้อเสนอต่อคำถาม, tool ไม่มี DELETE (ใช้ soft delete เท่านั้น)

### 6. Routines บน PM2 หลาย worker

```mermaid
sequenceDiagram
  participant W1 as PM2 worker 1
  participant W2 as PM2 worker 2
  participant DB as ai_routines
  Note over W1,W2: ทุก worker tick ทุก 30 วินาที
  W1->>DB: UPDATE SET locked_until = now()+10m WHERE id = (SELECT ... due ... FOR UPDATE SKIP LOCKED LIMIT 1)
  W2->>DB: (query เดียวกันพร้อมกัน)
  DB-->>W1: ได้ routine 7
  DB-->>W2: แถวถูกล็อก → ข้าม → ไม่ได้อะไร
  W1->>W1: answer() เหมือนแชทปกติ (สิทธิ์ของเจ้าของ routine)
  W1->>W1: POST webhook {text} → Teams / LINE / Slack
  W1->>DB: next_run_at = รอบถัดไป, locked_until = NULL
```

ถ้า worker ตายกลางทาง `locked_until` หมดอายุใน 10 นาที แล้ว worker อื่นหยิบไปรันแทน เวลาเป็น Asia/Bangkok (UTC+7 คงที่ ไม่มี DST)

### 7. Usage และค่าใช้จ่าย

ทุก call (ทั้ง router และ agent) บันทึกลง `ai_usage`: input/output/cache-read/cache-write tokens และ `cost_usd` จากตารางราคาใน `server/usage.js` หน้า **AI usage** (admin) มียอดรวม, กราฟรายวัน, แยกตามโมเดล, แยกตามคน, สัดส่วนที่ router ส่งไปแต่ละโมเดล

### 8. ตาราง

```mermaid
erDiagram
  app_users ||--o{ ai_conversations : owns
  app_users ||--o{ ai_routines : owns
  ai_conversations ||--o{ ai_messages : has
  ai_conversations ||--o{ ai_usage : costs
  ai_routines ||--o{ ai_routine_runs : runs
  ai_routine_runs }o--o| ai_conversations : produces
  ai_conversations ||--o{ ai_change_log : proposes
  ai_agents {
    text domain
    text handle
    text instructions
    text model "auto haiku sonnet opus"
    text_arr tools
  }
  ai_messages {
    text role
    text content
    text agent_handle
    text model
    jsonb meta "tags queries notes proposals delegations router"
  }
  ai_usage {
    text purpose "router agent"
    text model
    int input_tokens
    int output_tokens
    numeric cost_usd
  }
  ai_routines {
    text time_of_day
    int_arr days
    text webhook_url
    timestamptz next_run_at
    timestamptz locked_until
  }
  ai_change_log {
    text target_table
    text target_key
    text field
    text before_value
    text after_value
    text status "proposed applied undone rejected"
  }
```

ตาราง `ai_*` ไม่ผูกกับโดเมน (มีคอลัมน์ `domain`) และอยู่ใน `public` ซึ่ง `ai_reader` เข้าไม่ได้

---

## ทำโดเมนใหม่

1. คัดลอก `domains/shop` → `domains/crm`
2. แก้ `domain.config.js`: `schema`, `hiddenTables`, `hiddenColumns`, `tags`, `context` (นิยามตัวเลข, timezone), `agents`, `starterCards` (มี `group` สำหรับแท็บ, `icon`, และ `en: { title, text }` สำหรับภาษาอังกฤษ), `roles`. ข้อความ UI ทั้งหมดอยู่ใน `web/src/i18n.js` (TH/EN)
3. เขียน `db/30-crm.sql`: สร้าง schema + ข้อมูล แล้ว `GRANT USAGE ON SCHEMA crm TO ai_reader; GRANT SELECT ON ALL TABLES IN SCHEMA crm TO ai_reader;`
4. ตั้ง `DOMAIN=crm` แล้ว `docker compose down -v && docker compose up -d --build`

ไม่ต้องแก้อะไรใน `server/` ถ้าต้องต่อฐานข้อมูลจริงที่มีอยู่แล้ว ให้ชี้ `DATABASE_URL` / `READER_DATABASE_URL` ไปที่นั่น และสร้าง role อ่านอย่างเดียวแบบ `db/00-roles.sh`

### เพิ่ม tool

1 ไฟล์ = 1 tool วางใน `server/tools/` (ใช้ได้ทุกโดเมน) หรือ `domains/<name>/tools/` (เฉพาะโดเมน)

```js
// read tool
module.exports = {
  name: 'top_skus', type: 'read',
  description: '...', input_schema: { type: 'object', properties: {...}, required: [...] },
  async run(input, ctx) { /* ctx.config, ctx.budget, ctx.user, ctx.queries ... */ return 'text for the model'; },
};

// write tool: ไม่มี run — engine สร้างข้อเสนอ, คนกด Apply
module.exports = {
  name: 'propose_stock_adjust', type: 'write', roles: ['admin'],
  target: { table: 'stock', key: 'sku', field: 'reorder_point' },   // input ต้องมี sku และ new_reorder_point
  validate(input, before) { return null; /* หรือข้อความ error */ },
  description: '...', input_schema: {...},
};
```

แล้วเปิดใช้ให้ agent ในหน้า Agents (ติ๊ก tool)

---

## API

| Endpoint | หน้าที่ |
|---|---|
| `POST /api/login`, `/api/logout`, `GET /api/me` | session, สิทธิ์, tag types, starter cards ตาม role |
| `POST /api/ai/chat` | ถาม 1 รอบ `{conversationId?, text, tags[]}` server โหลดประวัติเอง |
| `GET /api/ai/tags` / `?type=&q=` | รายการ agents + tag types / ค่าที่เลือกได้ของ tag |
| `GET/PATCH/DELETE /api/ai/conversations[/:id]` | ประวัติแชท (soft delete) |
| `GET/POST/PUT/DELETE /api/ai/agents[/:id]` | จัดการ agent |
| `GET/POST/PUT/DELETE /api/ai/routines[/:id]`, `POST /:id/run` | routine + รันทันที |
| `GET /api/ai/usage?days=` | ข้อมูลหน้าค่าใช้จ่าย (admin) |
| `POST /api/ai/changes/:id/apply`, `/undo` | เขียนข้อมูลจริงหลังคนยืนยัน |

## ทดสอบ

```bash
npm install
```

```bash
npm run check
```

`checks/*.check.js` เป็น plain node ใช้ Claude/GPT client ปลอม ไม่ต้องมี key และไม่ต้องมี DB: SQL guard, plan guard, redaction, injection wrap, agent loop (งบหมด, ปฏิเสธ 3 ครั้ง, depth limit, write tool ตาม role, refusal), router fallback/timeout, ตารางเวลา routine

```bash
node checks/db.e2e.js
```

ต้องเปิด `docker compose up -d db` ก่อน รันกับ Postgres จริงและ role `ai_reader` จริง (แต่ Claude ปลอม): guard บล็อก hidden column / `*` / hidden table / schema อื่น / whole-row / `nextval` / หลาย statement / timeout, คำถามเต็มรอบพร้อมบันทึก DB, Apply → Undo → ข้อเสนอ stale ถูกปฏิเสธ

## Dev โดยไม่ใช้ Docker สำหรับ app

```bash
docker compose up -d db
```

```bash
DATABASE_URL=postgres://app:app_dev_pw@localhost:5433/aiconsole READER_DATABASE_URL=postgres://ai_reader:reader_dev_pw@localhost:5433/aiconsole ANTHROPIC_API_KEY=sk-ant-... npm run dev
```

```bash
cd web && npm install && npm run dev
```

Vite (port 5173) proxy `/api` ไปที่ port 3000

---

## คำถามข้อ 11 ของ brief: ค่าที่ template นี้เลือกไว้

| คำถาม | ค่าเริ่มต้นใน template | ถ้าไม่ตรงต้องทำอะไร |
|---|---|---|
| ข้อมูลอยู่ที่ไหน | DB เดียวที่รวมทุกแพลตฟอร์มแล้ว (schema `shop`) | หลายแหล่ง → ETL เข้า schema เดียว หรือเพิ่ม read tool ที่เรียก API (1 ไฟล์) |
| กรองแถวตามคน | ไม่กรอง ทุกคนที่ใช้ได้เห็นทั้ง schema | ทำ view ต่อ role หรือ Postgres RLS แล้วให้ reader `SET LOCAL` ตัวตนผู้ถามก่อนรัน ห้ามพึ่ง prompt |
| นิยามตัวเลข | GMV = `sum(gmv)` ไม่รวม cancelled (รวม returned), วันที่ Asia/Bangkok | แก้ `context` ใน `domain.config.js` |
| ช่องทางส่งผล routine | webhook https ส่ง `{text}` (Teams / Slack-style) | LINE Messaging API ต้องใช้ channel token + push API แก้ที่ `deliver()` ใน `server/routines.js` |

## ข้อจำกัดที่ตั้งใจเก็บไว้ให้เรียบง่าย

- rate limit อยู่ใน memory ของแต่ละ worker (2 workers = ได้ 2 เท่า) ถ้าสำคัญให้ใช้ Redis
- ตารางราคาโมเดลใน `server/usage.js` เป็นค่าคงที่ อัปเดตเมื่อราคาเปลี่ยน
- timezone ของ routine fix UTC+7
- auth เป็นแบบ username/password สำหรับ demo ใช้จริงควรต่อ SSO
- คำตอบไม่ stream (รอจนจบแล้วแสดงทีเดียว)

## โครงสร้างไฟล์

```
domains/
  shop/domain.config.js          ← ทุกอย่างที่ผูกกับโดเมน
  shop/tools/propose_price_change.js
  helpdesk/domain.config.js
server/
  index.js        routes, static UI, seed agents
  chat.js         1 คำถาม: conversation, pickAgent, router, ask_agent, persist
  agent.js        Claude tool loop + budget + depth
  router.js       GPT/Haiku → haiku|sonnet|opus
  guard.js        SQL/plan guard, redaction, injection wrap, guard rules
  tools/          table_list, describe_table, run_sql, ask_agent
  changes.js      propose / apply / undo
  routines.js     scheduler + webhook
  usage.js        model ids, prices, ai_usage
  auth.js         scrypt, HMAC cookie, roles, rate limit
db/               init scripts: roles, ai_* tables, mock data 2 โดเมน
web/src/          React: Chat (composer + @ picker), Admin (Agents, Routines, Usage), i18n.js (TH/EN)
checks/           *.check.js (no key, no DB) + db.e2e.js
```

## Technical Information

| หัวข้อ | รายละเอียด |
|---|---|
| Stack | Node.js 22 (Express, CommonJS) · PostgreSQL 16 · React 18 + Vite 6 · `@anthropic-ai/sdk` · `openai` (router, ไม่บังคับ) · PM2 cluster · Docker Compose |
| รัน | `cp .env.example .env` ใส่ `ANTHROPIC_API_KEY` แล้ว `docker compose up -d --build` → http://localhost:3000 |
| ทดสอบ | `npm run check` (ไม่ต้องมี key/DB) · `node checks/db.e2e.js` (ต้องมี DB จาก compose) |
| Env | ดู `.env.example` ห้าม commit `.env` (อยู่ใน `.gitignore`) |
| DB | init scripts ใน `db/` รันครั้งแรกที่สร้าง volume เท่านั้น รีเซ็ตด้วย `docker compose down -v` |
| UI | responsive (มือถือ/แท็บเล็ต/เดสก์ท็อป) สลับภาษา TH/EN ข้อความอยู่ใน `web/src/i18n.js` |
| Branch | `main` = production (PR เท่านั้น) ← `uat` = UAT ← `feature/<name>` แตกจาก `uat` · commit แบบ Conventional Commits |
| ข้อควรระวัง | รหัสผ่าน demo (`admin1234` ฯลฯ), `SESSION_SECRET` และรหัส DB ใน compose เป็นค่า dev ต้องเปลี่ยนก่อนใช้จริง |
