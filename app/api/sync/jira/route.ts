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
