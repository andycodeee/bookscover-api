-- Idempotent schema. Runs on every boot; safe to re-run.

CREATE TABLE IF NOT EXISTS players (
  id                BIGINT PRIMARY KEY,                 -- Roblox UserId
  username          TEXT        NOT NULL,
  points            NUMERIC(20, 3) NOT NULL DEFAULT 0 CHECK (points >= 0),
  stage             INTEGER     NOT NULL DEFAULT 1 CHECK (stage >= 1),
  game_state        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  total_afk_seconds BIGINT      NOT NULL DEFAULT 0,
  banned            BOOLEAN     NOT NULL DEFAULT FALSE,
  ban_reason        TEXT,
  last_award_at     TIMESTAMPTZ,                        -- server clock; drives AFK accrual
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE players ALTER COLUMN points TYPE NUMERIC(20, 3) USING points::numeric(20, 3);
ALTER TABLE players ADD COLUMN IF NOT EXISTS stage INTEGER NOT NULL DEFAULT 1;
ALTER TABLE players ADD COLUMN IF NOT EXISTS game_state JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS players_leaderboard_idx ON players (points DESC, id ASC);

CREATE TABLE IF NOT EXISTS items (
  id         BIGINT PRIMARY KEY,                        -- Roblox catalog asset id
  name       TEXT        NOT NULL,
  price      BIGINT      NOT NULL CHECK (price >= 0),
  active     BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory (
  player_id   BIGINT      NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  item_id     BIGINT      NOT NULL REFERENCES items(id),
  source      TEXT        NOT NULL DEFAULT 'redeem',
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, item_id)                       -- one copy per player per item
);

CREATE TABLE IF NOT EXISTS point_ledger (
  id            BIGSERIAL PRIMARY KEY,
  player_id     BIGINT      NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  delta         NUMERIC(20, 3) NOT NULL,
  balance_after NUMERIC(20, 3) NOT NULL,
  reason        TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE point_ledger ALTER COLUMN delta TYPE NUMERIC(20, 3) USING delta::numeric(20, 3);
ALTER TABLE point_ledger ALTER COLUMN balance_after TYPE NUMERIC(20, 3) USING balance_after::numeric(20, 3);
CREATE INDEX IF NOT EXISTS point_ledger_player_idx ON point_ledger (player_id, created_at DESC);

CREATE TABLE IF NOT EXISTS redemptions (
  idempotency_key  TEXT PRIMARY KEY,                     -- client-supplied; makes retries safe
  player_id        BIGINT      NOT NULL,
  item_id          BIGINT      NOT NULL,
  points_remaining NUMERIC(20, 3) NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE redemptions ALTER COLUMN points_remaining TYPE NUMERIC(20, 3) USING points_remaining::numeric(20, 3);

CREATE TABLE IF NOT EXISTS config (
  key        TEXT PRIMARY KEY,
  value      JSONB       NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
