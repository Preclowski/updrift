-- Sample data for local development.
INSERT INTO features (title, description, status, submitter_id) VALUES
  ('Dark mode', 'A proper dark theme for night owls.', 'approved', 'seed-user-1'),
  ('CSV export', 'Export the board to a CSV file.', 'approved', 'seed-user-2'),
  ('Slack integration', 'Post updates to a Slack channel.', 'in_progress', 'seed-user-1'),
  ('Keyboard shortcuts', 'Navigate the board with the keyboard.', 'done', 'seed-user-3'),
  ('Blockchain sync', 'Store every vote on-chain.', 'rejected', 'seed-user-4'),
  ('Email digests', 'Weekly email with top features.', 'new', 'seed-user-2');

UPDATE features SET reject_reason = 'Out of scope — we like our votes cheap and off-chain.' WHERE title = 'Blockchain sync';

-- Votes go through the triggers, so vote_count stays consistent.
INSERT INTO votes (feature_id, voter_id)
SELECT id, 'seed-user-' || v.n
FROM features, (SELECT 1 AS n UNION SELECT 2 UNION SELECT 3) v
WHERE features.title IN ('Dark mode', 'Slack integration');

INSERT INTO votes (feature_id, voter_id)
SELECT id, 'seed-user-1' FROM features WHERE title IN ('CSV export', 'Keyboard shortcuts');

INSERT INTO votes (feature_id, voter_id)
SELECT id, submitter_id FROM features WHERE title = 'Email digests';
