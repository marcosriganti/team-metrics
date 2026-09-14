"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface StatusMapping {
  jira_status_name: string;
  category: string;
}

interface StatusMapperProps {
  statuses: string[];
  mappings: StatusMapping[];
  onMappingChange: (status: string, category: string) => void;
}

const CATEGORIES = [
  { value: "progress", label: "In Progress" },
  { value: "review", label: "In Review" },
  { value: "blocked", label: "Blocked" },
  { value: "done", label: "Done" },
  { value: "other", label: "Other" },
];

export function StatusMapper({ statuses, mappings, onMappingChange }: StatusMapperProps) {
  const getCategory = (status: string): string => {
    const mapping = mappings.find((m) => m.jira_status_name === status);
    return mapping?.category || "other";
  };

  if (statuses.length === 0) {
    return (
      <p className="text-muted-foreground">
        No JIRA statuses found. Run a sync first to discover workflow statuses.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {statuses.map((status) => (
        <div key={status} className="flex items-center gap-4">
          <span className="w-48 font-medium">{status}</span>
          <Select
            value={getCategory(status)}
            onValueChange={(value) => onMappingChange(status, value)}
          >
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((cat) => (
                <SelectItem key={cat.value} value={cat.value}>
                  {cat.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}
    </div>
  );
}
