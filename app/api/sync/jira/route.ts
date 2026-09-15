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

// Save progress every N items
const SAVE_INTERVAL = 10;

export async function POST() {
  try {
    const syncLog = getSyncLog("jira");
    const since = syncLog?.last_synced_at;

    let issueCount = 0;
    let transitionCount = 0;
    const seenAssignees = new Set<string>();

    console.log("[JIRA] Fetching issues since:", since || "beginning");
    console.log("[JIRA] Progress is saved every", SAVE_INTERVAL, "issues - safe to stop anytime");

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

      // Fetch transitions for this issue
      try {
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
        console.warn(`[JIRA] Could not fetch changelog for ${issue.key}:`, e);
      }

      issueCount++;
      console.log(`[JIRA] Issue ${issueCount}: ${issue.key} "${issue.fields.summary.slice(0, 40)}..." (${issue.fields.status.name})`);

      // Save progress periodically
      if (issueCount % SAVE_INTERVAL === 0) {
        insertSyncLog("jira", issueCount);
        console.log(`[JIRA] ✓ Progress saved at ${issueCount} issues - safe to stop`);
      }
    }

    // Final save
    insertSyncLog("jira", issueCount);
    console.log(`[JIRA] ✓ Sync complete: ${issueCount} issues, ${transitionCount} transitions, ${seenAssignees.size} assignees`);

    return NextResponse.json({
      synced: issueCount,
      transitions: transitionCount,
      assignees: seenAssignees.size,
      message: `Synced ${issueCount} issues, ${transitionCount} transitions`,
    });
  } catch (error) {
    console.error("[JIRA] Sync error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sync failed" },
      { status: 500 }
    );
  }
}
