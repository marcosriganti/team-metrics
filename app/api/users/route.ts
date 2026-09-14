import { NextResponse } from "next/server";
import { getTeamMembers } from "@/lib/db";

export async function GET() {
  try {
    const members = getTeamMembers();
    return NextResponse.json({ users: members });
  } catch (error) {
    console.error("Users error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch users" },
      { status: 500 }
    );
  }
}
