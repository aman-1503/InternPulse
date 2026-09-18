import type { ReactNode } from "react";
import { useAuth } from "./AuthProvider";
import { btn, card, cn, meta } from "../ui/primitives";
import { LoadingScreen } from "../ui/states";

function CenteredScreen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className={cn(card, "w-full max-w-md text-center")}>
        <h1 className="mb-2 text-lg font-semibold text-text">{title}</h1>
        {children}
      </div>
    </div>
  );
}

/**
 * Gates the entire production app on auth state (PART 3). Only once state is
 * "authenticated" do we render the real app — every other state gets an
 * explicit, distinguishable screen instead of a raw error or a stuck spinner.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { state, refresh } = useAuth();

  if (state.status === "loading") return <LoadingScreen label="Signing you in…" />;

  if (state.status === "authenticated") return <>{children}</>;

  if (state.status === "unauthenticated") {
    return (
      <CenteredScreen title="Sign-in required">
        <p className={cn(meta, "mb-4")}>
          Your session has expired or you're not signed in. InternPulse uses your organization's
          identity provider via Cloudflare Access — reload to sign in again.
        </p>
        <button className={btn("primary")} onClick={() => window.location.reload()}>
          Reload
        </button>
      </CenteredScreen>
    );
  }

  if (state.status === "suspended") {
    return (
      <CenteredScreen title="Your account is suspended">
        <p className={meta}>
          A platform admin has suspended this account. Contact your organization's InternPulse admin
          to restore access.
        </p>
      </CenteredScreen>
    );
  }

  if (state.status === "disabled") {
    return (
      <CenteredScreen title="Your account is disabled">
        <p className={meta}>This account has been disabled. Contact your organization's InternPulse admin.</p>
      </CenteredScreen>
    );
  }

  if (state.status === "identity_conflict") {
    return (
      <CenteredScreen title="We couldn't verify your identity">
        <p className={cn(meta, "mb-4")}>{state.message}</p>
        <p className={meta}>
          This usually means your email is already linked to a different sign-in method. A platform
          admin needs to resolve this before you can continue.
        </p>
      </CenteredScreen>
    );
  }

  if (state.status === "forbidden") {
    return (
      <CenteredScreen title="Access denied">
        <p className={meta}>{state.message}</p>
      </CenteredScreen>
    );
  }

  // network_error
  return (
    <CenteredScreen title="Couldn't reach InternPulse">
      <p className={cn(meta, "mb-4")}>
        There was a network problem loading your account. Check your connection and try again.
      </p>
      <button className={btn("primary")} onClick={refresh}>
        Try again
      </button>
    </CenteredScreen>
  );
}
