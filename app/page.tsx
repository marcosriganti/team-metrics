"use client";

import { useEffect, useState, useCallback } from "react";
import { format, subDays } from "date-fns";
import { Header } from "@/components/header";
import { MetricsCard } from "@/components/metrics-card";
import { DateRangePicker } from "@/components/date-range-picker";
import { UserSelector } from "@/components/user-selector";
import { TeamTable } from "@/components/team-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { BitbucketMetrics, JiraMetrics, TeamMemberMetrics } from "@/lib/metrics";

interface User {
  id: number;
  external_id: string;
  display_name: string;
}

export default function Dashboard() {
  const [startDate, setStartDate] = useState(() => subDays(new Date(), 30));
  const [endDate, setEndDate] = useState(() => new Date());
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [bitbucketMetrics, setBitbucketMetrics] = useState<BitbucketMetrics | null>(null);
  const [jiraMetrics, setJiraMetrics] = useState<JiraMetrics | null>(null);
  const [teamMetrics, setTeamMetrics] = useState<TeamMemberMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncSuccess, setSyncSuccess] = useState(false);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        startDate: format(startDate, "yyyy-MM-dd"),
        endDate: format(endDate, "yyyy-MM-dd"),
      });
      if (selectedUserId) {
        params.set("userId", selectedUserId);
      }

      const response = await fetch(`/api/metrics?${params}`);
      const data = await response.json();

      setBitbucketMetrics(data.bitbucket);
      setJiraMetrics(data.jira);
      setTeamMetrics(data.team || []);
    } catch (error) {
      console.error("Failed to fetch metrics:", error);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, selectedUserId]);

  const fetchUsers = async () => {
    try {
      const response = await fetch("/api/users");
      const data = await response.json();
      setUsers(data.users || []);
    } catch (error) {
      console.error("Failed to fetch users:", error);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  const handleSync = async () => {
    await Promise.all([
      fetch("/api/sync/bitbucket", { method: "POST" }),
      fetch("/api/sync/jira", { method: "POST" }),
    ]);
    await fetchUsers();
    await fetchMetrics();
    setSyncSuccess(true);
    setTimeout(() => setSyncSuccess(false), 3000);
  };

  const handleExport = (exportFormat: "csv" | "pdf") => {
    const params = new URLSearchParams({
      format: exportFormat,
      startDate: format(startDate, "yyyy-MM-dd"),
      endDate: format(endDate, "yyyy-MM-dd"),
    });
    if (selectedUserId) {
      params.set("userId", selectedUserId);
    }
    window.open(`/api/export?${params}`, "_blank");
  };

  const handleRangeChange = (start: Date, end: Date) => {
    setStartDate(start);
    setEndDate(end);
  };

  return (
    <div className="min-h-screen bg-background">
      <Header onSync={handleSync} onExport={handleExport} />

      {syncSuccess && (
        <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-md mx-4 mt-4">
          Data synced successfully!
        </div>
      )}

      <main className="container mx-auto px-4 py-6 space-y-6">
        <div className="flex flex-wrap items-center gap-4">
          <DateRangePicker
            startDate={startDate}
            endDate={endDate}
            onRangeChange={handleRangeChange}
          />
          <UserSelector
            users={users}
            selectedUserId={selectedUserId}
            onUserChange={setSelectedUserId}
          />
        </div>

        {loading ? (
          <p className="text-muted-foreground">Loading metrics...</p>
        ) : (
          <>
            {bitbucketMetrics && (
              <MetricsCard
                title="Bitbucket"
                metrics={[
                  { label: "PRs Authored", value: bitbucketMetrics.prsAuthored },
                  { label: "PRs Merged", value: bitbucketMetrics.prsMerged },
                  { label: "PRs Reviewed", value: bitbucketMetrics.prsReviewed },
                  { label: "Comments Made", value: bitbucketMetrics.commentsMade },
                  { label: "Avg Comments/PR", value: bitbucketMetrics.avgCommentsPerPr },
                  { label: "Avg PR Size", value: bitbucketMetrics.avgPrSize, unit: "lines" },
                  { label: "Avg Time to Merge", value: bitbucketMetrics.avgTimeToMergeDays, unit: "days" },
                ]}
              />
            )}

            {jiraMetrics && (
              <MetricsCard
                title="JIRA"
                metrics={[
                  { label: "Tickets Worked", value: jiraMetrics.ticketsWorked },
                  { label: "Tickets Completed", value: jiraMetrics.ticketsCompleted },
                  { label: "Story Points", value: jiraMetrics.storyPointsDelivered },
                  { label: "Avg In Progress", value: jiraMetrics.avgTimeInProgressDays, unit: "days" },
                  { label: "Avg In Review", value: jiraMetrics.avgTimeInReviewDays, unit: "days" },
                  { label: "Avg Cycle Time", value: jiraMetrics.avgCycleTimeDays, unit: "days" },
                ]}
              />
            )}

            {!selectedUserId && teamMetrics.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Team Comparison</CardTitle>
                </CardHeader>
                <CardContent>
                  <TeamTable members={teamMetrics} />
                </CardContent>
              </Card>
            )}
          </>
        )}
      </main>
    </div>
  );
}
