/**
 * Hand-rolled production router (extended, not replaced with a routing
 * library — see LOCKED DECISIONS). Pure parse/build functions so routing
 * decisions are independently testable.
 */
export type ProductionRoute =
  | { view: "home" }
  | { view: "workspace"; workspaceId: string; tab?: string }
  | { view: "onboarding" }
  | { view: "invitations" }
  | { view: "create-workspace" }
  | { view: "admin" }
  | { view: "settings" };

const WORKSPACE_ID_RE = "[a-zA-Z0-9_-]{1,64}";
const TAB_RE = "[a-z]+";

export function parseProductionHash(hash: string): ProductionRoute {
  if (hash === "#/onboarding") return { view: "onboarding" };
  if (hash === "#/invitations") return { view: "invitations" };
  if (hash === "#/workspaces/new") return { view: "create-workspace" };
  if (hash === "#/admin") return { view: "admin" };
  if (hash === "#/settings") return { view: "settings" };

  const match = hash.match(new RegExp(`^#/w/(${WORKSPACE_ID_RE})(?:/(${TAB_RE}))?$`));
  if (match) return { view: "workspace", workspaceId: match[1], tab: match[2] };

  return { view: "home" };
}

export function workspaceHash(workspaceId: string, tab?: string): string {
  return tab ? `#/w/${workspaceId}/${tab}` : `#/w/${workspaceId}`;
}

export function navigate(hash: string): void {
  window.location.hash = hash;
}
