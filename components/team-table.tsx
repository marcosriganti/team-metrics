"use client";

import { DataTable, Column } from "@/components/data-table";
import { TeamMemberMetrics } from "@/lib/metrics";

interface TeamTableProps {
  members: TeamMemberMetrics[];
}

const columns: Column<TeamMemberMetrics>[] = [
  {
    id: "displayName",
    header: "Name",
    accessor: (row) => <span className="font-medium">{row.displayName}</span>,
    sortValue: (row) => row.displayName,
  },
  {
    id: "prsAuthored",
    header: "PRs",
    accessor: (row) => row.bitbucket.prsAuthored,
    sortValue: (row) => row.bitbucket.prsAuthored,
    align: "right",
  },
  {
    id: "prsMerged",
    header: "Merged",
    accessor: (row) => row.bitbucket.prsMerged,
    sortValue: (row) => row.bitbucket.prsMerged,
    align: "right",
  },
  {
    id: "prsReviewed",
    header: "Reviewed",
    accessor: (row) => row.bitbucket.prsReviewed,
    sortValue: (row) => row.bitbucket.prsReviewed,
    align: "right",
  },
  {
    id: "commentsMade",
    header: "Comments",
    accessor: (row) => row.bitbucket.commentsMade,
    sortValue: (row) => row.bitbucket.commentsMade,
    align: "right",
  },
  {
    id: "avgPrSize",
    header: "Avg PR Size",
    accessor: (row) => row.bitbucket.avgPrSize,
    sortValue: (row) => row.bitbucket.avgPrSize,
    align: "right",
  },
  {
    id: "ticketsCompleted",
    header: "Tickets",
    accessor: (row) => row.jira.ticketsCompleted,
    sortValue: (row) => row.jira.ticketsCompleted,
    align: "right",
  },
  {
    id: "storyPoints",
    header: "Points",
    accessor: (row) => row.jira.storyPointsDelivered,
    sortValue: (row) => row.jira.storyPointsDelivered,
    align: "right",
  },
  {
    id: "avgCycleTime",
    header: "Cycle Time",
    accessor: (row) => `${row.jira.avgCycleTimeDays}d`,
    sortValue: (row) => row.jira.avgCycleTimeDays,
    align: "right",
  },
  {
    id: "avgTimeInProgress",
    header: "In Progress",
    accessor: (row) => `${row.jira.avgTimeInProgressDays}d`,
    sortValue: (row) => row.jira.avgTimeInProgressDays,
    align: "right",
  },
  {
    id: "avgTimeInReview",
    header: "In Review",
    accessor: (row) => `${row.jira.avgTimeInReviewDays}d`,
    sortValue: (row) => row.jira.avgTimeInReviewDays,
    align: "right",
  },
];

export function TeamTable({ members }: TeamTableProps) {
  if (members.length === 0) {
    return <p className="text-muted-foreground">No team data available. Run a sync first.</p>;
  }

  return (
    <DataTable
      columns={columns}
      data={members}
      getRowKey={(row) => row.userId}
    />
  );
}
