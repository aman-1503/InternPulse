import type { AgentAskResponse, AgentErrorResponse, AgentTurn } from "../../shared/protocol";
import { identityQuery, withQuery, workspaceBase, type WorkspaceMode } from "./workspaceApi";

function agentUrl(workspaceId: string, mode: WorkspaceMode): string {
  return withQuery(`${workspaceBase(workspaceId, mode)}/agent`, identityQuery(mode));
}

export type AskResult = { ok: true; data: AgentAskResponse } | { ok: false; error: AgentErrorResponse };

export async function askAgent(
  workspaceId: string,
  mode: WorkspaceMode,
  prompt: string,
  signal?: AbortSignal,
): Promise<AskResult> {
  const res = await fetch(agentUrl(workspaceId, mode), {
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
  mode: WorkspaceMode,
  signal?: AbortSignal,
): Promise<AgentTurn[]> {
  try {
    const res = await fetch(agentUrl(workspaceId, mode), { signal });
    if (!res.ok) return [];
    const data = (await res.json()) as { turns?: AgentTurn[] };
    return data.turns ?? [];
  } catch {
    return [];
  }
}
