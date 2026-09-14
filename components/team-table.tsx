import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TeamMemberMetrics } from "@/lib/metrics";

interface TeamTableProps {
  members: TeamMemberMetrics[];
}

export function TeamTable({ members }: TeamTableProps) {
  if (members.length === 0) {
    return <p className="text-muted-foreground">No team data available. Run a sync first.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead className="text-right">PRs</TableHead>
          <TableHead className="text-right">Merged</TableHead>
          <TableHead className="text-right">Reviewed</TableHead>
          <TableHead className="text-right">Tickets</TableHead>
          <TableHead className="text-right">Points</TableHead>
          <TableHead className="text-right">Cycle Time</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((member) => (
          <TableRow key={member.userId}>
            <TableCell className="font-medium">{member.displayName}</TableCell>
            <TableCell className="text-right">{member.bitbucket.prsAuthored}</TableCell>
            <TableCell className="text-right">{member.bitbucket.prsMerged}</TableCell>
            <TableCell className="text-right">{member.bitbucket.prsReviewed}</TableCell>
            <TableCell className="text-right">{member.jira.ticketsCompleted}</TableCell>
            <TableCell className="text-right">{member.jira.storyPointsDelivered}</TableCell>
            <TableCell className="text-right">{member.jira.avgCycleTimeDays}d</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
