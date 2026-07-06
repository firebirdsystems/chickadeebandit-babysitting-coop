SELECT
  id,
  request_id,
  member_id,
  note,
  claimed_at
FROM app_babysitting_coop__coverage_claims
ORDER BY claimed_at DESC
LIMIT 200
