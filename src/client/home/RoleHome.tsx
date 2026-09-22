import type { MeUser, Membership } from "../auth/types";
import { deriveHomeRole } from "../auth/decisions";
import { InternHome } from "./InternHome";
import { MentorHome } from "./MentorHome";
import { ManagerHome } from "./ManagerHome";
import { EmptyState } from "../ui/states";

export function RoleHome({ user, memberships }: { user: MeUser; memberships: Membership[] }) {
  const role = deriveHomeRole(memberships);
  if (role === "manager") return <ManagerHome user={user} memberships={memberships} />;
  if (role === "mentor") return <MentorHome user={user} memberships={memberships} />;
  if (role === "intern") return <InternHome user={user} memberships={memberships} />;
  return <EmptyState title="No workspace memberships" description="Accept an invitation or create a workspace to get started." />;
}
