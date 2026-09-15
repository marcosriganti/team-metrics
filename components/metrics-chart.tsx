"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { TeamMemberMetrics } from "@/lib/metrics";

interface MetricsChartProps {
  members: TeamMemberMetrics[];
  metric: "prs" | "points" | "cycleTime";
}

const COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

export function MetricsChart({ members, metric }: MetricsChartProps) {
  if (members.length === 0) {
    return <p className="text-muted-foreground">No data available.</p>;
  }

  // Transform data for chart - each member becomes a data point
  const data = members.map((member) => {
    const getValue = () => {
      switch (metric) {
        case "prs":
          return member.bitbucket.prsAuthored;
        case "points":
          return member.jira.storyPointsDelivered;
        case "cycleTime":
          return member.jira.avgCycleTimeDays;
        default:
          return 0;
      }
    };

    return {
      name: member.displayName.split(" ")[0], // Use first name for brevity
      value: getValue(),
      fullName: member.displayName,
    };
  });

  const getLabel = () => {
    switch (metric) {
      case "prs":
        return "PRs Authored";
      case "points":
        return "Story Points";
      case "cycleTime":
        return "Cycle Time (days)";
      default:
        return "";
    }
  };

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis
          dataKey="name"
          tick={{ fontSize: 12 }}
          className="text-muted-foreground"
        />
        <YAxis tick={{ fontSize: 12 }} className="text-muted-foreground" />
        <Tooltip
          contentStyle={{
            backgroundColor: "hsl(var(--popover))",
            borderColor: "hsl(var(--border))",
            borderRadius: "var(--radius)",
          }}
          labelFormatter={(_, payload) => payload[0]?.payload?.fullName || ""}
        />
        <Legend />
        <Line
          type="monotone"
          dataKey="value"
          name={getLabel()}
          stroke={COLORS[0]}
          strokeWidth={2}
          dot={{ fill: COLORS[0], strokeWidth: 2 }}
          activeDot={{ r: 6 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

interface ComparisonChartProps {
  members: TeamMemberMetrics[];
}

export function ComparisonChart({ members }: ComparisonChartProps) {
  if (members.length === 0) {
    return <p className="text-muted-foreground">No data available.</p>;
  }

  // Transform data - show multiple metrics per member as bars
  const data = members.map((member) => ({
    name: member.displayName.split(" ")[0],
    fullName: member.displayName,
    PRs: member.bitbucket.prsAuthored,
    Merged: member.bitbucket.prsMerged,
    Reviewed: member.bitbucket.prsReviewed,
    Tickets: member.jira.ticketsCompleted,
    Points: member.jira.storyPointsDelivered,
  }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis
          dataKey="name"
          tick={{ fontSize: 12 }}
          className="text-muted-foreground"
        />
        <YAxis tick={{ fontSize: 12 }} className="text-muted-foreground" />
        <Tooltip
          contentStyle={{
            backgroundColor: "hsl(var(--popover))",
            borderColor: "hsl(var(--border))",
            borderRadius: "var(--radius)",
          }}
          labelFormatter={(_, payload) => payload[0]?.payload?.fullName || ""}
        />
        <Legend />
        <Line
          type="monotone"
          dataKey="PRs"
          stroke={COLORS[0]}
          strokeWidth={2}
          dot={{ fill: COLORS[0] }}
        />
        <Line
          type="monotone"
          dataKey="Merged"
          stroke={COLORS[1]}
          strokeWidth={2}
          dot={{ fill: COLORS[1] }}
        />
        <Line
          type="monotone"
          dataKey="Reviewed"
          stroke={COLORS[2]}
          strokeWidth={2}
          dot={{ fill: COLORS[2] }}
        />
        <Line
          type="monotone"
          dataKey="Tickets"
          stroke={COLORS[3]}
          strokeWidth={2}
          dot={{ fill: COLORS[3] }}
        />
        <Line
          type="monotone"
          dataKey="Points"
          stroke={COLORS[4]}
          strokeWidth={2}
          dot={{ fill: COLORS[4] }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
