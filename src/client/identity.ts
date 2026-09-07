/**
 * DEV / DEMO identity only. The browser picks who it is. This is NOT
 * authentication and is never treated as such by the Worker or the DO.
 * A real identity provider will replace this module in a later phase.
 */
import { useCallback, useState } from "react";
import type { Role } from "../shared/protocol";

export interface DemoIdentity {
  userId: string;
  displayName: string;
}

/** Matches seed/dev-seed.sql so D1 membership resolves a real role. */
export const SEEDED_IDENTITIES: ReadonlyArray<DemoIdentity & { seededRole: Role }> = [
  { userId: "u-alice", displayName: "Alice Chen", seededRole: "intern" },
  { userId: "u-mia", displayName: "Mia Rivera", seededRole: "mentor" },
  { userId: "u-jordan", displayName: "Jordan Park", seededRole: "manager" },
];

const ID_KEY = "internpulse.identity.v2";
const ROLE_KEY = "internpulse.devRole";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore private-mode / disabled storage */
  }
}

function makeGuest(): DemoIdentity {
  return {
    userId: `u-guest-${Math.random().toString(36).slice(2, 8)}`,
    displayName: `Guest ${Math.floor(Math.random() * 90 + 10)}`,
  };
}

/**
 * Identity + a DEV role hint (only used when the identity has no D1 membership).
 */
export function useIdentity() {
  const [identity, setIdentityState] = useState<DemoIdentity>(() => {
    const stored = read<DemoIdentity | null>(ID_KEY, null);
    if (stored?.userId) return stored;
    const guest = makeGuest();
    write(ID_KEY, guest);
    return guest;
  });

  const [devRole, setDevRoleState] = useState<Role>(() => read<Role>(ROLE_KEY, "intern"));

  const setIdentity = useCallback((next: DemoIdentity) => {
    write(ID_KEY, next);
    setIdentityState(next);
  }, []);

  const setDevRole = useCallback((next: Role) => {
    write(ROLE_KEY, next);
    setDevRoleState(next);
  }, []);

  const isSeeded = SEEDED_IDENTITIES.some((s) => s.userId === identity.userId);

  return { identity, setIdentity, devRole, setDevRole, isSeeded, newGuest: () => setIdentity(makeGuest()) };
}
