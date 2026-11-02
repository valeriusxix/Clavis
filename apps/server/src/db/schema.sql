-- Clavis SQLite schema (AGENT.md 8.1), version 1.
-- Differences from the spec (docs/DECISIONS.md):
--   trades.seq is NULL until the trade settles (SUCCESS or SIMULATED); pending quotes have no seq.
--   traders.key_price_yocto / period_days / style: needed for the leaderboard's keyPrice and cards.
--   price_history: the demo seed's price path (historical marks for equity curves).

CREATE TABLE IF NOT EXISTS traders (
  account_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  is_simulated INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  key_price_yocto TEXT NOT NULL DEFAULT '0',
  period_days INTEGER NOT NULL DEFAULT 30,
  style TEXT
);

CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY,                        -- uuid
  trader_id TEXT NOT NULL REFERENCES traders(account_id),
  seq INTEGER,                                -- 1..n per trader, set on SUCCESS / SIMULATED
  status TEXT NOT NULL,                       -- QUOTED|PENDING_DEPOSIT|KNOWN_DEPOSIT_TX|PROCESSING|SUCCESS|INCOMPLETE_DEPOSIT|REFUNDED|FAILED|SIMULATED
  is_simulated INTEGER NOT NULL DEFAULT 0,
  origin_asset TEXT NOT NULL, origin_symbol TEXT NOT NULL,
  dest_asset TEXT NOT NULL,   dest_symbol TEXT NOT NULL,
  amount_in TEXT NOT NULL,  amount_in_formatted TEXT NOT NULL,  amount_in_usd TEXT NOT NULL,
  amount_out TEXT NOT NULL, amount_out_formatted TEXT NOT NULL, amount_out_usd TEXT NOT NULL,
  confidentiality TEXT NOT NULL,              -- basic|advanced|simulated
  deposit_address TEXT, deposit_memo TEXT, tx_hash TEXT,
  quote_json TEXT NOT NULL,                   -- full raw 1Click response ('{}' for seeded rows)
  quote_signature TEXT,                       -- null for simulated
  signature_valid INTEGER,                    -- 1/0/null
  created_at TEXT NOT NULL, settled_at TEXT,
  UNIQUE (trader_id, seq)
);
CREATE INDEX IF NOT EXISTS trades_by_trader ON trades (trader_id, seq);
CREATE INDEX IF NOT EXISTS trades_by_status ON trades (status);

CREATE TABLE IF NOT EXISTS chain_heads (
  trader_id TEXT PRIMARY KEY,
  trade_count INTEGER NOT NULL,
  head_hash TEXT NOT NULL,
  committed_count INTEGER NOT NULL DEFAULT 0,
  commit_tx TEXT
);

CREATE TABLE IF NOT EXISTS demo_access (      -- demo-mode simulated key purchases
  trader_id TEXT, holder_id TEXT, expires_at TEXT,
  PRIMARY KEY (trader_id, holder_id)
);

CREATE TABLE IF NOT EXISTS prices (asset_id TEXT PRIMARY KEY, symbol TEXT, price REAL, updated_at TEXT);

CREATE TABLE IF NOT EXISTS price_history (
  asset_id TEXT NOT NULL,
  t INTEGER NOT NULL,                         -- ms since epoch
  price REAL NOT NULL,
  PRIMARY KEY (asset_id, t)
);
