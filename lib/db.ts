import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "team-metrics.db");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    initDb();
  }
  return db;
}

export interface PullRequestRow {
  bb_id: number;
  repo_slug: string;
  author_uuid: string;
  author_name: string;
  title: string;
  state: string;
  lines_added: number;
  lines_removed: number;
  created_at: string;
  updated_at: string;
  merged_at: string | null;
}

export interface PrCommentRow {
  bb_id: number;
  pr_bb_id: number;
  author_uuid: string;
  author_name: string;
  created_at: string;
  is_approval: boolean;
  is_request_changes: boolean;
}

export interface JiraIssueRow {
  issue_key: string;
  issue_type: string;
  assignee_id: string | null;
  assignee_name: string | null;
  summary: string;
  status: string;
  story_points: number | null;
  created_at: string;
  resolved_at: string | null;
}

export interface IssueTransitionRow {
  issue_key: string;
  from_status: string | null;
  to_status: string;
  author_id: string | null;
  transitioned_at: string;
}

export interface TeamMemberRow {
  source: "bitbucket" | "jira";
  external_id: string;
  display_name: string;
  email: string | null;
}

export interface StatusMappingRow {
  jira_status_name: string;
  category: "progress" | "review" | "blocked" | "done" | "other";
}

function initDb(): void {
  const database = getDb();

  database.exec(`
    CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL CHECK(source IN ('bitbucket', 'jira')),
      last_synced_at TEXT NOT NULL,
      last_cursor TEXT,
      items_fetched INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pull_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bb_id INTEGER UNIQUE NOT NULL,
      repo_slug TEXT NOT NULL,
      author_uuid TEXT NOT NULL,
      author_name TEXT NOT NULL,
      title TEXT NOT NULL,
      state TEXT NOT NULL,
      lines_added INTEGER DEFAULT 0,
      lines_removed INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      merged_at TEXT
    );

    CREATE TABLE IF NOT EXISTS pr_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bb_id INTEGER UNIQUE NOT NULL,
      pr_bb_id INTEGER NOT NULL,
      author_uuid TEXT NOT NULL,
      author_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      is_approval INTEGER DEFAULT 0,
      is_request_changes INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS jira_issues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_key TEXT UNIQUE NOT NULL,
      issue_type TEXT NOT NULL,
      assignee_id TEXT,
      assignee_name TEXT,
      summary TEXT NOT NULL,
      status TEXT NOT NULL,
      story_points REAL,
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS issue_transitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_key TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT NOT NULL,
      author_id TEXT,
      transitioned_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS status_mapping (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      jira_status_name TEXT UNIQUE NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('progress', 'review', 'blocked', 'done', 'other'))
    );

    CREATE TABLE IF NOT EXISTS team_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL CHECK(source IN ('bitbucket', 'jira')),
      external_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      email TEXT,
      is_active INTEGER DEFAULT 1,
      UNIQUE(source, external_id)
    );

    CREATE INDEX IF NOT EXISTS idx_pr_author ON pull_requests(author_uuid);
    CREATE INDEX IF NOT EXISTS idx_pr_created ON pull_requests(created_at);
    CREATE INDEX IF NOT EXISTS idx_comments_author ON pr_comments(author_uuid);
    CREATE INDEX IF NOT EXISTS idx_jira_assignee ON jira_issues(assignee_id);
    CREATE INDEX IF NOT EXISTS idx_transitions_issue ON issue_transitions(issue_key);
  `);
}

export function getSyncLog(
  source: "bitbucket" | "jira"
): { last_synced_at: string; last_cursor: string | null } | null {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT last_synced_at, last_cursor FROM sync_log WHERE source = ? ORDER BY id DESC LIMIT 1"
    )
    .get(source) as { last_synced_at: string; last_cursor: string | null } | undefined;
  return row || null;
}

export function insertSyncLog(
  source: "bitbucket" | "jira",
  itemsFetched: number,
  cursor?: string
): void {
  const db = getDb();
  db.prepare(
    "INSERT INTO sync_log (source, last_synced_at, items_fetched, last_cursor) VALUES (?, ?, ?, ?)"
  ).run(source, new Date().toISOString(), itemsFetched, cursor || null);
}

export function upsertPullRequest(pr: PullRequestRow): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO pull_requests (bb_id, repo_slug, author_uuid, author_name, title, state, lines_added, lines_removed, created_at, updated_at, merged_at)
    VALUES (@bb_id, @repo_slug, @author_uuid, @author_name, @title, @state, @lines_added, @lines_removed, @created_at, @updated_at, @merged_at)
    ON CONFLICT(bb_id) DO UPDATE SET
      state = excluded.state,
      lines_added = excluded.lines_added,
      lines_removed = excluded.lines_removed,
      updated_at = excluded.updated_at,
      merged_at = excluded.merged_at
  `).run(pr);
}

export function upsertPrComment(comment: PrCommentRow): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO pr_comments (bb_id, pr_bb_id, author_uuid, author_name, created_at, is_approval, is_request_changes)
    VALUES (@bb_id, @pr_bb_id, @author_uuid, @author_name, @created_at, @is_approval, @is_request_changes)
    ON CONFLICT(bb_id) DO UPDATE SET
      is_approval = excluded.is_approval,
      is_request_changes = excluded.is_request_changes
  `).run({
    ...comment,
    is_approval: comment.is_approval ? 1 : 0,
    is_request_changes: comment.is_request_changes ? 1 : 0,
  });
}

export function upsertJiraIssue(issue: JiraIssueRow): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO jira_issues (issue_key, issue_type, assignee_id, assignee_name, summary, status, story_points, created_at, resolved_at)
    VALUES (@issue_key, @issue_type, @assignee_id, @assignee_name, @summary, @status, @story_points, @created_at, @resolved_at)
    ON CONFLICT(issue_key) DO UPDATE SET
      status = excluded.status,
      assignee_id = excluded.assignee_id,
      assignee_name = excluded.assignee_name,
      story_points = excluded.story_points,
      resolved_at = excluded.resolved_at
  `).run(issue);
}

export function insertIssueTransition(transition: IssueTransitionRow): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO issue_transitions (issue_key, from_status, to_status, author_id, transitioned_at)
    VALUES (@issue_key, @from_status, @to_status, @author_id, @transitioned_at)
  `).run(transition);
}

export function clearIssueTransitions(issueKey: string): void {
  const db = getDb();
  db.prepare("DELETE FROM issue_transitions WHERE issue_key = ?").run(issueKey);
}

export function upsertTeamMember(member: TeamMemberRow): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO team_members (source, external_id, display_name, email)
    VALUES (@source, @external_id, @display_name, @email)
    ON CONFLICT(source, external_id) DO UPDATE SET
      display_name = excluded.display_name,
      email = excluded.email
  `).run(member);
}

export function getTeamMembers(): (TeamMemberRow & { id: number })[] {
  const db = getDb();
  return db.prepare("SELECT * FROM team_members WHERE is_active = 1").all() as (TeamMemberRow & {
    id: number;
  })[];
}

export function getStatusMapping(): StatusMappingRow[] {
  const db = getDb();
  return db.prepare("SELECT jira_status_name, category FROM status_mapping").all() as StatusMappingRow[];
}

export function upsertStatusMapping(status: string, category: StatusMappingRow["category"]): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO status_mapping (jira_status_name, category)
    VALUES (?, ?)
    ON CONFLICT(jira_status_name) DO UPDATE SET category = excluded.category
  `).run(status, category);
}

export function getDistinctJiraStatuses(): string[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT DISTINCT to_status FROM issue_transitions ORDER BY to_status")
    .all() as { to_status: string }[];
  return rows.map((r) => r.to_status);
}

// Check if a PR is already finalized (merged/declined/superseded)
// Returns: { exists: boolean, finalized: boolean, state: string | null, updatedAt: string | null }
export function getPullRequestStatus(bbId: number): {
  exists: boolean;
  finalized: boolean;
  state: string | null;
  updatedAt: string | null;
} {
  const db = getDb();
  const row = db
    .prepare("SELECT state, updated_at FROM pull_requests WHERE bb_id = ?")
    .get(bbId) as { state: string; updated_at: string } | undefined;

  if (!row) {
    return { exists: false, finalized: false, state: null, updatedAt: null };
  }

  // OPEN PRs can still change, others are finalized
  const finalized = row.state !== "OPEN";
  return { exists: true, finalized, state: row.state, updatedAt: row.updated_at };
}

// Check if a JIRA issue is already resolved
// Returns: { exists: boolean, resolved: boolean }
export function getJiraIssueStatus(issueKey: string): { exists: boolean; resolved: boolean } {
  const db = getDb();
  const row = db
    .prepare("SELECT resolved_at FROM jira_issues WHERE issue_key = ?")
    .get(issueKey) as { resolved_at: string | null } | undefined;

  if (!row) {
    return { exists: false, resolved: false };
  }

  return { exists: true, resolved: row.resolved_at !== null };
}

// Check if we have changelog for an issue
export function hasIssueTransitions(issueKey: string): boolean {
  const db = getDb();
  const row = db
    .prepare("SELECT COUNT(*) as count FROM issue_transitions WHERE issue_key = ?")
    .get(issueKey) as { count: number };
  return row.count > 0;
}
