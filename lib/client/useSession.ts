"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/client/api";

export interface ClientSessionUser {
  id: string;
  email: string;
  name: string;
  role: "CITIZEN" | "AUTHORITY" | "ADMIN";
  authorityId: string | null;
}

export function useSession() {
  const [user, setUser] = useState<ClientSessionUser | null | undefined>(undefined); // undefined = loading

  const refresh = useCallback(() => {
    apiGet<ClientSessionUser | null>("/api/auth/session")
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await apiPost("/api/auth/logout");
    setUser(null);
  }, []);

  return { user, loading: user === undefined, refresh, logout };
}
