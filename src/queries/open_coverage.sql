SELECT
  id,
  requester_name,
  title,
  date,
  start_time,
  end_time,
  kids,
  est_minutes,
  capacity,
  status,
  created_at
FROM app_babysitting_coop__coverage_requests
WHERE status = 'open'
ORDER BY date ASC, created_at ASC
LIMIT 200
