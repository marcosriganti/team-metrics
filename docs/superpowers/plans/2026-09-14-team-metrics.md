# Team Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Next.js app that fetches team performance metrics from Bitbucket Cloud and JIRA Cloud, stores data locally in SQLite to avoid duplicate API calls, and displays metrics in a dashboard with export functionality.

**Architecture:** Next.js 14 App Router with API routes for sync/metrics/export operations. SQLite via better-sqlite3 for local storage. Dashboard with date range and user filters. Manual sync triggered by user.

**Tech Stack:** Next.js 14, TypeScript, shadcn/ui (custom preset), better-sqlite3, pdfmake (for PDF export)

**Spec:** `docs/specs/2026-09-14-team-metrics-design.md`

## Global Constraints

- Node.js 18+
- pnpm as package manager
- All dates stored as ISO 8601 strings in SQLite
- Environment variables for all credentials (never hardcoded)
- Incremental sync only — never re-fetch data already stored

---

## File Structure

```
team-metrics/
├── app/
│   ├── layout.tsx               # Root layout with providers
│   ├── page.tsx                 # Dashboard page
│   ├── settings/
│   │   └── page.tsx             # Settings page
│   └── api/
│       ├── sync/
│       │   ├── bitbucket/route.ts
│       │   └── jira/route.ts
│       ├── metrics/route.ts
│       ├── settings/route.ts
│       ├── users/route.ts
│       └── export/route.ts
├── components/
│   ├── ui/                      # shadcn components (auto-generated)
│   ├── header.tsx               # App header with sync/settings
│   ├── metrics-card.tsx         # Reusable metrics display card
│   ├── date-range-picker.tsx    # Date range selection
│   ├── user-selector.tsx        # User dropdown filter
│   ├── team-table.tsx           # Comparison table
│   └── status-mapper.tsx        # JIRA status category mapping
├── lib/
│   ├── db.ts                    # SQLite connection + all queries
│   ├── bitbucket.ts             # Bitbucket API client
│   ├── jira.ts                  # JIRA API client
│   ├── metrics.ts               # Metric computation from DB
│   └── export.ts                # CSV/PDF generation
├── .env.example
├── .env.local                   # gitignored
└── .gitignore
```

---

### Task 1: Project Scaffolding

**Files:**
- Create: `team-metrics/` (entire project scaffold)
- Create: `.env.example`
- Create: `.gitignore`

**Interfaces:**
- Produces: Working Next.js project with shadcn/ui configured

- [ ] **Step 1: Initialize project with shadcn preset**

```bash
cd /Users/marcosriganti/Projects/team-metrics
pnpm dlx shadcn@latest init --preset b1aIcFPnM --base radix --template next
```

- [ ] **Step 2: Install additional dependencies**

```bash
pnpm add better-sqlite3 pdfmake
pnpm add -D @types/better-sqlite3 @types/pdfmake
```

- [ ] **Step 3: Create .env.example**

```env
# Bitbucket Cloud
BITBUCKET_WORKSPACE=your-workspace
BITBUCKET_REPO=your-repo
BITBUCKET_TOKEN=your-app-password-or-repository-token

# JIRA Cloud
JIRA_HOST=your-domain.atlassian.net
JIRA_PROJECT_KEY=PROJ
JIRA_EMAIL=your-email@example.com
JIRA_API_TOKEN=your-api-token
```

- [ ] **Step 4: Update .gitignore**

Add these lines to the existing .gitignore:

```
# Local database
*.db

# Environment
.env.local
```

- [ ] **Step 5: Verify project runs**

```bash
pnpm dev
```

Expected: App runs at http://localhost:3000

- [ ] **Step 6: Commit**

```bash
git init
git add .
git commit -m "chore: scaffold Next.js project with shadcn/ui preset"
```

---

### Task 2: Database Layer

**Files:**
- Create: `lib/db.ts`

**Interfaces:**
- Produces:
  - `getDb(): Database` — returns SQLite connection
  - `initDb(): void` — creates all tables if not exist
  - `getSyncLog(source: 'bitbucket' | 'jira'): { last_synced_at: string } | null`
  - `insertSyncLog(source: string, itemsFetched: number): void`
  - `upsertPullRequest(pr: PullRequestRow): void`
  - `upsertPrComment(comment: PrCommentRow): void`
  - `upsertJiraIssue(issue: JiraIssueRow): void`
  - `insertIssueTransition(transition: IssueTransitionRow): void`
  - `upsertTeamMember(member: TeamMemberRow): void`
  - `getStatusMapping(): StatusMappingRow[]`
  - `upsertStatusMapping(status: string, category: string): void`
  - `getTeamMembers(): TeamMemberRow[]`

- [ ] **Step 1: Create lib/db.ts with types and connection**

```typescript
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
```

- [ ] **Step 2: Add query functions to lib/db.ts**

Append to the file:

```typescript
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
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm tsc --noEmit
```

Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add lib/db.ts
git commit -m "feat: add SQLite database layer with all queries"
```

---

### Task 3: Bitbucket API Client

**Files:**
- Create: `lib/bitbucket.ts`

**Interfaces:**
- Consumes: Environment variables `BITBUCKET_WORKSPACE`, `BITBUCKET_REPO`, `BITBUCKET_TOKEN`
- Produces:
  - `fetchPullRequests(since?: string): AsyncGenerator<BitbucketPR>`
  - `fetchPrComments(prId: number): AsyncGenerator<BitbucketComment>`
  - `fetchWorkspaceMembers(): AsyncGenerator<BitbucketMember>`

- [ ] **Step 1: Create lib/bitbucket.ts**

```typescript
const BITBUCKET_API = "https://api.bitbucket.org/2.0";

function getConfig() {
  const workspace = process.env.BITBUCKET_WORKSPACE;
  const repo = process.env.BITBUCKET_REPO;
  const token = process.env.BITBUCKET_TOKEN;

  if (!workspace || !repo || !token) {
    throw new Error("Missing Bitbucket environment variables");
  }

  return { workspace, repo, token };
}

function getHeaders(): HeadersInit {
  const { token } = getConfig();
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
}

export interface BitbucketPR {
  id: number;
  title: string;
  state: string;
  author: {
    uuid: string;
    display_name: string;
  };
  created_on: string;
  updated_on: string;
  merge_commit?: { date: string };
  diffstat?: { lines_added: number; lines_removed: number };
}

export interface BitbucketComment {
  id: number;
  user: {
    uuid: string;
    display_name: string;
  };
  created_on: string;
  content: { raw: string };
}

export interface BitbucketMember {
  user: {
    uuid: string;
    display_name: string;
    email?: string;
  };
}

interface PaginatedResponse<T> {
  values: T[];
  next?: string;
}

async function fetchPaginated<T>(url: string): Promise<PaginatedResponse<T>> {
  const response = await fetch(url, { headers: getHeaders() });
  if (!response.ok) {
    throw new Error(`Bitbucket API error: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

export async function* fetchPullRequests(since?: string): AsyncGenerator<BitbucketPR> {
  const { workspace, repo } = getConfig();
  let url = `${BITBUCKET_API}/repositories/${workspace}/${repo}/pullrequests?state=ALL&pagelen=50&sort=-updated_on`;

  while (url) {
    const data = await fetchPaginated<BitbucketPR>(url);

    for (const pr of data.values) {
      // Stop if we've reached already-synced data
      if (since && pr.updated_on <= since) {
        return;
      }
      yield pr;
    }

    url = data.next || "";
  }
}

export async function* fetchPrComments(prId: number): AsyncGenerator<BitbucketComment> {
  const { workspace, repo } = getConfig();
  let url = `${BITBUCKET_API}/repositories/${workspace}/${repo}/pullrequests/${prId}/comments?pagelen=100`;

  while (url) {
    const data = await fetchPaginated<BitbucketComment>(url);

    for (const comment of data.values) {
      yield comment;
    }

    url = data.next || "";
  }
}

export async function* fetchWorkspaceMembers(): AsyncGenerator<BitbucketMember> {
  const { workspace } = getConfig();
  let url = `${BITBUCKET_API}/workspaces/${workspace}/members?pagelen=100`;

  while (url) {
    const data = await fetchPaginated<BitbucketMember>(url);

    for (const member of data.values) {
      yield member;
    }

    url = data.next || "";
  }
}

export async function fetchPrDiffstat(
  prId: number
): Promise<{ lines_added: number; lines_removed: number }> {
  const { workspace, repo } = getConfig();
  const url = `${BITBUCKET_API}/repositories/${workspace}/${repo}/pullrequests/${prId}/diffstat`;

  let linesAdded = 0;
  let linesRemoved = 0;
  let nextUrl: string | undefined = url;

  while (nextUrl) {
    const data = await fetchPaginated<{ lines_added: number; lines_removed: number }>(nextUrl);
    for (const file of data.values) {
      linesAdded += file.lines_added || 0;
      linesRemoved += file.lines_removed || 0;
    }
    nextUrl = data.next;
  }

  return { lines_added: linesAdded, lines_removed: linesRemoved };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm tsc --noEmit
```

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add lib/bitbucket.ts
git commit -m "feat: add Bitbucket Cloud API client"
```

---

### Task 4: JIRA API Client

**Files:**
- Create: `lib/jira.ts`

**Interfaces:**
- Consumes: Environment variables `JIRA_HOST`, `JIRA_PROJECT_KEY`, `JIRA_EMAIL`, `JIRA_API_TOKEN`
- Produces:
  - `fetchIssues(since?: string): AsyncGenerator<JiraIssue>`
  - `fetchIssueChangelog(issueKey: string): AsyncGenerator<JiraChangelogEntry>`
  - `fetchProjectStatuses(): Promise<string[]>`

- [ ] **Step 1: Create lib/jira.ts**

```typescript
function getConfig() {
  const host = process.env.JIRA_HOST;
  const projectKey = process.env.JIRA_PROJECT_KEY;
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;

  if (!host || !projectKey || !email || !token) {
    throw new Error("Missing JIRA environment variables");
  }

  return { host, projectKey, email, token };
}

function getHeaders(): HeadersInit {
  const { email, token } = getConfig();
  const auth = Buffer.from(`${email}:${token}`).toString("base64");
  return {
    Authorization: `Basic ${auth}`,
    Accept: "application/json",
  };
}

function getBaseUrl(): string {
  const { host } = getConfig();
  return `https://${host}/rest/api/3`;
}

export interface JiraIssue {
  key: string;
  fields: {
    issuetype: { name: string };
    assignee: { accountId: string; displayName: string } | null;
    summary: string;
    status: { name: string };
    customfield_10016?: number; // Story points - field ID may vary
    created: string;
    resolutiondate: string | null;
  };
}

export interface JiraChangelogEntry {
  id: string;
  author: { accountId: string } | null;
  created: string;
  items: Array<{
    field: string;
    fromString: string | null;
    toString: string | null;
  }>;
}

export async function* fetchIssues(since?: string): AsyncGenerator<JiraIssue> {
  const { projectKey } = getConfig();
  const baseUrl = getBaseUrl();

  let jql = `project = ${projectKey} ORDER BY updated DESC`;
  if (since) {
    const sinceDate = since.split("T")[0];
    jql = `project = ${projectKey} AND updated >= "${sinceDate}" ORDER BY updated DESC`;
  }

  let startAt = 0;
  const maxResults = 50;

  while (true) {
    const url = `${baseUrl}/search?jql=${encodeURIComponent(jql)}&startAt=${startAt}&maxResults=${maxResults}&fields=issuetype,assignee,summary,status,customfield_10016,created,resolutiondate`;

    const response = await fetch(url, { headers: getHeaders() });
    if (!response.ok) {
      throw new Error(`JIRA API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const issues: JiraIssue[] = data.issues;

    if (issues.length === 0) {
      break;
    }

    for (const issue of issues) {
      yield issue;
    }

    startAt += maxResults;
    if (startAt >= data.total) {
      break;
    }
  }
}

export async function* fetchIssueChangelog(
  issueKey: string
): AsyncGenerator<JiraChangelogEntry> {
  const baseUrl = getBaseUrl();
  let startAt = 0;
  const maxResults = 100;

  while (true) {
    const url = `${baseUrl}/issue/${issueKey}/changelog?startAt=${startAt}&maxResults=${maxResults}`;

    const response = await fetch(url, { headers: getHeaders() });
    if (!response.ok) {
      throw new Error(`JIRA API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const entries: JiraChangelogEntry[] = data.values;

    if (entries.length === 0) {
      break;
    }

    for (const entry of entries) {
      yield entry;
    }

    startAt += maxResults;
    if (startAt >= data.total) {
      break;
    }
  }
}

export async function fetchProjectStatuses(): Promise<string[]> {
  const { projectKey } = getConfig();
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/project/${projectKey}/statuses`;

  const response = await fetch(url, { headers: getHeaders() });
  if (!response.ok) {
    throw new Error(`JIRA API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const statuses = new Set<string>();

  for (const issueType of data) {
    for (const status of issueType.statuses) {
      statuses.add(status.name);
    }
  }

  return Array.from(statuses).sort();
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm tsc --noEmit
```

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add lib/jira.ts
git commit -m "feat: add JIRA Cloud API client"
```

---

### Task 5: Bitbucket Sync API Route

**Files:**
- Create: `app/api/sync/bitbucket/route.ts`

**Interfaces:**
- Consumes: `fetchPullRequests`, `fetchPrComments`, `fetchWorkspaceMembers`, `fetchPrDiffstat` from `lib/bitbucket.ts`; DB functions from `lib/db.ts`
- Produces: `POST /api/sync/bitbucket` — returns `{ synced: number }`

- [ ] **Step 1: Create app/api/sync/bitbucket/route.ts**

```typescript
import { NextResponse } from "next/server";
import {
  fetchPullRequests,
  fetchPrComments,
  fetchWorkspaceMembers,
  fetchPrDiffstat,
} from "@/lib/bitbucket";
import {
  getSyncLog,
  insertSyncLog,
  upsertPullRequest,
  upsertPrComment,
  upsertTeamMember,
} from "@/lib/db";

export async function POST() {
  try {
    const syncLog = getSyncLog("bitbucket");
    const since = syncLog?.last_synced_at;

    let prCount = 0;
    let commentCount = 0;

    // Sync workspace members first
    for await (const member of fetchWorkspaceMembers()) {
      upsertTeamMember({
        source: "bitbucket",
        external_id: member.user.uuid,
        display_name: member.user.display_name,
        email: member.user.email || null,
      });
    }

    // Sync pull requests
    for await (const pr of fetchPullRequests(since)) {
      // Fetch diffstat for line counts
      const diffstat = await fetchPrDiffstat(pr.id);

      upsertPullRequest({
        bb_id: pr.id,
        repo_slug: process.env.BITBUCKET_REPO!,
        author_uuid: pr.author.uuid,
        author_name: pr.author.display_name,
        title: pr.title,
        state: pr.state,
        lines_added: diffstat.lines_added,
        lines_removed: diffstat.lines_removed,
        created_at: pr.created_on,
        updated_at: pr.updated_on,
        merged_at: pr.merge_commit?.date || null,
      });

      prCount++;

      // Fetch comments for this PR
      for await (const comment of fetchPrComments(pr.id)) {
        const content = comment.content.raw.toLowerCase();
        upsertPrComment({
          bb_id: comment.id,
          pr_bb_id: pr.id,
          author_uuid: comment.user.uuid,
          author_name: comment.user.display_name,
          created_at: comment.created_on,
          is_approval: content.includes("lgtm") || content.includes("approved"),
          is_request_changes: content.includes("request changes"),
        });
        commentCount++;
      }
    }

    insertSyncLog("bitbucket", prCount);

    return NextResponse.json({
      synced: prCount,
      comments: commentCount,
      message: `Synced ${prCount} PRs and ${commentCount} comments`,
    });
  } catch (error) {
    console.error("Bitbucket sync error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sync failed" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm tsc --noEmit
```

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add app/api/sync/bitbucket/route.ts
git commit -m "feat: add Bitbucket sync API route"
```

---

### Task 6: JIRA Sync API Route

**Files:**
- Create: `app/api/sync/jira/route.ts`

**Interfaces:**
- Consumes: `fetchIssues`, `fetchIssueChangelog` from `lib/jira.ts`; DB functions from `lib/db.ts`
- Produces: `POST /api/sync/jira` — returns `{ synced: number }`

- [ ] **Step 1: Create app/api/sync/jira/route.ts**

```typescript
import { NextResponse } from "next/server";
import { fetchIssues, fetchIssueChangelog } from "@/lib/jira";
import {
  getSyncLog,
  insertSyncLog,
  upsertJiraIssue,
  insertIssueTransition,
  clearIssueTransitions,
  upsertTeamMember,
} from "@/lib/db";

export async function POST() {
  try {
    const syncLog = getSyncLog("jira");
    const since = syncLog?.last_synced_at;

    let issueCount = 0;
    const seenAssignees = new Set<string>();

    for await (const issue of fetchIssues(since)) {
      // Store issue
      upsertJiraIssue({
        issue_key: issue.key,
        issue_type: issue.fields.issuetype.name,
        assignee_id: issue.fields.assignee?.accountId || null,
        assignee_name: issue.fields.assignee?.displayName || null,
        summary: issue.fields.summary,
        status: issue.fields.status.name,
        story_points: issue.fields.customfield_10016 || null,
        created_at: issue.fields.created,
        resolved_at: issue.fields.resolutiondate,
      });

      // Track unique assignees as team members
      if (issue.fields.assignee && !seenAssignees.has(issue.fields.assignee.accountId)) {
        seenAssignees.add(issue.fields.assignee.accountId);
        upsertTeamMember({
          source: "jira",
          external_id: issue.fields.assignee.accountId,
          display_name: issue.fields.assignee.displayName,
          email: null,
        });
      }

      // Clear and re-fetch transitions for accurate time tracking
      clearIssueTransitions(issue.key);

      for await (const entry of fetchIssueChangelog(issue.key)) {
        for (const item of entry.items) {
          if (item.field === "status") {
            insertIssueTransition({
              issue_key: issue.key,
              from_status: item.fromString,
              to_status: item.toString || "",
              author_id: entry.author?.accountId || null,
              transitioned_at: entry.created,
            });
          }
        }
      }

      issueCount++;
    }

    insertSyncLog("jira", issueCount);

    return NextResponse.json({
      synced: issueCount,
      message: `Synced ${issueCount} issues`,
    });
  } catch (error) {
    console.error("JIRA sync error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sync failed" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm tsc --noEmit
```

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add app/api/sync/jira/route.ts
git commit -m "feat: add JIRA sync API route"
```

---

### Task 7: Metrics Computation Library

**Files:**
- Create: `lib/metrics.ts`

**Interfaces:**
- Consumes: `getDb` from `lib/db.ts`
- Produces:
  - `getBitbucketMetrics(userId: string | null, startDate: string, endDate: string): BitbucketMetrics`
  - `getJiraMetrics(userId: string | null, startDate: string, endDate: string): JiraMetrics`
  - `getTeamMetrics(startDate: string, endDate: string): TeamMemberMetrics[]`

- [ ] **Step 1: Create lib/metrics.ts**

```typescript
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
    prsReviewed.count > 0 ? commentsMade.count / prsReviewed.count : 0;

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

export function getTeamMetrics(
  startDate: string,
  endDate: string
): TeamMemberMetrics[] {
  const db = getDb();

  const members = db
    .prepare("SELECT DISTINCT external_id, display_name, source FROM team_members WHERE is_active = 1")
    .all() as { external_id: string; display_name: string; source: "bitbucket" | "jira" }[];

  return members.map((member) => ({
    userId: member.external_id,
    displayName: member.display_name,
    source: member.source,
    bitbucket: getBitbucketMetrics(member.external_id, startDate, endDate),
    jira: getJiraMetrics(member.external_id, startDate, endDate),
  }));
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm tsc --noEmit
```

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add lib/metrics.ts
git commit -m "feat: add metrics computation library"
```

---

### Task 8: API Routes (Metrics, Users, Settings)

**Files:**
- Create: `app/api/metrics/route.ts`
- Create: `app/api/users/route.ts`
- Create: `app/api/settings/route.ts`

**Interfaces:**
- Produces:
  - `GET /api/metrics?startDate=&endDate=&userId=` — returns metrics
  - `GET /api/users` — returns team members
  - `GET /api/settings` — returns status mappings and available statuses
  - `POST /api/settings` — saves status mappings

- [ ] **Step 1: Create app/api/metrics/route.ts**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getBitbucketMetrics, getJiraMetrics, getTeamMetrics } from "@/lib/metrics";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  const userId = searchParams.get("userId");

  if (!startDate || !endDate) {
    return NextResponse.json(
      { error: "startDate and endDate are required" },
      { status: 400 }
    );
  }

  try {
    if (userId) {
      // Individual user metrics
      const bitbucket = getBitbucketMetrics(userId, startDate, endDate);
      const jira = getJiraMetrics(userId, startDate, endDate);
      return NextResponse.json({ bitbucket, jira });
    } else {
      // Team metrics
      const bitbucket = getBitbucketMetrics(null, startDate, endDate);
      const jira = getJiraMetrics(null, startDate, endDate);
      const team = getTeamMetrics(startDate, endDate);
      return NextResponse.json({ bitbucket, jira, team });
    }
  } catch (error) {
    console.error("Metrics error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to compute metrics" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Create app/api/users/route.ts**

```typescript
import { NextResponse } from "next/server";
import { getTeamMembers } from "@/lib/db";

export async function GET() {
  try {
    const members = getTeamMembers();
    return NextResponse.json({ users: members });
  } catch (error) {
    console.error("Users error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch users" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 3: Create app/api/settings/route.ts**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getStatusMapping, upsertStatusMapping, getDistinctJiraStatuses } from "@/lib/db";
import { fetchProjectStatuses } from "@/lib/jira";

export async function GET() {
  try {
    const mapping = getStatusMapping();
    const localStatuses = getDistinctJiraStatuses();

    // Try to fetch from JIRA API, fall back to local statuses
    let availableStatuses: string[];
    try {
      availableStatuses = await fetchProjectStatuses();
    } catch {
      availableStatuses = localStatuses;
    }

    // Merge: include all statuses from both sources
    const allStatuses = Array.from(new Set([...availableStatuses, ...localStatuses])).sort();

    return NextResponse.json({
      mapping,
      availableStatuses: allStatuses,
    });
  } catch (error) {
    console.error("Settings error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch settings" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { mappings } = body as {
      mappings: Array<{ status: string; category: string }>;
    };

    for (const { status, category } of mappings) {
      upsertStatusMapping(status, category as "progress" | "review" | "blocked" | "done" | "other");
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Settings save error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save settings" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
pnpm tsc --noEmit
```

Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add app/api/metrics/route.ts app/api/users/route.ts app/api/settings/route.ts
git commit -m "feat: add metrics, users, and settings API routes"
```

---

### Task 9: Export API Route

**Files:**
- Create: `lib/export.ts`
- Create: `app/api/export/route.ts`

**Interfaces:**
- Consumes: `getBitbucketMetrics`, `getJiraMetrics`, `getTeamMetrics` from `lib/metrics.ts`
- Produces: `GET /api/export?format={csv|pdf}&startDate=&endDate=&userId=`

- [ ] **Step 1: Create lib/export.ts**

```typescript
import pdfMake from "pdfmake/build/pdfmake";
import pdfFonts from "pdfmake/build/vfs_fonts";
import type { TDocumentDefinitions } from "pdfmake/interfaces";
import { BitbucketMetrics, JiraMetrics, TeamMemberMetrics } from "./metrics";

pdfMake.vfs = pdfFonts.vfs;

interface ExportData {
  startDate: string;
  endDate: string;
  userName?: string;
  bitbucket: BitbucketMetrics;
  jira: JiraMetrics;
  team?: TeamMemberMetrics[];
}

export function generateCsv(data: ExportData): string {
  const lines: string[] = [];

  lines.push("Team Metrics Report");
  lines.push(`Date Range,${data.startDate},${data.endDate}`);
  if (data.userName) {
    lines.push(`User,${data.userName}`);
  }
  lines.push("");

  // Bitbucket metrics
  lines.push("Bitbucket Metrics");
  lines.push("Metric,Value");
  lines.push(`PRs Authored,${data.bitbucket.prsAuthored}`);
  lines.push(`PRs Merged,${data.bitbucket.prsMerged}`);
  lines.push(`PRs Reviewed,${data.bitbucket.prsReviewed}`);
  lines.push(`Comments Made,${data.bitbucket.commentsMade}`);
  lines.push(`Avg Comments per PR,${data.bitbucket.avgCommentsPerPr}`);
  lines.push(`Avg PR Size (lines),${data.bitbucket.avgPrSize}`);
  lines.push(`Avg Time to Merge (days),${data.bitbucket.avgTimeToMergeDays}`);
  lines.push("");

  // JIRA metrics
  lines.push("JIRA Metrics");
  lines.push("Metric,Value");
  lines.push(`Tickets Worked,${data.jira.ticketsWorked}`);
  lines.push(`Tickets Completed,${data.jira.ticketsCompleted}`);
  lines.push(`Story Points Delivered,${data.jira.storyPointsDelivered}`);
  lines.push(`Avg Time in Progress (days),${data.jira.avgTimeInProgressDays}`);
  lines.push(`Avg Time in Review (days),${data.jira.avgTimeInReviewDays}`);
  lines.push(`Avg Cycle Time (days),${data.jira.avgCycleTimeDays}`);

  // Team comparison if available
  if (data.team && data.team.length > 0) {
    lines.push("");
    lines.push("Team Comparison");
    lines.push("Name,PRs Authored,PRs Merged,Tickets Completed,Story Points,Cycle Time (days)");
    for (const member of data.team) {
      lines.push(
        `${member.displayName},${member.bitbucket.prsAuthored},${member.bitbucket.prsMerged},${member.jira.ticketsCompleted},${member.jira.storyPointsDelivered},${member.jira.avgCycleTimeDays}`
      );
    }
  }

  return lines.join("\n");
}

export async function generatePdf(data: ExportData): Promise<Buffer> {
  const docDefinition: TDocumentDefinitions = {
    content: [
      { text: "Team Metrics Report", style: "header" },
      { text: `${data.startDate} to ${data.endDate}`, style: "subheader" },
      data.userName ? { text: `User: ${data.userName}`, style: "subheader" } : {},
      { text: "", margin: [0, 10, 0, 0] },

      { text: "Bitbucket Metrics", style: "sectionHeader" },
      {
        table: {
          widths: ["*", "auto"],
          body: [
            ["Metric", "Value"],
            ["PRs Authored", data.bitbucket.prsAuthored.toString()],
            ["PRs Merged", data.bitbucket.prsMerged.toString()],
            ["PRs Reviewed", data.bitbucket.prsReviewed.toString()],
            ["Comments Made", data.bitbucket.commentsMade.toString()],
            ["Avg Comments per PR", data.bitbucket.avgCommentsPerPr.toString()],
            ["Avg PR Size (lines)", data.bitbucket.avgPrSize.toString()],
            ["Avg Time to Merge (days)", data.bitbucket.avgTimeToMergeDays.toString()],
          ],
        },
      },
      { text: "", margin: [0, 10, 0, 0] },

      { text: "JIRA Metrics", style: "sectionHeader" },
      {
        table: {
          widths: ["*", "auto"],
          body: [
            ["Metric", "Value"],
            ["Tickets Worked", data.jira.ticketsWorked.toString()],
            ["Tickets Completed", data.jira.ticketsCompleted.toString()],
            ["Story Points Delivered", data.jira.storyPointsDelivered.toString()],
            ["Avg Time in Progress (days)", data.jira.avgTimeInProgressDays.toString()],
            ["Avg Time in Review (days)", data.jira.avgTimeInReviewDays.toString()],
            ["Avg Cycle Time (days)", data.jira.avgCycleTimeDays.toString()],
          ],
        },
      },

      ...(data.team && data.team.length > 0
        ? [
            { text: "", margin: [0, 10, 0, 0] as [number, number, number, number] },
            { text: "Team Comparison", style: "sectionHeader" },
            {
              table: {
                widths: ["*", "auto", "auto", "auto", "auto", "auto"],
                body: [
                  ["Name", "PRs", "Merged", "Tickets", "Points", "Cycle"],
                  ...data.team.map((m) => [
                    m.displayName,
                    m.bitbucket.prsAuthored.toString(),
                    m.bitbucket.prsMerged.toString(),
                    m.jira.ticketsCompleted.toString(),
                    m.jira.storyPointsDelivered.toString(),
                    m.jira.avgCycleTimeDays.toString(),
                  ]),
                ],
              },
            },
          ]
        : []),
    ],
    styles: {
      header: { fontSize: 18, bold: true, margin: [0, 0, 0, 10] },
      subheader: { fontSize: 12, color: "gray", margin: [0, 0, 0, 5] },
      sectionHeader: { fontSize: 14, bold: true, margin: [0, 10, 0, 5] },
    },
  };

  return new Promise((resolve, reject) => {
    const pdfDoc = pdfMake.createPdf(docDefinition);
    pdfDoc.getBuffer((buffer: Buffer) => {
      resolve(buffer);
    });
  });
}
```

- [ ] **Step 2: Create app/api/export/route.ts**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getBitbucketMetrics, getJiraMetrics, getTeamMetrics } from "@/lib/metrics";
import { generateCsv, generatePdf } from "@/lib/export";
import { getTeamMembers } from "@/lib/db";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const format = searchParams.get("format") || "csv";
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  const userId = searchParams.get("userId");

  if (!startDate || !endDate) {
    return NextResponse.json(
      { error: "startDate and endDate are required" },
      { status: 400 }
    );
  }

  try {
    const bitbucket = getBitbucketMetrics(userId, startDate, endDate);
    const jira = getJiraMetrics(userId, startDate, endDate);
    const team = userId ? undefined : getTeamMetrics(startDate, endDate);

    let userName: string | undefined;
    if (userId) {
      const members = getTeamMembers();
      const member = members.find((m) => m.external_id === userId);
      userName = member?.display_name;
    }

    const exportData = {
      startDate,
      endDate,
      userName,
      bitbucket,
      jira,
      team,
    };

    if (format === "pdf") {
      const pdfBuffer = await generatePdf(exportData);
      return new NextResponse(pdfBuffer, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="metrics-${startDate}-${endDate}.pdf"`,
        },
      });
    } else {
      const csv = generateCsv(exportData);
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="metrics-${startDate}-${endDate}.csv"`,
        },
      });
    }
  } catch (error) {
    console.error("Export error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Export failed" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm tsc --noEmit
```

Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add lib/export.ts app/api/export/route.ts
git commit -m "feat: add CSV/PDF export functionality"
```

---

### Task 10: Dashboard UI Components

**Files:**
- Create: `components/header.tsx`
- Create: `components/metrics-card.tsx`
- Create: `components/date-range-picker.tsx`
- Create: `components/user-selector.tsx`
- Create: `components/team-table.tsx`

**Interfaces:**
- Produces: Reusable UI components for dashboard

- [ ] **Step 1: Install required shadcn components**

```bash
pnpm dlx shadcn@latest add button card select popover calendar table
```

- [ ] **Step 2: Create components/header.tsx**

```typescript
"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useState } from "react";

interface HeaderProps {
  onSync: () => Promise<void>;
  onExport: (format: "csv" | "pdf") => void;
}

export function Header({ onSync, onExport }: HeaderProps) {
  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await onSync();
    } finally {
      setSyncing(false);
    }
  };

  return (
    <header className="border-b">
      <div className="container mx-auto px-4 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">Team Metrics</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => onExport("csv")}>
            Export CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => onExport("pdf")}>
            Export PDF
          </Button>
          <Button onClick={handleSync} disabled={syncing}>
            {syncing ? "Syncing..." : "Sync Now"}
          </Button>
          <Link href="/settings">
            <Button variant="ghost">Settings</Button>
          </Link>
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 3: Create components/metrics-card.tsx**

```typescript
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface MetricItem {
  label: string;
  value: string | number;
  unit?: string;
}

interface MetricsCardProps {
  title: string;
  metrics: MetricItem[];
}

export function MetricsCard({ title, metrics }: MetricsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {metrics.map((metric) => (
            <div key={metric.label} className="space-y-1">
              <p className="text-sm text-muted-foreground">{metric.label}</p>
              <p className="text-2xl font-bold">
                {metric.value}
                {metric.unit && (
                  <span className="text-sm font-normal text-muted-foreground ml-1">
                    {metric.unit}
                  </span>
                )}
              </p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Create components/date-range-picker.tsx**

```typescript
"use client";

import { useState } from "react";
import { format, subDays } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface DateRangePickerProps {
  startDate: Date;
  endDate: Date;
  onRangeChange: (start: Date, end: Date) => void;
}

export function DateRangePicker({ startDate, endDate, onRangeChange }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);

  const presets = [
    { label: "Last 7 days", days: 7 },
    { label: "Last 30 days", days: 30 },
    { label: "Last 90 days", days: 90 },
  ];

  return (
    <div className="flex items-center gap-2">
      {presets.map((preset) => (
        <Button
          key={preset.days}
          variant="outline"
          size="sm"
          onClick={() => onRangeChange(subDays(new Date(), preset.days), new Date())}
        >
          {preset.label}
        </Button>
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            {format(startDate, "MMM d")} - {format(endDate, "MMM d, yyyy")}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="range"
            selected={{ from: startDate, to: endDate }}
            onSelect={(range) => {
              if (range?.from && range?.to) {
                onRangeChange(range.from, range.to);
                setOpen(false);
              }
            }}
            numberOfMonths={2}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
```

- [ ] **Step 5: Create components/user-selector.tsx**

```typescript
"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface User {
  id: number;
  external_id: string;
  display_name: string;
}

interface UserSelectorProps {
  users: User[];
  selectedUserId: string | null;
  onUserChange: (userId: string | null) => void;
}

export function UserSelector({ users, selectedUserId, onUserChange }: UserSelectorProps) {
  return (
    <Select
      value={selectedUserId || "all"}
      onValueChange={(value) => onUserChange(value === "all" ? null : value)}
    >
      <SelectTrigger className="w-[200px]">
        <SelectValue placeholder="Select user" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All Team Members</SelectItem>
        {users.map((user) => (
          <SelectItem key={user.external_id} value={user.external_id}>
            {user.display_name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

- [ ] **Step 6: Create components/team-table.tsx**

```typescript
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TeamMemberMetrics } from "@/lib/metrics";

interface TeamTableProps {
  members: TeamMemberMetrics[];
}

export function TeamTable({ members }: TeamTableProps) {
  if (members.length === 0) {
    return <p className="text-muted-foreground">No team data available. Run a sync first.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead className="text-right">PRs</TableHead>
          <TableHead className="text-right">Merged</TableHead>
          <TableHead className="text-right">Reviewed</TableHead>
          <TableHead className="text-right">Tickets</TableHead>
          <TableHead className="text-right">Points</TableHead>
          <TableHead className="text-right">Cycle Time</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((member) => (
          <TableRow key={member.userId}>
            <TableCell className="font-medium">{member.displayName}</TableCell>
            <TableCell className="text-right">{member.bitbucket.prsAuthored}</TableCell>
            <TableCell className="text-right">{member.bitbucket.prsMerged}</TableCell>
            <TableCell className="text-right">{member.bitbucket.prsReviewed}</TableCell>
            <TableCell className="text-right">{member.jira.ticketsCompleted}</TableCell>
            <TableCell className="text-right">{member.jira.storyPointsDelivered}</TableCell>
            <TableCell className="text-right">{member.jira.avgCycleTimeDays}d</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

- [ ] **Step 7: Install date-fns**

```bash
pnpm add date-fns
```

- [ ] **Step 8: Verify TypeScript compiles**

```bash
pnpm tsc --noEmit
```

Expected: No errors

- [ ] **Step 9: Commit**

```bash
git add components/
git commit -m "feat: add dashboard UI components"
```

---

### Task 11: Dashboard Page

**Files:**
- Modify: `app/page.tsx`
- Modify: `app/layout.tsx`

**Interfaces:**
- Consumes: All dashboard components, API routes
- Produces: Working dashboard at `/`

- [ ] **Step 1: Update app/layout.tsx**

```typescript
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Team Metrics",
  description: "Track team performance metrics from Bitbucket and JIRA",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  );
}
```

- [ ] **Step 2: Update app/page.tsx**

```typescript
"use client";

import { useEffect, useState, useCallback } from "react";
import { format, subDays } from "date-fns";
import { Header } from "@/components/header";
import { MetricsCard } from "@/components/metrics-card";
import { DateRangePicker } from "@/components/date-range-picker";
import { UserSelector } from "@/components/user-selector";
import { TeamTable } from "@/components/team-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { BitbucketMetrics, JiraMetrics, TeamMemberMetrics } from "@/lib/metrics";

interface User {
  id: number;
  external_id: string;
  display_name: string;
}

export default function Dashboard() {
  const [startDate, setStartDate] = useState(() => subDays(new Date(), 30));
  const [endDate, setEndDate] = useState(() => new Date());
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [bitbucketMetrics, setBitbucketMetrics] = useState<BitbucketMetrics | null>(null);
  const [jiraMetrics, setJiraMetrics] = useState<JiraMetrics | null>(null);
  const [teamMetrics, setTeamMetrics] = useState<TeamMemberMetrics[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        startDate: format(startDate, "yyyy-MM-dd"),
        endDate: format(endDate, "yyyy-MM-dd"),
      });
      if (selectedUserId) {
        params.set("userId", selectedUserId);
      }

      const response = await fetch(`/api/metrics?${params}`);
      const data = await response.json();

      setBitbucketMetrics(data.bitbucket);
      setJiraMetrics(data.jira);
      setTeamMetrics(data.team || []);
    } catch (error) {
      console.error("Failed to fetch metrics:", error);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, selectedUserId]);

  const fetchUsers = async () => {
    try {
      const response = await fetch("/api/users");
      const data = await response.json();
      setUsers(data.users || []);
    } catch (error) {
      console.error("Failed to fetch users:", error);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  const handleSync = async () => {
    await Promise.all([
      fetch("/api/sync/bitbucket", { method: "POST" }),
      fetch("/api/sync/jira", { method: "POST" }),
    ]);
    await fetchUsers();
    await fetchMetrics();
  };

  const handleExport = (exportFormat: "csv" | "pdf") => {
    const params = new URLSearchParams({
      format: exportFormat,
      startDate: format(startDate, "yyyy-MM-dd"),
      endDate: format(endDate, "yyyy-MM-dd"),
    });
    if (selectedUserId) {
      params.set("userId", selectedUserId);
    }
    window.open(`/api/export?${params}`, "_blank");
  };

  const handleRangeChange = (start: Date, end: Date) => {
    setStartDate(start);
    setEndDate(end);
  };

  return (
    <div className="min-h-screen bg-background">
      <Header onSync={handleSync} onExport={handleExport} />

      <main className="container mx-auto px-4 py-6 space-y-6">
        <div className="flex flex-wrap items-center gap-4">
          <DateRangePicker
            startDate={startDate}
            endDate={endDate}
            onRangeChange={handleRangeChange}
          />
          <UserSelector
            users={users}
            selectedUserId={selectedUserId}
            onUserChange={setSelectedUserId}
          />
        </div>

        {loading ? (
          <p className="text-muted-foreground">Loading metrics...</p>
        ) : (
          <>
            {bitbucketMetrics && (
              <MetricsCard
                title="Bitbucket"
                metrics={[
                  { label: "PRs Authored", value: bitbucketMetrics.prsAuthored },
                  { label: "PRs Merged", value: bitbucketMetrics.prsMerged },
                  { label: "PRs Reviewed", value: bitbucketMetrics.prsReviewed },
                  { label: "Comments Made", value: bitbucketMetrics.commentsMade },
                  { label: "Avg Comments/PR", value: bitbucketMetrics.avgCommentsPerPr },
                  { label: "Avg PR Size", value: bitbucketMetrics.avgPrSize, unit: "lines" },
                  { label: "Avg Time to Merge", value: bitbucketMetrics.avgTimeToMergeDays, unit: "days" },
                ]}
              />
            )}

            {jiraMetrics && (
              <MetricsCard
                title="JIRA"
                metrics={[
                  { label: "Tickets Worked", value: jiraMetrics.ticketsWorked },
                  { label: "Tickets Completed", value: jiraMetrics.ticketsCompleted },
                  { label: "Story Points", value: jiraMetrics.storyPointsDelivered },
                  { label: "Avg In Progress", value: jiraMetrics.avgTimeInProgressDays, unit: "days" },
                  { label: "Avg In Review", value: jiraMetrics.avgTimeInReviewDays, unit: "days" },
                  { label: "Avg Cycle Time", value: jiraMetrics.avgCycleTimeDays, unit: "days" },
                ]}
              />
            )}

            {!selectedUserId && teamMetrics.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Team Comparison</CardTitle>
                </CardHeader>
                <CardContent>
                  <TeamTable members={teamMetrics} />
                </CardContent>
              </Card>
            )}
          </>
        )}
      </main>
    </div>
  );
}
```

- [ ] **Step 3: Verify app runs**

```bash
pnpm dev
```

Expected: Dashboard loads at http://localhost:3000

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx app/layout.tsx
git commit -m "feat: implement dashboard page with metrics display"
```

---

### Task 12: Settings Page

**Files:**
- Create: `app/settings/page.tsx`
- Create: `components/status-mapper.tsx`

**Interfaces:**
- Consumes: `/api/settings` GET/POST
- Produces: Working settings page at `/settings`

- [ ] **Step 1: Create components/status-mapper.tsx**

```typescript
"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface StatusMapping {
  jira_status_name: string;
  category: string;
}

interface StatusMapperProps {
  statuses: string[];
  mappings: StatusMapping[];
  onMappingChange: (status: string, category: string) => void;
}

const CATEGORIES = [
  { value: "progress", label: "In Progress" },
  { value: "review", label: "In Review" },
  { value: "blocked", label: "Blocked" },
  { value: "done", label: "Done" },
  { value: "other", label: "Other" },
];

export function StatusMapper({ statuses, mappings, onMappingChange }: StatusMapperProps) {
  const getCategory = (status: string): string => {
    const mapping = mappings.find((m) => m.jira_status_name === status);
    return mapping?.category || "other";
  };

  if (statuses.length === 0) {
    return (
      <p className="text-muted-foreground">
        No JIRA statuses found. Run a sync first to discover workflow statuses.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {statuses.map((status) => (
        <div key={status} className="flex items-center gap-4">
          <span className="w-48 font-medium">{status}</span>
          <Select
            value={getCategory(status)}
            onValueChange={(value) => onMappingChange(status, value)}
          >
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((cat) => (
                <SelectItem key={cat.value} value={cat.value}>
                  {cat.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create app/settings/page.tsx**

```typescript
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusMapper } from "@/components/status-mapper";

interface StatusMapping {
  jira_status_name: string;
  category: string;
}

export default function SettingsPage() {
  const [statuses, setStatuses] = useState<string[]>([]);
  const [mappings, setMappings] = useState<StatusMapping[]>([]);
  const [pendingChanges, setPendingChanges] = useState<Map<string, string>>(new Map());
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const response = await fetch("/api/settings");
        const data = await response.json();
        setStatuses(data.availableStatuses || []);
        setMappings(data.mapping || []);
      } catch (error) {
        console.error("Failed to fetch settings:", error);
      }
    };
    fetchSettings();
  }, []);

  const handleMappingChange = (status: string, category: string) => {
    setPendingChanges((prev) => {
      const next = new Map(prev);
      next.set(status, category);
      return next;
    });
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const mappingsToSave = Array.from(pendingChanges.entries()).map(([status, category]) => ({
        status,
        category,
      }));

      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mappings: mappingsToSave }),
      });

      // Update local state
      setMappings((prev) => {
        const updated = [...prev];
        for (const [status, category] of pendingChanges) {
          const existing = updated.find((m) => m.jira_status_name === status);
          if (existing) {
            existing.category = category;
          } else {
            updated.push({ jira_status_name: status, category });
          }
        }
        return updated;
      });

      setPendingChanges(new Map());
      setSaved(true);
    } catch (error) {
      console.error("Failed to save settings:", error);
    } finally {
      setSaving(false);
    }
  };

  const hasChanges = pendingChanges.size > 0;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-xl font-bold">Settings</h1>
          <Link href="/">
            <Button variant="ghost">Back to Dashboard</Button>
          </Link>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        <Card>
          <CardHeader>
            <CardTitle>JIRA Status Mapping</CardTitle>
            <CardDescription>
              Map your JIRA workflow statuses to categories for accurate time tracking metrics.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <StatusMapper
              statuses={statuses}
              mappings={mappings}
              onMappingChange={handleMappingChange}
            />

            <div className="flex items-center gap-4">
              <Button onClick={handleSave} disabled={!hasChanges || saving}>
                {saving ? "Saving..." : "Save Mapping"}
              </Button>
              {saved && <span className="text-sm text-green-600">Saved successfully!</span>}
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
```

- [ ] **Step 3: Verify settings page works**

```bash
pnpm dev
```

Navigate to http://localhost:3000/settings

- [ ] **Step 4: Commit**

```bash
git add app/settings/page.tsx components/status-mapper.tsx
git commit -m "feat: implement settings page with JIRA status mapping"
```

---

### Task 13: GitHub Repository Setup

**Files:**
- None (git operations only)

**Interfaces:**
- Produces: Public GitHub repository at `marcos.riganti/team-metrics`

- [ ] **Step 1: Create GitHub repository**

```bash
gh repo create marcos.riganti/team-metrics --public --source=. --remote=origin --description="Team performance metrics from Bitbucket and JIRA"
```

- [ ] **Step 2: Push to GitHub**

```bash
git push -u origin main
```

- [ ] **Step 3: Verify repository**

Visit https://github.com/marcos.riganti/team-metrics

Expected: Repository exists with all code

---

### Task 14: Final Verification

**Files:**
- None

**Interfaces:**
- Produces: Fully working application

- [ ] **Step 1: Create .env.local with test values**

Create `.env.local` file (will not be committed):

```env
BITBUCKET_WORKSPACE=your-workspace
BITBUCKET_REPO=your-repo
BITBUCKET_TOKEN=your-token

JIRA_HOST=your-domain.atlassian.net
JIRA_PROJECT_KEY=PROJ
JIRA_EMAIL=your-email@example.com
JIRA_API_TOKEN=your-token
```

- [ ] **Step 2: Run the application**

```bash
pnpm dev
```

- [ ] **Step 3: Verify all features**

1. Dashboard loads at http://localhost:3000
2. Date range picker works
3. User selector works
4. Sync button triggers API calls
5. Export CSV/PDF downloads files
6. Settings page at /settings allows status mapping

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: final cleanup and verification"
git push
```
