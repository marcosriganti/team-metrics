import { NextResponse } from "next/server";
import { getTeamMembers } from "@/lib/db";

export async function GET() {
  try {
    const members = getTeamMembers();

    // Deduplicate by display_name - same person may exist in both Bitbucket and JIRA
    const uniqueByName = new Map<string, typeof members[0]>();
    for (const member of members) {
      if (!uniqueByName.has(member.display_name)) {
        uniqueByName.set(member.display_name, member);
      }
    }

    return NextResponse.json({ users: Array.from(uniqueByName.values()) });
  } catch (error) {
    console.error("Users error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch users" },
      { status: 500 }
    );
  }
}
