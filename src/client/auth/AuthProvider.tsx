import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { deriveAuthState } from "./deriveAuthState";
import type { AuthState, MeFetchResult } from "./types";

async function fetchMe(): Promise<MeFetchResult> {
  try {
    const res = await fetch("/api/me", { headers: { accept: "application/json" } });
    const body = await res.json().catch(() => null);
    return { kind: "response", status: res.status, body };
  } catch {
    return { kind: "network_error" };
  }
}

interface AuthContextValue {
  state: AuthState;
  /** Re-fetch /api/me — call after accepting an invite, or to retry a network error. */
  refresh: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * The ONE place production identity/session state is derived. Every screen
 * reads `useAuth()` rather than independently interpreting a fetch result —
 * see PART 1 of the productionization spec.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  const refresh = useCallback(() => {
    setState({ status: "loading" });
    fetchMe().then((result) => setState(deriveAuthState(result)));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return <AuthContext.Provider value={{ state, refresh }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth() must be used within <AuthProvider>");
  return ctx;
}
