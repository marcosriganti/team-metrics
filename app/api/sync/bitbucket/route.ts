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

// Save progress every N items
const SAVE_INTERVAL = 5;

export async function POST() {
  try {
    const syncLog = getSyncLog("bitbucket");
    const since = syncLog?.last_synced_at;

    let prCount = 0;
    let commentCount = 0;
    let lastUpdatedAt: string | null = null;
    const seenAuthors = new Set<string>();

    // Try to sync workspace members (optional - may fail with limited token scope)
    try {
      console.log("[Bitbucket] Fetching workspace members...");
      let memberCount = 0;
      for await (const member of fetchWorkspaceMembers()) {
        upsertTeamMember({
          source: "bitbucket",
          external_id: member.user.uuid,
          display_name: member.user.display_name,
          email: member.user.email || null,
        });
        memberCount++;
      }
      console.log(`[Bitbucket] Synced ${memberCount} workspace members`);
    } catch (error) {
      console.warn("[Bitbucket] Could not fetch workspace members (token may lack account:read scope). Will extract from PRs instead.");
    }

    // Sync pull requests
    console.log("[Bitbucket] Fetching pull requests since:", since || "beginning");
    console.log("[Bitbucket] Progress is saved every", SAVE_INTERVAL, "PRs - safe to stop anytime");

    for await (const pr of fetchPullRequests(since)) {
      // Track the most recent updated_at for resuming
      if (!lastUpdatedAt || pr.updated_on > lastUpdatedAt) {
        lastUpdatedAt = pr.updated_on;
      }

      // Extract team member from PR author
      if (!seenAuthors.has(pr.author.uuid)) {
        seenAuthors.add(pr.author.uuid);
        upsertTeamMember({
          source: "bitbucket",
          external_id: pr.author.uuid,
          display_name: pr.author.display_name,
          email: null,
        });
      }

      // Fetch diffstat for line counts
      let diffstat = { lines_added: 0, lines_removed: 0 };
      try {
        diffstat = await fetchPrDiffstat(pr.id);
      } catch (e) {
        console.warn(`[Bitbucket] Could not fetch diffstat for PR #${pr.id}:`, e);
      }

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

      // Fetch comments for this PR
      try {
        for await (const comment of fetchPrComments(pr.id)) {
          if (!seenAuthors.has(comment.user.uuid)) {
            seenAuthors.add(comment.user.uuid);
            upsertTeamMember({
              source: "bitbucket",
              external_id: comment.user.uuid,
              display_name: comment.user.display_name,
              email: null,
            });
          }

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
      } catch (e) {
        console.warn(`[Bitbucket] Could not fetch comments for PR #${pr.id}:`, e);
      }

      prCount++;
      console.log(`[Bitbucket] PR ${prCount}: #${pr.id} "${pr.title.slice(0, 40)}..." (${pr.state})`);

      // Save progress periodically
      if (prCount % SAVE_INTERVAL === 0) {
        insertSyncLog("bitbucket", prCount);
        console.log(`[Bitbucket] ✓ Progress saved at ${prCount} PRs - safe to stop`);
      }
    }

    // Final save
    insertSyncLog("bitbucket", prCount);
    console.log(`[Bitbucket] ✓ Sync complete: ${prCount} PRs, ${commentCount} comments, ${seenAuthors.size} authors`);

    return NextResponse.json({
      synced: prCount,
      comments: commentCount,
      authors: seenAuthors.size,
      message: `Synced ${prCount} PRs, ${commentCount} comments, ${seenAuthors.size} authors`,
    });
  } catch (error) {
    console.error("[Bitbucket] Sync error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sync failed" },
      { status: 500 }
    );
  }
}
