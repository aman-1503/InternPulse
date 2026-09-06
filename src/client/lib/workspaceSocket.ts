import type { ClientMessage, ServerMessage } from "../../shared/protocol";

export type SocketStatus = "connecting" | "open" | "closed";

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
 */
export class WorkspaceSocket {
  private ws: WebSocket | null = null;
  private closedByCaller = false;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly opts: WorkspaceSocketOptions) {}

  connect(): void {
    this.closedByCaller = false;
    this.clearTimer();
    this.opts.onStatusChange("connecting");

    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const qs = new URLSearchParams({
      userId: this.opts.userId,
      displayName: this.opts.displayName,
    });
    if (this.opts.devRole) qs.set("devRole", this.opts.devRole);
    const url = `${scheme}://${location.host}/api/workspace/${encodeURIComponent(
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
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private clearTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }
}
