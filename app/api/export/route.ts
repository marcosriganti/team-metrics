import { NextRequest, NextResponse } from "next/server";
import { getBitbucketMetrics, getJiraMetrics, getTeamMetrics } from "@/lib/metrics";
import { generateCsv, generatePdf } from "@/lib/export";
import { getTeamMembers } from "@/lib/db";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const format = searchParams.get("format") || "csv";
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
    const bitbucket = getBitbucketMetrics(userId, startDate, endDate);
    const jira = getJiraMetrics(userId, startDate, endDate);
    const team = userId ? undefined : getTeamMetrics(startDate, endDate);

    let userName: string | undefined;
    if (userId) {
      const members = getTeamMembers();
      const member = members.find((m) => m.external_id === userId);
      userName = member?.display_name;
    }

    const exportData = {
      startDate,
      endDate,
      userName,
      bitbucket,
      jira,
      team,
    };

    if (format === "pdf") {
      const pdfBuffer = await generatePdf(exportData);
      return new NextResponse(Buffer.from(pdfBuffer), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="metrics-${startDate}-${endDate}.pdf"`,
        },
      });
    } else {
      const csv = generateCsv(exportData);
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="metrics-${startDate}-${endDate}.csv"`,
        },
      });
    }
  } catch (error) {
    console.error("Export error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Export failed" },
      { status: 500 }
    );
  }
}
