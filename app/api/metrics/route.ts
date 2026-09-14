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
