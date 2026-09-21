import { useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import type { MeUser } from "../auth/types";
import { ApiError, updateDisplayName } from "../lib/api";
import { btn, card, cn, input, meta, pageTitle, row, sectionTitle } from "../ui/primitives";
import { AdminBadge } from "../ui/badges";
import { Banner } from "../ui/states";

/**
 * Profile/settings. Email/account status/security are read-only display
 * (Access owns identity; there is no password/change-password flow and no
 * persisted notification-preference storage, per the locked decisions).
 * Display name IS editable — Access frequently doesn't supply a `name`
 * claim, which otherwise permanently defaults it to the raw email.
 */
export function SettingsPage({ user }: { user: MeUser }) {
  const { refresh } = useAuth();
  const [name, setName] = useState(user.displayName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = name.trim() !== user.displayName && name.trim().length > 0;

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await updateDisplayName(name.trim());
      refresh();
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save — please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-4 md:p-6">
      <h1 className={pageTitle}>Profile &amp; settings</h1>

      <section className={cn(card, "flex flex-col gap-3")}>
        <h2 className={sectionTitle}>Profile</h2>

        <div>
          <label className={cn(meta, "mb-1 block")} htmlFor="display-name">
            Display name
          </label>
          <div className={row}>
            <input
              id="display-name"
              className={cn(input, "flex-1")}
              value={name}
              maxLength={200}
              onChange={(e) => {
                setName(e.target.value);
                setSaved(false);
              }}
            />
            <button className={btn("primary")} disabled={!dirty || busy} onClick={save}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
          {saved && <p className="mt-1 text-xs text-success">Saved.</p>}
          {error && (
            <div className="mt-2">
              <Banner tone="danger">{error}</Banner>
            </div>
          )}
        </div>

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
