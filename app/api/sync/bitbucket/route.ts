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
