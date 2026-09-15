import { getDb, getStatusMapping } from "./db";

export interface BitbucketMetrics {
  prsAuthored: number;
  prsMerged: number;
  prsReviewed: number;
  commentsMade: number;
  avgCommentsPerPr: number;
  avgPrSize: number;
  avgTimeToMergeDays: number;
}

export interface JiraMetrics {
  ticketsWorked: number;
  ticketsCompleted: number;
  storyPointsDelivered: number;
  avgTimeInProgressDays: number;
  avgTimeInReviewDays: number;
  avgCycleTimeDays: number;
}

export interface TeamMemberMetrics {
  userId: string;
  displayName: string;
  source: "bitbucket" | "jira";
  bitbucket: BitbucketMetrics;
  jira: JiraMetrics;
}

export function getBitbucketMetrics(
  userId: string | null,
  startDate: string,
  endDate: string
): BitbucketMetrics {
  const db = getDb();

  const userFilter = userId ? "AND author_uuid = ?" : "";
  const userParams = userId ? [startDate, endDate, userId] : [startDate, endDate];

  // PRs authored
  const prsAuthored = db
    .prepare(
      `SELECT COUNT(*) as count FROM pull_requests
       WHERE created_at >= ? AND created_at <= ? ${userFilter}`
    )
    .get(...userParams) as { count: number };

  // PRs merged
  const prsMerged = db
    .prepare(
      `SELECT COUNT(*) as count FROM pull_requests
       WHERE merged_at IS NOT NULL AND merged_at >= ? AND merged_at <= ? ${userFilter}`
    )
    .get(...userParams) as { count: number };

  // PRs reviewed (commented on others' PRs)
  const reviewUserFilter = userId ? "AND c.author_uuid = ?" : "";
  const prsReviewed = db
    .prepare(
      `SELECT COUNT(DISTINCT c.pr_bb_id) as count
       FROM pr_comments c
       JOIN pull_requests p ON c.pr_bb_id = p.bb_id
       WHERE c.created_at >= ? AND c.created_at <= ?
       AND c.author_uuid != p.author_uuid
       ${reviewUserFilter}`
    )
    .get(...userParams) as { count: number };

  // Comments made
  const commentsMade = db
    .prepare(
      `SELECT COUNT(*) as count FROM pr_comments
       WHERE created_at >= ? AND created_at <= ?
       ${userId ? "AND author_uuid = ?" : ""}`
    )
    .get(...userParams) as { count: number };

  // Avg PR size
  const avgPrSize = db
    .prepare(
      `SELECT AVG(lines_added + lines_removed) as avg FROM pull_requests
       WHERE created_at >= ? AND created_at <= ? ${userFilter}`
    )
    .get(...userParams) as { avg: number | null };

  // Avg time to merge (in days)
  const avgTimeToMerge = db
    .prepare(
      `SELECT AVG(
         (julianday(merged_at) - julianday(created_at))
       ) as avg FROM pull_requests
       WHERE merged_at IS NOT NULL AND created_at >= ? AND created_at <= ? ${userFilter}`
    )
    .get(...userParams) as { avg: number | null };

  const avgCommentsPerPr =
    prsAuthored.count > 0 ? commentsMade.count / prsAuthored.count : 0;

  return {
    prsAuthored: prsAuthored.count,
    prsMerged: prsMerged.count,
    prsReviewed: prsReviewed.count,
    commentsMade: commentsMade.count,
    avgCommentsPerPr: Math.round(avgCommentsPerPr * 10) / 10,
    avgPrSize: Math.round(avgPrSize.avg || 0),
    avgTimeToMergeDays: Math.round((avgTimeToMerge.avg || 0) * 10) / 10,
  };
}

export function getJiraMetrics(
  userId: string | null,
  startDate: string,
  endDate: string
): JiraMetrics {
  const db = getDb();
  const statusMapping = getStatusMapping();

  const progressStatuses = statusMapping
    .filter((s) => s.category === "progress")
    .map((s) => s.jira_status_name);
  const reviewStatuses = statusMapping
    .filter((s) => s.category === "review")
    .map((s) => s.jira_status_name);
  const doneStatuses = statusMapping
    .filter((s) => s.category === "done")
    .map((s) => s.jira_status_name);

  const userFilter = userId ? "AND assignee_id = ?" : "";
  const userParams = userId ? [startDate, endDate, userId] : [startDate, endDate];

  // Tickets worked (assigned at some point in date range)
  const ticketsWorked = db
    .prepare(
      `SELECT COUNT(DISTINCT issue_key) as count FROM jira_issues
       WHERE created_at <= ? AND (resolved_at IS NULL OR resolved_at >= ?)
       ${userFilter}`
    )
    .get(endDate, startDate, ...(userId ? [userId] : [])) as { count: number };

  // Tickets completed
  const ticketsCompleted = db
    .prepare(
      `SELECT COUNT(*) as count FROM jira_issues
       WHERE resolved_at >= ? AND resolved_at <= ? ${userFilter}`
    )
    .get(...userParams) as { count: number };

  // Story points delivered
  const storyPoints = db
    .prepare(
      `SELECT COALESCE(SUM(story_points), 0) as total FROM jira_issues
       WHERE resolved_at >= ? AND resolved_at <= ? ${userFilter}`
    )
    .get(...userParams) as { total: number };

  // Calculate average time in statuses
  const avgTimeInProgress = calculateAvgTimeInStatuses(
    db,
    progressStatuses,
    startDate,
    endDate,
    userId
  );
  const avgTimeInReview = calculateAvgTimeInStatuses(
    db,
    reviewStatuses,
    startDate,
    endDate,
    userId
  );

  // Avg cycle time (first progress status to done)
  const avgCycleTime = calculateAvgCycleTime(
    db,
    progressStatuses,
    doneStatuses,
    startDate,
    endDate,
    userId
  );

  return {
    ticketsWorked: ticketsWorked.count,
    ticketsCompleted: ticketsCompleted.count,
    storyPointsDelivered: storyPoints.total,
    avgTimeInProgressDays: avgTimeInProgress,
    avgTimeInReviewDays: avgTimeInReview,
    avgCycleTimeDays: avgCycleTime,
  };
}

function calculateAvgTimeInStatuses(
  db: ReturnType<typeof getDb>,
  statuses: string[],
  startDate: string,
  endDate: string,
  userId: string | null
): number {
  if (statuses.length === 0) return 0;

  const placeholders = statuses.map(() => "?").join(",");
  const userFilter = userId
    ? `AND i.assignee_id = ?`
    : "";

  const query = `
    WITH status_periods AS (
      SELECT
        t.issue_key,
        t.to_status,
        t.transitioned_at as entered_at,
        LEAD(t.transitioned_at) OVER (PARTITION BY t.issue_key ORDER BY t.transitioned_at) as exited_at
      FROM issue_transitions t
      JOIN jira_issues i ON t.issue_key = i.issue_key
      WHERE t.to_status IN (${placeholders})
      ${userFilter}
    )
    SELECT AVG(
      julianday(COALESCE(exited_at, datetime('now'))) - julianday(entered_at)
    ) as avg_days
    FROM status_periods
    WHERE entered_at >= ? AND entered_at <= ?
  `;

  const params = userId
    ? [...statuses, userId, startDate, endDate]
    : [...statuses, startDate, endDate];

  const result = db.prepare(query).get(...params) as { avg_days: number | null };
  return Math.round((result.avg_days || 0) * 10) / 10;
}

function calculateAvgCycleTime(
  db: ReturnType<typeof getDb>,
  progressStatuses: string[],
  doneStatuses: string[],
  startDate: string,
  endDate: string,
  userId: string | null
): number {
  if (progressStatuses.length === 0 || doneStatuses.length === 0) return 0;

  const progressPlaceholders = progressStatuses.map(() => "?").join(",");
  const donePlaceholders = doneStatuses.map(() => "?").join(",");
  const userFilter = userId ? `AND i.assignee_id = ?` : "";

  const query = `
    WITH first_progress AS (
      SELECT t.issue_key, MIN(t.transitioned_at) as started_at
      FROM issue_transitions t
      WHERE t.to_status IN (${progressPlaceholders})
      GROUP BY t.issue_key
    ),
    first_done AS (
      SELECT t.issue_key, MIN(t.transitioned_at) as done_at
      FROM issue_transitions t
      WHERE t.to_status IN (${donePlaceholders})
      GROUP BY t.issue_key
    )
    SELECT AVG(julianday(d.done_at) - julianday(p.started_at)) as avg_days
    FROM first_progress p
    JOIN first_done d ON p.issue_key = d.issue_key
    JOIN jira_issues i ON p.issue_key = i.issue_key
    WHERE d.done_at > p.started_at
    AND d.done_at >= ? AND d.done_at <= ?
    ${userFilter}
  `;

  const params = userId
    ? [...progressStatuses, ...doneStatuses, startDate, endDate, userId]
    : [...progressStatuses, ...doneStatuses, startDate, endDate];

  const result = db.prepare(query).get(...params) as { avg_days: number | null };
  return Math.round((result.avg_days || 0) * 10) / 10;
}

// Empty metrics when user doesn't exist in a system
const emptyBitbucketMetrics: BitbucketMetrics = {
  prsAuthored: 0,
  prsMerged: 0,
  prsReviewed: 0,
  commentsMade: 0,
  avgCommentsPerPr: 0,
  avgPrSize: 0,
  avgTimeToMergeDays: 0,
};

const emptyJiraMetrics: JiraMetrics = {
  ticketsWorked: 0,
  ticketsCompleted: 0,
  storyPointsDelivered: 0,
  avgTimeInProgressDays: 0,
  avgTimeInReviewDays: 0,
  avgCycleTimeDays: 0,
};

export function getTeamMetrics(
  startDate: string,
  endDate: string
): TeamMemberMetrics[] {
  const db = getDb();

  // Get all team members grouped by display_name to handle same person in both systems
  const members = db
    .prepare("SELECT external_id, display_name, source FROM team_members WHERE is_active = 1")
    .all() as { external_id: string; display_name: string; source: "bitbucket" | "jira" }[];

  // Group by display_name to merge Bitbucket and JIRA identities
  const memberMap = new Map<string, { bitbucketId: string | null; jiraId: string | null }>();

  for (const member of members) {
    const existing = memberMap.get(member.display_name) || { bitbucketId: null, jiraId: null };
    if (member.source === "bitbucket") {
      existing.bitbucketId = member.external_id;
    } else {
      existing.jiraId = member.external_id;
    }
    memberMap.set(member.display_name, existing);
  }

  // Build metrics for each unique person
  // IMPORTANT: Only query metrics if user has an ID in that system, otherwise return zeros
  return Array.from(memberMap.entries()).map(([displayName, ids]) => ({
    userId: ids.bitbucketId || ids.jiraId || "",
    displayName,
    source: ids.bitbucketId ? "bitbucket" : "jira",
    bitbucket: ids.bitbucketId
      ? getBitbucketMetrics(ids.bitbucketId, startDate, endDate)
      : emptyBitbucketMetrics,
    jira: ids.jiraId
      ? getJiraMetrics(ids.jiraId, startDate, endDate)
      : emptyJiraMetrics,
  }));
}
