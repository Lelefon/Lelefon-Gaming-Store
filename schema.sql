-- Your Complete Database Schema

DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS packages;
DROP TABLE IF EXISTS regions;
DROP TABLE IF EXISTS games;
DROP TABLE IF EXISTS wallets;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  email TEXT PRIMARY KEY NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE wallets (
  user_email TEXT PRIMARY KEY NOT NULL,
  balance REAL NOT NULL DEFAULT 0,
  FOREIGN KEY (user_email) REFERENCES users(email) ON DELETE CASCADE
);

CREATE TABLE games (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    image_url TEXT NOT NULL,
    category TEXT NOT NULL,
    regionable INTEGER NOT NULL,
    uid_required INTEGER NOT NULL
);

CREATE TABLE regions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id TEXT NOT NULL,
    region_key TEXT NOT NULL,
    name TEXT NOT NULL,
    flag TEXT,
    UNIQUE(game_id, region_key),
    FOREIGN KEY(game_id) REFERENCES games(id) ON DELETE CASCADE
);

CREATE TABLE packages (
    id TEXT PRIMARY KEY NOT NULL,
    game_id TEXT NOT NULL,
    region_key TEXT NOT NULL,
    label TEXT NOT NULL,
    price REAL NOT NULL,
    FOREIGN KEY(game_id) REFERENCES games(id) ON DELETE CASCADE
);

CREATE TABLE orders (
  id TEXT PRIMARY KEY NOT NULL,
  user_email TEXT NOT NULL,
  total REAL NOT NULL,
  payment_method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Processing',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_email) REFERENCES users(email)
);

CREATE TABLE order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT NOT NULL,
    game_name TEXT NOT NULL,
    package_label TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    price_at_purchase REAL NOT NULL,
    uid TEXT,
    pin TEXT,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

-- INSERT DEFAULT ADMIN USER (Password: admin123)
INSERT INTO users (email, password_hash, role) VALUES ('admin@lelefon.com', 'YWRtaW4xMjM=', 'admin');
INSERT INTO wallets (user_email, balance) VALUES ('admin@lelefon.com', 999999);