import type { MeUser } from "../auth/types";
import { card, cn, meta, sectionTitle } from "../ui/primitives";
import { AdminBadge } from "../ui/badges";

/**
 * Profile/settings. Everything here is read-only display — InternPulse
 * doesn't own an editable profile-write endpoint yet, and per the locked
 * decisions there is no password/change-password flow and no persisted
 * notification-preference storage. See README for the known gap.
 */
export function SettingsPage({ user }: { user: MeUser }) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-4 md:p-6">
      <h1 className="text-xl font-semibold text-text">Profile &amp; settings</h1>

      <section className={cn(card, "flex flex-col gap-2")}>
        <h2 className={sectionTitle}>Profile</h2>
        <Row label="Display name" value={user.displayName} />
        <Row label="Email" value={user.email} hint="Verified by your identity provider — not editable here." />
        <Row label="Account status" value={user.accountStatus} />
        {user.isAdmin && (
          <div className="flex items-center gap-2">
            <span className={meta}>Platform role</span>
            <AdminBadge />
          </div>
        )}
      </section>

      <section className={cn(card, "flex flex-col gap-2")}>
        <h2 className={sectionTitle}>Security</h2>
        <p className={meta}>Authentication is managed by your organization's identity provider via Cloudflare Access.</p>
        <a href="/cdn-cgi/access/logout" className="self-start text-sm font-medium text-accent hover:underline">
          Sign out
        </a>
      </section>

      <section className={cn(card, "flex flex-col gap-2")}>
        <h2 className={sectionTitle}>Notifications</h2>
        <p className={meta}>
          You're notified in-app (via the attention center) for: mentions, blocker activity, weekly review
          status changes, and manager escalations. Per-category preferences aren't configurable yet.
        </p>
      </section>
    </div>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className={meta}>{label}</span>
        <span className="text-sm text-text">{value}</span>
      </div>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}
