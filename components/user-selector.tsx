"use client";

import { Combobox } from "@/components/ui/combobox";

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
  const options = users.map((user) => ({
    value: user.external_id,
    label: user.display_name,
  }));

  return (
    <Combobox
      options={options}
      value={selectedUserId}
      onValueChange={onUserChange}
      placeholder="All Team Members"
      searchPlaceholder="Search members..."
      emptyText="No members found."
      className="w-[250px]"
    />
  );
}
