import type {
  AgentAskResponse,
  AgentErrorResponse,
  AgentTurn,
} from "../../shared/protocol";

interface Identity {
  userId: string;
  displayName: string;
}

function qs(identity: Identity, devRole: string): string {
  const p = new URLSearchParams({
    userId: identity.userId,
    displayName: identity.displayName,
  });
  if (devRole) p.set("devRole", devRole);
  return p.toString();
}

function agentUrl(workspaceId: string, identity: Identity, devRole: string): string {
  return `/api/workspace/${encodeURIComponent(workspaceId)}/agent?${qs(identity, devRole)}`;
}

export type AskResult =
  | { ok: true; data: AgentAskResponse }
  | { ok: false; error: AgentErrorResponse };

export async function askAgent(
  workspaceId: string,
  identity: Identity,
  devRole: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<AskResult> {
  const res = await fetch(agentUrl(workspaceId, identity, devRole), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt }),
    signal,
  });
  const body = (await res.json()) as AgentAskResponse | AgentErrorResponse;
  if (res.ok && "answer" in body) return { ok: true, data: body };
  return {
    ok: false,
    error: "error" in body ? body : { error: "request failed", code: "agent_error" },
  };
}

export async function getAgentHistory(
  workspaceId: string,
  identity: Identity,
  devRole: string,
  signal?: AbortSignal,
): Promise<AgentTurn[]> {
  try {
    const res = await fetch(agentUrl(workspaceId, identity, devRole), { signal });
    if (!res.ok) return [];
    const data = (await res.json()) as { turns?: AgentTurn[] };
    return data.turns ?? [];
  } catch {
    return [];
  }
}
