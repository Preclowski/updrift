/** Row types + thin query helpers. Raw SQL with prepared statements, no ORM. */

export type FeatureStatus = "new" | "approved" | "in_progress" | "done" | "rejected";

export const PUBLIC_STATUSES: FeatureStatus[] = ["approved", "in_progress", "done"];
export const VOTABLE_STATUSES: FeatureStatus[] = ["approved", "in_progress"];

export interface FeatureRow {
  id: number;
  title: string;
  description: string;
  status: FeatureStatus;
  private: number; // 0 | 1
  vote_count: number;
  reject_reason: string | null;
  submitter_id: string;
  created_at: string;
  updated_at: string;
}

/** FeatureRow + "did the current voter already vote on this" flag. */
export interface BoardFeature extends FeatureRow {
  has_voted: number; // 0 | 1
}

export interface SettingsRow {
  id: number;
  title: string;
  logo_url: string;
  website_url: string;
  accent_color: string;
  webhook_url: string;
}

export function getSettings(db: D1Database): Promise<SettingsRow> {
  return db
    .prepare("SELECT * FROM settings WHERE id = 1")
    .first<SettingsRow>()
    .then((row) => {
      if (!row) throw new Error("settings row missing — run migrations");
      return row;
    });
}

/**
 * Everything the public board needs in ONE query:
 * public features (approved/in_progress/done, not private) + the current
 * voter's own pending ("new") submissions, each with a has_voted flag.
 * Reads the denormalized vote_count — never COUNT(*) over votes.
 */
export function getBoardFeatures(db: D1Database, voterId: string): Promise<BoardFeature[]> {
  return db
    .prepare(
      `SELECT f.*, EXISTS(
         SELECT 1 FROM votes v WHERE v.feature_id = f.id AND v.voter_id = ?1
       ) AS has_voted
       FROM features f
       WHERE (f.status IN ('approved', 'in_progress', 'done') AND f.private = 0)
          OR (f.status = 'new' AND f.submitter_id = ?1)
       ORDER BY f.vote_count DESC, f.created_at DESC`,
    )
    .bind(voterId)
    .all<BoardFeature>()
    .then((r) => r.results);
}

export function getRejectedFeatures(db: D1Database): Promise<FeatureRow[]> {
  return db
    .prepare(
      `SELECT * FROM features
       WHERE status = 'rejected' AND private = 0
       ORDER BY updated_at DESC`,
    )
    .all<FeatureRow>()
    .then((r) => r.results);
}

export function getFeature(db: D1Database, id: number): Promise<FeatureRow | null> {
  return db.prepare("SELECT * FROM features WHERE id = ?1").bind(id).first<FeatureRow>();
}
