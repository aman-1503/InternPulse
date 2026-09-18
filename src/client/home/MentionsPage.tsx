import type { Membership } from "../auth/types";
import { usePortfolio } from "../lib/usePortfolio";
import { LoadingScreen } from "../ui/states";
import { AttentionList } from "./AttentionList";
import { byReasons, flattenAttention } from "./attentionGroups";

export function MentionsPage({ memberships }: { memberships: Membership[] }) {
  const { entries, loading } = usePortfolio(memberships, { kind: "production" });
  if (loading) return <LoadingScreen label="Loading mentions…" />;
  const mentions = byReasons(flattenAttention(entries), ["MENTIONED"]);
  return (
    <div className="mx-auto max-w-3xl p-4 md:p-6">
      <h1 className="mb-4 text-xl font-semibold text-text">Mentions</h1>
      <AttentionList title="Unread mentions" rows={mentions} emptyText="No mentions across your workspaces." />
    </div>
  );
}
