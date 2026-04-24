import { supabase } from "../auth";

export interface AdminWorkspaceUserRecord {
  id: string;
  email: string | null;
  username: string | null;
  is_admin: boolean;
  created_at: string;
  updated_at: string;
}

export const loadAdminWorkspaceUsers = async (): Promise<AdminWorkspaceUserRecord[]> => {
  const { data, error } = await supabase.rpc("list_workspace_users");
  if (error) {
    throw new Error(error.message);
  }

  if (!Array.isArray(data)) {
    return [];
  }

  return data.filter(
    (entry): entry is AdminWorkspaceUserRecord =>
      Boolean(
        entry &&
          typeof entry === "object" &&
          typeof (entry as { id?: unknown }).id === "string" &&
          typeof (entry as { created_at?: unknown }).created_at === "string" &&
          typeof (entry as { updated_at?: unknown }).updated_at === "string"
      )
  );
};
