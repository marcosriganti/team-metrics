import { NextRequest, NextResponse } from "next/server";
import { fetchIssues, fetchIssueChangelog } from "@/lib/jira";
import {
  getSyncLog,
  insertSyncLog,
  upsertJiraIssue,
  insertIssueTransition,
  clearIssueTransitions,
  upsertTeamMember,
} from "@/lib/db";

// Defaults
const DEFAULT_LIMIT = 50;        // Max issues per sync run
const DEFAULT_DELAY_MS = 200;    // Delay between API calls (rate limiting)
const SAVE_INTERVAL = 10;        // Save progress every N items

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function POST(request: NextRequest) {
  try {
    // Parse options from request body
    const body = await request.json().catch(() => ({}));
    const limit = body.limit ?? DEFAULT_LIMIT;
    const delayMs = body.delayMs ?? DEFAULT_DELAY_MS;
    const startDate = body.startDate; // ISO string, e.g., "2024-01-01"

    // Get last sync point
    const syncLog = getSyncLog("jira");
    let since = syncLog?.last_synced_at;

    // If startDate provided, use it as the lower bound
    if (startDate) {
      since = startDate;
      console.log(`[JIRA] Using startDate filter: ${startDate}`);
    }

    let issueCount = 0;
    let transitionCount = 0;
    const seenAssignees = new Set<string>();

    console.log("[JIRA] Sync config:", { limit, delayMs, since: since || "all time" });
    console.log("[JIRA] Progress saved every", SAVE_INTERVAL, "issues - safe to stop anytime");

    for await (const issue of fetchIssues(since)) {
      // Check limit
      if (issueCount >= limit) {
        console.log(`[JIRA] Reached limit of ${limit} issues. Run sync again for more.`);
        break;
      }

      // Rate limiting
      if (issueCount > 0) {
        await sleep(delayMs);
      }

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

      // Fetch transitions for this issue
      try {
        await sleep(delayMs); // Rate limit
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
              transitionCount++;
            }
          }
        }
      } catch (e) {
        console.warn(`[JIRA] Could not fetch changelog for ${issue.key}`);
      }

      issueCount++;
      console.log(`[JIRA] ${issueCount}/${limit}: ${issue.key} "${issue.fields.summary.slice(0, 40)}..."`);

      // Save progress periodically
      if (issueCount % SAVE_INTERVAL === 0) {
        insertSyncLog("jira", issueCount);
        console.log(`[JIRA] ✓ Progress saved at ${issueCount} issues`);
      }
    }

    // Final save
    insertSyncLog("jira", issueCount);

    const hasMore = issueCount >= limit;
    console.log(`[JIRA] ✓ Done: ${issueCount} issues, ${transitionCount} transitions${hasMore ? " (more available)" : ""}`);

    return NextResponse.json({
      synced: issueCount,
      transitions: transitionCount,
      assignees: seenAssignees.size,
      hasMore,
      message: `Synced ${issueCount} issues${hasMore ? ` (limit ${limit}, run again for more)` : ""}`,
    });
  } catch (error) {
    console.error("[JIRA] Sync error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sync failed" },
      { status: 500 }
    );
  }
}

// GET to check sync status
export async function GET() {
  const syncLog = getSyncLog("jira");
  return NextResponse.json({
    lastSyncedAt: syncLog?.last_synced_at || null,
    source: "jira",
  });
}
