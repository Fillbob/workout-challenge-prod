-- Calculate total points per user based on completed submissions.
-- This query sums the base_points from challenges for each user that has
-- completed submissions. Adjust the WHERE clause if you need to scope by
-- team_id or date range.
SELECT
  s.user_id,
  COALESCE(SUM(c.base_points), 0) AS total_points,
  COUNT(*) FILTER (WHERE s.completed) AS completed_submissions
FROM submissions AS s
JOIN challenges AS c ON c.id = s.challenge_id
WHERE s.completed = TRUE
GROUP BY s.user_id
ORDER BY total_points DESC, completed_submissions DESC;
