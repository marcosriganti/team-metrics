# Team Metrics - Design Specification

## Overview

A Next.js application that fetches and displays team performance metrics from Bitbucket Cloud and JIRA Cloud. Data is stored locally in SQLite to avoid duplicate API calls.

**Repository:** `github.com/marcos.riganti/team-metrics` (public)

## Requirements

### Constraints
- Single Bitbucket repository + single JIRA project (configured via env vars)
- Small team (2-10 people)
- Manual sync only (user clicks button)
- Never re-fetch data already stored

### Bitbucket Metrics (per user, per date range)
- PRs Authored
- PRs Merged
- PRs Reviewed (commented on others' PRs)
- Comments Made
- Avg Comments per PR
- Avg PR Size (lines changed)
- Avg Time to Merge

### JIRA Metrics (per user, per date range)
- Tickets Worked
- Tickets Completed
- Story Points Delivered
- Avg Time in Progress (mapped statuses)
- Avg Time in Review (mapped statuses)
- Avg Cycle Time (first In Progress → Done)

### Team Metrics (aggregate)
- Comparison table when "All users" selected

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Next.js App                          │
├─────────────────────────────────────────────────────────┤
│  Pages/UI                                               │
│  ├── / (Dashboard)                                      │
│  └── /settings (JIRA status mapping)                    │
├─────────────────────────────────────────────────────────┤
│  API Routes (/app/api)                                  │
│  ├── /api/sync/bitbucket                                │
│  ├── /api/sync/jira                                     │
│  ├── /api/metrics                                       │
│  ├── /api/settings                                      │
│  ├── /api/users                                         │
│  └── /api/export                                        │
├─────────────────────────────────────────────────────────┤
│  Data Layer                                             │
│  ├── /lib/db.ts (SQLite connection)                     │
│  ├── /lib/bitbucket.ts (API client)                     │
│  └── /lib/jira.ts (API client)                          │
├─────────────────────────────────────────────────────────┤
│  SQLite Database (local file)                           │
└─────────────────────────────────────────────────────────┘
```

## Tech Stack

- **Next.js 14** with App Router
- **shadcn/ui** with custom preset: `pnpm dlx shadcn@latest init --preset b1aIcFPnM --base radix --template next`
- **better-sqlite3** for SQLite
- **TypeScript**

## Database Schema

```sql
-- Sync tracking (prevents duplicate fetches)
CREATE TABLE sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL CHECK(source IN ('bitbucket', 'jira')),
  last_synced_at TEXT NOT NULL,
  last_cursor TEXT,
  items_fetched INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Bitbucket: Pull Requests
CREATE TABLE pull_requests (
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

-- Bitbucket: PR Comments
CREATE TABLE pr_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bb_id INTEGER UNIQUE NOT NULL,
  pr_id INTEGER NOT NULL REFERENCES pull_requests(id),
  author_uuid TEXT NOT NULL,
  author_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  is_approval INTEGER DEFAULT 0,
  is_request_changes INTEGER DEFAULT 0
);

-- JIRA: Issues
CREATE TABLE jira_issues (
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

-- JIRA: Status Transitions (for time-in-status calculations)
CREATE TABLE issue_transitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_key TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  author_id TEXT,
  transitioned_at TEXT NOT NULL
);

-- Configuration: JIRA status mapping
CREATE TABLE status_mapping (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jira_status_name TEXT UNIQUE NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('progress', 'review', 'blocked', 'done', 'other'))
);

-- Cached team members
CREATE TABLE team_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL CHECK(source IN ('bitbucket', 'jira')),
  external_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  email TEXT,
  is_active INTEGER DEFAULT 1,
  UNIQUE(source, external_id)
);
```

## API Integration

### Bitbucket Cloud API

**Base URL:** `https://api.bitbucket.org/2.0`

**Authentication:** Bearer token with App Password or Repository Access Token

To create credentials:
1. Go to Bitbucket Settings → Personal settings → App passwords
2. Create an App Password with `repository:read` and `pullrequest:read` scopes
3. Or use a Repository Access Token for more limited scope

```
Authorization: Bearer {app_password_or_token}
```

**Endpoints:**
| Purpose | Endpoint |
|---------|----------|
| List PRs | `GET /repositories/{workspace}/{repo}/pullrequests?state=ALL&pagelen=50` |
| PR Comments | `GET /repositories/{workspace}/{repo}/pullrequests/{id}/comments` |
| Workspace Members | `GET /workspaces/{workspace}/members` |

**Incremental Sync:** Filter by `updated_on` query param or sort by `updated_on` descending and stop when reaching already-synced items.

### JIRA Cloud API

**Base URL:** `https://{host}/rest/api/3`

**Authentication:** Basic Auth with API Token
```
Authorization: Basic base64(email:api_token)
```

**Endpoints:**
| Purpose | Endpoint |
|---------|----------|
| Search Issues | `GET /search?jql=project={key} ORDER BY updated DESC&maxResults=50` |
| Issue Changelog | `GET /issue/{key}/changelog` |
| Project Statuses | `GET /project/{key}/statuses` |

**Incremental Sync:** JQL filter `updated >= "{last_sync_date}"` to fetch only recent changes.

## Environment Variables

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

## UI Pages

### Dashboard (`/`)

- Date range picker (default: last 30 days)
- User dropdown (All / individual team members)
- Bitbucket metrics card
- JIRA metrics card
- Team comparison table (when "All" selected)
- Sync button in header
- Export button (CSV/PDF) for current view with selected date range

### Settings (`/settings`)

- Auto-detected JIRA statuses from project workflow
- Dropdown to categorize each status: Progress / Review / Blocked / Done / Other
- Save button

## Sync Behavior

1. **First sync:** Fetch all data from last 6 months (configurable)
2. **Subsequent syncs:**
   - Read `last_synced_at` from `sync_log`
   - Fetch only items updated after that timestamp
   - Upsert into local tables (update if exists, insert if new)
   - Record new sync in `sync_log`
3. **Metrics computed at query time** from raw stored data

## File Structure

```
team-metrics/
├── app/
│   ├── page.tsx                 # Dashboard
│   ├── settings/
│   │   └── page.tsx             # Settings page
│   ├── api/
│   │   ├── sync/
│   │   │   ├── bitbucket/route.ts
│   │   │   └── jira/route.ts
│   │   ├── metrics/route.ts
│   │   ├── settings/route.ts
│   │   ├── users/route.ts
│   │   └── export/route.ts
│   └── layout.tsx
├── components/
│   ├── ui/                      # shadcn components
│   ├── dashboard/
│   │   ├── metrics-card.tsx
│   │   ├── date-range-picker.tsx
│   │   ├── user-selector.tsx
│   │   └── team-table.tsx
│   └── settings/
│       └── status-mapper.tsx
├── lib/
│   ├── db.ts                    # SQLite connection + queries
│   ├── schema.ts                # Table definitions
│   ├── bitbucket.ts             # Bitbucket API client
│   ├── jira.ts                  # JIRA API client
│   └── metrics.ts               # Metric computation functions
├── docs/
│   └── specs/
│       └── 2026-09-14-team-metrics-design.md
├── team-metrics.db              # SQLite database (gitignored)
├── .env.local                   # Credentials (gitignored)
├── .env.example                 # Template for env vars
└── package.json
```

## Export Feature

**Formats supported:** CSV and PDF

**Export API:** `GET /api/export?format={csv|pdf}&startDate={date}&endDate={date}&userId={optional}`

**CSV format:**
- Headers row + data rows
- All metrics for selected user(s) and date range
- Suitable for spreadsheet analysis

**PDF format:**
- Formatted report matching dashboard layout
- Generated server-side using a PDF library (e.g., `@react-pdf/renderer` or `pdfmake`)
- Includes date range, user filter, and all metric cards

## Out of Scope (for v1)

- OAuth flow (using env var tokens instead)
- Background/scheduled sync
- Multi-project support
- Historical trend charts
- Notifications/alerts
