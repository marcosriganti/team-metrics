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
  getPullRequestStatus,
} from "@/lib/db";

// Defaults
const DEFAULT_LIMIT = 50;
const DEFAULT_DELAY_MS = 200;
const SAVE_INTERVAL = 5;

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const limit = body.limit ?? DEFAULT_LIMIT;
    const delayMs = body.delayMs ?? DEFAULT_DELAY_MS;
    const startDate = body.startDate;

    const syncLog = getSyncLog("bitbucket");
    let since = syncLog?.last_synced_at;

    if (startDate) {
      since = startDate;
      console.log(`[Bitbucket] Using startDate filter: ${startDate}`);
    }

    let prCount = 0;
    let commentCount = 0;
    let skippedFinalized = 0;
    let apiCalls = 0;
    const seenAuthors = new Set<string>();

    console.log("[Bitbucket] Sync config:", { limit, delayMs, since: since || "all time" });
    console.log("[Bitbucket] Smart caching: skipping details for merged/closed PRs already in DB");

    for await (const pr of fetchPullRequests(since)) {
      apiCalls++;

      if (prCount >= limit) {
        console.log(`[Bitbucket] Reached limit of ${limit} PRs. Run sync again for more.`);
        break;
      }

      if (prCount > 0) {
        await sleep(delayMs);
      }

      // Check if this PR is already in our DB
      const prStatus = getPullRequestStatus(pr.id);
      const isFinalized = pr.state !== "OPEN"; // Current state from API

      // Skip ENTIRELY if nothing changed (same updated_at)
      if (prStatus.exists && prStatus.updatedAt === pr.updated_on) {
        console.log(`[Bitbucket] SKIP: PR #${pr.id} unchanged since ${pr.updated_on}`);
        prCount++;
        skippedFinalized++;
        continue;
      }

      const alreadyCached = prStatus.exists && prStatus.finalized;

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

      // If PR was already finalized and cached, skip expensive fetches
      if (alreadyCached) {
        skippedFinalized++;
        console.log(`[Bitbucket] SKIP: PR #${pr.id} already cached (${prStatus.state})`);

        // Still update basic info in case title/metadata changed
        upsertPullRequest({
          bb_id: pr.id,
          repo_slug: process.env.BITBUCKET_REPO!,
          author_uuid: pr.author.uuid,
          author_name: pr.author.display_name,
          title: pr.title,
          state: pr.state,
          lines_added: 0, // Keep existing values via upsert
          lines_removed: 0,
          created_at: pr.created_on,
          updated_at: pr.updated_on,
          merged_at: pr.merge_commit?.date || null,
        });
        prCount++;
        continue;
      }

      // Fetch diffstat (only for new or open PRs)
      let diffstat = { lines_added: 0, lines_removed: 0 };
      try {
        await sleep(delayMs);
        apiCalls++;
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

      // Fetch comments (only for new or open PRs)
      try {
        await sleep(delayMs);
        apiCalls++;
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
      const status = isFinalized ? `✓ ${pr.state}` : `OPEN`;
      console.log(`[Bitbucket] ${prCount}/${limit}: PR #${pr.id} [${status}] "${pr.title.slice(0, 30)}..."`);

      if (prCount % SAVE_INTERVAL === 0) {
        insertSyncLog("bitbucket", prCount);
        console.log(`[Bitbucket] ✓ Progress saved at ${prCount} PRs`);
      }
    }

    insertSyncLog("bitbucket", prCount);

    const hasMore = prCount >= limit;
    console.log(`[Bitbucket] ✓ Done: ${prCount} PRs, ${commentCount} comments`);
    console.log(`[Bitbucket] ✓ Skipped ${skippedFinalized} finalized PRs (already cached)`);
    console.log(`[Bitbucket] ✓ API calls made: ${apiCalls}`);

    return NextResponse.json({
      synced: prCount,
      comments: commentCount,
      skippedFinalized,
      apiCalls,
      hasMore,
      message: `Synced ${prCount} PRs (${skippedFinalized} skipped as cached)`,
    });
  } catch (error) {
    console.error("[Bitbucket] Sync error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sync failed" },
      { status: 500 }
    );
  }
}

export async function GET() {
  const syncLog = getSyncLog("bitbucket");
  return NextResponse.json({
    lastSyncedAt: syncLog?.last_synced_at || null,
    source: "bitbucket",
  });
}
