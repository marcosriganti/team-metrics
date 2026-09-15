"use client";

import * as React from "react";
import { ArrowUpDown, ArrowUp, ArrowDown, ChevronDown, Eye } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface Column<T> {
  id: string;
  header: string;
  accessor: (row: T) => React.ReactNode;
  sortValue?: (row: T) => number | string;
  align?: "left" | "right" | "center";
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  getRowKey: (row: T) => string;
}

type SortDirection = "asc" | "desc" | null;

export function DataTable<T>({
  columns,
  data,
  getRowKey,
}: DataTableProps<T>) {
  const [sortColumn, setSortColumn] = React.useState<string | null>(null);
  const [sortDirection, setSortDirection] = React.useState<SortDirection>(null);
  const [hiddenColumns, setHiddenColumns] = React.useState<Set<string>>(new Set());

  const handleSort = (columnId: string) => {
    if (sortColumn === columnId) {
      if (sortDirection === "asc") {
        setSortDirection("desc");
      } else if (sortDirection === "desc") {
        setSortColumn(null);
        setSortDirection(null);
      }
    } else {
      setSortColumn(columnId);
      setSortDirection("asc");
    }
  };

  const sortedData = React.useMemo(() => {
    if (!sortColumn || !sortDirection) return data;

    const column = columns.find((c) => c.id === sortColumn);
    if (!column?.sortValue) return data;

    return [...data].sort((a, b) => {
      const aVal = column.sortValue!(a);
      const bVal = column.sortValue!(b);

      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
      }

      const aStr = String(aVal);
      const bStr = String(bVal);
      return sortDirection === "asc"
        ? aStr.localeCompare(bStr)
        : bStr.localeCompare(aStr);
    });
  }, [data, columns, sortColumn, sortDirection]);

  const visibleColumns = columns.filter((c) => !hiddenColumns.has(c.id));

  const toggleColumn = (columnId: string, visible: boolean) => {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (visible) {
        next.delete(columnId);
      } else {
        next.add(columnId);
      }
      return next;
    });
  };

  const getSortIcon = (columnId: string) => {
    if (sortColumn !== columnId) {
      return <ArrowUpDown className="ml-2 h-4 w-4" />;
    }
    return sortDirection === "asc" ? (
      <ArrowUp className="ml-2 h-4 w-4" />
    ) : (
      <ArrowDown className="ml-2 h-4 w-4" />
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {data.length} member(s)
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Eye className="mr-2 h-4 w-4" />
              Columns
              <ChevronDown className="ml-2 h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {columns.map((column) => (
              <DropdownMenuCheckboxItem
                key={column.id}
                checked={!hiddenColumns.has(column.id)}
                onCheckedChange={(checked) => toggleColumn(column.id, checked)}
              >
                {column.header}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {visibleColumns.map((column) => (
                <TableHead
                  key={column.id}
                  className={column.align === "right" ? "text-right" : ""}
                >
                  {column.sortValue ? (
                    <Button
                      variant="ghost"
                      onClick={() => handleSort(column.id)}
                      className={column.align === "right" ? "-mr-4" : "-ml-4"}
                    >
                      {column.header}
                      {getSortIcon(column.id)}
                    </Button>
                  ) : (
                    column.header
                  )}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedData.length > 0 ? (
              sortedData.map((row) => (
                <TableRow key={getRowKey(row)}>
                  {visibleColumns.map((column) => (
                    <TableCell
                      key={column.id}
                      className={column.align === "right" ? "text-right" : ""}
                    >
                      {column.accessor(row)}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={visibleColumns.length}
                  className="h-24 text-center"
                >
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
