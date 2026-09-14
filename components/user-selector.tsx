"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface User {
  id: number;
  external_id: string;
  display_name: string;
}

interface UserSelectorProps {
  users: User[];
  selectedUserId: string | null;
  onUserChange: (userId: string | null) => void;
}

export function UserSelector({ users, selectedUserId, onUserChange }: UserSelectorProps) {
  return (
    <Select
      value={selectedUserId || "all"}
      onValueChange={(value) => onUserChange(value === "all" ? null : value)}
    >
      <SelectTrigger className="w-[200px]">
        <SelectValue placeholder="Select user" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All Team Members</SelectItem>
        {users.map((user) => (
          <SelectItem key={user.external_id} value={user.external_id}>
            {user.display_name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
