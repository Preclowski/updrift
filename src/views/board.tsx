import type { BoardFeature, FeatureRow, FeatureStatus } from "../db";
import { VOTABLE_STATUSES } from "../db";

export const STATUS_LABELS: Record<FeatureStatus, string> = {
  new: "Pending",
  approved: "Planned",
  in_progress: "In progress",
  done: "Done",
  rejected: "Rejected",
};

/**
 * The vote control. Interactive only for votable statuses; done/rejected/new
 * render a frozen counter. This mirrors the server-side rule — the server
 * re-checks status and uniqueness on every request regardless.
 */
export function VoteControl(props: { feature: Pick<FeatureRow, "id" | "status" | "vote_count">; hasVoted: boolean }) {
  const { feature, hasVoted } = props;
  const votable = (VOTABLE_STATUSES as string[]).includes(feature.status);
  if (!votable) {
    return (
      <div class="vote-frozen" id={`vote-${feature.id}`} title="Voting closed">
        <span class="vote-arrow">▲</span>
        <strong>{feature.vote_count}</strong>
      </div>
    );
  }
  return hasVoted ? (
    <button
      class="vote-btn"
      id={`vote-${feature.id}`}
      data-voted="1"
      hx-delete={`/api/features/${feature.id}/vote`}
      hx-swap="outerHTML"
      title="You voted — click to remove your vote"
    >
      <span class="vote-arrow">▲</span>
      <strong>{feature.vote_count}</strong>
    </button>
  ) : (
    <button
      class="vote-btn"
      id={`vote-${feature.id}`}
      data-voted="0"
      data-needs-token
      hx-post={`/api/features/${feature.id}/vote`}
      hx-swap="outerHTML"
      title="Vote for this feature"
    >
      <span class="vote-arrow">▲</span>
      <strong>{feature.vote_count}</strong>
    </button>
  );
}

function FeatureCard(props: { feature: BoardFeature; pending?: boolean }) {
  const f = props.feature;
  return (
    <div class="card">
      <VoteControl feature={f} hasVoted={f.has_voted === 1} />
      <div class="body">
        <h3>
          {f.title}
          {props.pending ? <span class="badge">awaiting approval</span> : null}
          {f.status === "in_progress" ? <span class="badge progress">in progress</span> : null}
          {f.status === "done" ? <span class="badge done">done</span> : null}
        </h3>
        {f.description ? <p>{f.description}</p> : null}
      </div>
    </div>
  );
}

export function Board(props: { features: BoardFeature[]; submitted?: boolean }) {
  // One flat list, ordered by votes (the query's order); finished items sink
  // to the bottom — no kanban columns on the public board.
  const visible = props.features
    .filter((f) => f.status !== "new")
    .sort((a, b) => Number(a.status === "done") - Number(b.status === "done"));
  const mine = props.features.filter((f) => f.status === "new");

  return (
    <>
      {props.submitted ? (
        <div class="flash">
          Thanks! Your idea was submitted and is awaiting moderation. It already carries your
          vote and will appear publicly once approved.
        </div>
      ) : null}

      <SubmitForm />

      {mine.length > 0 ? (
        <section>
          <h2 class="muted">Your pending submissions</h2>
          {mine.map((f) => (
            <FeatureCard feature={f} pending />
          ))}
        </section>
      ) : null}

      <section>
        {visible.length === 0 ? <p class="muted">Nothing here yet — suggest something!</p> : null}
        {visible.map((f) => (
          <FeatureCard feature={f} />
        ))}
      </section>

      {/* Collapsed by default; content lazy-loads from /closed on first open. */}
      <details class="closed-toggle" style="margin-top:1.5rem">
        <summary>Closed / rejected</summary>
        <div hx-get="/closed" hx-trigger="toggle once from:closest details" hx-swap="innerHTML">
          <p class="muted">Loading…</p>
        </div>
      </details>
    </>
  );
}

export function SubmitForm() {
  return (
    <details class="submit-box" open={false}>
      <summary style="cursor:pointer;font-weight:600">Suggest a feature</summary>
      <form method="post" action="/api/features" style="margin-top:0.8rem">
        <input type="text" name="title" placeholder="Short title" required minlength={3} maxlength={120} />
        <textarea
          name="description"
          placeholder="What should it do, and why does it matter? (optional)"
          rows={3}
          maxlength={2000}
        ></textarea>
        <div id="ts-form" style="margin-bottom:0.6rem"></div>
        <button class="primary" type="submit">
          Submit for review
        </button>
        <p class="muted">New ideas are reviewed by a maintainer before they appear publicly.</p>
      </form>
    </details>
  );
}

export function ClosedList(props: { features: FeatureRow[] }) {
  if (props.features.length === 0) {
    return <p class="muted">No rejected ideas. Clean slate!</p>;
  }
  return (
    <div style="margin-top:0.8rem">
      {props.features.map((f) => (
        <div class="card">
          <div class="vote-frozen" title="Voting closed">
            <span class="vote-arrow">▲</span>
            <strong>{f.vote_count}</strong>
          </div>
          <div class="body">
            <h3>
              {f.title}
              <span class="badge rejected">rejected</span>
            </h3>
            {f.description ? <p>{f.description}</p> : null}
            {f.reject_reason ? <div class="reject-reason">Reason: {f.reject_reason}</div> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
