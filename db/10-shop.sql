-- Domain 1: Shop Performance (mock). Online sales across Shopee / Lazada / TikTok Shop.
-- Data is generated relative to "today" (Asia/Bangkok) at first container start, ~300 days back.
-- Built-in stories for demo questions:
--   * Kiss My Body on Shopee drops this month: demand x0.6 and ad spend cut to 40%.
--   * SKU KMB-003 is out of stock in every warehouse and stopped selling 10 days ago.
--   * TikTok Shop grows steadily; double-day campaigns (9.9, 10.10, 11.11 ...) spike x3.

CREATE SCHEMA shop;
SET search_path = shop;
SELECT setseed(0.42);

CREATE TABLE brands (
  id   int PRIMARY KEY,
  code text UNIQUE NOT NULL,
  name text UNIQUE NOT NULL
);
COMMENT ON TABLE brands IS 'Brands we sell';
INSERT INTO brands VALUES
 (1, 'KMB', 'Kiss My Body'), (2, 'MLK', 'Malissa Kiss'), (3, 'GLG', 'Gluta Glow'), (4, 'FRD', 'Fresh Daily');

CREATE TABLE shops (
  id       text PRIMARY KEY,
  name     text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('Shopee', 'Lazada', 'TikTok Shop')),
  brand_id int NOT NULL REFERENCES brands(id)
);
COMMENT ON TABLE shops IS 'One official store per brand per platform';
INSERT INTO shops
SELECT p.code || '-' || b.code, b.name || ' Official (' || p.platform || ')', p.platform, b.id
FROM brands b CROSS JOIN (VALUES ('SHP', 'Shopee'), ('LZD', 'Lazada'), ('TTS', 'TikTok Shop')) p(code, platform);

CREATE TABLE products (
  sku         text PRIMARY KEY,
  title       text NOT NULL,
  brand_id    int NOT NULL REFERENCES brands(id),
  category    text NOT NULL,
  price       numeric(10, 2) NOT NULL CHECK (price > 0),
  cost_price  numeric(10, 2) NOT NULL,     -- confidential: hidden from the AI by domain.config hiddenColumns
  launched_at date NOT NULL,
  deleted_at  timestamptz
);
COMMENT ON TABLE products IS 'Product master. price = current list price in THB';
INSERT INTO products VALUES
 ('KMB-001', 'Kiss My Body Perfume Lotion 226g',      1, 'Body Lotion', 159, 48, '2024-03-01', NULL),
 ('KMB-002', 'Kiss My Body Bright & Shine Serum 380g',1, 'Body Serum',  199, 61, '2024-06-15', NULL),
 ('KMB-003', 'Kiss My Body Body Mist 88ml',           1, 'Body Mist',   129, 35, '2025-01-10', NULL),
 ('KMB-004', 'Kiss My Body Shower Gel 500ml',         1, 'Shower',      149, 40, '2025-04-01', NULL),
 ('MLK-001', 'Malissa Kiss Whitening Perfume Lotion', 2, 'Body Lotion', 189, 55, '2024-02-01', NULL),
 ('MLK-002', 'Malissa Kiss Hand Cream 50g',           2, 'Hand Care',    89, 22, '2024-09-01', NULL),
 ('MLK-003', 'Malissa Kiss Body Scrub 300g',          2, 'Scrub',       169, 47, '2025-02-01', NULL),
 ('MLK-004', 'Malissa Kiss Lip Balm',                 2, 'Lip',          79, 18, '2025-05-20', NULL),
 ('GLG-001', 'Gluta Glow Serum 30ml',                 3, 'Face Serum',  299, 80, '2024-01-15', NULL),
 ('GLG-002', 'Gluta Glow Day Cream 50g',              3, 'Face Cream',  349, 95, '2024-07-01', NULL),
 ('GLG-003', 'Gluta Glow Sunscreen SPF50 40ml',       3, 'Sunscreen',   259, 70, '2025-03-01', NULL),
 ('GLG-004', 'Gluta Glow Night Mask 50g',             3, 'Face Mask',   319, 88, '2025-08-01', NULL),
 ('FRD-001', 'Fresh Daily Deodorant Roll-on',         4, 'Deodorant',    69, 17, '2024-04-01', NULL),
 ('FRD-002', 'Fresh Daily Facial Foam 100g',          4, 'Cleanser',     99, 26, '2024-05-01', NULL),
 ('FRD-003', 'Fresh Daily Micellar Water 300ml',      4, 'Cleanser',    139, 38, '2024-10-01', NULL),
 ('FRD-004', 'Fresh Daily Cotton Pads 100pcs',        4, 'Accessory',    49, 12, '2025-01-01', NULL);

CREATE SEQUENCE order_seq START 100001;
CREATE TABLE orders (
  order_id   text PRIMARY KEY DEFAULT 'ORD-' || nextval('shop.order_seq'),
  platform   text NOT NULL,
  shop_id    text NOT NULL REFERENCES shops(id),
  brand_name text NOT NULL,
  sku        text NOT NULL REFERENCES products(sku),
  qty        int NOT NULL CHECK (qty > 0),
  gmv        numeric(12, 2) NOT NULL,                 -- net of discount, THB
  status     text NOT NULL CHECK (status IN ('completed', 'cancelled', 'returned')),
  order_date date NOT NULL                            -- Asia/Bangkok calendar date
);
COMMENT ON TABLE orders IS 'One row per order line. GMV for reporting = sum(gmv) where status <> ''cancelled''';
CREATE INDEX orders_date ON orders (order_date);
CREATE INDEX orders_shop_date ON orders (shop_id, order_date);

WITH today AS (SELECT (now() AT TIME ZONE 'Asia/Bangkok')::date AS d),
days AS (
  SELECT g::date AS day FROM today, generate_series(d - 300, d - 1, interval '1 day') g
),
lines AS (
  SELECT days.day, s.id AS shop_id, s.platform, b.name AS brand_name, p.sku, p.price,
    (CASE s.platform WHEN 'Shopee' THEN 6 WHEN 'Lazada' THEN 3.5
       ELSE 1.5 + 3.0 * (days.day - (SELECT d FROM today) + 300) / 300.0 END)           -- TikTok grows
    * (CASE b.code WHEN 'KMB' THEN 1.3 WHEN 'MLK' THEN 1.0 WHEN 'GLG' THEN 0.8 ELSE 0.6 END)
    * (CASE WHEN extract(isodow FROM days.day) IN (6, 7) THEN 1.15 ELSE 1 END)
    * (CASE WHEN extract(day FROM days.day) >= 25 OR extract(day FROM days.day) <= 2 THEN 1.25 ELSE 1 END)
    * (CASE WHEN extract(day FROM days.day) = extract(month FROM days.day) THEN 3 ELSE 1 END)  -- 9.9, 10.10, 11.11
    * (CASE WHEN s.id = 'SHP-KMB' AND days.day >= date_trunc('month', (SELECT d FROM today)) THEN 0.6 ELSE 1 END)
    * (CASE WHEN p.sku = 'KMB-003' AND days.day >= (SELECT d FROM today) - 10 THEN 0 ELSE 1 END)
    * (CASE WHEN p.launched_at > days.day THEN 0 ELSE 1 END) AS lambda,
    extract(day FROM days.day) = extract(month FROM days.day) AS mega
  FROM days
  CROSS JOIN shops s
  JOIN brands b ON b.id = s.brand_id
  JOIN products p ON p.brand_id = s.brand_id
),
expanded AS (
  SELECT l.*, generate_series(1, floor(random() * l.lambda * 2)::int) AS n
  FROM lines l
),
priced AS (
  SELECT e.*, 1 + floor(power(random(), 3) * 4)::int AS q,
         CASE WHEN mega THEN 0.15 + random() * 0.15 ELSE random() * 0.12 END AS disc,
         random() AS r
  FROM expanded e
)
INSERT INTO orders (platform, shop_id, brand_name, sku, qty, gmv, status, order_date)
SELECT platform, shop_id, brand_name, sku, q, round((q * price * (1 - disc))::numeric, 2),
       CASE WHEN r < 0.05 THEN 'cancelled' WHEN r < 0.08 THEN 'returned' ELSE 'completed' END,
       day
FROM priced
ORDER BY day;

CREATE TABLE ads_spend (
  id          bigserial PRIMARY KEY,
  spend_date  date NOT NULL,
  platform    text NOT NULL,
  shop_id     text NOT NULL REFERENCES shops(id),
  brand_name  text NOT NULL,
  campaign    text NOT NULL,
  spend       numeric(12, 2) NOT NULL,   -- THB
  impressions int NOT NULL,
  clicks      int NOT NULL,
  ads_orders  int NOT NULL,
  ads_gmv     numeric(12, 2) NOT NULL    -- GMV attributed to ads; ROAS = ads_gmv / spend
);
COMMENT ON TABLE ads_spend IS 'Daily ad spend per shop and campaign. ROAS = ads_gmv / spend';

WITH today AS (SELECT (now() AT TIME ZONE 'Asia/Bangkok')::date AS d),
base AS (
  SELECT g::date AS day, s.id AS shop_id, s.platform, b.name AS brand_name,
    (CASE s.platform WHEN 'Shopee' THEN 2500 WHEN 'Lazada' THEN 1500 ELSE 1800 END)
    * (CASE b.code WHEN 'KMB' THEN 1.3 WHEN 'MLK' THEN 1.0 WHEN 'GLG' THEN 0.9 ELSE 0.5 END)
    * (CASE WHEN s.id = 'SHP-KMB' AND g >= date_trunc('month', (SELECT d FROM today)) THEN 0.4 ELSE 1 END)
    * (0.85 + random() * 0.3) AS spend,
    extract(day FROM g) = extract(month FROM g) AS mega
  FROM today, generate_series(d - 300, d - 1, interval '1 day') g
  CROSS JOIN shops s JOIN brands b ON b.id = s.brand_id
),
spend_rows AS (
  SELECT day, shop_id, platform, brand_name, 'Always-on' AS campaign, spend, 4 + random() * 4 AS roas FROM base
  UNION ALL
  SELECT day, shop_id, platform, brand_name, 'Mega Sale ' || extract(month FROM day) || '.' || extract(month FROM day),
         spend * 2.5, 6 + random() * 5 FROM base WHERE mega
)
INSERT INTO ads_spend (spend_date, platform, shop_id, brand_name, campaign, spend, impressions, clicks, ads_orders, ads_gmv)
SELECT day, platform, shop_id, brand_name, campaign, round(spend::numeric, 2),
       (spend * (35 + random() * 10))::int, (spend * (0.9 + random() * 0.4))::int,
       (spend * roas / 180)::int, round((spend * roas)::numeric, 2)
FROM spend_rows ORDER BY day;

CREATE TABLE stock (
  sku           text NOT NULL REFERENCES products(sku),
  warehouse     text NOT NULL,
  on_hand       int NOT NULL,
  reserved      int NOT NULL,
  reorder_point int NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sku, warehouse)
);
COMMENT ON TABLE stock IS 'Current stock snapshot. available = on_hand - reserved';
INSERT INTO stock (sku, warehouse, on_hand, reserved, reorder_point)
SELECT p.sku, w,
       CASE WHEN p.sku = 'KMB-003' THEN 0 ELSE 200 + floor(random() * 2500)::int END,
       CASE WHEN p.sku = 'KMB-003' THEN 0 ELSE floor(random() * 150)::int END,
       300
FROM products p CROSS JOIN unnest(ARRAY['BKK-WH1', 'CNX-WH2']) w;
UPDATE stock SET on_hand = 180 WHERE sku = 'GLG-001' AND warehouse = 'BKK-WH1';  -- below reorder point

-- A table the AI must never see (hiddenTables). Values are fake.
CREATE TABLE api_keys (id serial PRIMARY KEY, name text, token text);
INSERT INTO api_keys (name, token) VALUES ('shopee-open-api', 'demo_fake_token_do_not_leak_1'), ('lazada-open-api', 'demo_fake_token_do_not_leak_2');

-- Read-only access for the AI role. api_keys revoked at the DB level too (defence in depth).
GRANT USAGE ON SCHEMA shop TO ai_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA shop TO ai_reader;
REVOKE ALL ON shop.api_keys FROM ai_reader;
ANALYZE;
