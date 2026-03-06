-- AI Math Teacher 数据库 Schema
-- 执行方式：psql -U postgres -d ai_math_teacher -f schema.sql

-- ===== 用户表 =====
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  nickname      VARCHAR(100),
  role          VARCHAR(20) NOT NULL DEFAULT 'free',  -- free | paid | admin
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ===== 刷新令牌表（安全登出/多端管理） =====
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);

-- ===== 每日用量统计表 =====
CREATE TABLE IF NOT EXISTS usage_records (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date          DATE NOT NULL DEFAULT CURRENT_DATE,
  request_count INTEGER NOT NULL DEFAULT 0,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_usage_user_date ON usage_records(user_id, date);

-- ===== AI 请求日志（可选，用于计费审计）=====
CREATE TABLE IF NOT EXISTS ai_request_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider          VARCHAR(50),
  model             VARCHAR(100),
  prompt_tokens     INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  latency_ms        INTEGER DEFAULT 0,
  success           BOOLEAN DEFAULT TRUE,
  error_msg         TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_logs_user ON ai_request_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_logs_created ON ai_request_logs(created_at);

-- ===== 用户云端数据同步表 =====
-- 使用 JSONB 存储，每个 data_type 对应一类数据，整体存储以简化同步逻辑
CREATE TABLE IF NOT EXISTS user_data (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data_type  VARCHAR(50) NOT NULL,  -- wrong_problems | notes | qbank | settings
  payload    JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, data_type)
);

CREATE INDEX IF NOT EXISTS idx_user_data_user ON user_data(user_id);

-- ===== 自动更新 updated_at 触发器 =====
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_users_updated_at') THEN
    CREATE TRIGGER trg_users_updated_at
      BEFORE UPDATE ON users
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_user_data_updated_at') THEN
    CREATE TRIGGER trg_user_data_updated_at
      BEFORE UPDATE ON user_data
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END;
$$;
