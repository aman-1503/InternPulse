import { useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { createWorkspace, ApiError } from "../lib/api";
import { navigate, workspaceHash } from "../router";
import { btn, card, cn, input, meta, pageTitle, row, stack } from "../ui/primitives";
import { Banner } from "../ui/states";

type CreatorRole = "mentor" | "manager";

interface PersonField {
  email: string;
  displayName: string;
}

export function CreateWorkspaceForm() {
  const { state, refresh } = useAuth();
  const user = state.status === "authenticated" ? state.user : null;

  const [creatorRole, setCreatorRole] = useState<CreatorRole | null>(null);
  const [name, setName] = useState("");
  const [team, setTeam] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [intern, setIntern] = useState<PersonField>({ email: "", displayName: "" });
  const [mentor, setMentor] = useState<PersonField>({ email: "", displayName: "" });
  const [manager, setManager] = useState<PersonField>({ email: "", displayName: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) return null;

  const chooseRole = (role: CreatorRole) => {
    setCreatorRole(role);
    const mine: PersonField = { email: user.email, displayName: user.displayName };
    if (role === "mentor") setMentor(mine);
    else setManager(mine);
  };

  const canSubmit =
    creatorRole && name.trim() && intern.email && intern.displayName && mentor.email && mentor.displayName && manager.email && manager.displayName;

  const submit = async () => {
    if (!creatorRole) return;
    setBusy(true);
    setError(null);
    try {
      const { workspace } = await createWorkspace({
        name: name.trim(),
        creatorRole,
        intern,
        mentor,
        manager,
        team: team.trim() || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });
      refresh();
      navigate(workspaceHash(workspace.id, "settings"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Network error — please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!creatorRole) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-4">
        <div className="mb-2 flex flex-col items-center gap-3 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-base font-bold text-white shadow-sm">IP</span>
          <div>
            <h1 className="text-lg font-semibold text-text">Set up a new workspace</h1>
            <p className={meta}>Are you setting this up as the mentor or the manager of this internship/project?</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <button
            className={cn(card, "flex flex-col items-center gap-1 py-6 text-center font-medium transition-colors hover:border-accent hover:bg-accent-muted/30")}
            onClick={() => chooseRole("mentor")}
          >
            Mentor
          </button>
          <button
            className={cn(card, "flex flex-col items-center gap-1 py-6 text-center font-medium transition-colors hover:border-accent hover:bg-accent-muted/30")}
            onClick={() => chooseRole("manager")}
          >
            Manager
          </button>
        </div>
        <p className={cn(meta, "text-center")}>Interns join through invitation only — there's no self-service intern signup.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-4 md:p-6">
      <div>
        <h1 className={pageTitle}>New workspace — you're the {creatorRole}</h1>
        <p className={meta}>
          Invited people must sign in with the exact email address below. Roles come from
          membership/invitation only — nobody can self-promote later.
        </p>
      </div>

      {error && <Banner tone="danger">{error}</Banner>}

      <section className={cn(card, stack)}>
        <label className="text-sm font-medium" htmlFor="ws-name">
          Project / internship name
        </label>
        <input id="ws-name" className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Payments Service Revamp" />
        <div className={row}>
          <div className="flex-1">
            <label className="text-sm font-medium" htmlFor="ws-team">
              Team (optional)
            </label>
            <input id="ws-team" className={input} value={team} onChange={(e) => setTeam(e.target.value)} />
          </div>
          <div className="flex-1">
            <label className="text-sm font-medium" htmlFor="ws-start-date">
              Start date (optional)
            </label>
            <input id="ws-start-date" type="date" className={input} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="flex-1">
            <label className="text-sm font-medium" htmlFor="ws-end-date">
              End date (optional)
            </label>
            <input id="ws-end-date" type="date" className={input} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        </div>
      </section>

      <PersonSection title="Intern" value={intern} onChange={setIntern} />
      <PersonSection title="Mentor" value={mentor} onChange={setMentor} lockedToSelf={creatorRole === "mentor"} />
      <PersonSection title="Manager" value={manager} onChange={setManager} lockedToSelf={creatorRole === "manager"} />

      <div className={row}>
        <button className={btn("primary")} disabled={!canSubmit || busy} onClick={submit}>
          {busy ? "Creating…" : "Create workspace"}
        </button>
        <button className={btn("default")} onClick={() => setCreatorRole(null)}>
          Back
        </button>
      </div>
    </div>
  );
}

function PersonSection({
  title,
  value,
  onChange,
  lockedToSelf,
}: {
  title: string;
  value: PersonField;
  onChange: (v: PersonField) => void;
  lockedToSelf?: boolean;
}) {
  return (
    <section className={cn(card, stack)}>
      <h2 className="text-sm font-semibold text-text">{title}</h2>
      {lockedToSelf && <p className={meta}>This is you — matched to your signed-in email.</p>}
      <div className={row}>
        <input
          className={cn(input, "flex-1")}
          placeholder="Email"
          type="email"
          value={value.email}
          disabled={lockedToSelf}
          onChange={(e) => onChange({ ...value, email: e.target.value })}
        />
        <input
          className={cn(input, "flex-1")}
          placeholder="Display name"
          value={value.displayName}
          disabled={lockedToSelf}
          onChange={(e) => onChange({ ...value, displayName: e.target.value })}
        />
      </div>
    </section>
  );
}
