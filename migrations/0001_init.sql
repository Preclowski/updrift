-- Updrift initial schema
PRAGMA defer_foreign_keys = true;

CREATE TABLE features (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'new'
                CHECK (status IN ('new', 'approved', 'in_progress', 'done', 'rejected')),
  -- Admin "hide" toggle, independent of status.
  private       INTEGER NOT NULL DEFAULT 0 CHECK (private IN (0, 1)),
  -- Denormalized counter, kept in sync by the vote triggers below.
  -- The board reads this column and never does COUNT(*) over votes.
  vote_count    INTEGER NOT NULL DEFAULT 0,
  reject_reason TEXT,
  -- voter_id of the author, so they can see their own pending submission.
  submitter_id  TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE votes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  feature_id INTEGER NOT NULL REFERENCES features(id) ON DELETE CASCADE,
  voter_id   TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (voter_id, feature_id)
);

CREATE INDEX idx_votes_feature ON votes(feature_id);
CREATE INDEX idx_features_status ON features(status, private);
CREATE INDEX idx_features_submitter ON features(submitter_id);

-- Keep features.vote_count transactionally in sync with the votes table.
-- INSERT ... ON CONFLICT DO NOTHING that inserts nothing does not fire the trigger,
-- so duplicate votes never inflate the counter.
CREATE TRIGGER votes_after_insert AFTER INSERT ON votes
BEGIN
  UPDATE features SET vote_count = vote_count + 1 WHERE id = NEW.feature_id;
END;

CREATE TRIGGER votes_after_delete AFTER DELETE ON votes
BEGIN
  UPDATE features SET vote_count = vote_count - 1 WHERE id = OLD.feature_id;
END;

-- Single-row settings table (id is fixed to 1).
CREATE TABLE settings (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  title        TEXT NOT NULL DEFAULT 'Updrift',
  logo_url     TEXT NOT NULL DEFAULT '',
  website_url  TEXT NOT NULL DEFAULT '',
  accent_color TEXT NOT NULL DEFAULT '#6366f1',
  webhook_url  TEXT NOT NULL DEFAULT ''
);

INSERT INTO settings (id) VALUES (1);
