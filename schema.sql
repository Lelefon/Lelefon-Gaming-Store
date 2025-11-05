-- =========================================
-- Lelefon Gaming Store - Database Schema
-- =========================================
PRAGMA foreign_keys = ON;

-- --------- DROP (for rebuilds) ----------
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS packages;
DROP TABLE IF EXISTS regions;
DROP TABLE IF EXISTS games;
DROP TABLE IF EXISTS wallets;
DROP TABLE IF EXISTS users;

-- -------------- USERS -------------------
CREATE TABLE users (
  email        TEXT PRIMARY KEY NOT NULL,
  password_hash TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'user',
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- -------------- WALLETS -----------------
CREATE TABLE wallets (
  user_email TEXT PRIMARY KEY NOT NULL,
  balance    REAL NOT NULL DEFAULT 0 CHECK (balance >= 0),
  FOREIGN KEY (user_email) REFERENCES users(email) ON DELETE CASCADE
);

-- --------------- GAMES ------------------
CREATE TABLE games (
  id           TEXT PRIMARY KEY NOT NULL,
  name         TEXT NOT NULL,
  image_url    TEXT NOT NULL,
  category     TEXT NOT NULL,            -- 'direct' | 'card'
  regionable   INTEGER NOT NULL,         -- 0 or 1
  uid_required INTEGER NOT NULL          -- 0 or 1
);

-- -------------- REGIONS -----------------
CREATE TABLE regions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id    TEXT NOT NULL,
  region_key TEXT NOT NULL,              -- e.g., 'MY', 'SG'
  name       TEXT NOT NULL,              -- e.g., 'Malaysia'
  flag       TEXT,                       -- emoji or short flag text
  UNIQUE (game_id, region_key),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);

-- ------------- PACKAGES -----------------
-- region_key is NULL for non-regionable games.
CREATE TABLE packages (
  id           TEXT PRIMARY KEY NOT NULL,
  game_id      TEXT NOT NULL,
  region_key   TEXT DEFAULT NULL,        -- NULL for no-region games
  label        TEXT NOT NULL,            -- e.g., '475 VP'
  price        REAL NOT NULL CHECK (price >= 0),
  discount_pct REAL NOT NULL DEFAULT 0   -- percentage 0..100
                 CHECK (discount_pct >= 0 AND discount_pct <= 100),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);

-- --------------- ORDERS -----------------
CREATE TABLE orders (
  id             TEXT PRIMARY KEY NOT NULL,
  user_email     TEXT NOT NULL,
  total          REAL NOT NULL CHECK (total >= 0),
  payment_method TEXT NOT NULL,          -- 'LF Wallet' | 'iPay88' | etc.
  status         TEXT NOT NULL DEFAULT 'Processing',
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_email) REFERENCES users(email)
);

-- ------------ ORDER ITEMS ---------------
CREATE TABLE order_items (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id           TEXT NOT NULL,
  game_name          TEXT NOT NULL,
  package_label      TEXT NOT NULL,
  quantity           INTEGER NOT NULL CHECK (quantity > 0),
  price_at_purchase  REAL NOT NULL CHECK (price_at_purchase >= 0),
  uid                TEXT,
  pin                TEXT,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

-- --------------- INDEXES ----------------
CREATE INDEX idx_games_category          ON games(category);
CREATE INDEX idx_regions_game            ON regions(game_id);
CREATE INDEX idx_packages_game_region    ON packages(game_id, region_key);
CREATE INDEX idx_orders_user_created     ON orders(user_email, created_at DESC);
CREATE INDEX idx_items_order             ON order_items(order_id);

-- ---------- DEFAULT ADMIN USER ----------
-- Password: admin123  (base64 -> YWRtaW4xMjM=)
INSERT INTO users (email, password_hash, role)
VALUES ('admin@lelefon.com', 'YWRtaW4xMjM=', 'admin');

INSERT INTO wallets (user_email, balance)
VALUES ('admin@lelefon.com', 999999);
