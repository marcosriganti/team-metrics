import { NextRequest, NextResponse } from "next/server";
import { fetchIssues, fetchIssueChangelog } from "@/lib/jira";
import {
  getSyncLog,
  insertSyncLog,
  upsertJiraIssue,
  insertIssueTransition,
  clearIssueTransitions,
  upsertTeamMember,
  getJiraIssueStatus,
  hasIssueTransitions,
} from "@/lib/db";

// Defaults
const DEFAULT_LIMIT = 50;
const DEFAULT_DELAY_MS = 200;
const SAVE_INTERVAL = 10;

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const limit = body.limit ?? DEFAULT_LIMIT;
    const delayMs = body.delayMs ?? DEFAULT_DELAY_MS;
    const startDate = body.startDate;

    const syncLog = getSyncLog("jira");
    let since = syncLog?.last_synced_at;

    if (startDate) {
      since = startDate;
      console.log(`[JIRA] Using startDate filter: ${startDate}`);
    }

    let issueCount = 0;
    let transitionCount = 0;
    let skippedResolved = 0;
    let apiCalls = 0;
    const seenAssignees = new Set<string>();

    console.log("[JIRA] Sync config:", { limit, delayMs, since: since || "all time" });
    console.log("[JIRA] Smart caching: skipping changelog for resolved issues already in DB");

    for await (const issue of fetchIssues(since)) {
      apiCalls++;

      if (issueCount >= limit) {
        console.log(`[JIRA] Reached limit of ${limit} issues. Run sync again for more.`);
        break;
      }

      if (issueCount > 0) {
        await sleep(delayMs);
      }

      // Check if this issue is already resolved in our DB with transitions
      const issueStatus = getJiraIssueStatus(issue.key);
      const isResolved = issue.fields.resolutiondate !== null;
      const alreadyCached = issueStatus.exists && issueStatus.resolved && hasIssueTransitions(issue.key);

      // Always update basic issue info
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

      // Track unique assignees
      if (issue.fields.assignee && !seenAssignees.has(issue.fields.assignee.accountId)) {
        seenAssignees.add(issue.fields.assignee.accountId);
        upsertTeamMember({
          source: "jira",
          external_id: issue.fields.assignee.accountId,
          display_name: issue.fields.assignee.displayName,
          email: null,
        });
      }

      // Skip changelog fetch if already resolved and cached
      if (alreadyCached) {
        skippedResolved++;
        console.log(`[JIRA] SKIP changelog: ${issue.key} already cached (resolved)`);
        issueCount++;
        continue;
      }

      // Fetch changelog (only for new or unresolved issues)
      try {
        await sleep(delayMs);
        apiCalls++;
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
      const status = isResolved ? "✓ RESOLVED" : issue.fields.status.name;
      console.log(`[JIRA] ${issueCount}/${limit}: ${issue.key} [${status}] "${issue.fields.summary.slice(0, 30)}..."`);

      if (issueCount % SAVE_INTERVAL === 0) {
        insertSyncLog("jira", issueCount);
        console.log(`[JIRA] ✓ Progress saved at ${issueCount} issues`);
      }
    }

    insertSyncLog("jira", issueCount);

    const hasMore = issueCount >= limit;
    console.log(`[JIRA] ✓ Done: ${issueCount} issues, ${transitionCount} transitions`);
    console.log(`[JIRA] ✓ Skipped ${skippedResolved} resolved issues (changelog already cached)`);
    console.log(`[JIRA] ✓ API calls made: ${apiCalls}`);

    return NextResponse.json({
      synced: issueCount,
      transitions: transitionCount,
      skippedResolved,
      apiCalls,
      hasMore,
      message: `Synced ${issueCount} issues (${skippedResolved} skipped as cached)`,
    });
  } catch (error) {
    console.error("[JIRA] Sync error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sync failed" },
      { status: 500 }
    );
  }
}

export async function GET() {
  const syncLog = getSyncLog("jira");
  return NextResponse.json({
    lastSyncedAt: syncLog?.last_synced_at || null,
    source: "jira",
  });
}
