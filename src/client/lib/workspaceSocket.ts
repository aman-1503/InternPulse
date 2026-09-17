import type { ClientMessage, ServerMessage } from "../../shared/protocol";

/**
 * "unauthorized" is a terminal state — the server rejected the connection
 * because this identity has no membership in the workspace (see the Worker's
 * `resolveRole` boundary). It is distinct from "closed", which still retries.
 */
export type SocketStatus = "connecting" | "open" | "closed" | "unauthorized";

export interface WorkspaceSocketOptions {
  workspaceId: string;
  userId: string;
  displayName: string;
  /** DEV ONLY role hint; ignored by the server when the identity has a D1 membership. */
  devRole?: string | null;
  onMessage: (msg: ServerMessage) => void;
  onStatusChange: (status: SocketStatus) => void;
}

/**
 * Thin WebSocket client for a single workspace with automatic, backing-off
 * reconnect. The Durable Object replays a full snapshot on every (re)connect,
 * so the client does not need to buffer or replay anything itself.
 *
 * A browser WebSocket can't tell you WHY the upgrade failed — a 403 from the
 * Worker's authorization boundary and a dropped network connection both just
 * fire a generic `close`/`error` event. So before opening the socket we do a
 * cheap HTTP preflight against the same authorization boundary (`/snapshot`):
 * an explicit 403 means "not a member, never will be until membership
 * changes" — stop retrying and surface a clear denied state. Any other
 * outcome (network error, 5xx, timeout) falls through to the normal
 * WebSocket attempt with its existing backoff/retry behavior, so a genuinely
 * flaky network doesn't get misclassified as "unauthorized".
 */
export class WorkspaceSocket {
  private ws: WebSocket | null = null;
  private closedByCaller = false;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly opts: WorkspaceSocketOptions) {}

  connect(): void {
    this.closedByCaller = false;
    this.attempt = 0;
    this.clearTimer();
    void this.preflightThenConnect();
  }

  private async preflightThenConnect(): Promise<void> {
    if (this.closedByCaller) return;
    this.opts.onStatusChange("connecting");
    const qs = new URLSearchParams({ userId: this.opts.userId, displayName: this.opts.displayName });
    if (this.opts.devRole) qs.set("devRole", this.opts.devRole);

    try {
      const res = await fetch(
        `/api/demo/workspace/${encodeURIComponent(this.opts.workspaceId)}/snapshot?${qs}`,
      );
      if (res.status === 403) {
        this.opts.onStatusChange("unauthorized");
        return; // terminal — no reconnect scheduled
      }
    } catch {
      // Preflight itself failed (offline, DNS, etc.) — not evidence of denial.
      // Fall through and let the normal WS attempt + backoff handle it.
    }

    if (this.closedByCaller) return; // caller closed while the preflight was in flight
    this.openSocket();
  }

  private openSocket(): void {
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const qs = new URLSearchParams({
      userId: this.opts.userId,
      displayName: this.opts.displayName,
    });
    if (this.opts.devRole) qs.set("devRole", this.opts.devRole);
    const url = `${scheme}://${location.host}/api/demo/workspace/${encodeURIComponent(
      this.opts.workspaceId,
    )}/ws?${qs}`;

    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.attempt = 0;
      this.opts.onStatusChange("open");
    };
    ws.onmessage = (ev) => {
      try {
        this.opts.onMessage(JSON.parse(ev.data as string) as ServerMessage);
      } catch {
        // ignore malformed frame
      }
    };
    ws.onerror = () => ws.close();
    ws.onclose = () => {
      this.opts.onStatusChange("closed");
      if (!this.closedByCaller) this.scheduleReconnect();
    };
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  close(): void {
    this.closedByCaller = true;
    this.clearTimer();
    this.ws?.close();
    this.ws = null;
  }

  private scheduleReconnect(): void {
    const delay = Math.min(1000 * 2 ** this.attempt, 15_000);
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => this.preflightThenConnect(), delay);
  }

  private clearTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }
}
