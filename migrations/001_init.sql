-- Babysitting Co-op Ledger — initial schema.
--
-- Two features share one household D1 database:
--   1. Coverage board — coverage_requests are claimable "slots"; sitters claim
--      them through the slot_claims hub endpoints (atomic capacity guard). The
--      claims table is endpoint_only so raw /api/db cannot bypass capacity.
--   2. Hours ledger — ledger_entries is party_scoped (visible/writable only by
--      the two members named on the row). Credit only counts once BOTH parties
--      have confirmed, which is tracked in the separate endpoint_only
--      ledger_agreements table (written exclusively by the api/agree endpoint).
--      Deriving "confirmed" from the agreement table — never from a column the
--      parties can forge on the party_scoped row — is the security boundary.

-- ── Coverage board ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_babysitting_coop__coverage_requests (
  id             TEXT PRIMARY KEY,
  requester_id   TEXT NOT NULL,
  requester_name TEXT NOT NULL,
  title          TEXT NOT NULL,
  date           TEXT NOT NULL,
  start_time     TEXT NOT NULL DEFAULT '',
  end_time       TEXT NOT NULL DEFAULT '',
  kids           TEXT NOT NULL DEFAULT '',
  est_minutes    INTEGER NOT NULL DEFAULT 0 CHECK (est_minutes >= 0),
  capacity       INTEGER NOT NULL DEFAULT 1 CHECK (capacity > 0),
  status         TEXT NOT NULL DEFAULT 'open',
  notes          TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL
);

-- Claims table is written ONLY by the slot_claims endpoints (see manifest).
CREATE TABLE IF NOT EXISTS app_babysitting_coop__coverage_claims (
  id         TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  member_id  TEXT NOT NULL,
  note       TEXT DEFAULT '',
  claimed_at TEXT NOT NULL,
  FOREIGN KEY (request_id) REFERENCES app_babysitting_coop__coverage_requests(id) ON DELETE CASCADE,
  UNIQUE (request_id, member_id)
);

-- ── Hours ledger ──────────────────────────────────────────────────────────────
-- One row per sitting. sitter_id EARNS `minutes` of credit, parent_id SPENDS it.
-- party_scoped: only the two named members can read/write the row. The creating
-- member is forced to be the sitter (self_column), so nobody can log hours that
-- credit a third party. minutes stays encrypted at rest and is summed client-side
-- (never filtered/sorted in SQL) so it needs no plaintext declaration.
CREATE TABLE IF NOT EXISTS app_babysitting_coop__ledger_entries (
  id          TEXT PRIMARY KEY,
  sitter_id   TEXT NOT NULL,
  sitter_name TEXT NOT NULL,
  parent_id   TEXT NOT NULL,
  parent_name TEXT NOT NULL,
  minutes     INTEGER NOT NULL CHECK (minutes > 0),
  occurred_on TEXT NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  request_id  TEXT,
  created_at  TEXT NOT NULL
);

-- Agreement / confirmation state. Written ONLY by the api/agree hub endpoint
-- (endpoint_only). "Confirmed" hours = rows here with status='locked'. A forged
-- value on ledger_entries can never make an entry count, because balances are
-- derived solely from this table.
CREATE TABLE IF NOT EXISTS app_babysitting_coop__ledger_agreements (
  id            TEXT PRIMARY KEY,   -- same id as ledger_entries
  sitter_id     TEXT NOT NULL,      -- copied from ledger_entries on init
  parent_id     TEXT NOT NULL,
  sitter_agreed INTEGER NOT NULL DEFAULT 0,
  parent_agreed INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'locked'
  locked_at     TEXT,
  updated_at    TEXT NOT NULL
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS app_babysitting_coop__coverage_requests_status_idx
  ON app_babysitting_coop__coverage_requests(status, date);

CREATE INDEX IF NOT EXISTS app_babysitting_coop__coverage_claims_request_idx
  ON app_babysitting_coop__coverage_claims(request_id, claimed_at);

CREATE INDEX IF NOT EXISTS app_babysitting_coop__coverage_claims_member_idx
  ON app_babysitting_coop__coverage_claims(member_id);

CREATE INDEX IF NOT EXISTS app_babysitting_coop__ledger_entries_sitter_idx
  ON app_babysitting_coop__ledger_entries(sitter_id, created_at);

CREATE INDEX IF NOT EXISTS app_babysitting_coop__ledger_entries_parent_idx
  ON app_babysitting_coop__ledger_entries(parent_id, created_at);
