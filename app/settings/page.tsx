"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusMapper } from "@/components/status-mapper";

interface StatusMapping {
  jira_status_name: string;
  category: string;
}

export default function SettingsPage() {
  const [statuses, setStatuses] = useState<string[]>([]);
  const [mappings, setMappings] = useState<StatusMapping[]>([]);
  const [pendingChanges, setPendingChanges] = useState<Map<string, string>>(new Map());
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const response = await fetch("/api/settings");
        const data = await response.json();
        setStatuses(data.availableStatuses || []);
        setMappings(data.mapping || []);
      } catch (error) {
        console.error("Failed to fetch settings:", error);
      }
    };
    fetchSettings();
  }, []);

  const handleMappingChange = (status: string, category: string) => {
    setPendingChanges((prev) => {
      const next = new Map(prev);
      next.set(status, category);
      return next;
    });
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const mappingsToSave = Array.from(pendingChanges.entries()).map(([status, category]) => ({
        status,
        category,
      }));

      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mappings: mappingsToSave }),
      });

      // Update local state
      setMappings((prev) => {
        const updated = [...prev];
        for (const [status, category] of pendingChanges) {
          const existing = updated.find((m) => m.jira_status_name === status);
          if (existing) {
            existing.category = category;
          } else {
            updated.push({ jira_status_name: status, category });
          }
        }
        return updated;
      });

      setPendingChanges(new Map());
      setSaved(true);
    } catch (error) {
      console.error("Failed to save settings:", error);
    } finally {
      setSaving(false);
    }
  };

  const hasChanges = pendingChanges.size > 0;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-xl font-bold">Settings</h1>
          <Link href="/">
            <Button variant="ghost">Back to Dashboard</Button>
          </Link>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        <Card>
          <CardHeader>
            <CardTitle>JIRA Status Mapping</CardTitle>
            <CardDescription>
              Map your JIRA workflow statuses to categories for accurate time tracking metrics.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <StatusMapper
              statuses={statuses}
              mappings={mappings}
              onMappingChange={handleMappingChange}
            />

            <div className="flex items-center gap-4">
              <Button onClick={handleSave} disabled={!hasChanges || saving}>
                {saving ? "Saving..." : "Save Mapping"}
              </Button>
              {saved && <span className="text-sm text-green-600">Saved successfully!</span>}
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
