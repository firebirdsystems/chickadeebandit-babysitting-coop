-- recent_claims orders by claimed_at DESC under LIMIT 200. The existing
-- (request_id, claimed_at) index cannot serve an unfiltered ordering because
-- claimed_at is not its leading column.
CREATE INDEX IF NOT EXISTS app_babysitting_coop__coverage_claims_claimed_idx
  ON app_babysitting_coop__coverage_claims(claimed_at);
