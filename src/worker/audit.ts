/** Append-only security/admin audit trail. Never store secrets/JWTs here. */
export interface AuditEventInput {
  actorUserId: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  workspaceId?: string | null;
  /** Small, bounded, non-secret context. Serialized and truncated defensively. */
  metadata?: Record<string, unknown>;
}

export async function recordAudit(env: Env, event: AuditEventInput): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO audit_events
         (id, actor_user_id, action, target_type, target_id, workspace_id, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        event.actorUserId,
        event.action,
        event.targetType ?? null,
        event.targetId ?? null,
        event.workspaceId ?? null,
        event.metadata ? JSON.stringify(event.metadata).slice(0, 2000) : null,
        Date.now(),
      )
      .run();
  } catch (err) {
    // Audit logging must never break the underlying action.
    console.error("audit log write failed (non-fatal)", err);
  }
}
