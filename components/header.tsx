"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useState } from "react";

interface HeaderProps {
  onSync: () => Promise<void>;
  onExport: (format: "csv" | "pdf") => void;
}

export function Header({ onSync, onExport }: HeaderProps) {
  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await onSync();
    } finally {
      setSyncing(false);
    }
  };

  return (
    <header className="border-b">
      <div className="container mx-auto px-4 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">Team Metrics</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => onExport("csv")}>
            Export CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => onExport("pdf")}>
            Export PDF
          </Button>
          <Button onClick={handleSync} disabled={syncing}>
            {syncing ? "Syncing..." : "Sync Now"}
          </Button>
          <Link href="/settings">
            <Button variant="ghost">Settings</Button>
          </Link>
        </div>
      </div>
    </header>
  );
}
