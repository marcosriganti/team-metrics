import { NextRequest, NextResponse } from "next/server";
import {
  fetchPullRequests,
  fetchPrComments,
  fetchPrDiffstat,
} from "@/lib/bitbucket";
import {
  getSyncLog,
  insertSyncLog,
  upsertPullRequest,
  upsertPrComment,
  upsertTeamMember,
} from "@/lib/db";

// Defaults
const DEFAULT_LIMIT = 50;        // Max PRs per sync run
const DEFAULT_DELAY_MS = 200;    // Delay between API calls (rate limiting)
const SAVE_INTERVAL = 5;         // Save progress every N items

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
    const syncLog = getSyncLog("bitbucket");
    let since = syncLog?.last_synced_at;

    // If startDate provided, use it as the lower bound
    if (startDate) {
      since = startDate;
      console.log(`[Bitbucket] Using startDate filter: ${startDate}`);
    }

    let prCount = 0;
    let commentCount = 0;
    const seenAuthors = new Set<string>();

    console.log("[Bitbucket] Sync config:", { limit, delayMs, since: since || "all time" });
    console.log("[Bitbucket] Progress saved every", SAVE_INTERVAL, "PRs - safe to stop anytime");

    for await (const pr of fetchPullRequests(since)) {
      // Check limit
      if (prCount >= limit) {
        console.log(`[Bitbucket] Reached limit of ${limit} PRs. Run sync again for more.`);
        break;
      }

      // Rate limiting
      if (prCount > 0) {
        await sleep(delayMs);
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
        await sleep(delayMs); // Rate limit
        diffstat = await fetchPrDiffstat(pr.id);
      } catch (e) {
        console.warn(`[Bitbucket] Could not fetch diffstat for PR #${pr.id}`);
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
        await sleep(delayMs); // Rate limit
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
        console.warn(`[Bitbucket] Could not fetch comments for PR #${pr.id}`);
      }

      prCount++;
      console.log(`[Bitbucket] ${prCount}/${limit}: PR #${pr.id} "${pr.title.slice(0, 40)}..."`);

      // Save progress periodically
      if (prCount % SAVE_INTERVAL === 0) {
        insertSyncLog("bitbucket", prCount);
        console.log(`[Bitbucket] ✓ Progress saved at ${prCount} PRs`);
      }
    }

    // Final save
    insertSyncLog("bitbucket", prCount);

    const hasMore = prCount >= limit;
    console.log(`[Bitbucket] ✓ Done: ${prCount} PRs, ${commentCount} comments${hasMore ? " (more available)" : ""}`);

    return NextResponse.json({
      synced: prCount,
      comments: commentCount,
      authors: seenAuthors.size,
      hasMore,
      message: `Synced ${prCount} PRs${hasMore ? ` (limit ${limit}, run again for more)` : ""}`,
    });
  } catch (error) {
    console.error("[Bitbucket] Sync error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sync failed" },
      { status: 500 }
    );
  }
}

// GET to check sync status
export async function GET() {
  const syncLog = getSyncLog("bitbucket");
  return NextResponse.json({
    lastSyncedAt: syncLog?.last_synced_at || null,
    source: "bitbucket",
  });
}
