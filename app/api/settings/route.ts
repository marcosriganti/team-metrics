import { NextRequest, NextResponse } from "next/server";
import { getStatusMapping, upsertStatusMapping, getDistinctJiraStatuses } from "@/lib/db";
import { fetchProjectStatuses } from "@/lib/jira";

export async function GET() {
  try {
    const mapping = getStatusMapping();
    const localStatuses = getDistinctJiraStatuses();

    // Try to fetch from JIRA API, fall back to local statuses
    let availableStatuses: string[];
    try {
      availableStatuses = await fetchProjectStatuses();
    } catch {
      availableStatuses = localStatuses;
    }

    // Merge: include all statuses from both sources
    const allStatuses = Array.from(new Set([...availableStatuses, ...localStatuses])).sort();

    return NextResponse.json({
      mapping,
      availableStatuses: allStatuses,
    });
  } catch (error) {
    console.error("Settings error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch settings" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { mappings } = body as {
      mappings: Array<{ status: string; category: string }>;
    };

    for (const { status, category } of mappings) {
      upsertStatusMapping(status, category as "progress" | "review" | "blocked" | "done" | "other");
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Settings save error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save settings" },
      { status: 500 }
    );
  }
}
