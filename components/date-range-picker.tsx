"use client";

import { useState } from "react";
import { format, subDays } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface DateRangePickerProps {
  startDate: Date;
  endDate: Date;
  onRangeChange: (start: Date, end: Date) => void;
}

export function DateRangePicker({ startDate, endDate, onRangeChange }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);

  const presets = [
    { label: "Last 7 days", days: 7 },
    { label: "Last 30 days", days: 30 },
    { label: "Last 90 days", days: 90 },
  ];

  return (
    <div className="flex items-center gap-2">
      {presets.map((preset) => (
        <Button
          key={preset.days}
          variant="outline"
          size="sm"
          onClick={() => onRangeChange(subDays(new Date(), preset.days), new Date())}
        >
          {preset.label}
        </Button>
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            {format(startDate, "MMM d")} - {format(endDate, "MMM d, yyyy")}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="range"
            selected={{ from: startDate, to: endDate }}
            onSelect={(range) => {
              if (range?.from && range?.to) {
                onRangeChange(range.from, range.to);
                setOpen(false);
              }
            }}
            numberOfMonths={2}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
