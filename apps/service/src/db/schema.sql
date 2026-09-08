-- Toolroll 数据模型(spec 6)—— 幂等,启动时执行
CREATE TABLE IF NOT EXISTS users (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id),
  key_hash      TEXT NOT NULL UNIQUE,          -- 平台 key 只存 SHA-256
  name          TEXT NOT NULL DEFAULT 'default',
  status        TEXT NOT NULL DEFAULT 'active', -- active | revoked
  last_used_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS balances (
  user_id     BIGINT PRIMARY KEY REFERENCES users(id),
  credits     BIGINT NOT NULL DEFAULT 0,       -- 1 credit = ¥0.01,整数分记账
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recharge_records (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id),
  credits     BIGINT NOT NULL,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS usage_records (
  id               BIGSERIAL PRIMARY KEY,
  user_id          BIGINT NOT NULL REFERENCES users(id),
  api_key_id       BIGINT NOT NULL REFERENCES api_keys(id),
  provider         TEXT NOT NULL,
  action           TEXT NOT NULL,
  credits          BIGINT NOT NULL DEFAULT 0,  -- 实扣;失败为 0
  status           TEXT NOT NULL,              -- success | error
  error_code       TEXT,
  upstream_status  INT,
  latency_ms       INT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_usage_user_time ON usage_records (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_provider_time ON usage_records (provider, created_at);

CREATE TABLE IF NOT EXISTS provider_keys (
  id             BIGSERIAL PRIMARY KEY,
  provider       TEXT NOT NULL,
  encrypted_key  TEXT NOT NULL,                -- AES-256-GCM(masterKey 派生)
  status         TEXT NOT NULL DEFAULT 'active',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_provider_keys_provider ON provider_keys (provider, status);
