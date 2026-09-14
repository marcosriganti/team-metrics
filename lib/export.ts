import pdfMake from "pdfmake/build/pdfmake";
import pdfFonts from "pdfmake/build/vfs_fonts";
import type { TDocumentDefinitions } from "pdfmake/interfaces";
import { BitbucketMetrics, JiraMetrics, TeamMemberMetrics } from "./metrics";

(pdfMake as any).vfs = pdfFonts.vfs;

interface ExportData {
  startDate: string;
  endDate: string;
  userName?: string;
  bitbucket: BitbucketMetrics;
  jira: JiraMetrics;
  team?: TeamMemberMetrics[];
}

export function generateCsv(data: ExportData): string {
  const lines: string[] = [];

  lines.push("Team Metrics Report");
  lines.push(`Date Range,${data.startDate},${data.endDate}`);
  if (data.userName) {
    lines.push(`User,${data.userName}`);
  }
  lines.push("");

  // Bitbucket metrics
  lines.push("Bitbucket Metrics");
  lines.push("Metric,Value");
  lines.push(`PRs Authored,${data.bitbucket.prsAuthored}`);
  lines.push(`PRs Merged,${data.bitbucket.prsMerged}`);
  lines.push(`PRs Reviewed,${data.bitbucket.prsReviewed}`);
  lines.push(`Comments Made,${data.bitbucket.commentsMade}`);
  lines.push(`Avg Comments per PR,${data.bitbucket.avgCommentsPerPr}`);
  lines.push(`Avg PR Size (lines),${data.bitbucket.avgPrSize}`);
  lines.push(`Avg Time to Merge (days),${data.bitbucket.avgTimeToMergeDays}`);
  lines.push("");

  // JIRA metrics
  lines.push("JIRA Metrics");
  lines.push("Metric,Value");
  lines.push(`Tickets Worked,${data.jira.ticketsWorked}`);
  lines.push(`Tickets Completed,${data.jira.ticketsCompleted}`);
  lines.push(`Story Points Delivered,${data.jira.storyPointsDelivered}`);
  lines.push(`Avg Time in Progress (days),${data.jira.avgTimeInProgressDays}`);
  lines.push(`Avg Time in Review (days),${data.jira.avgTimeInReviewDays}`);
  lines.push(`Avg Cycle Time (days),${data.jira.avgCycleTimeDays}`);

  // Team comparison if available
  if (data.team && data.team.length > 0) {
    lines.push("");
    lines.push("Team Comparison");
    lines.push("Name,PRs Authored,PRs Merged,Tickets Completed,Story Points,Cycle Time (days)");
    for (const member of data.team) {
      lines.push(
        `${member.displayName},${member.bitbucket.prsAuthored},${member.bitbucket.prsMerged},${member.jira.ticketsCompleted},${member.jira.storyPointsDelivered},${member.jira.avgCycleTimeDays}`
      );
    }
  }

  return lines.join("\n");
}

export async function generatePdf(data: ExportData): Promise<Uint8Array> {
  const docDefinition: TDocumentDefinitions = {
    content: [
      { text: "Team Metrics Report", style: "header" },
      { text: `${data.startDate} to ${data.endDate}`, style: "subheader" },
      ...(data.userName ? [{ text: `User: ${data.userName}`, style: "subheader" }] : []),
      { text: "", margin: [0, 10, 0, 0] },

      { text: "Bitbucket Metrics", style: "sectionHeader" },
      {
        table: {
          widths: ["*", "auto"],
          body: [
            ["Metric", "Value"],
            ["PRs Authored", data.bitbucket.prsAuthored.toString()],
            ["PRs Merged", data.bitbucket.prsMerged.toString()],
            ["PRs Reviewed", data.bitbucket.prsReviewed.toString()],
            ["Comments Made", data.bitbucket.commentsMade.toString()],
            ["Avg Comments per PR", data.bitbucket.avgCommentsPerPr.toString()],
            ["Avg PR Size (lines)", data.bitbucket.avgPrSize.toString()],
            ["Avg Time to Merge (days)", data.bitbucket.avgTimeToMergeDays.toString()],
          ],
        },
      },
      { text: "", margin: [0, 10, 0, 0] },

      { text: "JIRA Metrics", style: "sectionHeader" },
      {
        table: {
          widths: ["*", "auto"],
          body: [
            ["Metric", "Value"],
            ["Tickets Worked", data.jira.ticketsWorked.toString()],
            ["Tickets Completed", data.jira.ticketsCompleted.toString()],
            ["Story Points Delivered", data.jira.storyPointsDelivered.toString()],
            ["Avg Time in Progress (days)", data.jira.avgTimeInProgressDays.toString()],
            ["Avg Time in Review (days)", data.jira.avgTimeInReviewDays.toString()],
            ["Avg Cycle Time (days)", data.jira.avgCycleTimeDays.toString()],
          ],
        },
      },

      ...(data.team && data.team.length > 0
        ? [
            { text: "", margin: [0, 10, 0, 0] as [number, number, number, number] },
            { text: "Team Comparison", style: "sectionHeader" },
            {
              table: {
                widths: ["*", "auto", "auto", "auto", "auto", "auto"],
                body: [
                  ["Name", "PRs", "Merged", "Tickets", "Points", "Cycle"],
                  ...data.team.map((m) => [
                    m.displayName,
                    m.bitbucket.prsAuthored.toString(),
                    m.bitbucket.prsMerged.toString(),
                    m.jira.ticketsCompleted.toString(),
                    m.jira.storyPointsDelivered.toString(),
                    m.jira.avgCycleTimeDays.toString(),
                  ]),
                ],
              },
            },
          ]
        : []),
    ],
    styles: {
      header: { fontSize: 18, bold: true, margin: [0, 0, 0, 10] },
      subheader: { fontSize: 12, color: "gray", margin: [0, 0, 0, 5] },
      sectionHeader: { fontSize: 14, bold: true, margin: [0, 10, 0, 5] },
    },
  };

  return new Promise((resolve, reject) => {
    const pdfDoc = pdfMake.createPdf(docDefinition);
    (pdfDoc as any).getBuffer((buffer: any) => {
      resolve(buffer as Uint8Array);
    });
  });
}
